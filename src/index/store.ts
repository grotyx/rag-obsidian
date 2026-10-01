import {
  create,
  insertMultiple,
  remove,
  removeMultiple,
  getByID,
  search,
  AnyOrama,
  SearchParams,
} from "@orama/orama";
import { Chunk } from "./chunker";

/** Orama's generics are driven by string-literal schema types (`"enum[]"`, `` `vector[${N}]` ``)
 *  that aren't worth threading through a runtime-built dimension — this wraps it loosely
 *  (`AnyOrama`) and describes only the document/hit shape actually read here. */
interface StoredDoc {
  id: string;
  citekey: string;
  title: string;
  section: string;
  year: number;
  tags: string[];
  author: string[];
  text: string;
}

interface SearchHitRaw {
  document: StoredDoc;
  score: number;
}

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
  /** View onto this hit's row of the vector bank (no copy). Internal use (MMR) only. */
  vector?: Float32Array;
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

/** Candidates kept per arm before merging (Orama's own hybrid merges the full lists; the tail
 *  past the top 500 cannot reach a realistic `k`). */
/** Text hits kept from Orama (it returns every match; past this rank the normalized BM25 share is small). */
const TEXT_LIMIT = 2000;

function unit(v: ArrayLike<number>, out: Float32Array, at: number): void {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) out[at + i] = v[i] / n;
}

/** Orama (BM25 + facets/filters) for the text arm; embeddings live in one packed Float32Array
 *  we scan ourselves (Orama's vector arm is a brute-force scan too, but holds `number[]`s). */
export class VectorStore {
  /** Gated fusion (default): measured on a 96-question held-out set it beat Orama's own hybrid
   *  formula (English nDCG@10 0.63 vs 0.55 with expansion). `false` reproduces Orama exactly — kept for the parity test. */
  gatedFusion = true;
  /** Size of the vector arm's top slice (500; tests shrink it). */
  vectorArm = 500;
  private db: AnyOrama | null = null;
  /** Row-major, L2-normalized (dot = cosine). Capacity grows ×1.5. */
  private bank = new Float32Array(0);
  private rowOf = new Map<string, number>();
  private idAt: (string | null)[] = [];
  private free: number[] = [];
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
    this.clearBank();
    this.dim = 0;
    this.modelId = "";
    this.chunkIds = {};
    this.paths = {};
    this.hashes = {};
  }

  private clearBank(): void {
    this.bank = new Float32Array(0);
    this.rowOf = new Map();
    this.idAt = [];
    this.free = [];
  }

  private takeRow(id: string): number {
    let row = this.rowOf.get(id);
    if (row === undefined) {
      row = this.free.pop();
      if (row === undefined) {
        row = this.idAt.length;
        this.idAt.push(null);
        if ((row + 1) * this.dim > this.bank.length) {
          const grown = new Float32Array(Math.max((row + 1) * this.dim, Math.ceil(this.bank.length * 1.5)));
          grown.set(this.bank);
          this.bank = grown;
        }
      }
      this.rowOf.set(id, row);
      this.idAt[row] = id;
    }
    return row;
  }

  private freeRow(id: string): void {
    const row = this.rowOf.get(id);
    if (row === undefined) return;
    this.rowOf.delete(id);
    this.idAt[row] = null;
    this.free.push(row);
  }

  /** Create a fresh DB for a given vector dimension + model id. Clears content. */
  init(dim: number, modelId: string): void {
    this.dim = dim;
    this.modelId = modelId;
    this.chunkIds = {};
    this.paths = {};
    this.hashes = {};
    this.clearBank();
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
      },
    });
  }

  async addChunks(chunks: Chunk[], vectors: number[][]): Promise<void> {
    if (!this.db) throw new Error("store not initialized");
    for (const v of vectors.slice(0, chunks.length)) {
      if (v?.length !== this.dim) throw new Error(`Vector dim ${v?.length} ≠ index dim ${this.dim}.`);
    }
    const docs = chunks.map((c) => ({
      id: c.id,
      citekey: c.citekey,
      title: c.title,
      section: c.section,
      year: c.year,
      tags: c.tags,
      tagText: c.tags.join(" "),
      author: c.authors,
      text: c.text,
    }));
    // stale ids (e.g. meta/DB desync) would make insertMultiple throw DOCUMENT_ALREADY_EXISTS
    for (const d of docs) {
      if (getByID(this.db, d.id)) await remove(this.db, d.id);
    }
    await insertMultiple(this.db, docs);
    chunks.forEach((c, i) => {
      const row = this.takeRow(c.id); // may reallocate the bank, so take the row first
      unit(vectors[i], this.bank, row * this.dim);
    });
    for (const c of chunks) {
      if (!this.chunkIds[c.citekey]) this.chunkIds[c.citekey] = [];
      if (!this.chunkIds[c.citekey].includes(c.id)) this.chunkIds[c.citekey].push(c.id);
    }
  }

  async removeCitekey(citekey: string): Promise<void> {
    if (!this.db) return;
    const ids = this.chunkIds[citekey];
    if (ids && ids.length) {
      await removeMultiple(this.db, ids);
      for (const id of ids) this.freeRow(id);
    }
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
    const db = this.db;
    const whereArg = Object.keys(where).length ? { where } : {};
    // Text arm: Orama BM25 (a boost, not a filter, on tagged passages), top score → 1.
    const text = await search(db, {
      term: term || " ",
      limit: TEXT_LIMIT,
      boost: { tagText: 1.5 },
      ...whereArg,
    } as SearchParams<AnyOrama>);
    const textHits = text.hits as unknown as SearchHitRaw[];
    const docs = new Map<string, StoredDoc>();
    const merged = new Map<string, number>();
    const maxText = textHits.length ? textHits[0].score : 0;
    if (maxText > 0) {
      for (const h of textHits) {
        docs.set(h.document.id, h.document);
        merged.set(h.document.id, (0.5 * h.score) / maxText);
      }
    }
    // Vector arm: cosine vs every live row (inside the filter), > 0 only, top this.vectorArm, top → 1.
    let allowed: Set<string> | null = null;
    if (whereArg.where) {
      const all = await search(db, { term: "", limit: Math.max(1, this.count), ...whereArg } as SearchParams<AnyOrama>);
      allowed = new Set((all.hits as unknown as SearchHitRaw[]).map((h) => h.document.id));
    }
    const q = new Float32Array(this.dim);
    unit(queryVec, q, 0);
    const dim = this.dim;
    // Orama's hybrid gives *every* text hit its vector score too (its vector arm returns all docs
    // above `similarity: 0`), so score every row once and look scores up for text hits — keeping
    // only a top slice of the vector arm dropped that half for text-only hits and reordered results.
    const sim = new Float32Array(this.idAt.length);
    let maxVec = 0;
    let cand: { id: string; s: number }[] = [];
    let cut = 0;
    for (let row = 0; row < this.idAt.length; row++) {
      const id = this.idAt[row];
      if (id === null || (allowed && !allowed.has(id))) continue;
      let sc = 0;
      for (let j = 0, o = row * dim; j < dim; j++) sc += q[j] * this.bank[o + j];
      sim[row] = sc;
      if (sc > maxVec) maxVec = sc;
      if (sc <= cut) continue;
      cand.push({ id, s: sc });
      if (cand.length >= this.vectorArm * 2) {
        cand.sort((x, y) => y.s - x.s);
        cand = cand.slice(0, this.vectorArm);
        cut = Math.max(cut, cand[this.vectorArm - 1].s);
      }
    }
    cand.sort((x, y) => y.s - x.s);
    cand = cand.slice(0, this.vectorArm);
    if (maxVec > 0) {
      // `gated`: only passages in the vector arm's top slice get its share — a keyword-only match the
      // embedding ranks far down is not lifted by a vector score it barely has.
      const near = this.gatedFusion ? new Set(cand.map((c) => c.id)) : null;
      for (const id of merged.keys()) {
        if (near && !near.has(id)) continue;
        const row = this.rowOf.get(id);
        const sc = row === undefined ? 0 : sim[row];
        if (sc > 0) merged.set(id, (merged.get(id) ?? 0) + (0.5 * sc) / maxVec);
      }
      for (const c of cand) if (!merged.has(c.id)) merged.set(c.id, (0.5 * c.s) / maxVec);
    }
    const top = [...merged].sort((x, y) => y[1] - x[1]).slice(0, k);
    const out: SearchHit[] = [];
    for (const [id, score] of top) {
      const d = docs.get(id) ?? (getByID(db, id) as unknown as StoredDoc | undefined);
      if (!d) continue;
      const row = this.rowOf.get(id);
      out.push({
        id: String(d.id),
        citekey: String(d.citekey),
        title: String(d.title),
        section: String(d.section),
        year: Number(d.year) || 0,
        text: String(d.text),
        score,
        ...(row === undefined ? {} : { vector: this.bank.subarray(row * dim, (row + 1) * dim) }),
      });
    }
    return out;
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
    const dim = this.dim;
    ids.forEach((id, i) => {
      const doc = getByID(this.db as AnyOrama, id) as unknown as StoredDoc | undefined;
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
      const row = this.rowOf.get(id);
      if (row === undefined) throw new Error(`index/meta desync — rebuild required (missing vector ${id})`);
      vectors.set(this.bank.subarray(row * dim, (row + 1) * dim), i * dim);
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
    const insertDocs = docs.map((d) => ({
      id: d.id,
      citekey: d.citekey,
      title: d.title,
      section: d.section,
      year: d.year,
      tags: d.tags,
      tagText: d.tags.join(" "),
      author: d.author,
      text: d.text,
    }));
    if (insertDocs.length) await insertMultiple(this.db as AnyOrama, insertDocs);
    this.bank = new Float32Array(docs.length * meta.dim);
    docs.forEach((d, i) => {
      const o = i * meta.dim;
      unit(view.subarray(o, o + meta.dim), this.bank, o);
      this.rowOf.set(d.id, i);
      this.idAt.push(d.id);
    });
    this.chunkIds = meta.chunkIds || {};
    this.paths = meta.paths || {};
    this.hashes = meta.hashes || {};
  }
}
