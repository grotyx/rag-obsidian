import { requestUrl } from "obsidian";
import { ScholarRagSettings } from "../../types";
import { EmbeddingProvider } from "../embedding";

/** Local embeddings via Ollama (https://ollama.com). Recommended local default.
 *  Setup: install Ollama, then `ollama pull nomic-embed-text`. */
export class OllamaProvider implements EmbeddingProvider {
  readonly id: string;
  private url: string;
  private model: string;

  constructor(settings: ScholarRagSettings) {
    this.model = settings.embeddingModel || "nomic-embed-text";
    this.url = (settings.ollamaUrl || "http://localhost:11434").replace(/\/+$/, "");
    this.id = `ollama:${this.model}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await requestUrl({
      url: `${this.url}/api/embed`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts }),
      throw: false,
    });
    if (res.status >= 400) {
      throw new Error(
        `Ollama error ${res.status}: ${res.text?.slice(0, 200) || "is Ollama running?"}`
      );
    }
    const embeddings = res.json?.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      throw new Error("Ollama returned unexpected embedding payload");
    }
    return embeddings;
  }
}
