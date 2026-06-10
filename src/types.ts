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
  anthropicApiKey: string;
  llmMaxTokens: number;
  citeStyle: CiteStyle; // lightweight fallback formatter (APA / Vancouver / Plain)
  cslStyleId: string; // CSL style id for citeproc bibliographies ("" = use the lightweight formatter)

  // Phase 4 — citation graph
  openalexMailto: string;

  // Phase 5 — writing
  renderCitations: boolean;

  // Ontology
  ontologyEnabled: boolean;
  ontologyPackPath: string;
}

/** Settings fields holding API keys — kept in Obsidian secretStorage (1.11.4+) when available,
 *  and blanked in data.json so secrets never persist in plaintext. */
export const SECRET_FIELDS = ["pubmedApiKey", "openaiApiKey", "anthropicApiKey"] as const;
export type SecretField = (typeof SECRET_FIELDS)[number];

export const DEFAULT_SETTINGS: ScholarRagSettings = {
  referencesFolder: "References",
  citekeyStyle: "authoryeartitle",
  pubmedApiKey: "",

  embeddingProvider: "ollama",
  embeddingModel: "nomic-embed-text",
  ollamaUrl: "http://localhost:11434",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiApiKey: "",
  chunkChars: 1200,
  topK: 8,

  llmProvider: "anthropic",
  llmModel: "claude-haiku-4-5-20251001",
  anthropicApiKey: "",
  llmMaxTokens: 1024,
  citeStyle: "apa",
  cslStyleId: "spine",

  openalexMailto: "",

  renderCitations: true,

  ontologyEnabled: false,
  ontologyPackPath: "",
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
