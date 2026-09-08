import { App, TFile, normalizePath, debounce } from "obsidian";
import { ScholarRagSettings } from "../types";
import { Library } from "../data/library";
import { createProvider, EmbeddingProvider } from "./embedding";
import { VectorStore, SearchHit, SearchFilters, StoredMeta, INDEX_SCHEMA } from "./store";
import {
  chunkReference,
  stripFrontmatter,
  yearFromIssued,
  authorNames,
  chunkHash,
  Chunk,
} from "./chunker";

/** Orchestrates the embedding index: build, incremental update, persistence, search. */
export class IndexManager {
  private store = new VectorStore();
  private dir: string;
  private oramaPath: string;
  private metaPath: string;
  private reindexQueue = new Set<string>();
  private flush: () => void;
  // Every index mutation (rebuild / debounced reindex / remove) is chained here, so two of
  // them can never interleave persist()'s write-tmp → remove → rename steps on the same files.
  private chain: Promise<unknown> = Promise.resolve();
  private provider: EmbeddingProvider | null = null;
  private providerKey = "";

  constructor(
    private app: App,
    private library: Library,
    public settings: ScholarRagSettings,
    pluginDir: string
  ) {
    this.dir = normalizePath(`${pluginDir}/index`);
    this.oramaPath = `${this.dir}/orama.json`;
    this.metaPath = `${this.dir}/meta.json`;
    this.flush = debounce(() => void this.flushReindex(), 1500, true);
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

  /** One provider per `provider:model` — Transformers.js keeps its ONNX pipeline on the instance,
   *  so rebuild only when the settings that define the id actually change. */
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

  /** On load: restore the index if it exists AND matches the current model. */
  async restore(): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(this.metaPath))) return;
      const meta = JSON.parse(await adapter.read(this.metaPath)) as StoredMeta;
      if (meta.modelId !== this.modelId) {
        console.debug("[RAG Obsidian] embedding model changed since last build — rebuild required");
        return;
      }
      if ((meta.schema ?? 1) !== INDEX_SCHEMA) {
        console.debug("[RAG Obsidian] index schema changed since last build — rebuild required");
        return;
      }
      const data = await adapter.read(this.oramaPath);
      await this.store.load(data, meta);
      console.debug(`[RAG Obsidian] index restored: ${this.store.count} chunks`);
    } catch (e) {
      console.error("[RAG Obsidian] failed to restore index", e);
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

  async search(query: string, filters: SearchFilters = {}): Promise<SearchHit[]> {
    const [vec] = await this.getProvider().embed([query]);
    return this.store.search(vec, query, this.settings.topK, filters);
  }

  private async persist(): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(this.dir))) await adapter.mkdir(this.dir);
    const { data, meta } = await this.store.serialize();
    // orama first, meta last: meta is the commit marker (restore bails if it's missing,
    // and store.load rejects a count desync from a crash between the two writes)
    await this.writeAtomic(this.oramaPath, data);
    await this.writeAtomic(this.metaPath, JSON.stringify(meta));
  }

  /** Crash-safe write: stage to `<path>.tmp`, then rename into place so the target
   *  file is never observed truncated/half-written. A stale .tmp from a crash is
   *  harmless — it's simply overwritten on the next persist. */
  private async writeAtomic(path: string, content: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    const tmp = `${path}.tmp`;
    await adapter.write(tmp, content);
    // DataAdapter.rename doesn't document overwrite-on-existing semantics — clear the target first
    if (await adapter.exists(path)) await adapter.remove(path);
    await adapter.rename(tmp, path);
  }

  private async clearPersisted(): Promise<void> {
    const adapter = this.app.vault.adapter;
    // meta first: without it, a leftover orama.json is ignored on restore
    const paths = [this.metaPath, this.oramaPath, `${this.metaPath}.tmp`, `${this.oramaPath}.tmp`];
    for (const p of paths) if (await adapter.exists(p)) await adapter.remove(p);
  }
}
