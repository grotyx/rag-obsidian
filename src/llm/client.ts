import { requestUrl } from "obsidian";
import { ScholarRagSettings } from "../types";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatOpts {
  /** OpenAI-style reasoning effort; on Gemini 3.x this maps to the thinking level. */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  /** Output cap for this call (Anthropic); defaults to `settings.llmMaxTokens`. */
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
    const res = await requestUrl({
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
    if (!key) throw new Error("OpenAI API key not set (Settings → RAG Obsidian)");
    const body: Record<string, unknown> = {
      model: this.settings.llmModel,
      messages: [{ role: "system", content: system }, ...messages],
    };
    // Only reasoning models accept it — gpt-4o-class models answer 400 "Unsupported parameter".
    // Ids may carry a router prefix (OpenRouter: `openai/gpt-5.1`), so match after any "/".
    if (opts.reasoningEffort && /(^|\/)(o\d|gpt-5)/i.test(this.settings.llmModel)) {
      body.reasoning_effort = opts.reasoningEffort;
    }
    const res = await requestUrl({
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
    const res = await requestUrl({
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
