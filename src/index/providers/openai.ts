import { requestWithRetry } from "../../util/retry";
import { ScholarRagSettings, effective } from "../../types";
import { EmbeddingProvider } from "../embedding";
import { rec, arr, num, isNumberArray } from "../../util/json";

/** Embeddings via OpenAI or any OpenAI-compatible endpoint (set base URL + key).
 *  e.g. model `text-embedding-3-small` (1536-d) or `text-embedding-3-large` (3072-d). */
export class OpenAIProvider implements EmbeddingProvider {
  readonly id: string;
  private base: string;
  private model: string;
  private key: string;

  constructor(settings: ScholarRagSettings) {
    this.model = settings.embeddingModel || "text-embedding-3-small";
    this.base = effective(settings, "openaiBaseUrl").replace(/\/+$/, "");
    this.key = settings.openaiApiKey;
    this.id = `openai:${this.model}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.key) throw new Error("API key not set — Settings → Refwright → API key (OpenRouter or OpenAI)");
    // A 2xx whose payload is short or malformed is usually a transient upstream hiccup: ask again.
    let vectors: { i: number; embedding: number[] }[] | null = null;
    for (let attempt = 1; !vectors; attempt++) {
      const res = await requestWithRetry({
        url: `${this.base}/embeddings`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.key}`,
        },
        body: JSON.stringify({ model: this.model, input: texts }),
        throw: false,
      });
      if (res.status >= 400) {
        throw new Error(`OpenAI error ${res.status}: ${res.text?.slice(0, 200)}`);
      }
      const data = arr(rec(res.json as unknown).data);
      // Gemini's OpenAI-compat endpoint OMITS `index` for the first item (index 0), so fall back
      // to array position when it's missing (responses come back in input order).
      const parsed = data.map((d, i) => {
        const o = rec(d);
        return { i: num(o.index) ?? i, embedding: o.embedding };
      });
      // A base64 `encoding_format` string or a missing field must not become an empty vector.
      if (data.length === texts.length && parsed.every((p) => isNumberArray(p.embedding))) {
        vectors = parsed as { i: number; embedding: number[] }[];
      } else if (attempt >= 3) {
        throw new Error(
          data.length !== texts.length
            ? "OpenAI returned unexpected embedding payload"
            : "unexpected embedding payload (no numeric `embedding` array)"
        );
      } else {
        await new Promise<void>((r) => window.setTimeout(r, attempt * 1000));
      }
    }
    // Sort by `index`; a NaN comparator would corrupt the order.
    return vectors.sort((a, b) => a.i - b.i).map((d) => d.embedding);
  }
}
