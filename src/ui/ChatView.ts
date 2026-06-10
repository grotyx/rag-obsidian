import { ItemView, WorkspaceLeaf, Notice, TFile, normalizePath, MarkdownRenderer } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { RagChat, RagAnswer, ChatTurn } from "../chat/rag";

export const VIEW_TYPE_CHAT = "rag-obsidian-chat";

export class ChatView extends ItemView {
  private plugin: ScholarRagPlugin;
  private rag: RagChat;
  private history: ChatTurn[] = [];
  private logEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;

  constructor(leaf: WorkspaceLeaf, plugin: ScholarRagPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.rag = new RagChat(plugin.indexManager, plugin.library, plugin.settings);
  }

  getViewType(): string {
    return VIEW_TYPE_CHAT;
  }
  getDisplayText(): string {
    return "RAG Obsidian chat";
  }
  getIcon(): string {
    return "messages-square";
  }

  async onOpen(): Promise<void> {
    const c = this.contentEl;
    c.empty();
    c.addClass("rag-obsidian-chat");

    this.logEl = c.createDiv({ cls: "srag-chat-log" });

    const composer = c.createDiv({ cls: "srag-chat-composer" });
    this.inputEl = composer.createEl("textarea", {
      cls: "srag-chat-input",
      attr: { rows: "2", placeholder: "Ask your library…  (Enter to send, Shift+Enter for newline)" },
    });
    const send = composer.createEl("button", { text: "Send", cls: "mod-cta" });
    send.onclick = () => void this.send();
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.send();
      }
    });

    if (!this.plugin.indexManager.ready) {
      this.bubble("system", "Index not built yet. Open the search pane and click “Rebuild index”, then come back.");
    } else {
      this.bubble("system", "Ask a question — answers are grounded in your reference notes with [n] citations.");
    }
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private bubble(role: "user" | "assistant" | "system", text: string): HTMLElement {
    const el = this.logEl.createDiv({ cls: `srag-bubble srag-${role}` });
    el.createSpan({ text });
    this.logEl.scrollTop = this.logEl.scrollHeight;
    return el;
  }

  private async send(): Promise<void> {
    const query = this.inputEl.value.trim();
    if (!query) return;
    this.inputEl.value = "";
    this.bubble("user", query);

    const thinking = this.bubble("assistant", "…");
    try {
      const ans = await this.rag.answer(query, this.history);
      thinking.remove();
      await this.renderAnswer(ans);
      this.history.push({ role: "user", content: query });
      // Keep this turn's source order so follow-up turns can resolve its [n] anchors.
      this.history.push({ role: "assistant", content: ans.text, sources: ans.sources.map((s) => s.citekey) });
      // keep history bounded
      if (this.history.length > 8) this.history = this.history.slice(-8);
    } catch (e) {
      thinking.remove();
      const msg = e instanceof Error ? e.message : String(e);
      this.bubble("system", `⚠ ${msg}`);
    }
  }

  private async renderAnswer(ans: RagAnswer): Promise<void> {
    const wrap = this.logEl.createDiv({ cls: "srag-bubble srag-assistant" });
    const body = wrap.createDiv({ cls: "srag-answer" });
    await MarkdownRenderer.render(this.app, ans.text, body, "", this);

    if (ans.sources.length) {
      const src = wrap.createDiv({ cls: "srag-sources" });
      src.createEl("div", { cls: "srag-sources-head", text: "Sources" });
      for (const s of ans.sources) {
        const row = src.createDiv({ cls: "srag-source" });
        row.createSpan({ cls: "srag-source-n", text: `[${s.n}]` });
        row.createSpan({ cls: "srag-source-text", text: ` ${s.formatted}` });
        row.onclick = () => void this.openCitekey(s.citekey);
      }
    }
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  private async openCitekey(citekey: string): Promise<void> {
    const path = normalizePath(`${this.plugin.settings.referencesFolder}/${citekey}.md`);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
    else new Notice(`Note not found: ${citekey}`);
  }
}
