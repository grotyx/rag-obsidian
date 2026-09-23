import {
  create,
  insertMultiple,
  remove,
  removeMultiple,
  getByID,
  search,
  MODE_HYBRID_SEARCH,
} from "@orama/orama";
import { Chunk } from "./chunker";

/** Bump on any Orama schema change (or the on-disk persistence format): an index written
 *  under an older number cannot be restored into the new schema, so `IndexManager.restore`
 *  drops it and asks for a rebuild.
 *  Schema 4: stopped persisting the whole Orama DB (`@orama/plugin-data-persistence`, which
 *  wrote every vector twice as JSON text) in favor of `docs.json` (documents, no embedding
 *  field) + `vectors.f32` (one packed Float32Array) — see `serialize`/`load`. */
export const INDEX_SCHEMA = 4;

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
      // NOT false: @orama/orama's `includeVectors: false` path (removeVectorsFromHits)
      // mutates the *stored* document in place, permanently nulling its embedding — a real
      // corruption a later persist would silently write out. We never read `h.document.embedding`
      // below anyway (the mapped SearchHit doesn't carry it), so just leave it in the hit.
      includeVectors: true,
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

  /** Documents (without their embedding — `docs`) + one packed Float32Array of every
   *  embedding in the same order (`vectors`), instead of persisting the whole Orama DB
   *  (which wrote each vector twice, as JSON text). Order follows `this.chunkIds`. */
  async serialize(): Promise<{ docs: string; vectors: ArrayBuffer; meta: StoredMeta }> {
    if (!this.db) throw new Error("store not initialized");
    const ids: string[] = [];
    for (const arr of Object.values(this.chunkIds)) ids.push(...arr);
    const docs: Array<Record<string, unknown>> = [];
    const vectors = new Float32Array(ids.length * this.dim);
    ids.forEach((id, i) => {
      const doc = getByID(this.db, id);
      if (!doc) throw new Error(`index/meta desync — rebuild required (missing doc ${id})`);
      docs.push({
        id: doc.id,
        citekey: doc.citekey,
        title: doc.title,
        section: doc.section,
        year: doc.year,
        tags: doc.tags,
        author: doc.author,
        text: doc.text,
      });
      vectors.set(doc.embedding as number[], i * this.dim);
    });
    const meta: StoredMeta = {
      modelId: this.modelId,
      dim: this.dim,
      chunkIds: this.chunkIds,
      count: this.count,
      paths: this.paths,
      hashes: this.hashes,
      schema: INDEX_SCHEMA,
    };
    return { docs: JSON.stringify(docs), vectors: vectors.buffer, meta };
  }

  async load(docsJson: string, vectors: ArrayBuffer, meta: StoredMeta): Promise<void> {
    // docs/vectors/meta written separately — a crash between writes can desync them; treat as absent.
    const tracked = Object.values(meta.chunkIds || {}).reduce((a, b) => a + b.length, 0);
    const docs = JSON.parse(docsJson) as Array<{
      id: string;
      citekey: string;
      title: string;
      section: string;
      year: number;
      tags: string[];
      author: string[];
      text: string;
    }>;
    if (docs.length !== tracked) {
      throw new Error(`index/meta desync (${docs.length} docs vs ${tracked} tracked) — rebuild required`);
    }
    const expectedBytes = docs.length * meta.dim * 4;
    if (vectors.byteLength !== expectedBytes) {
      throw new Error(
        `index/meta desync (vectors ${vectors.byteLength} bytes vs ${expectedBytes} expected) — rebuild required`
      );
    }
    this.init(meta.dim, meta.modelId);
    const view = new Float32Array(vectors);
    const insertDocs = docs.map((d, i) => ({
      id: d.id,
      citekey: d.citekey,
      title: d.title,
      section: d.section,
      year: d.year,
      tags: d.tags,
      tagText: d.tags.join(" "),
      author: d.author,
      text: d.text,
      embedding: Array.from(view.subarray(i * meta.dim, i * meta.dim + meta.dim)),
    }));
    if (insertDocs.length) await insertMultiple(this.db, insertDocs);
    this.chunkIds = meta.chunkIds || {};
    this.paths = meta.paths || {};
    this.hashes = meta.hashes || {};
  }
}
