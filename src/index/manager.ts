import { App, TFile, normalizePath, debounce, Platform } from "obsidian";
import { ScholarRagSettings } from "../types";
import { Library } from "../data/library";
import { createProvider, EmbeddingProvider } from "./embedding";
import { VectorStore, SearchHit, SearchFilters, StoredMeta, INDEX_SCHEMA } from "./store";
import { capPerReference } from "./rerank";
import { FileIO, NodeFileIO, localIndexDir } from "./localFiles";

import {
  chunkReference,
  stripFrontmatter,
  yearFromIssued,
  authorNames,
  chunkHash,
  Chunk,
} from "./chunker";

/** Chunks pulled from the index before the per-reference cap thins them. */
const OVERFETCH = 3;


/** Orchestrates the embedding index: build, incremental update, persistence, search. */
export class IndexManager {
  private store = new VectorStore();
  // Default (vault-relative) location; still used whenever `indexLocal` is off or unsupported.
  private vaultDir: string;
  // Active location — vault-relative (via `app.vault.adapter`) or an absolute OS-cache path
  // (via `NodeFileIO`), resolved lazily on first use and only changed again by `relocate()`.
  private io: FileIO;
  private dir: string;
  private docsPath = "";
  private vectorsPath = "";
  private metaPath = "";
  // Pre-0.7 format, persisted whole-DB-as-JSON via @orama/plugin-data-persistence — only ever
  // written to the vault-relative location; cleaned up opportunistically after a persist there.
  private legacyOramaPath = "";
  private locationResolved = false;
  private reindexQueue = new Set<string>();
  private flush: () => void;
  // Every index mutation (rebuild / debounced reindex / remove / relocate) is chained here, so
  // two of them can never interleave persist()'s write-tmp → remove → rename steps on the same files.
  private chain: Promise<unknown> = Promise.resolve();
  private provider: EmbeddingProvider | null = null;
  private providerKey = "";

  constructor(
    private app: App,
    private library: Library,
    public settings: ScholarRagSettings,
    pluginDir: string
  ) {
    this.vaultDir = normalizePath(`${pluginDir}/index`);
    this.io = this.app.vault.adapter;
    this.dir = this.vaultDir;
    this.setPaths();
    this.flush = debounce(() => void this.flushReindex(), 1500, true);
  }

  private setPaths(): void {
    this.docsPath = `${this.dir}/docs.json`;
    this.vectorsPath = `${this.dir}/vectors.f32`;
    this.metaPath = `${this.dir}/meta.json`;
    this.legacyOramaPath = `${this.dir}/orama.json`;
  }

  /** Where the index currently lives, based on `settings.indexLocal` (desktop only). */
  private async resolveLocation(): Promise<{ io: FileIO; dir: string }> {
    if (this.settings.indexLocal && Platform.isDesktopApp) {
      try {
        const base = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.();
        if (typeof base === "string") return { io: new NodeFileIO(), dir: await localIndexDir(base) };
      } catch (e) {
        console.error("[RAG Obsidian] could not resolve local index dir — using vault storage", e);
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
    this.io = next.io;
    this.dir = next.dir;
    this.setPaths();
    if (oldDir === this.dir) return;
    if (this.store.ready) {
      await this.persistNow();
      await this.clearPersistedAt(oldIO, oldDir);
    }
  }

  get ready(): boolean {
    return this.store.ready;
  }
  get count(): number {
    return this.store.count;
  }
  get modelId(): string {
    return this.getProvider().id;
  }
  /** Model recorded by the live index, without creating/loading an embedding provider. */
  get indexedModelId(): string {
    return this.store.modelId;
  }

  /** One provider per `provider:model`; rebuild only when settings defining the id change. */
  private getProvider(): EmbeddingProvider {
    const key = `${this.settings.embeddingProvider}:${this.settings.embeddingModel}`;
    if (!this.provider || this.providerKey !== key) {
      this.provider = createProvider(this.settings);
      this.providerKey = key;
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

  /** On load: restore the index if it exists AND matches the current model. */
  async restore(): Promise<void> {
    this.restoreError = null;
    try {
      await this.ensureLocation();
      if (!(await this.io.exists(this.metaPath))) return;
      const meta = JSON.parse(await this.io.read(this.metaPath)) as StoredMeta;
      if (meta.modelId !== this.modelId) {
        console.debug("[RAG Obsidian] embedding model changed since last build — rebuild required");
        return;
      }
      if ((meta.schema ?? 1) !== INDEX_SCHEMA) {
        this.restoreError = "The search index format changed — run “Rebuild search index” once.";
        return;
      }
      const docs = await this.io.read(this.docsPath);
      const vectors = await this.io.readBinary(this.vectorsPath);
      await this.store.load(docs, vectors, meta);
      console.debug(`[RAG Obsidian] index restored: ${this.store.count} chunks`);
    } catch (e) {
      console.error("[RAG Obsidian] failed to restore index", e);
      this.restoreError = e instanceof Error ? e.message : String(e);
    }
  }

  private files(): TFile[] {
    const prefix = normalizePath(this.settings.referencesFolder) + "/";
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
        tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
        authors: authorNames(fm.author),
        abstract: typeof fm.abstract === "string" ? fm.abstract : undefined,
        body: stripFrontmatter(content),
      },
      this.settings.chunkChars
    );
  }

  /** Full rebuild from scratch over all reference notes. */
  rebuild(onProgress?: (done: number, total: number) => void): Promise<number> {
    return this.serialized(() => this.rebuildNow(onProgress));
  }

  private async rebuildNow(onProgress?: (done: number, total: number) => void): Promise<number> {
    const provider = this.getProvider();
    const all: Chunk[] = [];
    const pathByCitekey = new Map<string, { path: string; hash: string }>();
    for (const f of this.files()) {
      const chunks = await this.readChunks(f);
      const citekey = chunks[0]?.citekey;
      if (!citekey) continue;
      if (pathByCitekey.has(citekey)) {
        console.warn(`[RAG Obsidian] duplicate citekey "${citekey}" — skipping ${f.path}`);
        continue;
      }
      pathByCitekey.set(citekey, { path: f.path, hash: chunkHash(chunks) });
      all.push(...chunks);
    }

    if (all.length === 0) {
      // don't init() with a bogus dim — clear instead so reindexFile no-ops until a real build
      this.store.reset();
      await this.clearPersisted();
      return 0;
    }

    const batchSize = 32;
    const vectors: number[][] = [];
    for (let i = 0; i < all.length; i += batchSize) {
      const batch = all.slice(i, i + batchSize);
      vectors.push(...(await provider.embed(batch.map((c) => c.embedText))));
      onProgress?.(Math.min(i + batchSize, all.length), all.length);
    }

    this.store.init(vectors[0].length, provider.id);
    await this.store.addChunks(all, vectors);
    for (const [citekey, { path, hash }] of pathByCitekey) this.store.setPath(path, citekey, hash);
    await this.persist();
    return all.length;
  }

  /** Incremental: re-embed a single note (on edit/create). No-op until first build.
   *  Returns false when the embedded text is unchanged — e.g. only plugin-managed
   *  frontmatter (`openalex_id`, `status`, `cited_by_count`) was written — so the
   *  caller can skip embedding + persist. */
  private async reindexNow(file: TFile): Promise<boolean> {
    if (!this.store.ready) return false;
    const chunks = await this.readChunks(file);
    const oldCitekey = this.store.citekeyForPath(file.path);
    if (chunks.length) {
      const citekey = chunks[0].citekey;
      const hash = chunkHash(chunks);
      if (oldCitekey === citekey && this.store.hashForPath(file.path) === hash) return false;
      // Another note already holds this citekey: removing + re-adding under it would
      // delete that note's chunks (removeCitekey clears every path with the key).
      // Keep the first note's chunks — rebuild() skips later duplicates the same way.
      const holder = Object.entries(this.store.paths).find(([p, ck]) => ck === citekey && p !== file.path);
      if (holder) {
        console.warn(`[RAG Obsidian] duplicate citekey "${citekey}" — skipping reindex of ${file.path}`);
        return false;
      }
      // embed + dim-check BEFORE touching the index, so a model mismatch can't drop the note
      const vecs = await this.getProvider().embed(chunks.map((c) => c.embedText));
      if (vecs[0]?.length !== this.store.dim) {
        console.warn(
          `[RAG Obsidian] embedding dim ${vecs[0]?.length} ≠ index dim ${this.store.dim} — rebuild required; ${file.path} left as-is`
        );
        return false;
      }
      if (oldCitekey && oldCitekey !== citekey) await this.store.removeCitekey(oldCitekey);
      await this.store.removeCitekey(citekey);
      await this.store.addChunks(chunks, vecs);
      this.store.setPath(file.path, citekey, hash);
      return true;
    }
    const citekey = oldCitekey ?? this.citekeyOfPath(file.path);
    if (!citekey) return false;
    await this.store.removeCitekey(citekey);
    return true;
  }

  removeFile(path: string): Promise<void> {
    return this.serialized(async () => {
      if (!this.store.ready) return;
      // chunks are keyed by frontmatter citekey, which may differ from the filename
      const citekey = this.store.citekeyForPath(path) ?? this.citekeyOfPath(path);
      if (!citekey) return;
      await this.store.removeCitekey(citekey);
      await this.persist();
    });
  }

  private citekeyOfPath(path: string): string {
    return (path.split("/").pop() ?? "").replace(/\.md$/, "");
  }

  /** Queue a file for debounced incremental reindexing. */
  enqueue(file: TFile): void {
    const prefix = normalizePath(this.settings.referencesFolder) + "/";
    if (!file.path.startsWith(prefix)) return;
    this.reindexQueue.add(file.path);
    this.flush();
  }

  private flushReindex(): Promise<void> {
    return this.serialized(async () => {
      const paths = [...this.reindexQueue];
      this.reindexQueue.clear();
      let changed = false;
      for (const p of paths) {
        const f = this.app.vault.getAbstractFileByPath(p);
        if (!(f instanceof TFile)) continue;
        try {
          if (await this.reindexNow(f)) changed = true;
        } catch (e) {
          console.error("[RAG Obsidian] reindex failed", p, e);
        }
      }
      if (changed) await this.persist(); // once per burst, not once per note
    });
  }

  /** `k` defaults to the user's top-K; callers that collapse hits (one row per reference)
   *  pass a bigger one so a full-text-indexed paper can't fill the whole result set. */
  async search(query: string, filters: SearchFilters = {}, k = this.settings.topK): Promise<SearchHit[]> {
    const [vec] = await this.getProvider().embed([query]);
    // Over-fetch, then cap per reference: a paper whose stashed PDF text splits into dozens of
    // chunks would otherwise fill the whole result set on its own.
    const hits = await this.store.search(vec, query, k * OVERFETCH, filters);
    return capPerReference(hits, k);
  }

  private async persist(): Promise<void> {
    await this.ensureLocation();
    await this.persistNow();
  }

  private async persistNow(): Promise<void> {
    if (!(await this.io.exists(this.dir))) await this.io.mkdir(this.dir);
    const { docs, vectors, meta } = await this.store.serialize();
    // docs, then vectors, then meta last: meta is the commit marker (restore bails if it's
    // missing, and store.load rejects a count/size desync from a crash between the writes)
    await this.writeAtomicText(this.docsPath, docs);
    await this.writeAtomicBinary(this.vectorsPath, vectors);
    await this.writeAtomicText(this.metaPath, JSON.stringify(meta));
    // a pre-0.7 whole-DB dump left behind at this same location is now dead weight
    for (const p of [this.legacyOramaPath, `${this.legacyOramaPath}.tmp`]) {
      if (await this.io.exists(p)) await this.io.remove(p);
    }
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

  private async writeAtomicBinary(path: string, content: ArrayBuffer): Promise<void> {
    const tmp = `${path}.tmp`;
    await this.io.writeBinary(tmp, content);
    if (await this.io.exists(path)) await this.io.remove(path);
    await this.io.rename(tmp, path);
  }

  private async clearPersisted(): Promise<void> {
    await this.ensureLocation();
    await this.clearPersistedAt(this.io, this.dir);
  }

  private async clearPersistedAt(io: FileIO, dir: string): Promise<void> {
    const meta = `${dir}/meta.json`;
    const docs = `${dir}/docs.json`;
    const vectors = `${dir}/vectors.f32`;
    const orama = `${dir}/orama.json`;
    // meta first: without it, leftover data files are ignored on restore
    const paths = [meta, docs, vectors, orama, `${meta}.tmp`, `${docs}.tmp`, `${vectors}.tmp`, `${orama}.tmp`];
    for (const p of paths) if (await io.exists(p)) await io.remove(p);
  }
}
