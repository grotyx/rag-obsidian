import {
  create,
  insertMultiple,
  removeMultiple,
  search,
  MODE_HYBRID_SEARCH,
} from "@orama/orama";
import { persist, restore } from "@orama/plugin-data-persistence";
import { Chunk } from "./chunker";

export interface StoredMeta {
  modelId: string;
  dim: number;
  chunkIds: Record<string, string[]>;
  count: number;
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
}

/** Thin wrapper over an Orama hybrid (BM25 + vector) index. */
export class VectorStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any = null;
  dim = 0;
  modelId = "";
  chunkIds: Record<string, string[]> = {};

  get ready(): boolean {
    return this.db !== null;
  }

  /** Create a fresh DB for a given vector dimension + model id. Clears content. */
  init(dim: number, modelId: string): void {
    this.dim = dim;
    this.modelId = modelId;
    this.chunkIds = {};
    this.db = create({
      schema: {
        id: "string",
        citekey: "string",
        title: "string",
        section: "string",
        year: "number",
        tags: "string[]",
        text: "string",
        embedding: `vector[${dim}]`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      text: c.text,
      embedding: vectors[i],
    }));
    await insertMultiple(this.db, docs);
    for (const c of chunks) {
      if (!this.chunkIds[c.citekey]) this.chunkIds[c.citekey] = [];
      this.chunkIds[c.citekey].push(c.id);
    }
  }

  async removeCitekey(citekey: string): Promise<void> {
    if (!this.db) return;
    const ids = this.chunkIds[citekey];
    if (ids && ids.length) await removeMultiple(this.db, ids);
    delete this.chunkIds[citekey];
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
    if (filters.yearFrom || filters.yearTo) {
      where.year = {
        ...(filters.yearFrom ? { gte: filters.yearFrom } : {}),
        ...(filters.yearTo ? { lte: filters.yearTo } : {}),
      };
    }
    const res = await search(this.db, {
      term: term || " ",
      mode: MODE_HYBRID_SEARCH,
      vector: { value: queryVec, property: "embedding" },
      similarity: 0,
      includeVectors: false,
      limit: k,
      ...(Object.keys(where).length ? { where } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    };
    return { data, meta };
  }

  async load(data: string, meta: StoredMeta): Promise<void> {
    this.db = await restore("json", data);
    this.dim = meta.dim;
    this.modelId = meta.modelId;
    this.chunkIds = meta.chunkIds || {};
  }
}
