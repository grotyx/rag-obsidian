import { ScholarRagSettings } from "../../types";
import { EmbeddingProvider } from "../embedding";
import { wrapCdnImportError } from "../../util/cdn";

/**
 * EXPERIMENTAL: in-app local embeddings via Transformers.js, loaded from a CDN at
 * runtime (no bundling, no setup). True zero-dependency local option, but WASM
 * inference is slow on CPU and unverified across platforms — prefer Ollama until
 * validated in a real vault. Default model: a small multilingual sentence model.
 */
export class TransformersProvider implements EmbeddingProvider {
  readonly id: string;
  private model: string;
  private pipe: any = null;

  constructor(settings: ScholarRagSettings) {
    this.model = settings.embeddingModel || "Xenova/multilingual-e5-small";
    this.id = `transformers:${this.model}`;
  }

  private async getPipe(): Promise<(text: string, opts: object) => Promise<{ data: Float32Array }>> {
    if (this.pipe) return this.pipe;
    type DynamicImport = (u: string) => Promise<{
      pipeline: (task: string, model: string) => Promise<unknown>;
      env: { allowLocalModels: boolean };
    }>;
    let mod: Awaited<ReturnType<DynamicImport>>;
    try {
      // Hide the URL from esbuild so it stays a runtime dynamic import.
      const dynamicImport = new Function("u", "return import(u)") as DynamicImport;
      mod = await dynamicImport("https://esm.sh/@huggingface/transformers@3.0.2");
    } catch (e) {
      // Same CDN-blocked failure mode as pdfjs (src/ingest/pdf.ts) — give the caller a clear
      // reason instead of a raw module-loader error.
      throw wrapCdnImportError("Transformers.js embeddings", e);
    }
    mod.env.allowLocalModels = false;
    this.pipe = await mod.pipeline("feature-extraction", this.model);
    return this.pipe;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const pipe = await this.getPipe();
    const out: number[][] = [];
    for (const t of texts) {
      const r = await pipe(t, { pooling: "mean", normalize: true });
      out.push(Array.from(r.data));
    }
    return out;
  }
}
