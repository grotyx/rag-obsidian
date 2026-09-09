// Plugin settings
export type EmbeddingProviderId = "ollama" | "openai" | "transformers";
export type LLMProviderId = "anthropic" | "openai" | "ollama";
export type CiteStyle = "apa" | "vancouver" | "plain";

export interface ScholarRagSettings {
  referencesFolder: string;
  citekeyStyle: "authoryeartitle" | "authoryear";
  pubmedApiKey: string;

  // Phase 1 — retrieval
  embeddingProvider: EmbeddingProviderId;
  embeddingModel: string;
  ollamaUrl: string;
  openaiBaseUrl: string;
  openaiApiKey: string;
  chunkChars: number;
  topK: number;

  // Phase 2 — chat
  llmProvider: LLMProviderId;
  llmModel: string;
  /** Model for "Chat with library" only; "" = use `llmModel`. Answering over retrieved
   *  passages rewards a stronger model than the summarize / metadata-extract calls. */
  chatModel: string;
  anthropicApiKey: string;
  llmMaxTokens: number;
  citeStyle: CiteStyle; // lightweight fallback formatter (APA / Vancouver / Plain)
  cslStyleId: string; // CSL style id for citeproc bibliographies ("" = use the lightweight formatter)
  /** Language for AI-generated paper summaries: "en", "ko", "en+ko" (both, legacy default),
   *  or any free-text language name (e.g. "German"). */
  summaryLanguage: string;

  // Phase 4 — citation graph
  openalexMailto: string;

  // Phase 5 — writing
  renderCitations: boolean;
}

/** Settings fields holding API keys — kept in Obsidian secretStorage (1.11.4+) when available,
 *  and blanked in data.json so secrets never persist in plaintext. */
export const SECRET_FIELDS = ["pubmedApiKey", "openaiApiKey", "anthropicApiKey"] as const;
export type SecretField = (typeof SECRET_FIELDS)[number];

export const DEFAULT_SETTINGS: ScholarRagSettings = {
  referencesFolder: "References",
  citekeyStyle: "authoryeartitle",
  pubmedApiKey: "",

  // Defaults point at OpenRouter through the OpenAI-compatible provider: one key covers chat,
  // paper summaries and embeddings, and nothing has to be installed locally. Swap the base URL
  // for api.openai.com (and drop the `openai/` model prefix) to talk to OpenAI directly.
  embeddingProvider: "openai",
  embeddingModel: "openai/text-embedding-3-small",
  ollamaUrl: "http://localhost:11434",
  openaiBaseUrl: "https://openrouter.ai/api/v1",
  openaiApiKey: "",
  chunkChars: 1200,
  topK: 20,

  llmProvider: "openai",
  llmModel: "deepseek/deepseek-v4-flash-0731",
  chatModel: "deepseek/deepseek-v4-pro-0813",
  anthropicApiKey: "",
  llmMaxTokens: 8192,
  citeStyle: "apa",
  cslStyleId: "spine",
  summaryLanguage: "en+ko",

  openalexMailto: "",

  renderCitations: true,
};

/** Section-wise summary produced by the LLM (see ingest/summarize.ts). */
export interface SummarySections {
  background?: string;
  methods?: string;
  results?: string;
  conclusions?: string;
  kr?: string;
  mesh?: string; // comma/line-separated MeSH-style terms (LLM fallback when PubMed has none)
}

// Minimal CSL-JSON item (https://citationstyles.org/) — field names verbatim
// so frontmatter feeds citeproc-js directly with zero mapping in later phases.
export interface CSLName {
  family?: string;
  given?: string;
  literal?: string;
}

export interface CSLDate {
  "date-parts"?: number[][];
  raw?: string;
}

export interface CSLItem {
  type: string;
  title?: string;
  author?: CSLName[];
  issued?: CSLDate;
  "container-title"?: string;
  "container-title-short"?: string;
  volume?: string;
  issue?: string;
  page?: string;
  DOI?: string;
  PMID?: string;
  URL?: string;
  abstract?: string;
  keyword?: string[];
  publisher?: string;
  number?: string;
  [key: string]: unknown;
}
