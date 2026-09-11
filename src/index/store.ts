import {
  create,
  insertMultiple,
  remove,
  removeMultiple,
  getByID,
  count,
  search,
  MODE_HYBRID_SEARCH,
} from "@orama/orama";
import { persist, restore } from "@orama/plugin-data-persistence";
import { Chunk } from "./chunker";

/** Bump on any Orama schema change: an index written under an older number cannot be
 *  restored into the new schema, so `IndexManager.restore` drops it and asks for a rebuild. */
export const INDEX_SCHEMA = 3;

export interface StoredMeta {
  modelId: string;
  dim: number;
  chunkIds: Record<string, string[]>;
  count: number;
  /** note path → citekey (optional: absent in pre-0.3.1 metas). */
  paths?: Record<string, string>;
  /** note path → hash of its embedded chunk text (optional: absent in pre-0.4.1 metas). */
  hashes?: Record<string, string>;
  /** `INDEX_SCHEMA` this index was written under (absent = 1, the pre-facet schema). */
  schema?: number;
}

export interface SearchHit {
  id: string;
  citekey: string;
  title: string;
  section: string;
  year: number;
  text: string;
  score: number;
}

export interface SearchFilters {
  yearFrom?: number;
  yearTo?: number;
  /** A hit must carry **every** tag (AND). Matched exactly, so pass the tags as written. */
  tags?: string[];
  /** Author family name; matched exactly against the lowercased names on the chunk. */
  author?: string;
}

/** One-line, human-readable summary of a filter set, e.g. "2022–2025 · tag: endoscopy ·
 *  author: kim". Empty string when nothing is filtered, so callers can test it as a flag. */
export function describeFilters(f: SearchFilters): string {
  const parts: string[] = [];
  if (f.yearFrom || f.yearTo) parts.push(`${f.yearFrom ?? ""}–${f.yearTo ?? ""}`);
  if (f.tags?.length) parts.push(`${f.tags.length > 1 ? "tags" : "tag"}: ${f.tags.join(" + ")}`);
  if (f.author) parts.push(`author: ${f.author}`);
  return parts.join(" · ");
}

/** Thin wrapper over an Orama hybrid (BM25 + vector) index. */
export class VectorStore {
  private db: any = null;
  dim = 0;
  modelId = "";
  chunkIds: Record<string, string[]> = {};
  /** note path → citekey, so deletes/renames can resolve chunks even when filename ≠ citekey. */
  paths: Record<string, string> = {};
  /** note path → chunk-text hash, so a frontmatter-only write doesn't re-embed the note. */
  hashes: Record<string, string> = {};

  get ready(): boolean {
    return this.db !== null;
  }

  /** Drop everything; store becomes not-ready until the next init/load. */
  reset(): void {
    this.db = null;
    this.dim = 0;
    this.modelId = "";
    this.chunkIds = {};
    this.paths = {};
    this.hashes = {};
  }

  /** Create a fresh DB for a given vector dimension + model id. Clears content. */
  init(dim: number, modelId: string): void {
    this.dim = dim;
    this.modelId = modelId;
    this.chunkIds = {};
    this.paths = {};
    this.hashes = {};
    this.db = create({
      schema: {
        id: "string",
        citekey: "string",
        title: "string",
        section: "string",
        year: "number",
        // enum[] gives exact, whole-value matching (`containsAll`); string[] would tokenize,
        // so a multi-word tag like "Spinal Fusion" could never be filtered on as one value.
        tags: "enum[]",
        // A tokenized copy of the same tags, `enum[]` can't participate in full-text relevance
        // (that's the point of enum) — this is what lets a query mentioning "spinal fusion"
        // rank a chunk whose only mesh_terms/tags hit is that phrase, boosted in `search()`.
        tagText: "string",
        author: "enum[]",
        text: "string",
        embedding: `vector[${dim}]`,
      } as any,
    });
  }

  async addChunks(chunks: Chunk[], vectors: number[][]): Promise<void> {
    if (!this.db) throw new Error("store not initialized");
    const docs = chunks.map((c, i) => ({
      id: c.id,
      citekey: c.citekey,
      title: c.title,
      section: c.section,
      year: c.year,
      tags: c.tags,
      tagText: c.tags.join(" "),
      author: c.authors,
      text: c.text,
      embedding: vectors[i],
    }));
    // stale ids (e.g. meta/DB desync) would make insertMultiple throw DOCUMENT_ALREADY_EXISTS
    for (const d of docs) {
      if (getByID(this.db, d.id)) await remove(this.db, d.id);
    }
    await insertMultiple(this.db, docs);
    for (const c of chunks) {
      if (!this.chunkIds[c.citekey]) this.chunkIds[c.citekey] = [];
      if (!this.chunkIds[c.citekey].includes(c.id)) this.chunkIds[c.citekey].push(c.id);
    }
  }

  async removeCitekey(citekey: string): Promise<void> {
    if (!this.db) return;
    const ids = this.chunkIds[citekey];
    if (ids && ids.length) await removeMultiple(this.db, ids);
    delete this.chunkIds[citekey];
    for (const [p, ck] of Object.entries(this.paths)) {
      if (ck === citekey) {
        delete this.paths[p];
        delete this.hashes[p];
      }
    }
  }

  /** Record which note path holds a citekey's chunks (and the hash of the text embedded). */
  setPath(path: string, citekey: string, hash?: string): void {
    this.paths[path] = citekey;
    if (hash) this.hashes[path] = hash;
  }

  citekeyForPath(path: string): string | undefined {
    return this.paths[path];
  }

  hashForPath(path: string): string | undefined {
    return this.hashes[path];
  }

  async search(
    queryVec: number[],
    term: string,
    k: number,
    filters: SearchFilters = {}
  ): Promise<SearchHit[]> {
    if (!this.db) throw new Error("Index not built yet — run “Rebuild index”.");
    if (queryVec.length !== this.dim) {
      throw new Error(`Query dim ${queryVec.length} ≠ index dim ${this.dim}. Rebuild the index.`);
    }
    const where: Record<string, unknown> = {};
    // Orama allows exactly one operator per property, so a two-sided range must be `between`
    // rather than `{ gte, lte }` (which throws INVALID_FILTER_OPERATION).
    if (filters.yearFrom && filters.yearTo) where.year = { between: [filters.yearFrom, filters.yearTo] };
    else if (filters.yearFrom) where.year = { gte: filters.yearFrom };
    else if (filters.yearTo) where.year = { lte: filters.yearTo };
    if (filters.tags?.length) where.tags = { containsAll: filters.tags };
    if (filters.author) where.author = { containsAll: [filters.author.trim().toLowerCase()] };
    const res = await search(this.db, {
      term: term || " ",
      mode: MODE_HYBRID_SEARCH,
      vector: { value: queryVec, property: "embedding" },
      similarity: 0,
      includeVectors: false,
      limit: k,
      // A term hitting a paper's own mesh_terms/tags is a strong topical signal even when the
      // vector side is lukewarm — moderate boost, not a filter (an unrelated query still ranks
      // on the passage text/vector, this only sways close calls).
      boost: { tagText: 1.5 },
      ...(Object.keys(where).length ? { where } : {}),
    } as any);
    return (res.hits as any[]).map((h) => ({
      id: String(h.document.id),
      citekey: String(h.document.citekey),
      title: String(h.document.title),
      section: String(h.document.section),
      year: Number(h.document.year) || 0,
      text: String(h.document.text),
      score: h.score as number,
    }));
  }

  get count(): number {
    return Object.values(this.chunkIds).reduce((a, b) => a + b.length, 0);
  }

  async serialize(): Promise<{ data: string; meta: StoredMeta }> {
    const data = (await persist(this.db, "json")) as string;
    const meta: StoredMeta = {
      modelId: this.modelId,
      dim: this.dim,
      chunkIds: this.chunkIds,
      count: this.count,
      paths: this.paths,
      hashes: this.hashes,
      schema: INDEX_SCHEMA,
    };
    return { data, meta };
  }

  async load(data: string, meta: StoredMeta): Promise<void> {
    const db: any = await restore("json", data);
    // DB/meta written separately — a crash between writes can desync them; treat as absent.
    const tracked = Object.values(meta.chunkIds || {}).reduce((a, b) => a + b.length, 0);
    if (count(db) !== tracked) {
      throw new Error(`index/meta desync (${count(db)} docs vs ${tracked} tracked) — rebuild required`);
    }
    this.db = db;
    this.dim = meta.dim;
    this.modelId = meta.modelId;
    this.chunkIds = meta.chunkIds || {};
    this.paths = meta.paths || {};
    this.hashes = meta.hashes || {};
  }
}
