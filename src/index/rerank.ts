import { LLMClient } from "../llm/client";
import { ScholarRagSettings } from "../types";
import { SearchHit } from "./store";

/** Chunks kept per reference, so one long paper (a stashed PDF full text splits into dozens
 *  of chunks) can't take every slot in the answer's context. */
export const MAX_PER_REF = 3;
/** Candidates fetched per kept hit when the LLM reranker is on. */
export const RERANK_POOL = 2;
/** How much of a passage the reranker is shown — enough to judge, short enough to send 40 of. */
const SNIPPET = 400;
/** A reranker is an optimisation; past this it is only a delay, so the answer goes ahead
 *  on retrieval order. Measured: ~8s for 40 passages with thinking off, ~50s with it on. */
const RERANK_TIMEOUT_MS = 30_000;

/**
 * Keep at most `maxPerRef` chunks per reference, then top the list back up to `k` from what was
 * skipped (best score first). Diversity where the library offers it, recall where it doesn't:
 * a question only three papers can answer still gets `k` passages.
 */
export function capPerReference(hits: SearchHit[], k: number, maxPerRef = MAX_PER_REF): SearchHit[] {
  const perRef = new Map<string, number>();
  const kept: SearchHit[] = [];
  const spill: SearchHit[] = [];
  for (const h of hits) {
    const n = perRef.get(h.citekey) ?? 0;
    if (n < maxPerRef) {
      perRef.set(h.citekey, n + 1);
      kept.push(h);
    } else {
      spill.push(h);
    }
  }
  if (kept.length >= k) return kept.slice(0, k);
  return kept.concat(spill.slice(0, k - kept.length));
}

export const RERANK_SYSTEM =
  "You rank retrieved passages by how well they answer a question. " +
  "Reply with ONLY a JSON array of passage numbers, most relevant first, e.g. [3,1,7]. " +
  "Include every number exactly once. No prose, no explanation.";

export function buildRerankUser(query: string, hits: SearchHit[]): string {
  const list = hits
    .map((h, i) => {
      const text = h.text.length > SNIPPET ? h.text.slice(0, SNIPPET) + "…" : h.text;
      return `[${i + 1}] (${h.title}, ${h.year || "n.d."}) ${text.replace(/\s+/g, " ")}`;
    })
    .join("\n\n");
  return `Question: ${query}\n\nPassages:\n${list}\n\nRank all ${hits.length} passages.`;
}

/**
 * Parse the model's ranking into 0-based indices. Tolerant on purpose: a model that answers
 * with prose around the array, repeats a number, or invents one out of range still yields a
 * usable order, and anything it left out keeps its retrieval rank at the back.
 */
export function parseRerankOrder(raw: string, n: number): number[] {
  const bracket = raw.match(/\[[\s\S]*?\]/);
  const source = bracket ? bracket[0] : raw;
  const seen = new Set<number>();
  const out: number[] = [];
  for (const m of source.matchAll(/\d+/g)) {
    const i = parseInt(m[0], 10) - 1;
    if (i >= 0 && i < n && !seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  }
  for (let i = 0; i < n; i++) if (!seen.has(i)) out.push(i);
  return out;
}

/**
 * Reorder `hits` by asking the LLM which passages actually answer the question. One extra
 * request; any failure (offline, unparseable reply) falls back to the retrieval order, so the
 * answer is never blocked on the reranker.
 */
export async function rerankHits(
  query: string,
  hits: SearchHit[],
  settings: ScholarRagSettings
): Promise<SearchHit[]> {
  if (hits.length < 2) return hits;
  try {
    const llm = new LLMClient({ ...settings, llmModel: settings.llmModel });
    const ranked = llm.chat([{ role: "user", content: buildRerankUser(query, hits) }], RERANK_SYSTEM, {
      reasoningEffort: "minimal",
      noReasoning: true, // ranking is mechanical: thinking tokens buy nothing and cost a minute
    });
    const raw = await Promise.race([
      ranked,
      new Promise<null>((r) => setTimeout(() => r(null), RERANK_TIMEOUT_MS)),
    ]);
    if (raw === null) return hits; // too slow — answer on retrieval order
    return parseRerankOrder(raw, hits.length).map((i) => hits[i]);
  } catch {
    return hits;
  }
}
