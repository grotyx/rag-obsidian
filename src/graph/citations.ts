import { App, TFile, normalizePath, debounce } from "obsidian";
import { Library } from "../data/library";
import { CSLItem, ScholarRagSettings } from "../types";
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
  /** `missingFrequent` costs an OpenAlex round trip and the Related pane asks on every note
   *  switch; the answer only changes when the graph does. A rejected lookup is not kept. */
  private missingCache = new Map<number, Promise<MissingPaper[]>>();
  /** Notes added since the last build, waiting for their one OpenAlex lookup. */
  private addQueue = new Set<string>();
  private flush: () => void;
  /** Every mutation (build / incremental add / prune) is chained so two can't interleave
   *  their read-modify-persist of `this.data`. */
  private chain: Promise<unknown> = Promise.resolve();
  /** Views that redraw when the graph gains or loses nodes behind their back. */
  private listeners = new Set<() => void>();

  constructor(
    private app: App,
    private library: Library,
    public settings: ScholarRagSettings,
    pluginDir: string
  ) {
    this.path = normalizePath(`${pluginDir}/index/citations.json`);
    this.flush = debounce(() => void this.flushAdds(), 3000, true);
  }

  /** Subscribe to graph changes; returns the unsubscribe. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emitChange(): void {
    for (const fn of this.listeners) fn();
  }

  private serialized<T>(job: () => Promise<T>): Promise<T> {
    const run = this.chain.then(job);
    this.chain = run.catch(() => undefined);
    return run;
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
        this.missingCache.clear();
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
  build(onProgress?: (done: number, total: number) => void): Promise<number> {
    return this.serialized(() => this.buildNow(onProgress));
  }

  private async buildNow(onProgress?: (done: number, total: number) => void): Promise<number> {
    this.addQueue.clear(); // a full pass covers everything queued
    const entries = this.library.entries(); // one vault pass (list()+getItem() per note was O(n²))
    const data: GraphData = { byCitekey: {}, idToCitekey: {} };
    let done = 0;
    for (const e of entries) {
      const w = await resolveWork(e.item, this.settings.openalexMailto);
      if (w && w.openalexId) {
        data.byCitekey[e.citekey] = { openalexId: w.openalexId, refs: w.referencedWorks };
        data.idToCitekey[w.openalexId] = e.citekey;
        // Frontmatter-only write: the indexer's content hash keeps this from re-embedding the note.
        await this.backfillId(e.file, w.openalexId);
      } else if (this.data.byCitekey[e.citekey]) {
        // Transient failure (e.g. 429): keep the previously resolved node.
        const prev = this.data.byCitekey[e.citekey];
        data.byCitekey[e.citekey] = prev;
        data.idToCitekey[prev.openalexId] = e.citekey;
      }
      onProgress?.(++done, entries.length);
    }
    this.data = data;
    this.missingCache.clear();
    await this.persist();
    this.emitChange();
    return this.size;
  }

  /** Queue a newly added/edited reference note for a single OpenAlex lookup, so the graph
   *  stays current without a full rebuild. Incoming edges need no work: the notes that cite
   *  it already carry its id in their `refs`. */
  enqueue(file: TFile): void {
    if (!this.size) return; // never built — don't start network traffic the user didn't ask for
    const prefix = normalizePath(this.settings.referencesFolder) + "/";
    if (!file.path.startsWith(prefix)) return;
    this.addQueue.add(file.path);
    this.flush();
  }

  private flushAdds(): Promise<void> {
    return this.serialized(async () => {
      const paths = [...this.addQueue];
      this.addQueue.clear();
      let changed = false;
      for (const path of paths) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) continue;
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        const citekey = fm?.citekey ? String(fm.citekey) : "";
        if (!citekey || this.data.byCitekey[citekey]) continue;
        try {
          const w = await resolveWork(fm as unknown as CSLItem, this.settings.openalexMailto);
          if (!w?.openalexId) continue;
          this.data.byCitekey[citekey] = { openalexId: w.openalexId, refs: w.referencedWorks };
          this.data.idToCitekey[w.openalexId] = citekey;
          await this.backfillId(file, w.openalexId);
          changed = true;
        } catch {
          /* offline / rate-limited — the next add or a full build picks this note up */
        }
      }
      if (changed) {
        this.missingCache.clear();
        await this.persist();
        this.emitChange();
      }
    });
  }

  /** Drop nodes whose note no longer exists (delete, or a rename that changed the citekey).
   *  One vault pass, no network. Ids other notes cite simply count as "missing" again. */
  prune(): Promise<void> {
    if (!this.size) return Promise.resolve();
    return this.serialized(async () => {
      const live = new Set(this.library.entries().map((e) => e.citekey));
      let changed = false;
      for (const [ck, node] of Object.entries(this.data.byCitekey)) {
        if (live.has(ck)) continue;
        delete this.data.idToCitekey[node.openalexId];
        delete this.data.byCitekey[ck];
        changed = true;
      }
      if (changed) {
        this.missingCache.clear();
        await this.persist();
        this.emitChange();
      }
    });
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

  /** Raw OpenAlex ids this paper cites, in or out of the library — the map uses it to
   *  draw a "missing" work only when the active paper actually cites it. */
  refIds(citekey: string): string[] {
    return this.data.byCitekey[citekey]?.refs ?? [];
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
  missingFrequent(minCount = 2): Promise<MissingPaper[]> {
    const cached = this.missingCache.get(minCount);
    if (cached) return cached;
    const p = this.computeMissing(minCount).catch((e: unknown) => {
      this.missingCache.delete(minCount);
      throw e;
    });
    this.missingCache.set(minCount, p);
    return p;
  }

  private async computeMissing(minCount: number): Promise<MissingPaper[]> {
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
