import { ScholarRagSettings } from "../types";
import { OllamaProvider } from "./providers/ollama";
import { OpenAIProvider } from "./providers/openai";
import { TransformersProvider } from "./providers/transformers";

/**
 * An embedding provider turns text into vectors. All providers expose the same
 * interface so the index pipeline is provider-agnostic. The vector dimension is
 * discovered from the provider's first response (not hardcoded), so any model works.
 */
export interface EmbeddingProvider {
  /** Stable id `provider:model` — when this changes, the index must be rebuilt. */
  readonly id: string;
  /** Embed a batch of texts; returns one vector per input, in order. */
  embed(texts: string[]): Promise<number[][]>;
}

export function createProvider(settings: ScholarRagSettings): EmbeddingProvider {
  switch (settings.embeddingProvider) {
    case "openai":
      return new OpenAIProvider(settings);
    case "transformers":
      return new TransformersProvider(settings);
    case "ollama":
    default:
      return new OllamaProvider(settings);
  }
}
