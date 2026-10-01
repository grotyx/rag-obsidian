/** MeSH entry-term cache for query expansion. Every E-utilities request waits in `ncbiGate`.
 *  Resumable: only uncached headings are asked for, a failure leaves the heading uncached
 *  (retry later), and a clean "not a heading" caches `[]`. */
import { requestUrl } from "obsidian";
import { ncbiGate } from "../ingest/ncbi";
import { arr, rec, str } from "../util/json";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const BATCH = 200;

export interface MeshAddOptions {
  apiKey?: string;
  email?: string;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export class MeshThesaurus {
  private headings: Record<string, string[]> = {};

  load(json: unknown): void {
    this.headings = {};
    for (const [h, v] of Object.entries(rec(rec(json).headings))) this.headings[h] = arr(v).map(str).filter(Boolean);
  }

  toJSON(): { version: 1; headings: Record<string, string[]> } {
    return { version: 1, headings: this.headings };
  }

  /** heading -> entry terms, for `buildExpander`. */
  entries(): Record<string, string[]> {
    return this.headings;
  }

  has(heading: string): boolean {
    return heading in this.headings;
  }

  async addHeadings(headings: string[], opts: MeshAddOptions = {}): Promise<{ added: number; failed: number }> {
    const todo = [...new Set(headings.map((h) => h.trim()).filter((h) => h && !this.has(h)))];
    const hasKey = !!opts.apiKey;
    const a =
      (opts.apiKey ? `&api_key=${encodeURIComponent(opts.apiKey)}` : "") +
      (opts.email ? `&email=${encodeURIComponent(opts.email)}&tool=rag-obsidian` : "");
    const get = async (url: string): Promise<unknown> => {
      await ncbiGate(hasKey);
      const r = await requestUrl({ url });
      if (r.status >= 400) throw new Error(`MeSH request failed (HTTP ${r.status})`);
      const j: unknown = r.json;
      return j;
    };
    let added = 0;
    let failed = 0;
    let done = 0;
    let pending: { uids: string[]; heading: string }[] = [];
    const flush = async (): Promise<void> => {
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      try {
        const ids = [...new Set(batch.flatMap((b) => b.uids))];
        const res = rec(rec(await get(`${EUTILS}/esummary.fcgi?db=mesh&retmode=json&id=${ids.join(",")}${a}`)).result);
        for (const { uids, heading } of batch) {
          // [MeSH Terms] also matches related descriptors in no useful order: keep the one whose
          // own term list names this heading, or nothing (wrong synonyms are worse than none).
          const hl = heading.toLowerCase();
          const terms = uids
            .map((u) => arr(rec(res[u]).ds_meshterms).map(str).filter(Boolean))
            .find((t) => t.some((x) => x.toLowerCase() === hl)) ?? [];
          this.headings[heading] = [...new Set(terms)].filter((t) => t.toLowerCase() !== hl);
          added++;
        }
      } catch {
        failed += batch.length;
      }
      done += batch.length;
      opts.onProgress?.(done, todo.length);
    };
    for (const heading of todo) {
      if (opts.signal?.aborted) break;
      try {
        const sr = rec(rec(await get(`${EUTILS}/esearch.fcgi?db=mesh&retmode=json&term=${encodeURIComponent(`"${heading}"[MeSH Terms]`)}${a}`)).esearchresult);
        const uids = arr(sr.idlist).map(str).filter(Boolean).slice(0, 5);
        if (uids.length) pending.push({ uids, heading });
        else {
          this.headings[heading] = [];
          added++;
          opts.onProgress?.(++done, todo.length);
        }
      } catch {
        failed++;
        opts.onProgress?.(++done, todo.length);
      }
      if (pending.length * 5 >= BATCH) await flush();
    }
    await flush(); // an abort still flushes what was already resolved
    return { added, failed };
  }
}
