import { Chunk } from "./chunker";
import { TextDoc, TextIndex } from "./textIndex";

/** Bump on any index schema change (or the on-disk persistence format): an index written
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

/** Text hits kept (every match is scored; past this rank the normalized BM25 share is small). */
const TEXT_LIMIT = 2000;

/** Size (chars) of one piece of the streamed docs.json. */
const PART_CHARS = 4_000_000;

function unit(v: ArrayLike<number>, out: Float32Array, at: number): void {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) out[at + i] = v[i] / n;
}

/** `TextIndex` (BM25 + facets/filters, typed arrays) for the text arm; embeddings live in one packed
 *  Float32Array we scan ourselves. Row `r` addresses both. */
export class VectorStore {
  /** Gated fusion (default): measured on a 96-question held-out set it beat Orama's own hybrid
   *  formula (English nDCG@10 0.63 vs 0.55 with expansion). `false` reproduces Orama exactly — kept for the parity test. */
  gatedFusion = true;
  /** Size of the vector arm's top slice (500; tests shrink it). */
  vectorArm = 500;
  private ti: TextIndex | null = null;
  /** Row-major, L2-normalized (dot = cosine). Capacity grows ×1.5. */
  private bank = new Float32Array(0);
  private rowOf = new Map<string, number>();
  private idAt: (string | null)[] = [];
  /** Rows whose text postings are gone (reusable) / not yet gone (see `TextIndex.epoch`). */
  private free: number[] = [];
  private pending: number[] = [];
  private seenEpoch = 0;
  dim = 0;
  modelId = "";
  chunkIds: Record<string, string[]> = {};
  /** note path → citekey, so deletes/renames can resolve chunks even when filename ≠ citekey. */
  paths: Record<string, string> = {};
  /** note path → chunk-text hash, so a frontmatter-only write doesn't re-embed the note. */
  hashes: Record<string, string> = {};

  get ready(): boolean {
    return this.ti !== null;
  }

  /** Drop everything; store becomes not-ready until the next init/load. */
  reset(): void {
    this.ti = null;
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
    this.pending = [];
  }

  /** Freed rows become reusable once a compaction has dropped their stale text postings. */
  private syncFree(): void {
    if (!this.ti || this.ti.epoch === this.seenEpoch) return;
    for (const r of this.pending) this.free.push(r);
    this.pending = [];
    this.seenEpoch = this.ti.epoch;
  }

  private takeRow(id: string): number {
    let row = this.rowOf.get(id);
    if (row === undefined) {
      this.syncFree();
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
    this.syncFree();
    this.rowOf.delete(id);
    this.idAt[row] = null;
    this.pending.push(row);
  }

  /** Create a fresh DB for a given vector dimension + model id. Clears content. */
  init(dim: number, modelId: string): void {
    this.dim = dim;
    this.modelId = modelId;
    this.chunkIds = {};
    this.paths = {};
    this.hashes = {};
    this.clearBank();
    this.ti = new TextIndex();
    this.seenEpoch = 0;
  }

  async addChunks(chunks: Chunk[], vectors: number[][]): Promise<void> {
    const ti = this.ti;
    if (!ti) throw new Error("store not initialized");
    for (const v of vectors.slice(0, chunks.length)) {
      if (v?.length !== this.dim) throw new Error(`Vector dim ${v?.length} ≠ index dim ${this.dim}.`);
    }
    // stale ids (e.g. meta/DB desync) are replaced: free the old row, take a clean one
    for (const c of chunks) {
      const old = this.rowOf.get(c.id);
      if (old !== undefined) {
        ti.remove(old);
        this.freeRow(c.id);
      }
    }
    chunks.forEach((c, i) => {
      const row = this.takeRow(c.id); // may reallocate the bank, so take the row first
      unit(vectors[i], this.bank, row * this.dim);
      ti.add(row, {
        id: c.id,
        citekey: c.citekey,
        title: c.title,
        section: c.section,
        year: c.year,
        tags: c.tags,
        author: c.authors,
        text: c.text,
      });
    });
    for (const c of chunks) {
      if (!this.chunkIds[c.citekey]) this.chunkIds[c.citekey] = [];
      if (!this.chunkIds[c.citekey].includes(c.id)) this.chunkIds[c.citekey].push(c.id);
    }
  }

  async removeCitekey(citekey: string): Promise<void> {
    const ti = this.ti;
    if (!ti) return;
    for (const id of this.chunkIds[citekey] ?? []) {
      const row = this.rowOf.get(id);
      if (row !== undefined) ti.remove(row);
      this.freeRow(id);
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
    const ti = this.ti;
    if (!ti) throw new Error("Index not built yet — run “Rebuild index”.");
    if (queryVec.length !== this.dim) {
      throw new Error(`Query dim ${queryVec.length} ≠ index dim ${this.dim}. Rebuild the index.`);
    }
    const allowed = ti.allowedRows(filters);
    // Text arm: BM25 (a boost, not a filter, on tagged passages), top score → 1.
    const textHits = ti.search(term, allowed, TEXT_LIMIT);
    const merged = new Map<number, number>();
    const maxText = textHits.length ? textHits[0].score : 0;
    if (maxText > 0) for (const h of textHits) merged.set(h.row, (0.5 * h.score) / maxText);
    // Vector arm: cosine vs every live row (inside the filter), > 0 only, top this.vectorArm, top → 1.
    const q = new Float32Array(this.dim);
    unit(queryVec, q, 0);
    const dim = this.dim;
    // Orama's hybrid gives *every* text hit its vector score too (its vector arm returns all docs
    // above `similarity: 0`), so score every row once and look scores up for text hits — keeping
    // only a top slice of the vector arm dropped that half for text-only hits and reordered results.
    const sim = new Float32Array(this.idAt.length);
    let maxVec = 0;
    let cand: { row: number; s: number }[] = [];
    let cut = 0;
    for (let row = 0; row < this.idAt.length; row++) {
      if (this.idAt[row] === null || (allowed && !allowed[row])) continue;
      let sc = 0;
      for (let j = 0, o = row * dim; j < dim; j++) sc += q[j] * this.bank[o + j];
      sim[row] = sc;
      if (sc > maxVec) maxVec = sc;
      if (sc <= cut) continue;
      cand.push({ row, s: sc });
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
      const near = this.gatedFusion ? new Set(cand.map((c) => c.row)) : null;
      for (const row of merged.keys()) {
        if (near && !near.has(row)) continue;
        const sc = sim[row];
        if (sc > 0) merged.set(row, (merged.get(row) ?? 0) + (0.5 * sc) / maxVec);
      }
      for (const c of cand) if (!merged.has(c.row)) merged.set(c.row, (0.5 * c.s) / maxVec);
    }
    const top = [...merged].sort((x, y) => y[1] - x[1]).slice(0, k);
    const out: SearchHit[] = [];
    for (const [row, score] of top) {
      const d = ti.doc(row);
      if (!d) continue;
      out.push({
        id: d.id,
        citekey: d.citekey,
        title: d.title,
        section: d.section,
        year: Number(d.year) || 0,
        text: d.text,
        score,
        vector: this.bank.subarray(row * dim, (row + 1) * dim),
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
  /** Join of `serializeStream()` — one big string; the writer should prefer the stream. */
  async serialize(): Promise<{ docs: string; vectors: ArrayBuffer; meta: StoredMeta }> {
    const { parts, vectors, meta } = await this.serializeStream();
    return { docs: [...parts].join(""), vectors, meta };
  }

  /** Merge the text index's recent adds into its typed arrays and drop dead bytes (cheap to call often). */
  flush(): void {
    this.ti?.compact();
    this.syncFree();
  }

  /** Same content as `serialize()`, but `docs.json` comes out as pieces (a generator of
   *  ≤ ~`PART_CHARS` strings whose concatenation is the file) so it is never one 150 MB+ string. */
  async serializeStream(): Promise<{ parts: Generator<string>; vectors: ArrayBuffer; meta: StoredMeta }> {
    const ti = this.ti;
    if (!ti) throw new Error("store not initialized");
    const ids: string[] = [];
    for (const arr of Object.values(this.chunkIds)) ids.push(...arr);
    const dim = this.dim;
    const rows = new Int32Array(ids.length);
    ids.forEach((id, i) => {
      const row = this.rowOf.get(id);
      if (row === undefined || !ti.has(row)) throw new Error(`index/meta desync — rebuild required (missing doc ${id})`);
      rows[i] = row;
    });
    const vectors = new Float32Array(ids.length * dim);
    for (let i = 0; i < rows.length; i++) vectors.set(this.bank.subarray(rows[i] * dim, (rows[i] + 1) * dim), i * dim);
    const index: TextIndex = ti;
    function* parts(): Generator<string> {
      let out = "[";
      let first = true;
      for (const row of rows) {
        const doc = index.doc(row);
        if (!doc) throw new Error("index/meta desync — rebuild required");
        out +=
          (first ? "" : ",") +
          JSON.stringify({
            id: doc.id,
            citekey: doc.citekey,
            title: doc.title,
            section: doc.section,
            year: doc.year,
            tags: doc.tags,
            author: doc.author,
            text: doc.text,
          });
        first = false;
        if (out.length >= PART_CHARS) {
          yield out;
          out = "";
        }
      }
      yield out + "]";
    }
    const meta: StoredMeta = {
      modelId: this.modelId,
      dim: this.dim,
      chunkIds: this.chunkIds,
      count: this.count,
      paths: this.paths,
      hashes: this.hashes,
      schema: INDEX_SCHEMA,
    };
    return { parts: parts(), vectors: vectors.buffer, meta };
  }

  async load(docsJson: string, vectors: ArrayBuffer, meta: StoredMeta): Promise<void> {
    // docs/vectors/meta written separately — a crash between writes can desync them; treat as absent.
    const tracked = Object.values(meta.chunkIds || {}).reduce((a, b) => a + b.length, 0);
    const docs = JSON.parse(docsJson) as Array<TextDoc | undefined>;
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
    const ti = this.ti as TextIndex;
    const view = new Float32Array(vectors);
    this.bank = new Float32Array(docs.length * meta.dim);
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i] as TextDoc;
      docs[i] = undefined; // let the parsed document go as soon as it is indexed
      const o = i * meta.dim;
      unit(view.subarray(o, o + meta.dim), this.bank, o);
      this.rowOf.set(d.id, i);
      this.idAt.push(d.id);
      ti.add(i, d);
    }
    ti.compact();
    this.seenEpoch = ti.epoch;
    this.chunkIds = meta.chunkIds || {};
    this.paths = meta.paths || {};
    this.hashes = meta.hashes || {};
  }
}
