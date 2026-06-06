import { requestUrl } from "obsidian";
import { ScholarRagSettings } from "../../types";
import { EmbeddingProvider } from "../embedding";

/** Embeddings via OpenAI or any OpenAI-compatible endpoint (set base URL + key).
 *  e.g. model `text-embedding-3-small` (1536-d) or `text-embedding-3-large` (3072-d). */
export class OpenAIProvider implements EmbeddingProvider {
  readonly id: string;
  private base: string;
  private model: string;
  private key: string;

  constructor(settings: ScholarRagSettings) {
    this.model = settings.embeddingModel || "text-embedding-3-small";
    this.base = (settings.openaiBaseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    this.key = settings.openaiApiKey;
    this.id = `openai:${this.model}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.key) throw new Error("OpenAI API key not set (Settings → RAG Obsidian)");
    const res = await requestUrl({
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
    const data = res.json?.data;
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new Error("OpenAI returned unexpected embedding payload");
    }
    // Sort by `index` to be safe — but Gemini's OpenAI-compat endpoint OMITS index
    // for the first item (index 0), so fall back to array position when it's missing
    // (responses come back in input order). A NaN comparator would corrupt the order.
    return data
      .map((d: { index?: number; embedding: number[] }, i: number) => ({
        i: typeof d.index === "number" ? d.index : i,
        embedding: d.embedding,
      }))
      .sort((a, b) => a.i - b.i)
      .map((d) => d.embedding);
  }
}
