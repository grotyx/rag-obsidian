import { App, TFile, normalizePath } from "obsidian";
import { Library } from "../data/library";
import { ScholarRagSettings } from "../types";
import { resolveWork, fetchTitles } from "./openalex";

interface GraphData {
  byCitekey: Record<string, { openalexId: string; refs: string[] }>;
  idToCitekey: Record<string, string>;
}

export interface MissingPaper {
  openalexId: string;
  title: string;
  count: number;
}

export interface CoupledPaper {
  citekey: string;
  shared: number;
}

/** Citation graph built from OpenAlex `referenced_works` edges — structured,
 *  free, no LLM. Powers "related papers" and "papers you're missing". */
export class CitationGraph {
  private data: GraphData = { byCitekey: {}, idToCitekey: {} };
  private path: string;

  constructor(
    private app: App,
    private library: Library,
    public settings: ScholarRagSettings,
    pluginDir: string
  ) {
    this.path = normalizePath(`${pluginDir}/index/citations.json`);
  }

  get size(): number {
    return Object.keys(this.data.byCitekey).length;
  }
  has(citekey: string): boolean {
    return !!this.data.byCitekey[citekey];
  }

  async restore(): Promise<void> {
    const a = this.app.vault.adapter;
    if (await a.exists(this.path)) {
      try {
        this.data = JSON.parse(await a.read(this.path));
      } catch {
        /* ignore corrupt cache */
      }
    }
  }

  private async persist(): Promise<void> {
    const a = this.app.vault.adapter;
    const dir = this.path.split("/").slice(0, -1).join("/");
    if (!(await a.exists(dir))) await a.mkdir(dir);
    await a.write(this.path, JSON.stringify(this.data));
  }

  /** Build the graph over the whole library (1 OpenAlex request per paper). */
  async build(onProgress?: (done: number, total: number) => void): Promise<number> {
    const entries = this.library.list();
    const data: GraphData = { byCitekey: {}, idToCitekey: {} };
    let done = 0;
    for (const e of entries) {
      const item = this.library.getItem(e.citekey);
      if (item) {
        const w = await resolveWork(item, this.settings.openalexMailto);
        if (w && w.openalexId) {
          data.byCitekey[e.citekey] = { openalexId: w.openalexId, refs: w.referencedWorks };
          data.idToCitekey[w.openalexId] = e.citekey;
          await this.backfillId(e.file, w.openalexId);
        } else if (this.data.byCitekey[e.citekey]) {
          // Transient failure (e.g. 429): keep the previously resolved node.
          const prev = this.data.byCitekey[e.citekey];
          data.byCitekey[e.citekey] = prev;
          data.idToCitekey[prev.openalexId] = e.citekey;
        }
      }
      onProgress?.(++done, entries.length);
    }
    this.data = data;
    await this.persist();
    return this.size;
  }

  private async backfillId(file: TFile, openalexId: string): Promise<void> {
    try {
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        if (!fm.openalex_id) fm.openalex_id = openalexId;
      });
    } catch {
      /* non-fatal */
    }
  }

  /** Library papers that THIS paper cites. */
  referencesInLibrary(citekey: string): string[] {
    const node = this.data.byCitekey[citekey];
    if (!node) return [];
    return node.refs.map((id) => this.data.idToCitekey[id]).filter(Boolean);
  }

  /** Library papers that cite THIS paper. */
  citedByInLibrary(citekey: string): string[] {
    const node = this.data.byCitekey[citekey];
    if (!node) return [];
    const myId = node.openalexId;
    const out: string[] = [];
    for (const [ck, n] of Object.entries(this.data.byCitekey)) {
      if (ck !== citekey && n.refs.includes(myId)) out.push(ck);
    }
    return out;
  }

  /** Bibliographic coupling: library papers sharing ≥minShared referenced works. */
  coupled(citekey: string, minShared = 2): CoupledPaper[] {
    const node = this.data.byCitekey[citekey];
    if (!node) return [];
    const mine = new Set(node.refs);
    const scored: CoupledPaper[] = [];
    for (const [ck, n] of Object.entries(this.data.byCitekey)) {
      if (ck === citekey) continue;
      const shared = new Set(n.refs.filter((r) => mine.has(r))).size;
      if (shared >= minShared) scored.push({ citekey: ck, shared });
    }
    return scored.sort((a, b) => b.shared - a.shared);
  }

  /** Works cited by ≥minCount library papers but absent from the library. */
  async missingFrequent(minCount = 2): Promise<MissingPaper[]> {
    const count: Record<string, number> = {};
    for (const n of Object.values(this.data.byCitekey)) {
      for (const r of new Set(n.refs)) {
        if (!this.data.idToCitekey[r]) count[r] = (count[r] || 0) + 1;
      }
    }
    const freq = Object.entries(count)
      .filter(([, c]) => c >= minCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25);
    if (freq.length === 0) return [];
    const titles = await fetchTitles(
      freq.map(([id]) => id),
      this.settings.openalexMailto
    );
    return freq.map(([id, c]) => ({ openalexId: id, title: titles.get(id)?.title || id, count: c }));
  }
}
