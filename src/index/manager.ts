import { App, TFile, normalizePath, debounce, Debouncer, Platform, Notice } from "obsidian";
import { ScholarRagSettings, effective } from "../types";
import { Library } from "../data/library";
import { createProvider, EmbeddingProvider } from "./embedding";
import { VectorStore, SearchHit, SearchFilters, StoredMeta, INDEX_SCHEMA, VECTOR_SLICE_BYTES } from "./store";
import { canHostedRerank, capPerReference, hostedRerank, mmr } from "./rerank";
import { buildExpander, expandedTerm, Expander, Expansion, isForeignQuery, parseVocabulary } from "./expand";
import { MeshThesaurus, MeshAddOptions } from "./thesaurus";
import { mapPool } from "../util/pool";
import { tagsOf, text } from "../util/json";
import { FileIO, NodeFileIO, localIndexDir, staleIndexFiles } from "./localFiles";

import {
  chunkReference,
  stripFrontmatter,
  yearFromIssued,
  authorNames,
  chunkHash,
  Chunk,
} from "./chunker";

/** FNV-1a 32-bit: enough to notice that a secret changed without keeping the secret around. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16);
}

/** Where an embedding provider sends its text: the base URL it posts to (origin + path, trailing slash
 *  trimmed, loopback spellings folded together) + model. Never the key. Two routes of one gateway, or two
 *  hosts, can serve one model alias and still disagree on the vectors. */
export function endpointFingerprint(s: ScholarRagSettings, legacy = false): string {
  const base = s.embeddingProvider === "openai" ? effective(s, "openaiBaseUrl") : effective(s, "ollamaUrl");
  let where = base.trim().toLowerCase();
  try {
    const u = new URL(base.trim());
    const host = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ? "localhost" : u.hostname;
    where = `${u.protocol}//${host}${u.port ? `:${u.port}` : ""}${legacy ? "" : u.pathname.replace(/\/+$/, "")}`;
  } catch { /* not a URL: compare the raw text */ }
  return `${where}|${s.embeddingModel}`;
}

/** A stored fingerprint names this endpoint. An index written before endpoints were recorded (empty)
 *  accepts any; one from the origin-only era (0.11.4 candidates) matches on origin + model. */
function endpointMatches(stored: string | undefined, s: ScholarRagSettings): boolean {
  return !stored || stored === endpointFingerprint(s) || stored === endpointFingerprint(s, true);
}

/** Chunks pulled from the index before the per-reference cap thins them. */
const OVERFETCH = 3;

/** Embedding requests in flight during a full rebuild (a local Ollama just queues them). */
const EMBED_WIDTH = 4;

/** Embedding requests (or notes) failing in a row that mean the key or endpoint is broken: stop starting paid requests. */
const MAX_CONSECUTIVE_FAILS = 5;

/** A background reindex that throws is queued again this many times (each next flush); after that the note
 *  waits for the next start, whose reconcile sees its newer mtime. */
const MAX_REINDEX_RETRIES = 3;

/** A queue longer than this is embedded in batches by the incremental rebuild (one request per note is too slow). */
const CATCH_UP_BATCH = 50;

/** The note's file mtime (0 when unknown — a test double without `stat`). */
function mtimeOf(f: TFile): number {
  return f.stat?.mtime ?? 0;
}


/** Orchestrates the embedding index: build, incremental update, persistence, search. */
/** One search's rerank step (MCP reports it; `reason` when it was skipped). */
export type RerankOutcome = { asked: boolean; ok: boolean; reason?: string };

export class IndexManager {
  private store = new VectorStore();
  // Default (vault-relative) location; still used whenever `indexLocal` is off or unsupported.
  private vaultDir: string;
  // Active location — vault-relative (via `app.vault.adapter`) or an absolute OS-cache path
  // (via `NodeFileIO`), resolved lazily on first use and only changed again by `relocate()`.
  private io: FileIO;
  private dir: string;
  private metaPath = "";
  // A removal not yet persisted (see `removeFile`): the next flush must write the index even when no
  // note was re-embedded.
  private dirty = false;
  /** Largest packed slice of vectors written at once (a field so tests can force several slices). */
  vectorSliceBytes = VECTOR_SLICE_BYTES;
  private locationResolved = false;
  private reindexQueue = new Set<string>();
  private flush: Debouncer<[], void>;
  /** Set by `dispose()` (plugin unload): nothing more is scheduled; the final flush is the last write. */
  private closed = false;
  // Every index mutation (rebuild / debounced reindex / remove / relocate) is chained here, so
  // two of them can never interleave persist()'s write-tmp → remove → rename steps on the same files.
  private chain: Promise<unknown> = Promise.resolve();
  private provider: EmbeddingProvider | null = null;
  private providerKey = "";
  /** Index generations this process wrote or loaded: the only ones a persist may delete (the folder may be
   *  shared with another computer's live generation). */
  private ownGens = new Set<string>();
  /** Failed background reindexes per path (see `MAX_REINDEX_RETRIES`). */
  private retries = new Map<string, number>();
  /** Set by the plugin: shows a message the user should see about background indexing. */
  notify: ((message: string) => void) | null = null;

  constructor(
    private app: App,
    private library: Library,
    public settings: ScholarRagSettings,
    private pluginDir: string
  ) {
    this.vaultDir = normalizePath(`${pluginDir}/index`);
    this.io = this.app.vault.adapter;
    this.dir = this.vaultDir;
    this.setPaths();
    this.flush = debounce(() => void this.flushReindex(), 1500, true);
  }

  private setPaths(): void {
    this.metaPath = `${this.dir}/meta.json`;
  }

  /** Where the index currently lives, based on `settings.indexLocal` (desktop only). */
  private async resolveLocation(): Promise<{ io: FileIO; dir: string }> {
    if (this.settings.indexLocal && Platform.isDesktopApp) {
      try {
        const base = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.();
        if (typeof base === "string") return { io: new NodeFileIO(), dir: await localIndexDir(base) };
      } catch (e) {
        console.error("[Refwright] could not resolve local index dir — using vault storage", e);
      }
    }
    return { io: this.app.vault.adapter, dir: this.vaultDir };
  }

  /** Resolve the active location once per session; `relocate()` is the only thing allowed to
   *  change it afterward (it needs the *previous* location to clean up from). */
  private async ensureLocation(): Promise<void> {
    if (this.locationResolved) return;
    const { io, dir } = await this.resolveLocation();
    this.io = io;
    this.dir = dir;
    this.setPaths();
    this.locationResolved = true;
  }

  /** Called when the `indexLocal` setting flips. Moves the index to wherever
   *  `settings.indexLocal` now points: persists into the new location (if a store is loaded)
   *  and clears the old one; with nothing built yet, just switches location. */
  relocate(): Promise<void> {
    return this.serialized(() => this.relocateNow());
  }

  private async relocateNow(): Promise<void> {
    await this.ensureLocation(); // make sure "old" below really is the location in use
    const oldIO = this.io;
    const oldDir = this.dir;
    const next = await this.resolveLocation();
    if (oldDir === next.dir) return;
    this.io = next.io;
    this.dir = next.dir;
    this.setPaths();
    if (this.store.ready) {
      try {
        await this.persistNow();
      } catch (e) {
        // The old copy is still whole: keep using it, and drop what the failed write left behind.
        const failed = { io: this.io, dir: this.dir };
        this.io = oldIO;
        this.dir = oldDir;
        this.setPaths();
        await this.clearPersistedAt(failed.io, failed.dir).catch(() => undefined);
        throw e;
      }
      // The new generation is committed: the move happened. Leftovers of the old location (a file a sync
      // client holds open) are only litter, and failing the move over them would point the setting back
      // at a location with no index.
      await this.clearPersistedAt(oldIO, oldDir).catch((e) => console.warn("[Refwright] could not clear the old index location", e));
    }
  }

  /** True while `rebuildNow` streams a new index in; the store then holds only part of the library. */
  rebuilding = false;

  /** Searchable: built and not mid-rebuild (a partial index would answer as if it were the whole library). */
  get ready(): boolean {
    return this.store.ready && !this.rebuilding;
  }
  get count(): number {
    return this.store.count;
  }
  /** False when the last run stopped early or left notes unembedded: searches see only part of the library. */
  get complete(): boolean {
    return this.store.complete;
  }
  get modelId(): string {
    return this.getProvider().id;
  }
  /** Model recorded by the live index, without creating/loading an embedding provider. */
  get indexedModelId(): string {
    return this.store.modelId;
  }

  /** One provider per set of settings its constructor snapshots (model, endpoint, API key). The
   *  key enters the cache key only as a short non-cryptographic fingerprint, never as text. */
  private getProvider(): EmbeddingProvider {
    const s = this.settings;
    const key =
      s.embeddingProvider === "openai"
        ? `openai|${s.embeddingModel}|${effective(s, "openaiBaseUrl")}|${fingerprint(s.openaiApiKey)}`
        : `${s.embeddingProvider}|${s.embeddingModel}|${effective(s, "ollamaUrl")}`;
    if (!this.provider || this.providerKey !== key) {
      this.provider = createProvider(s);
      this.providerKey = key;
      this.queryVecs.clear(); // vectors from the old endpoint/model must not answer the new one
    }
    return this.provider;
  }

  /** Run an index mutation after every previously scheduled one has settled. */
  private serialized<T>(job: () => Promise<T>): Promise<T> {
    const run = this.chain.then(job);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Set when the last `restore()` failed — main.ts surfaces it instead of staying silent. */
  restoreError: string | null = null;

  /** On load: restore the index if it exists AND matches the current model. Serialized like every
   *  other mutation, so a rebuild or reindex requested meanwhile waits for it instead of being clobbered. */
  restore(): Promise<void> {
    return this.serialized(() => this.restoreNow());
  }

  private async restoreNow(): Promise<void> {
    this.restoreError = null;
    try {
      await this.ensureLocation();
      // A crash between "remove old meta" and "rename new meta" in `writeAtomicText` leaves only the
      // fully written .tmp, which names a complete generation.
      let metaFile = this.metaPath;
      if (!(await this.io.exists(metaFile))) {
        metaFile = `${this.metaPath}.tmp`;
        if (!(await this.io.exists(metaFile))) return;
      }
      const meta = JSON.parse(await this.io.read(metaFile)) as StoredMeta;
      if (meta.modelId !== this.modelId || !endpointMatches(meta.endpoint, this.settings)) {
        console.debug("[Refwright] embedding model or endpoint changed since last build — rebuild required");
        return;
      }
      if ((meta.schema ?? 1) !== INDEX_SCHEMA) {
        this.restoreError = "The search index format changed — run “Update search index” once.";
        return;
      }
      // meta names the generation it commits; a meta without `gen` is a pre-generation index.
      if (meta.gen !== undefined && !/^[a-z0-9]+$/.test(meta.gen)) throw new Error("index meta has a bad generation id");
      const docs = await this.io.read(`${this.dir}/${meta.gen ? `docs-${meta.gen}.json` : "docs.json"}`);
      const vectors = await this.io.readBinary(`${this.dir}/${meta.gen ? `vectors-${meta.gen}.f32` : "vectors.f32"}`);
      await this.store.load(docs, vectors, meta);
      if (meta.gen) this.ownGens.add(meta.gen); // the next persist supersedes it
      // The tmp was the only commit record, and the next persist stages its metadata in that same
      // file — make it the real meta.json before anything can overwrite it.
      if (metaFile !== this.metaPath) {
        try { await this.io.rename(metaFile, this.metaPath); } catch (e) { console.warn("[Refwright] could not promote meta.json.tmp", e); }
      }
      console.debug(`[Refwright] index restored: ${this.store.count} chunks`);
      await this.reconcileNow().catch((e) => console.warn("[Refwright] could not reconcile the index with the vault", e));
    } catch (e) {
      console.error("[Refwright] failed to restore index", e);
      this.restoreError = e instanceof Error ? e.message : String(e);
    }
    // Edits that arrived while there was no index to put them in (see `flushReindex`).
    if (this.reindexQueue.size) this.flush();
  }

  /** Drop tracked notes whose file is gone and queue live notes the index does not know. Run after a
   *  restore (notes deleted or synced while Obsidian was closed raise no event) and when the
   *  references folder changes. Removals persist on the usual schedule. */
  /** Remove the chunks of tracked notes whose path is not in `live` (and whose key no `keep`-ed live
   *  note holds). Shared by the update rebuild and `reconcileNow`; returns how many were dropped. */
  private async dropMissing(live: Set<string>, keep?: Set<string>): Promise<number> {
    let n = 0;
    for (const [p, ck] of Object.entries(this.store.paths)) {
      if (live.has(p) || keep?.has(ck)) continue;
      await this.store.removeCitekey(ck);
      n++;
    }
    return n;
  }

  private async reconcileNow(): Promise<void> {
    if (!this.store.ready) return;
    const files = this.files();
    const live = new Set(files.map((f) => f.path));
    if ((await this.dropMissing(live)) > 0) this.schedulePersist();
    for (const f of files) {
      // Unknown to the index, or edited since it was embedded (a failed background embed, or an edit made
      // while Obsidian was closed — neither raised an event). The mtime check reads nothing; `reindexNow`
      // compares the content hash and skips what only had plugin-managed frontmatter written.
      const was = this.store.mtimeForPath(f.path);
      if (!this.store.citekeyForPath(f.path) || (was && mtimeOf(f) > was)) this.reindexQueue.add(f.path);
    }
    if (this.reindexQueue.size) this.flush();
  }

  private reconcileSoon: Debouncer<[], void> = debounce(() => void this.serialized(() => this.reconcileNow()), 4000, true);

  /** `referencesFolder` changed: the index may hold the old folder's notes (debounced: the setting is
   *  edited key by key, and a half-typed folder must not look like an emptied library). */
  folderChanged(): void {
    this.reconcileSoon();
  }

  private files(): TFile[] {
    const prefix = this.library.folder() + "/";
    return this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix));
  }

  private async readChunks(file: TFile): Promise<Chunk[]> {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || !fm.citekey) return [];
    const content = await this.app.vault.read(file);
    return chunkReference(
      {
        citekey: String(fm.citekey),
        title: String(fm.title ?? file.basename),
        year: yearFromIssued(fm.issued),
        tags: tagsOf(fm.tags),
        authors: authorNames(fm.author),
        journal: text(fm["container-title"]),
        abstract: typeof fm.abstract === "string" ? fm.abstract : undefined,
        body: stripFrontmatter(content),
      },
      this.settings.chunkChars
    );
  }

  /** Counts of the last `rebuild()` (also set just before it throws, so a caller can report partial progress). */
  lastRun: {
    mode: "update" | "fresh"; embedded: number; removed: number; failed: number; unchanged: number; error: string | null;
    /** Notes of the library the run never got to (it stopped early); 0 for a run that finished. */
    remaining: number;
  } | null = null;

  /** Bring the index in line with the vault: re-embed only new/changed notes and drop deleted ones
   *  (`update`, the default). `fresh` throws the index away and embeds every note. A different
   *  embedding model, or no index yet, always means fresh. Returns the chunk count afterward. */
  rebuild(onProgress?: (done: number, total: number) => void, opts?: { fresh?: boolean }): Promise<number> {
    // Set synchronously, before the job waits in the queue: a second request while one is pending
    // or running joins it instead of queueing another paid rebuild (its opts are ignored).
    if (this.pendingRebuild) return this.pendingRebuild;
    const p = this.serialized(() => this.rebuildNow(onProgress, opts));
    this.pendingRebuild = p;
    const clear = () => { if (this.pendingRebuild === p) this.pendingRebuild = null; };
    p.then(clear, clear);
    return p;
  }

  private pendingRebuild: Promise<number> | null = null;
  /** True from the moment a rebuild is requested until it settles (`rebuilding` starts only when its job runs). */
  get rebuildPending(): boolean {
    return this.pendingRebuild !== null;
  }

  private async rebuildNow(onProgress?: (done: number, total: number) => void, opts?: { fresh?: boolean }): Promise<number> {
    this.lastRun = null; // a client polling during the run must not read the previous one's outcome
    // One snapshot for the whole run: the provider that embeds and the label the vectors get. Reading the
    // settings again after the first request (a host switched mid-build) would label old vectors as new.
    const provider = this.getProvider();
    const snap = { ...this.settings };
    const fp = endpointFingerprint(snap);
    const files = this.files();
    const update = !opts?.fresh && this.store.ready && this.store.modelId === provider.id && !this.endpointChanged();
    if (update && this.store.endpoint && this.store.endpoint !== fp) this.store.endpoint = fp; // origin-only label → full one
    // Streamed in windows of notes: embed a window, put its vectors straight into the store's
    // Float32 bank, drop it. Holding every chunk and every embedding (as number[]) until the end
    // peaked at ~1 GB of extra heap on a 19k-note vault and crashed Obsidian's renderer.
    const WINDOW = 400;
    const batchSize = 32;
    const seen = new Set<string>();
    const run = { mode: update ? ("update" as const) : ("fresh" as const), embedded: 0, removed: 0, failed: 0, unchanged: 0, error: null as string | null, remaining: 0 };
    // Fresh: the old index is dropped first so two copies never sit in memory; if the build fails
    // the last persisted index is restored from disk below. Update keeps it (and search) live.
    if (!update) {
      this.store.reset();
      this.rebuilding = true;
    }
    // One failed batch fails only the notes in it; this many in a row means the key or endpoint is
    // broken, so stop starting (paid) requests.
    const stop = new AbortController();
    let consecutive = 0;
    let lastError: unknown = null;
    let fatal = false;
    let dim = update ? this.store.dim : 0; // fresh: the first valid reply sets it
    let doneNotes = 0;
    try {
      for (let w = 0; w < files.length; w += WINDOW) {
        const chunks: Chunk[] = [];
        const owners: { citekey: string; path: string; hash: string; mtime: number; from: number; to: number }[] = [];
        for (const f of files.slice(w, w + WINDOW)) {
          const mtime = mtimeOf(f); // before the read: an edit during it leaves a newer mtime to be noticed
          const cs = await this.readChunks(f);
          const citekey = cs[0]?.citekey;
          if (!citekey) {
            // Only a path the index tracks: a same-named note elsewhere must not delete this key's chunks.
            const tracked = update ? this.store.citekeyForPath(f.path) : undefined;
            if (tracked) {
              await this.store.removeCitekey(tracked);
              run.removed++;
              this.dirty = true;
            }
            continue;
          }
          if (seen.has(citekey)) {
            console.warn(`[Refwright] duplicate citekey "${citekey}" — skipping ${f.path}`);
            continue;
          }
          seen.add(citekey);
          const hash = chunkHash(cs);
          if (update && this.store.citekeyForPath(f.path) === citekey && this.store.hashForPath(f.path) === hash) {
            run.unchanged++;
            if (mtime) this.store.setPath(f.path, citekey, hash, mtime); // in memory only: the content is what is indexed
            continue;
          }
          owners.push({ citekey, path: f.path, hash, mtime, from: chunks.length, to: chunks.length + cs.length });
          chunks.push(...cs);
        }
        doneNotes = Math.min(files.length, w + WINDOW);
        if (chunks.length) {
          const batches: Chunk[][] = [];
          for (let i = 0; i < chunks.length; i += batchSize) batches.push(chunks.slice(i, i + batchSize));
          const results = await mapPool(
            batches,
            EMBED_WIDTH,
            async (batch) => {
              try {
                const v = await provider.embed(batch.map((c) => c.embedText));
                // Every vector checked before any note is touched: a short or odd-sized reply fails this
                // batch (its notes keep their old entries) instead of deleting notes mid-run.
                if (!Array.isArray(v) || v.length !== batch.length) throw new Error(`embedding reply has ${Array.isArray(v) ? v.length : "no"} vectors for ${batch.length} chunks`);
                for (const x of v) {
                  if (!x || !(x.length > 0)) throw new Error("embedding reply holds a vector that is not a number array");
                  if (!dim) dim = x.length;
                  if (x.length !== dim) {
                    throw new Error(`Embedding dimension ${x.length} ≠ index dimension ${dim}${update ? " — rebuild the index from scratch" : ""}`);
                  }
                }
                consecutive = 0;
                return v;
              } catch (e) {
                console.warn("[Refwright] embedding batch failed", e);
                lastError = e;
                if (++consecutive >= MAX_CONSECUTIVE_FAILS) stop.abort();
                return null;
              }
            },
            stop.signal
          );
          // chunk index → vector; a hole (failed or never-started batch) fails the notes it touches
          // (`results` is sparse for batches that never started, hence the index loop, not flatMap)
          const vecs: (number[] | undefined)[] = [];
          batches.forEach((b, i) => {
            const r = results[i];
            for (let j = 0; j < b.length; j++) vecs.push(r?.[j] ?? undefined);
          });
          for (const o of owners) {
            const v = vecs.slice(o.from, o.to);
            if (v.some((x) => !x)) {
              run.failed++;
              continue;
            }
            if (!this.store.ready) this.store.init(dim, provider.id, fp);
            if (update) {
              const old = this.store.citekeyForPath(o.path);
              if (old && old !== o.citekey) await this.store.removeCitekey(old);
              await this.store.removeCitekey(o.citekey);
            }
            await this.store.addChunks(chunks.slice(o.from, o.to), v as number[][]);
            this.store.setPath(o.path, o.citekey, o.hash, o.mtime);
            this.retries.delete(o.path);
            run.embedded++;
            this.dirty = true; // in memory only until persist() commits it
          }
        }
        onProgress?.(doneNotes, files.length);
        if (stop.signal.aborted) break;
      }
      if (stop.signal.aborted) {
        const why = lastError instanceof Error ? lastError.message : String(lastError);
        fatal = true;
        throw new Error(`${why} (${MAX_CONSECUTIVE_FAILS} embedding requests failed in a row)`);
      }
      if (update) {
        // Tracked notes whose file is gone (or moved out of the library) and whose key no live note holds.
        const gone = await this.dropMissing(new Set(files.map((f) => f.path)), seen);
        run.removed += gone;
        if (gone) this.dirty = true;
      }
      if (!update && run.embedded === 0 && run.failed > 0) {
        throw new Error(`No note could be embedded (${run.failed} failed)`);
      }
    } catch (e) {
      run.error = e instanceof Error ? e.message : String(e);
      run.remaining = Math.max(0, files.length - doneNotes);
      this.lastRun = run;
      // Update: what was embedded so far stays and is written, so the next run resumes from it. A fresh
      // build that got somewhere does the same unless the disk still holds a usable index of this model
      // and endpoint — that one is restored (below) rather than overwritten by half a library.
      const keep = update || (run.embedded > 0 && !(await this.diskIndexUsable(provider.id, snap)));
      if (!keep) {
        this.store.reset();
        await this.restoreNow(); // back to the last persisted index (it never throws); we are inside the queue, so not restore()
        if (this.store.ready) this.markClean(); // memory is the disk copy again
        throw e;
      }
      // What is saved answers for only part of the library: say so, so Search / Chat / MCP do not take it for all of it.
      this.store.complete = false;
      if (run.embedded || run.removed) {
        this.dirty = true;
        try { await this.persist(); } catch (pe) { console.error("[Refwright] could not save the partial index — kept in memory, retried on the next update", pe); }
      }
      if (fatal) throw new Error(`${run.error} — progress saved: ${run.embedded} notes embedded, ${run.removed} removed`);
      throw e;
    } finally {
      this.rebuilding = false;
    }
    this.lastRun = run;
    if (this.store.count === 0) {
      // don't keep a bogus dim — clear instead so reindexFile no-ops until a real build
      this.store.reset();
      await this.clearPersisted();
      return 0;
    }
    // Complete means every note was attempted and none failed; a change of that flag is itself worth saving.
    if (this.store.complete !== (run.failed === 0)) {
      this.store.complete = run.failed === 0;
      this.dirty = true;
    }
    // An update with nothing to do must not rewrite a multi-GB index.
    if (!update || run.embedded > 0 || run.removed > 0 || this.dirty) {
      try {
        await this.persist();
      } catch (e) {
        run.error = e instanceof Error ? e.message : String(e); // `dirty` stays set: the next update or unload retries the write
        throw e;
      }
    }
    if (this.reindexQueue.size) this.flush();
    return this.store.count;
  }

  /** The persisted index (if any) was built by this model at this endpoint and has the current format,
   *  so a failed fresh build can fall back to it. */
  private async diskIndexUsable(modelId: string, at: ScholarRagSettings): Promise<boolean> {
    try {
      await this.ensureLocation();
      for (const f of [this.metaPath, `${this.metaPath}.tmp`]) {
        if (!(await this.io.exists(f))) continue;
        const meta = JSON.parse(await this.io.read(f)) as StoredMeta;
        return meta.modelId === modelId && endpointMatches(meta.endpoint, at) && (meta.schema ?? 1) === INDEX_SCHEMA;
      }
    } catch { /* unreadable: not usable */ }
    return false;
  }

  /** Incremental: re-embed a single note (on edit/create). No-op until first build.
   *  Returns false when the embedded text is unchanged — e.g. only plugin-managed
   *  frontmatter (`openalex_id`, `status`, `cited_by_count`) was written — so the
   *  caller can skip embedding + persist. */
  private async reindexNow(file: TFile): Promise<boolean> {
    if (!this.store.ready) return false;
    const mtime = mtimeOf(file); // before the read, as in rebuildNow
    const chunks = await this.readChunks(file);
    const oldCitekey = this.store.citekeyForPath(file.path);
    if (chunks.length) {
      const citekey = chunks[0].citekey;
      const hash = chunkHash(chunks);
      if (oldCitekey === citekey && this.store.hashForPath(file.path) === hash) {
        if (mtime) this.store.setPath(file.path, citekey, hash, mtime); // same content: remember the newer mtime (memory only)
        return false;
      }
      // Another note already holds this citekey: removing + re-adding under it would
      // delete that note's chunks (removeCitekey clears every path with the key).
      // Keep the first note's chunks — rebuild() skips later duplicates the same way.
      const holder = this.store.pathsOf(citekey).find((p) => p !== file.path);
      if (holder) {
        console.warn(`[Refwright] duplicate citekey "${citekey}" — skipping reindex of ${file.path}`);
        return false;
      }
      // A different model's vectors would be written into an index labelled with the old one.
      const provider = this.getProvider();
      if (provider.id !== this.store.modelId || this.endpointChanged()) {
        console.warn(
          `[Refwright] embedding model ${provider.id} (${endpointFingerprint(this.settings)}) ≠ index model ${this.store.modelId} (${this.store.endpoint || "unknown endpoint"}) — rebuild required; ${file.path} left as-is`
        );
        return false;
      }
      // embed + validate BEFORE touching the index, so a bad response can't drop the note
      const vecs = await provider.embed(chunks.map((c) => c.embedText));
      if (vecs.length !== chunks.length || vecs.some((v) => v?.length !== this.store.dim)) {
        console.warn(
          `[Refwright] embedding response (${vecs.length} vectors for ${chunks.length} chunks, dims ${[...new Set(vecs.map((v) => v?.length))].join("/")}) does not fit index dim ${this.store.dim} — rebuild required if the model changed; ${file.path} left as-is`
        );
        this.reindexQueue.add(file.path); // tried again on its next flush
        return false;
      }
      if (oldCitekey && oldCitekey !== citekey) await this.store.removeCitekey(oldCitekey);
      await this.store.removeCitekey(citekey);
      await this.store.addChunks(chunks, vecs);
      this.store.setPath(file.path, citekey, hash, mtime);
      return true;
    }
    // Only a path the index tracks: a same-named note elsewhere must not delete this key's chunks.
    if (!oldCitekey) return false;
    await this.store.removeCitekey(oldCitekey);
    return true;
  }

  removeFile(path: string): Promise<void> {
    return this.serialized(async () => {
      if (!this.store.ready) return;
      // chunks are keyed by frontmatter citekey, which may differ from the filename; a path the
      // index never tracked (a draft named like a reference) owns no chunks
      const citekey = this.store.citekeyForPath(path);
      if (!citekey) return;
      await this.store.removeCitekey(citekey);
      // Search already sees the removal; the disk copy lags by `persistEveryMs` (see `schedulePersist`).
      this.schedulePersist();
    });
  }

  /** A note was renamed or moved: carry its tracked path over, without re-embedding (the text is the
   *  same). Moving it out of the library folder drops it, like a delete. */
  renamePath(oldPath: string, newPath: string): Promise<void> {
    if (!newPath.startsWith(this.library.folder() + "/")) return this.removeFile(oldPath);
    return this.serialized(async () => {
      if (!this.store.movePath(oldPath, newPath)) return;
      this.schedulePersist();
    });
  }

  /** Final flush: run what the debounce has not yet (a reindex burst, a delete burst's persist). Always
   *  queued behind the running mutation — a reindex in flight has cleared the queue and sets `dirty` only
   *  when it finishes, so checking the flags here would miss it. */
  flushPending(): Promise<void> {
    return this.flushReindex(true);
  }

  /** Plugin unload: stop every timer, schedule nothing more, then write what is pending. */
  dispose(): Promise<void> {
    this.closed = true;
    this.flush.cancel();
    this.reconcileSoon.cancel();
    if (this.persistTimer !== null) window.clearTimeout(this.persistTimer);
    this.persistTimer = null;
    return this.flushPending();
  }

  /** Incremental edits write the index (a whole new generation, ~1.3 GB at 212k chunks) at most this
   *  often; the in-memory index is authoritative meanwhile, and unload / rebuild persist at once. */
  persistEveryMs = 5 * 60 * 1000;
  private persistTimer: number | null = null;

  private schedulePersist(): void {
    this.dirty = true;
    if (this.closed || this.persistTimer !== null) return;
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      void this.serialized(async () => {
        if (this.dirty && this.store.ready && !this.rebuilding) await this.persist();
      }).catch((e) => {
        console.error("[Refwright] could not save the search index — will retry", e);
        this.schedulePersist();
      });
    }, this.persistEveryMs);
  }

  private markClean(): void {
    this.dirty = false;
    if (this.persistTimer !== null) window.clearTimeout(this.persistTimer);
    this.persistTimer = null;
  }

  /** Queue a file for debounced incremental reindexing. */
  enqueue(file: TFile): void {
    const prefix = this.library.folder() + "/";
    if (this.closed || !file.path.startsWith(prefix)) return;
    this.reindexQueue.add(file.path);
    this.flush();
  }

  private flushReindex(now = false): Promise<void> {
    return this.serialized(async () => {
      // No index yet (restore not run, or nothing built): keep the paths; `restoreNow` and a finished
      // rebuild flush again. Dropping them lost every edit made while the index was loading.
      if (!this.store.ready) return;
      // Only what is in the references folder now: the folder may have changed since a path was queued, and
      // re-adding an old folder's note would undo the reconcile that dropped it.
      const prefix = this.library.folder() + "/";
      const paths = [...this.reindexQueue].filter((p) => p.startsWith(prefix));
      this.reindexQueue.clear();
      let changed = false;
      if (paths.length > CATCH_UP_BATCH && this.store.modelId === this.getProvider().id && !this.endpointChanged()) {
        // One request per note would take hours (and never stops on a dead key): the update rebuild embeds
        // in batches, reports progress and stops after MAX_CONSECUTIVE_FAILS failed requests. It saves
        // for itself; whatever it did not reach is found again by the next start's reconcile.
        this.notify?.(`Indexing ${paths.length.toLocaleString()} new or changed notes in the background…`);
        try {
          await this.rebuildNow();
        } catch (e) {
          console.warn("[Refwright] background index update stopped", e);
          this.notify?.(`Background indexing stopped: ${e instanceof Error ? e.message : String(e)} — run “Update search index” to finish.`);
        }
      } else {
        let consecutive = 0;
        for (let i = 0; i < paths.length; i++) {
          const p = paths[i];
          const f = this.app.vault.getAbstractFileByPath(p);
          if (!(f instanceof TFile)) continue;
          try {
            if (await this.reindexNow(f)) changed = true;
            consecutive = 0;
            this.retries.delete(p);
          } catch (e) {
            console.error("[Refwright] reindex failed", p, e);
            // Not lost: it stays pending for the next flush, a few times; after that its stale mtime in the
            // index makes the next start's reconcile pick it up.
            const n = (this.retries.get(p) ?? 0) + 1;
            this.retries.set(p, n);
            if (n <= MAX_REINDEX_RETRIES) this.reindexQueue.add(p);
            if (++consecutive >= MAX_CONSECUTIVE_FAILS) {
              // The key or endpoint is broken: leave the rest pending instead of failing each one after its retries.
              for (const rest of paths.slice(i + 1)) this.reindexQueue.add(rest);
              console.warn(`[Refwright] ${MAX_CONSECUTIVE_FAILS} reindexes failed in a row — the rest wait for the next flush`);
              break;
            }
          }
        }
      }
      if (changed) this.dirty = true;
      if (!this.dirty) return;
      if (now) await this.persist();
      else this.schedulePersist();
    });
  }

  /** `k` defaults to the user's top-K; callers that collapse hits (one row per reference)
   *  pass a bigger one so a full-text-indexed paper can't fill the whole result set.
   *  `rerank` asks the hosted cross-encoder to reorder a 2k pool (falls back to retrieval order). */
  async search(
    query: string,
    filters: SearchFilters = {},
    k = this.settings.topK,
    opts: {
      rerank?: boolean; translate?: boolean; outcome?: RerankOutcome;
      /** Asked per citekey before MMR/rerank/capping; an ineligible reference is dropped so none of its text reaches the hosted reranker. */
      eligible?: (citekey: string) => Promise<boolean>;
    } = {}
  ): Promise<SearchHit[]> {
    if (this.rebuilding) throw new Error("The search index is being rebuilt — search again when it finishes.");
    // Query vectors from another model are meaningless against the stored ones, even at equal dimension.
    if (this.store.ready && (this.store.modelId !== this.getProvider().id || this.endpointChanged())) {
      throw new Error(
        `The embedding model changed (index: ${this.store.modelId}, now: ${this.getProvider().id}) — run “Update search index”.`
      );
    }
    // A Korean question lands far from its English twin in embedding space (cosine ~0.45), so
    // translate first when allowed; MCP passes translate:false (its agent translates itself).
    const english = opts.translate !== false ? await this.toEnglish(query) : query;
    const vec = await this.embedQuery(english);
    // Synonyms go to the keyword half only: the embedding already paraphrases, BM25 doesn't.
    // The original words still feed the matcher (Korean aliases live in the vocabulary).
    const term = this.settings.queryExpansion
      ? expandedTerm(english, await this.expand(english === query ? query : `${query} ${english}`))
      : english;
    // The rerank endpoint is OpenRouter's; any other host would 404 (and get the key posted to it).
    // And only when the user sends embeddings or chat to a hosted endpoint: with both on Ollama, no text leaves.
    const rerank = !!opts.rerank && canHostedRerank(this.settings);
    const want = rerank ? Math.round(k * this.rerankPool) : k;
    // Over-fetch, then cap per reference: a paper whose stashed PDF text splits into dozens of
    // chunks would otherwise fill the whole result set on its own.
    // The translation and embedding awaits above can span a rebuild starting or the store being reset.
    if (this.rebuilding) throw new Error("The search index is being rebuilt — search again when it finishes.");
    if (!this.store.ready) throw new Error("Index not built yet — run “Update search index”.");
    let hits = await this.store.search(vec, term, want * OVERFETCH, filters);
    if (opts.eligible) {
      const ok = new Map<string, boolean>();
      const keep: typeof hits = [];
      for (const h of hits) {
        if (!ok.has(h.citekey)) ok.set(h.citekey, await opts.eligible(h.citekey));
        if (ok.get(h.citekey)) keep.push(h);
      }
      hits = keep;
    }
    if (this.settings.searchDiversity) hits = mmr(hits, Math.min(hits.length, want * 2));
    hits = capPerReference(hits, want);
    // Per call, not a shared field: concurrent MCP searches must not report each other's rerank.
    const out = opts.outcome ?? { asked: false, ok: false };
    out.asked = rerank;
    out.ok = false;
    if (rerank) {
      const key = this.settings.openaiApiKey;
      if (!key) this.rerankFailed("no OpenRouter API key is set", out);
      // `abstract`: score each hit's paper (title + abstract) instead of the passage itself.
      const api = { baseUrl: this.settings.openaiBaseUrl, apiKey: key, model: this.settings.rerankModel };
      if (key && this.rerankOn === "abstract" && this.rerankPerPaper) {
        // One document per paper (title + abstract): a paper's chunks would otherwise send identical
        // documents and fill pool slots; its passages then keep their retrieval order under its score.
        const papers = [...new Map(hits.map((h) => [h.citekey, h])).values()].map((h) => {
          const ab = this.library.getItem(h.citekey)?.abstract;
          return { ...h, text: typeof ab === "string" && ab ? ab : h.text };
        });
        const r = await hostedRerank(api, english, papers, { onFail: (why) => this.rerankFailed(why, out) });
        if (r) {
          out.ok = true;
          const rank = new Map(r.hits.map((p, i) => [p.citekey, { i, score: r.scores[i] }]));
          hits = hits
            .filter((h) => rank.has(h.citekey))
            .map((h, order) => ({ h, order, r: rank.get(h.citekey)! }))
            .sort((a, b) => a.r.i - b.r.i || a.order - b.order)
            .map(({ h, r: pr }) => ({ ...h, score: pr.score }));
        }
      } else if (key) {
        const docs = this.rerankOn === "abstract"
          ? hits.map((h) => {
              const ab = this.library.getItem(h.citekey)?.abstract;
              return { ...h, text: typeof ab === "string" && ab ? ab : h.text };
            })
          : hits;
        const r = await hostedRerank(api, english, docs, { onFail: (why) => this.rerankFailed(why, out) });
        // Reranked hits carry the cross-encoder's score so `score` stays in result order.
        if (r) {
          out.ok = true;
          hits = r.hits.map((h, i) => ({ ...h, score: r.scores[i] }));
        }
      }
    }
    // The bank row view is internal (MMR); never hand it to callers that serialize hits.
    return hits.slice(0, k).map(({ vector: _v, ...h }) => h);
  }

  private rerankNoticeAt = new Map<string, number>();

  /** A skipped rerank silently drops search quality, so say why — once per reason per 30 minutes. */
  rerankFailed(reason: string, outcome?: RerankOutcome): void {
    if (outcome) outcome.reason = reason;
    const now = Date.now();
    if (now - (this.rerankNoticeAt.get(reason) ?? 0) < 30 * 60 * 1000) return;
    this.rerankNoticeAt.set(reason, now);
    new Notice(`Reranking skipped — ${reason}. Results are in retrieval order.`, 10000);
  }

  /** The live settings point at a different embedding endpoint than the one that built the index
   *  (an index from before endpoints were recorded accepts any). */
  private endpointChanged(): boolean {
    return !endpointMatches(this.store.endpoint, this.settings);
  }

  /** Rerank a 3k pool and score each hit's *paper* (title + abstract, one document per paper): on the
   *  held-out set this beat 0.8.0's 2k pool of passages (English nDCG@10 0.76 → 0.81, Korean 0.77 → 0.83
   *  with voyage-2.5-lite).
   *  Fields, not settings, so the eval can still compare variants. */
  rerankPool = 3;
  rerankOn: "passage" | "abstract" = "abstract";
  /** Send one document per paper (vs. one per passage) when reranking abstracts. */
  rerankPerPaper = true;
  private queryVecs = new Map<string, number[]>();

  /** Query embeddings are cached per provider+model: a repeated or re-filtered question skips the API call. */
  private async embedQuery(text: string): Promise<number[]> {
    const provider = this.getProvider(); // first: a changed endpoint/key/model drops the cache
    const key = `${provider.id}\u0000${text}`;
    const hit = this.queryVecs.get(key);
    if (hit) return hit;
    const [vec] = await provider.embed([text]);
    if (this.getProvider() !== provider) return vec; // the endpoint changed meanwhile: this vector is not cached for the new one
    if (this.queryVecs.size >= 200) this.queryVecs.delete(this.queryVecs.keys().next().value as string);
    this.queryVecs.set(key, vec);
    return vec;
  }

  /** Set by the plugin: non-English query → English search query (failures fall back to the original, cached). */
  translator: ((query: string) => Promise<string>) | null = null;
  private translations = new Map<string, string>();

  private async toEnglish(query: string): Promise<string> {
    if (!this.settings.translateQueries || !this.translator || !isForeignQuery(query)) return query;
    const hit = this.translations.get(query);
    if (hit) return hit;
    try {
      const en = (await this.translator(query)).trim();
      if (!en) return query;
      if (this.translations.size > 500) this.translations.clear();
      this.translations.set(query, en);
      return en;
    } catch (e) {
      console.warn("[Refwright] query translation failed — searching the original", e);
      this.translations.set(query, query); // don't pay for the same failing call on every search
      return query;
    }
  }

  // ---- query expansion: user vocabulary + cached MeSH entry terms ----

  private expander: Promise<Expander> | null = null;
  readonly mesh = new MeshThesaurus();
  private meshLoaded = false;
  private get meshPath(): string {
    return normalizePath(`${this.pluginDir}/mesh-thesaurus.json`);
  }

  /** What expansion would add to a query (also used by the search pane to show it). */
  async expand(query: string): Promise<Expansion> {
    if (!this.expander) this.expander = this.loadExpander();
    return (await this.expander).expand(query);
  }

  /** Drop the built expander (vocabulary path changed, thesaurus grew). */
  invalidateExpander(): void {
    this.expander = null;
  }

  private async loadExpander(): Promise<Expander> {
    const adapter = this.app.vault.adapter;
    try {
      // Read the disk copy once: reloading it mid-build (a vocabulary edit invalidates the expander)
      // would drop headings fetched since, and the build would then save the thesaurus without them.
      if (!this.meshLoaded && (await adapter.exists(this.meshPath))) this.mesh.load(JSON.parse(await adapter.read(this.meshPath)));
      this.meshLoaded = true;
    } catch (e) {
      console.warn("[Refwright] MeSH thesaurus unreadable — ignoring", e);
    }
    let vocab = null;
    const vp = this.settings.searchVocabulary.trim();
    if (vp) {
      try {
        vocab = parseVocabulary(JSON.parse(await adapter.read(normalizePath(vp))));
      } catch (e) {
        console.warn(`[Refwright] search vocabulary "${vp}" unreadable — ignoring`, e);
      }
    }
    return buildExpander(vocab, this.mesh.entries());
  }

  /** Load the cached thesaurus (and vocabulary) if not yet loaded — `mesh.has` is empty until then. */
  async ensureExpander(): Promise<void> {
    if (!this.expander) this.expander = this.loadExpander();
    await this.expander;
  }

  /** Look up NLM entry terms for these MeSH headings (cached in the plugin folder, resumable). */
  async addMeshHeadings(headings: string[], opts: MeshAddOptions = {}): Promise<{ added: number; failed: number }> {
    if (!this.expander) await (this.expander = this.loadExpander()); // load the existing cache first
    const res = await this.mesh.addHeadings(headings, opts);
    await this.app.vault.adapter.write(this.meshPath, JSON.stringify(this.mesh.toJSON()));
    this.invalidateExpander();
    return res;
  }

  private async persist(): Promise<void> {
    await this.ensureLocation();
    await this.persistNow();
  }

  /** Persist as a new generation: `docs-<gen>.json` and `vectors-<gen>.f32` are written whole first,
   *  then `meta.json` (naming `gen`) is swapped in — that single write is the commit point. A crash
   *  before it leaves the previous generation (meta + its two files) untouched; the half-written
   *  new files are orphans swept by the next persist. */
  private async persistNow(): Promise<void> {
    if (!(await this.io.exists(this.dir))) await this.io.mkdir(this.dir);
    this.store.flush();
    const { parts, vectorSlices, meta } = await this.store.serializeStream();
    const gen = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    this.ownGens.add(gen); // from the first byte: a crash mid-write leaves an orphan this process may sweep
    const docsName = `docs-${gen}.json`;
    const vectorsName = `vectors-${gen}.f32`;
    let first = true;
    for (const part of parts) {
      if (first) await this.io.write(`${this.dir}/${docsName}`, part);
      else await this.io.append(`${this.dir}/${docsName}`, part);
      first = false;
    }
    const vectorsPath = `${this.dir}/${vectorsName}`;
    if (this.io.appendBinary) {
      // <= 64 MB packed at a time: packing the whole bank (212k x 1536 x 4 B ~ 1.3 GB) per persist
      // peaked far above the bank itself in the renderer
      let firstSlice = true;
      for (const slice of vectorSlices(this.vectorSliceBytes)) {
        if (firstSlice) await this.io.writeBinary(vectorsPath, slice);
        else await this.io.appendBinary(vectorsPath, slice);
        firstSlice = false;
      }
    } else {
      // ponytail: Obsidian < 1.12.3 has no DataAdapter.appendBinary, so one full packed copy (~1.3 GB
      // at 212k chunks) lives for the write; the vault location is the only user of this path
      const [all] = vectorSlices(Infinity);
      await this.io.writeBinary(vectorsPath, all);
    }
    meta.gen = gen;
    await this.writeAtomicText(this.metaPath, JSON.stringify(meta));
    this.markClean();
    // Committed. The generations this process wrote or loaded before this one, and the pre-generation
    // files, are dead weight; another computer's generation is not ours to delete. Failing to delete
    // must not fail the persist.
    try {
      await this.sweep(this.io, this.dir, new Set(["meta.json", docsName, vectorsName]), this.ownGens);
    } catch (e) {
      console.warn("[Refwright] could not remove old index files", e);
    }
  }

  /** Remove index files in `dir` except the `keep` names: any `docs*.json`, `vectors*.f32`,
   *  `meta.json`, pre-0.7 `orama.json`, and their `.tmp` stages. With `own`, only what `staleIndexFiles`
   *  allows (this process's superseded generations + pre-generation files), and `own` then forgets the
   *  generations it removed. */
  private async sweep(io: FileIO, dir: string, keep: Set<string>, own?: Set<string>): Promise<void> {
    if (!(await io.exists(dir))) return;
    const names = (await io.list(dir)).files.map((p) => p.slice(p.lastIndexOf("/") + 1));
    const doomed = own
      ? staleIndexFiles(names, keep, own)
      : names.filter((n) => /^(docs|vectors|meta|orama)(-[a-z0-9]+)?\.(json|f32)(\.tmp)?$/.test(n) && !keep.has(n));
    for (const name of doomed) await io.remove(`${dir}/${name}`);
    if (own) for (const name of doomed) own.delete(/^(?:docs|vectors)-([a-z0-9]+)\./.exec(name)?.[1] ?? "");
  }

  /** Crash-safe write: stage to `<path>.tmp`, then rename into place so the target
   *  file is never observed truncated/half-written. A stale .tmp from a crash is
   *  harmless — it's simply overwritten on the next persist. */
  private async writeAtomicText(path: string, content: string): Promise<void> {
    const tmp = `${path}.tmp`;
    await this.io.write(tmp, content);
    // DataAdapter.rename doesn't document overwrite-on-existing semantics — clear the target first
    if (await this.io.exists(path)) await this.io.remove(path);
    await this.io.rename(tmp, path);
  }

  private async clearPersisted(): Promise<void> {
    await this.ensureLocation();
    this.markClean();
    await this.clearPersistedAt(this.io, this.dir);
  }

  private async clearPersistedAt(io: FileIO, dir: string): Promise<void> {
    // meta first: without it (or its .tmp), leftover data files are ignored on restore
    for (const p of [`${dir}/meta.json`, `${dir}/meta.json.tmp`]) if (await io.exists(p)) await io.remove(p);
    await this.sweep(io, dir, new Set());
  }
}
