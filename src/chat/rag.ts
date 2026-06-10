import { IndexManager } from "../index/manager";
import { Library } from "../data/library";
import { LLMClient, ChatMessage } from "../llm/client";
import { formatCitation } from "../cite/format";
import { ScholarRagSettings, CiteStyle } from "../types";

export interface AnswerSource {
  n: number;
  citekey: string;
  title: string;
  formatted: string;
}

export interface RagAnswer {
  text: string;
  sources: AnswerSource[];
}

/** Retrieval-augmented chat with passage-level citation grounding:
 *  retrieve → number sources → answer with [n] anchors → resolve to formatted citations. */
export class RagChat {
  constructor(
    private index: IndexManager,
    private library: Library,
    private settings: ScholarRagSettings
  ) {}

  async answer(query: string, history: ChatMessage[] = []): Promise<RagAnswer> {
    if (!this.index.ready) {
      throw new Error("Search index not built — open the search pane and click “Rebuild index”.");
    }

    const hits = await this.index.search(query);
    if (hits.length === 0) {
      return { text: "No relevant passages found in your library for that question.", sources: [] };
    }

    // Number sources by first appearance (one number per cited reference).
    const order: string[] = [];
    for (const h of hits) if (!order.includes(h.citekey)) order.push(h.citekey);
    const numOf = (ck: string) => order.indexOf(ck) + 1;

    const context = hits
      .map((h) => `[${numOf(h.citekey)}] (${h.title}, ${h.year || "n.d."}) ${h.text}`)
      .join("\n\n");

    const system = [
      "You are a research assistant answering questions strictly from the user's reference library.",
      "Use ONLY the information in the provided sources. If the sources do not contain the answer, say so plainly.",
      "Cite every claim with bracketed source numbers like [1] or [2][3]. Never invent citations or facts.",
      "Be concise and precise; surface specific findings, numbers, effect sizes, and methods when present.",
      "Cite ONLY from the current source list below; earlier turns in the conversation refer to different source numberings.",
    ].join(" ");

    // Prior assistant answers carry [n] anchors numbered against THEIR turn's sources;
    // strip them so they can't collide with the current numbering.
    const cleanHistory: ChatMessage[] = history.map((m) =>
      m.role === "assistant" ? { ...m, content: m.content.replace(/\[\d+\]/g, "") } : m
    );

    const user = `Question: ${query}\n\nSources:\n${context}`;
    const llm = new LLMClient(this.settings);
    const raw = await llm.chat([...cleanHistory, { role: "user", content: user }], system);

    // Drop dangling anchors (n outside 1..sources) so the UI never maps them.
    const text = raw.replace(/\[(\d+)\]/g, (m, d) => {
      const n = parseInt(d, 10);
      return n >= 1 && n <= order.length ? m : "";
    });

    const style = this.settings.citeStyle as CiteStyle;
    const sources: AnswerSource[] = order.map((ck, i) => {
      const item = this.library.getItem(ck);
      return {
        n: i + 1,
        citekey: ck,
        title: item?.title ? String(item.title) : ck,
        formatted: item ? formatCitation(item, style) : ck,
      };
    });

    return { text, sources };
  }
}
