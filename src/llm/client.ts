import { requestUrl } from "obsidian";

/** Providers answer 429 when too many requests land at once — and the batch paths deliberately
 *  run 15 papers in parallel. Retry those (and transient 5xx) with exponential backoff, honouring
 *  Retry-After when the provider sends one, so a burst degrades into a wait instead of a row of
 *  "summary failed" notices. */
const RETRY_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

async function requestWithRetry(
  opts: Parameters<typeof requestUrl>[0]
): Promise<Awaited<ReturnType<typeof requestUrl>>> {
  let wait = 1000;
  for (let attempt = 1; ; attempt++) {
    const res = await requestUrl(opts);
    if (!RETRY_STATUS.has(res.status) || attempt >= MAX_ATTEMPTS) return res;
    const header = Number(res.headers?.["retry-after"] ?? res.headers?.["Retry-After"]);
    const delay = Number.isFinite(header) && header > 0 ? header * 1000 : wait;
    await new Promise((r) => setTimeout(r, Math.min(delay, 30000)));
    wait *= 2;
  }
}
import { ScholarRagSettings } from "../types";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatOpts {
  /** OpenAI-style reasoning effort; on Gemini 3.x this maps to the thinking level. */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  /** Output cap for this call (Anthropic only — the OpenAI-compatible and Ollama bodies send
   *  no cap and take the endpoint default); defaults to `settings.llmMaxTokens`. */
  maxTokens?: number;
}

/** Provider-agnostic chat completion via requestUrl (CORS-safe, desktop + mobile). */
export class LLMClient {
  constructor(private settings: ScholarRagSettings) {}

  async chat(messages: ChatMessage[], system: string, opts: ChatOpts = {}): Promise<string> {
    switch (this.settings.llmProvider) {
      case "openai":
        return this.openai(messages, system, opts);
      case "ollama":
        return this.ollama(messages, system);
      case "anthropic":
      default:
        return this.anthropic(messages, system, opts);
    }
  }

  private async anthropic(messages: ChatMessage[], system: string, opts: ChatOpts = {}): Promise<string> {
    const key = this.settings.anthropicApiKey;
    if (!key) throw new Error("Anthropic API key not set (Settings → RAG Obsidian)");
    const res = await requestWithRetry({
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.settings.llmModel,
        max_tokens: opts.maxTokens ?? this.settings.llmMaxTokens,
        system,
        messages,
      }),
      throw: false,
    });
    if (res.status >= 400) throw new Error(`Anthropic ${res.status}: ${res.text?.slice(0, 200)}`);
    const blocks = res.json?.content;
    return Array.isArray(blocks)
      ? blocks.filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("")
      : "";
  }

  private async openai(messages: ChatMessage[], system: string, opts: ChatOpts = {}): Promise<string> {
    const key = this.settings.openaiApiKey;
    if (!key) throw new Error("API key not set — Settings → Academic Paper Citation Manager → OpenAI API key");
    const body: Record<string, unknown> = {
      model: this.settings.llmModel,
      messages: [{ role: "system", content: system }, ...messages],
    };
    // Only reasoning models accept it — gpt-4o-class models answer 400 "Unsupported parameter".
    // Ids may carry a router prefix (OpenRouter: `openai/gpt-5.1`), so match after any "/".
    if (opts.reasoningEffort && /(^|\/)(o\d|gpt-5)/i.test(this.settings.llmModel)) {
      body.reasoning_effort = opts.reasoningEffort;
    }
    const res = await requestWithRetry({
      url: `${this.settings.openaiBaseUrl.replace(/\/+$/, "")}/chat/completions`,
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      throw: false,
    });
    if (res.status >= 400) throw new Error(`OpenAI ${res.status}: ${res.text?.slice(0, 200)}`);
    return res.json?.choices?.[0]?.message?.content ?? "";
  }

  private async ollama(messages: ChatMessage[], system: string): Promise<string> {
    const res = await requestWithRetry({
      url: `${this.settings.ollamaUrl.replace(/\/+$/, "")}/api/chat`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.settings.llmModel,
        stream: false,
        messages: [{ role: "system", content: system }, ...messages],
      }),
      throw: false,
    });
    if (res.status >= 400) throw new Error(`Ollama ${res.status}: ${res.text?.slice(0, 200)}`);
    return res.json?.message?.content ?? "";
  }
}
