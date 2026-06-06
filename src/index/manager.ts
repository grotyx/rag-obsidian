import { App, TFile, normalizePath, debounce } from "obsidian";
import { ScholarRagSettings } from "../types";
import { Library } from "../data/library";
import { createProvider } from "./embedding";
import { VectorStore, SearchHit, SearchFilters, StoredMeta } from "./store";
import { chunkReference, stripFrontmatter, yearFromIssued, Chunk } from "./chunker";

/** Orchestrates the embedding index: build, incremental update, persistence, search. */
export class IndexManager {
  private store = new VectorStore();
  private dir: string;
  private oramaPath: string;
  private metaPath: string;
  private reindexQueue = new Set<string>();
  private flush: () => void;

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
    return createProvider(this.settings).id;
  }

  /** On load: restore the index if it exists AND matches the current model. */
  async restore(): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(this.metaPath))) return;
      const meta = JSON.parse(await adapter.read(this.metaPath)) as StoredMeta;
      if (meta.modelId !== this.modelId) {
        console.log("[RAG Obsidian] embedding model changed since last build — rebuild required");
        return;
      }
      const data = await adapter.read(this.oramaPath);
      await this.store.load(data, meta);
      console.log(`[RAG Obsidian] index restored: ${this.store.count} chunks`);
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
        abstract: typeof fm.abstract === "string" ? fm.abstract : undefined,
        body: stripFrontmatter(content),
      },
      this.settings.chunkChars
    );
  }

  /** Full rebuild from scratch over all reference notes. */
  async rebuild(onProgress?: (done: number, total: number) => void): Promise<number> {
    const provider = createProvider(this.settings);
    const all: Chunk[] = [];
    for (const f of this.files()) all.push(...(await this.readChunks(f)));

    if (all.length === 0) {
      this.store.init(1, provider.id);
      await this.persist();
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
    await this.persist();
    return all.length;
  }

  /** Incremental: re-embed a single note (on edit/create). No-op until first build. */
  async reindexFile(file: TFile): Promise<void> {
    if (!this.store.ready) return;
    const provider = createProvider(this.settings);
    const chunks = await this.readChunks(file);
    const citekey = chunks[0]?.citekey ?? this.citekeyOfPath(file.path);
    if (citekey) await this.store.removeCitekey(citekey);
    if (chunks.length) {
      const vecs = await provider.embed(chunks.map((c) => c.embedText));
      if (vecs[0]?.length !== this.store.dim) return; // model mismatch — needs full rebuild
      await this.store.addChunks(chunks, vecs);
    }
    await this.persist();
  }

  async removeFile(path: string): Promise<void> {
    if (!this.store.ready) return;
    const citekey = this.citekeyOfPath(path);
    if (citekey) {
      await this.store.removeCitekey(citekey);
      await this.persist();
    }
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

  private async flushReindex(): Promise<void> {
    const paths = [...this.reindexQueue];
    this.reindexQueue.clear();
    for (const p of paths) {
      const f = this.app.vault.getAbstractFileByPath(p);
      if (f instanceof TFile) {
        try {
          await this.reindexFile(f);
        } catch (e) {
          console.error("[RAG Obsidian] reindex failed", p, e);
        }
      }
    }
  }

  async search(query: string, filters: SearchFilters = {}): Promise<SearchHit[]> {
    const provider = createProvider(this.settings);
    const [vec] = await provider.embed([query]);
    return this.store.search(vec, query, this.settings.topK, filters);
  }

  private async persist(): Promise<void> {
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(this.dir))) await adapter.mkdir(this.dir);
    const { data, meta } = await this.store.serialize();
    await adapter.write(this.oramaPath, data);
    await adapter.write(this.metaPath, JSON.stringify(meta));
  }
}
