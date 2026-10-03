/** Compact incremental BM25 index with metadata filters — the text arm of `VectorStore`.
 *
 *  Mirrors Orama 3.1.x's default full-text search (what `VectorStore` used before):
 *   - tokenizer: lowercase, split on /[^A-Za-zàèéìòóù0-9_'-]+/ (so Korean/CJK/most accented
 *     letters are separators), the 7 allowed accents folded to a/e/i/o/u, no stemming, no stop
 *     words, tokens de-duplicated per field (so a field's length = its UNIQUE token count and
 *     tf = 1/length — Orama stores tf that way);
 *   - fields searched: id, citekey, title, section, text, tagText (the `string` schema props),
 *     per-field BM25 (k 1.2, b 0.75, d 0.5; idf = ln(1 + (N − df + 0.5)/(df + 0.5)), N = all live
 *     docs, avg length per field) summed over fields and over every matching word, `tagText` ×1.5;
 *   - each query token PREFIX-matches dictionary words (tolerance 0, not exact) and every matched
 *     word scores separately; threshold 1 = OR across tokens; an empty query returns nothing;
 *   - filters (year between/gte/lte, tags containsAll exact, author containsAll exact) restrict the
 *     hits but never df / N / averages.
 *  Knowingly simplified: Orama keeps a running average of field length updated at insert time
 *  (order dependent); this uses the exact mean over live docs. Ties are broken by row, not by
 *  Orama's map-insertion order.
 *
 *  Layout (nothing per document on the V8 heap): postings are CSR typed arrays per field plus a
 *  small Map "memtable" of recent adds; strings live as UTF-8 in one byte array. Removal is
 *  lazy — the row goes stale, queries skip it, df is fixed up at once, and `compact()` drops the
 *  stale postings. A stale row must not be re-added until a compaction (`epoch` changes) has run.
 *  Pure module: no obsidian import. */

export interface TextDoc {
  id: string;
  citekey: string;
  title: string;
  section: string;
  year: number;
  tags: string[];
  author: string[];
  text: string;
}

export interface TextFilters {
  yearFrom?: number;
  yearTo?: number;
  tags?: string[];
  author?: string;
}

const SPLIT = /[^A-Za-zàèéìòóù0-9_'-]+/gim;
const ACCENT: Record<string, string> = { à: "a", è: "e", é: "e", ì: "i", ò: "o", ó: "o", ù: "u" };
const ACCENT_RE = /[àèéìòóù]/g;

/** Orama's default English tokenizer (unique tokens, order of first appearance). */
export function tokenize(s: string): string[] {
  const seen = new Set<string>();
  for (let t of s.toLowerCase().split(SPLIT)) {
    if (!t) continue;
    if (/[àèéìòóù]/.test(t)) t = t.replace(ACCENT_RE, (c) => ACCENT[c]);
    seen.add(t);
  }
  return [...seen];
}

const NF = 6; // id, citekey, title, section, text, tagText
const NSTR = 5; // stored strings: id, citekey, title, section, text
const F_TEXT = 4;
const BOOST = [1, 1, 1, 1, 1, 1.5];
const K = 1.2;
const B = 0.75;
const D = 0.5;
const enc = new TextEncoder();
const dec = new TextDecoder();

function grown<T extends Uint8Array | Int16Array | Int32Array | Uint32Array | Uint16Array | Float64Array>(a: T, n: number): T {
  if (a.length >= n) return a;
  const out = new (a.constructor as new (len: number) => T)(Math.max(n, Math.ceil(a.length * 1.5), 16));
  out.set(a);
  return out;
}

class FieldIdx {
  terms = new Map<string, number>();
  names: string[] = [];
  /** Live docs containing each term. */
  df = new Int32Array(1024);
  /** CSR main: postings of term t are rows[off[t] .. off[t+1]) for t < mainTerms. */
  off = new Int32Array(1);
  rows = new Int32Array(0);
  mainTerms = 0;
  mem = new Map<number, number[]>();
  memCount = 0;
  sorted: string[] = [];
  fresh: string[] = [];
  sumLen = 0;

  idOf(t: string): number {
    let id = this.terms.get(t);
    if (id === undefined) {
      // a long token is a slice of the whole chunk text — copy it so the text can be freed
      if (t.length >= 13) t = dec.decode(enc.encode(t));
      id = this.names.length;
      this.names.push(t);
      this.terms.set(t, id);
      this.fresh.push(t);
      this.df = grown(this.df, id + 1);
    }
    return id;
  }

  /** Dictionary words starting with `prefix`. */
  prefixed(prefix: string): string[] {
    if (this.fresh.length > Math.max(2000, this.sorted.length >> 3)) {
      const add = this.fresh.sort();
      const out: string[] = new Array<string>(this.sorted.length + add.length);
      let i = 0, j = 0, k = 0;
      while (i < this.sorted.length && j < add.length) out[k++] = this.sorted[i] <= add[j] ? this.sorted[i++] : add[j++];
      while (i < this.sorted.length) out[k++] = this.sorted[i++];
      while (j < add.length) out[k++] = add[j++];
      this.sorted = out;
      this.fresh = [];
    }
    const res: string[] = [];
    const s = this.sorted;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (s[mid] < prefix) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < s.length && s[i].startsWith(prefix); i++) res.push(s[i]);
    for (const w of this.fresh) if (w.startsWith(prefix)) res.push(w);
    return res;
  }

  /** Rebuild the CSR from main + memtable, dropping rows whose `st` is not live (1). */
  compact(st: Uint8Array): void {
    const nT = this.names.length;
    const off = new Int32Array(nT + 1);
    let total = 0;
    for (let t = 0; t < nT; t++) {
      let c = 0;
      if (t < this.mainTerms) for (let i = this.off[t]; i < this.off[t + 1]; i++) if (st[this.rows[i]] === 1) c++;
      const m = this.mem.get(t);
      if (m) for (const r of m) if (st[r] === 1) c++;
      off[t] = total;
      total += c;
    }
    off[nT] = total;
    const rows = new Int32Array(total);
    for (let t = 0; t < nT; t++) {
      let p = off[t];
      if (t < this.mainTerms) for (let i = this.off[t]; i < this.off[t + 1]; i++) if (st[this.rows[i]] === 1) rows[p++] = this.rows[i];
      const m = this.mem.get(t);
      if (m) for (const r of m) if (st[r] === 1) rows[p++] = r;
    }
    this.off = off;
    this.rows = rows;
    this.mainTerms = nT;
    this.mem = new Map();
    this.memCount = 0;
  }
}

export class TextIndex {
  private fields: FieldIdx[] = Array.from({ length: NF }, () => new FieldIdx());
  /** 0 = never used / clean, 1 = live, 2 = removed with postings still present. */
  private st = new Uint8Array(0);
  private year = new Int16Array(0);
  private len: Uint32Array[] = Array.from({ length: NF }, () => new Uint32Array(0));
  /** Per row: byte offset of its record in `bytes`, and the byte length of each stored string. */
  private recOff = new Uint32Array(0);
  private recLen = new Uint32Array(0);
  private bytes = new Uint8Array(0);
  private bytesUsed = 0;
  private bytesDead = 0;
  /** Per row: offset into `pool`, tag count, author count (interned ids). */
  private poolOff = new Uint32Array(0);
  private tagN = new Uint16Array(0);
  private authN = new Uint16Array(0);
  private pool = new Int32Array(0);
  private poolUsed = 0;
  private poolDead = 0;
  private strs: string[] = [];
  private strId = new Map<string, number>();
  private live = 0;
  private staleRows = 0;
  private acc = new Float64Array(0);
  /** Changes whenever stale postings are dropped: rows freed before a change are safe to reuse. */
  epoch = 0;

  get size(): number {
    return this.live;
  }

  has(row: number): boolean {
    return row < this.st.length && this.st[row] === 1;
  }

  private intern(s: string): number {
    let id = this.strId.get(s);
    if (id === undefined) {
      id = this.strs.length;
      this.strs.push(s);
      this.strId.set(s, id);
    }
    return id;
  }

  private ensureRows(n: number): void {
    if (n <= this.st.length) return;
    const cap = Math.max(n, Math.ceil(this.st.length * 1.5), 16);
    this.st = grown(this.st, cap);
    this.year = grown(this.year, cap);
    this.len = this.len.map((a) => grown(a, cap));
    this.recOff = grown(this.recOff, cap);
    this.recLen = grown(this.recLen, cap * NSTR);
    this.poolOff = grown(this.poolOff, cap);
    this.tagN = grown(this.tagN, cap);
    this.authN = grown(this.authN, cap);
  }

  add(row: number, d: TextDoc): void {
    if (row < this.st.length && this.st[row] === 1) this.remove(row);
    if (row < this.st.length && this.st[row] === 2) this.compact();
    this.ensureRows(row + 1);
    const strs = [d.id, d.citekey, d.title, d.section, d.text];
    const parts = strs.map((s) => enc.encode(s));
    let total = 0;
    for (const p of parts) total += p.length;
    if (this.bytesUsed + total > this.bytes.length) this.bytes = grown(this.bytes, this.bytesUsed + total);
    this.recOff[row] = this.bytesUsed;
    parts.forEach((p, i) => {
      this.recLen[row * NSTR + i] = p.length;
      this.bytes.set(p, this.bytesUsed);
      this.bytesUsed += p.length;
    });
    const n = d.tags.length + d.author.length;
    if (this.poolUsed + n > this.pool.length) this.pool = grown(this.pool, this.poolUsed + n);
    this.poolOff[row] = this.poolUsed;
    this.tagN[row] = d.tags.length;
    this.authN[row] = d.author.length;
    for (const t of d.tags) this.pool[this.poolUsed++] = this.intern(t);
    for (const a of d.author) this.pool[this.poolUsed++] = this.intern(a);
    this.year[row] = Number(d.year) || 0;
    const values = [...strs, d.tags.join(" ")];
    for (let f = 0; f < NF; f++) {
      const toks = tokenize(values[f]);
      const fi = this.fields[f];
      this.len[f][row] = toks.length;
      fi.sumLen += toks.length;
      for (const t of toks) {
        const id = fi.idOf(t);
        fi.df[id]++;
        const m = fi.mem.get(id);
        if (m) m.push(row);
        else fi.mem.set(id, [row]);
        fi.memCount++;
      }
    }
    this.st[row] = 1;
    this.live++;
    if (this.fields[F_TEXT].memCount > Math.max(500_000, this.fields[F_TEXT].rows.length >> 2)) this.compact();
  }

  /** Lazy removal: queries skip the row at once; its postings go at the next `compact()`. */
  remove(row: number): void {
    if (!this.has(row)) return;
    const d = this.doc(row);
    if (!d) return;
    const values = [d.id, d.citekey, d.title, d.section, d.text, d.tags.join(" ")];
    for (let f = 0; f < NF; f++) {
      const fi = this.fields[f];
      for (const t of tokenize(values[f])) {
        const id = fi.terms.get(t);
        if (id !== undefined) fi.df[id]--;
      }
      fi.sumLen -= this.len[f][row];
    }
    for (let i = 0; i < NSTR; i++) this.bytesDead += this.recLen[row * NSTR + i];
    this.poolDead += this.tagN[row] + this.authN[row];
    this.st[row] = 2;
    this.live--;
    this.staleRows++;
    if (this.staleRows > Math.max(1000, this.live >> 4)) this.compact();
  }

  /** Drop stale postings and dead string/tag bytes. Afterwards no stale row remains. */
  compact(): void {
    for (const fi of this.fields) fi.compact(this.st);
    for (let r = 0; r < this.st.length; r++) if (this.st[r] === 2) this.st[r] = 0;
    this.staleRows = 0;
    this.epoch++;
    if (this.bytesDead > Math.max(1 << 20, this.bytesUsed >> 2)) {
      const nb = new Uint8Array(Math.max(16, this.bytesUsed - this.bytesDead));
      let p = 0;
      for (let r = 0; r < this.st.length; r++) {
        if (this.st[r] !== 1) continue;
        let n = 0;
        for (let i = 0; i < NSTR; i++) n += this.recLen[r * NSTR + i];
        nb.set(this.bytes.subarray(this.recOff[r], this.recOff[r] + n), p);
        this.recOff[r] = p;
        p += n;
      }
      this.bytes = nb;
      this.bytesUsed = p;
      this.bytesDead = 0;
    }
    if (this.poolDead > Math.max(100_000, this.poolUsed >> 2)) {
      const np = new Int32Array(Math.max(16, this.poolUsed - this.poolDead));
      let p = 0;
      for (let r = 0; r < this.st.length; r++) {
        if (this.st[r] !== 1) continue;
        const n = this.tagN[r] + this.authN[r];
        np.set(this.pool.subarray(this.poolOff[r], this.poolOff[r] + n), p);
        this.poolOff[r] = p;
        p += n;
      }
      this.pool = np;
      this.poolUsed = p;
      this.poolDead = 0;
    }
  }

  private str(row: number, i: number): string {
    let o = this.recOff[row];
    for (let j = 0; j < i; j++) o += this.recLen[row * NSTR + j];
    return dec.decode(this.bytes.subarray(o, o + this.recLen[row * NSTR + i]));
  }

  /** Decoded copy of one live row, or undefined. */
  doc(row: number): TextDoc | undefined {
    if (!this.has(row)) return undefined;
    const o = this.poolOff[row];
    const tn = this.tagN[row];
    const an = this.authN[row];
    const tags: string[] = [];
    const author: string[] = [];
    for (let i = 0; i < tn; i++) tags.push(this.strs[this.pool[o + i]]);
    for (let i = 0; i < an; i++) author.push(this.strs[this.pool[o + tn + i]]);
    return {
      id: this.str(row, 0),
      citekey: this.str(row, 1),
      title: this.str(row, 2),
      section: this.str(row, 3),
      year: this.year[row],
      tags,
      author,
      text: this.str(row, 4),
    };
  }

  /** 1 for each live row passing the filters; null when there are none to apply. */
  allowedRows(f: TextFilters): Uint8Array | null {
    const tagIds: number[] = [];
    let wantTags = false;
    if (f.tags?.length) {
      wantTags = true;
      for (const t of f.tags) {
        const id = this.strId.get(t);
        if (id === undefined) return new Uint8Array(this.st.length);
        tagIds.push(id);
      }
    }
    let authId = -1;
    const wantAuthor = !!f.author;
    if (f.author) {
      const id = this.strId.get(f.author.trim().toLowerCase());
      if (id === undefined) return new Uint8Array(this.st.length);
      authId = id;
    }
    const lo = f.yearFrom || 0;
    const hi = f.yearTo || 0;
    if (!wantTags && !wantAuthor && !lo && !hi) return null;
    const out = new Uint8Array(this.st.length);
    for (let r = 0; r < this.st.length; r++) {
      if (this.st[r] !== 1) continue;
      const y = this.year[r];
      if (lo && y < lo) continue;
      if (hi && y > hi) continue;
      const o = this.poolOff[r];
      const tn = this.tagN[r];
      if (wantTags) {
        let ok = true;
        for (const id of tagIds) {
          let hit = false;
          for (let i = 0; i < tn; i++) if (this.pool[o + i] === id) { hit = true; break; }
          if (!hit) { ok = false; break; }
        }
        if (!ok) continue;
      }
      if (wantAuthor) {
        let hit = false;
        for (let i = 0; i < this.authN[r]; i++) if (this.pool[o + tn + i] === authId) { hit = true; break; }
        if (!hit) continue;
      }
      out[r] = 1;
    }
    return out;
  }

  /** BM25 over all fields, best first (ties by row). */
  search(term: string, allowed: Uint8Array | null, limit: number): { row: number; score: number }[] {
    const tokens = tokenize(term);
    const N = this.live;
    if (!tokens.length || !N) return [];
    if (this.acc.length < this.st.length) this.acc = new Float64Array(this.st.length);
    const acc = this.acc;
    const st = this.st;
    const touched: number[] = [];
    for (let f = 0; f < NF; f++) {
      const fi = this.fields[f];
      const lens = this.len[f];
      const avg = fi.sumLen / N || 1;
      const boost = BOOST[f];
      for (const tok of tokens) {
        for (const w of fi.prefixed(tok)) {
          const id = fi.terms.get(w);
          if (id === undefined) continue;
          const df = fi.df[id];
          if (df <= 0) continue;
          const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
          const hit = (r: number): void => {
            if (st[r] !== 1 || (allowed && !allowed[r])) return;
            const L = lens[r];
            const tf = 1 / L;
            const s = (idf * (D + tf * (K + 1))) / (tf + K * (1 - B + (B * L) / avg));
            if (acc[r] === 0) touched.push(r);
            acc[r] += s * boost;
          };
          if (id < fi.mainTerms) for (let i = fi.off[id]; i < fi.off[id + 1]; i++) hit(fi.rows[i]);
          const m = fi.mem.get(id);
          if (m) for (const r of m) hit(r);
        }
      }
    }
    let pick = touched;
    if (touched.length > limit * 4) {
      const sc = Float64Array.from(touched, (r) => acc[r]).sort();
      const cut = sc[Math.max(0, sc.length - limit)];
      pick = touched.filter((r) => acc[r] >= cut);
    }
    const out = pick.map((row) => ({ row, score: acc[row] }));
    for (const r of touched) acc[r] = 0;
    out.sort((a, b) => b.score - a.score || a.row - b.row);
    return out.length > limit ? out.slice(0, limit) : out;
  }
}
