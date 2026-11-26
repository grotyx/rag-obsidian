import { App, TFile, normalizePath, debounce } from "obsidian";
import { Library } from "../data/library";
import { CSLItem, ScholarRagSettings } from "../types";
import { text } from "../util/json";
import { resolveWork, fetchTitles, shortId, normalizeDoi } from "./openalex";

interface GraphData {
  /** `src` is the identifier the node was resolved from (`graphSource`); absent on caches written before it existed. */
  byCitekey: Record<string, { openalexId: string; refs: string[]; src?: string }>;
  idToCitekey: Record<string, string>;
}

/** The persisted cache may be hand-edited or truncated — refuse anything unexpected. */
function isGraphData(v: unknown): v is GraphData {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (!o.byCitekey || typeof o.byCitekey !== "object" || Array.isArray(o.byCitekey)) return false;
  if (!o.idToCitekey || typeof o.idToCitekey !== "object" || Array.isArray(o.idToCitekey)) return false;
  return Object.values((o.byCitekey as Record<string, unknown>)).every(
    (n) =>
      !!n &&
      typeof n === "object" &&
      typeof (n as { openalexId?: unknown }).openalexId === "string" &&
      Array.isArray((n as { refs?: unknown }).refs)
  );
}

/** The identifier `resolveWork` would use for a note (openalex_id → DOI → PMID), as a comparable
 *  string; "" when it would fall back to a title search. */
export function graphSource(item: { openalex_id?: unknown; DOI?: unknown; PMID?: unknown }): string {
  const oa = typeof item.openalex_id === "string" ? shortId(item.openalex_id) : "";
  if (oa) return `oa:${oa}`;
  const doi = text(item.DOI).trim();
  if (doi) return `doi:${normalizeDoi(doi)}`;
  const pmid = text(item.PMID).trim();
  if (pmid) return `pmid:${pmid}`;
  return "";
}

/** What to record for a freshly resolved node: `backfillId` writes openalex_id into a note that had
 *  none, so a DOI / PMID / title source becomes `oa:<id>` and the write's own change event is a no-op. */
const storedSource = (src: string, openalexId: string): string => (src.startsWith("oa:") ? src : `oa:${openalexId}`);

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
  private flush: { (): void; cancel: () => unknown };
  /** Quiet period before `prune` scans the library (settable so tests need not wait 2 s). */
  pruneDelayMs = 2000;
  private pruneTimer: number | null = null;
  private pruneWaiters: Promise<void> | null = null;
  private pruneDone: () => void = () => undefined;
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

  /** Plugin unload: no timer may fire into a dead plugin. A pending prune resolves, doing nothing. */
  dispose(): void {
    this.flush.cancel();
    this.addQueue.clear();
    if (this.pruneTimer !== null) window.clearTimeout(this.pruneTimer);
    this.pruneTimer = null;
    this.pruneWaiters = null;
    this.pruneDone();
    this.listeners.clear();
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

  /** Set when the last `restore()` found a missing/unreadable/invalid cache. */
  restoreError: string | null = null;

  async restore(): Promise<void> {
    this.restoreError = null;
    const a = this.app.vault.adapter;
    if (await a.exists(this.path)) {
      try {
        const parsed: unknown = JSON.parse(await a.read(this.path));
        if (!isGraphData(parsed)) throw new Error("unrecognized citation-graph shape");
        this.data = parsed;
        this.missingCache.clear();
      } catch (e) {
        // Corrupt cache: keep the empty graph so a rebuild starts clean, and let
        // main.ts tell the user instead of failing silently.
        this.restoreError = e instanceof Error ? e.message : String(e);
      }
    }
  }

  private async persist(data: GraphData = this.data): Promise<void> {
    const a = this.app.vault.adapter;
    const dir = this.path.split("/").slice(0, -1).join("/");
    if (!(await a.exists(dir))) await a.mkdir(dir);
    await a.write(this.path, JSON.stringify(data));
  }

  /** How the last full build went (for the Notice): papers resolved on OpenAlex, lookups that
   *  failed (rate limit / offline — their previous node is kept), and why it stopped early. */
  lastBuild: { total: number; resolved: number; failed: number; stopped: "cancelled" | "api-refused" | null } | null = null;

  /** Build the graph over the whole library (1 OpenAlex request per paper). `signal` stops it
   *  after the current paper; what was resolved so far is kept and saved. */
  build(onProgress?: (done: number, total: number, failed: number) => void, signal?: AbortSignal): Promise<number> {
    return this.serialized(() => this.buildNow(onProgress, signal));
  }

  /** This many lookups in a row failing means the API is refusing us (daily budget gone, outage):
   *  carrying on would only burn the rest of the library on futile, slow retries. */
  private static readonly REFUSED_AFTER = 10;
  /** Save the graph every this many resolved papers, so a crash or quit does not lose a long run. */
  private static readonly CHECKPOINT_EVERY = 200;

  private async buildNow(onProgress?: (done: number, total: number, failed: number) => void, signal?: AbortSignal): Promise<number> {
    this.addQueue.clear(); // a full pass covers everything queued
    const entries = this.library.entries(); // one vault pass (list()+getItem() per note was O(n²))
    // Start from the previous graph and overwrite per note: a lookup that fails keeps its old node,
    // a definitive not-found drops it, and a stopped build leaves the rest as it was.
    const data: GraphData = { byCitekey: { ...this.data.byCitekey }, idToCitekey: { ...this.data.idToCitekey } };
    const drop = (ck: string) => {
      const n = data.byCitekey[ck];
      if (!n) return;
      if (data.idToCitekey[n.openalexId] === ck) delete data.idToCitekey[n.openalexId];
      delete data.byCitekey[ck];
    };
    let done = 0;
    let failed = 0;
    let resolved = 0;
    let streak = 0;
    let stopped: "cancelled" | "api-refused" | null = null;
    for (const e of entries) {
      if (signal?.aborted) {
        stopped = "cancelled";
        break;
      }
      // One paper's network failure must not abort the whole build: keep going and
      // preserve the previously resolved node (transient 429/offline), like flushAdds.
      let w: Awaited<ReturnType<typeof resolveWork>> = null;
      let threw = false;
      try {
        w = await resolveWork(e.item, this.settings.openalexMailto);
        streak = 0;
      } catch (err) {
        failed++;
        threw = true;
        console.warn(`[Refwright] OpenAlex lookup failed for "${e.citekey}" — keeping the previous node`, err);
      }
      if (!threw) drop(e.citekey); // answered: the old node is replaced, or gone if OpenAlex has nothing
      if (w && w.openalexId) {
        // `backfillId` is about to write openalex_id when the note had none, so that is the source.
        data.byCitekey[e.citekey] = { openalexId: w.openalexId, refs: w.referencedWorks, src: storedSource(graphSource(e.item), w.openalexId) };
        data.idToCitekey[w.openalexId] = e.citekey;
        // Frontmatter-only write: the indexer's content hash keeps this from re-embedding the note.
        if (!e.item.openalex_id) await this.backfillId(e.file, w.openalexId);
        if (++resolved % CitationGraph.CHECKPOINT_EVERY === 0) await this.persist(data);
      }
      onProgress?.(++done, entries.length, failed);
      if (threw && ++streak >= CitationGraph.REFUSED_AFTER) {
        stopped = "api-refused";
        break;
      }
    }
    // Notes that are gone from the library take their nodes with them.
    const live = new Set(entries.map((e) => e.citekey));
    for (const ck of Object.keys(data.byCitekey)) if (!live.has(ck)) drop(ck);
    this.lastBuild = { total: entries.length, resolved, failed, stopped };
    if (failed) console.warn(`[Refwright] citation-graph build: ${failed} lookup(s) failed, previous nodes kept`);
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
    const prefix = this.library.folder() + "/";
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
        if (!citekey) continue;
        const prev = this.data.byCitekey[citekey];
        const src = graphSource(fm ?? {});
        // Already resolved from this very identifier (or from a cache that never recorded one): nothing to do.
        if (prev && prev.src === src) continue;
        if (prev && prev.src === undefined) {
          // A cache from before `src` existed: an explicit openalex_id that still equals the node's
          // id only needs its provenance recorded; a different one is a correction to resolve.
          if (src.startsWith("oa:") && src.slice(3) === shortId(prev.openalexId)) {
            prev.src = src;
            changed = true;
          }
          if (!src.startsWith("oa:") || prev.src !== undefined) continue;
        }
        try {
          const w = await resolveWork(fm as unknown as CSLItem, this.settings.openalexMailto);
          if (!w?.openalexId) {
            if (prev) {
              // The corrected identifier resolves to nothing: the old node's edges are wrong now.
              if (this.data.idToCitekey[prev.openalexId] === citekey) delete this.data.idToCitekey[prev.openalexId];
              delete this.data.byCitekey[citekey];
              changed = true;
            }
            continue;
          }
          if (prev && this.data.idToCitekey[prev.openalexId] === citekey) delete this.data.idToCitekey[prev.openalexId];
          // Same work under a changed citekey: drop the old key's node when its note is gone,
          // so the stale node can't be pruned later (or double-count as a second citing paper).
          const old = this.data.idToCitekey[w.openalexId];
          if (old && old !== citekey && !this.library.getFile(old)) delete this.data.byCitekey[old];
          this.data.byCitekey[citekey] = { openalexId: w.openalexId, refs: w.referencedWorks, src: storedSource(src, w.openalexId) };
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
    // A 500-file bulk delete fires 500 events: collapse them into one scan after things go quiet.
    this.pruneWaiters ??= new Promise<void>((resolve) => (this.pruneDone = resolve));
    if (this.pruneTimer !== null) window.clearTimeout(this.pruneTimer);
    this.pruneTimer = window.setTimeout(() => {
      const done = this.pruneDone;
      this.pruneTimer = null;
      this.pruneWaiters = null;
      this.pruneNow()
        .catch((e) => console.warn("[Refwright] citation-graph prune failed", e))
        .finally(() => done());
    }, this.pruneDelayMs);
    return this.pruneWaiters;
  }

  private pruneNow(): Promise<void> {
    if (!this.size) return Promise.resolve();
    return this.serialized(async () => {
      const live = new Set(this.library.entries().map((e) => e.citekey));
      let changed = false;
      for (const [ck, node] of Object.entries(this.data.byCitekey)) {
        if (live.has(ck)) continue;
        // Only unmap the id while it still points at the node being removed: a renamed note's
        // new citekey may already own it.
        if (this.data.idToCitekey[node.openalexId] === ck) delete this.data.idToCitekey[node.openalexId];
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
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
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
