import { ItemView, WorkspaceLeaf, Notice, MarkdownRenderer, normalizePath } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { RagChat, RagAnswer, AnswerSource, ChatTurn } from "../chat/rag";
import { anchorsToCitekeys } from "../cite/bibliography";
import { formatCitation } from "../cite/format";

export const VIEW_TYPE_CHAT = "rag-obsidian-chat";

const MAX_TURNS = 50; // messages kept on disk
const CONTEXT_TURNS = 8; // messages replayed to the model (unchanged prompt budget)

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
    return "Chat";
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
    const clear = composer.createEl("button", { text: "Clear", attr: { "aria-label": "Clear chat" } });
    clear.onclick = () => void this.clear();
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.send();
      }
    });

    await this.loadHistory();
    if (!this.plugin.indexManager.ready) {
      this.bubble("system", "Index not built yet. Open the search pane and click “Rebuild index”, then come back.");
    } else if (!this.history.length) {
      this.bubble("system", "Ask a question — answers are grounded in your reference notes with [n] citations.");
    }
    await this.replay();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  // ---- persistence (plugin dir, next to the index — never in data.json settings) ----

  private historyPath(): string {
    const dir = this.plugin.manifest.dir ?? `.obsidian/plugins/${this.plugin.manifest.id}`;
    return normalizePath(`${dir}/chat.json`);
  }

  private async loadHistory(): Promise<void> {
    try {
      const adapter = this.app.vault.adapter;
      const path = this.historyPath();
      if (!(await adapter.exists(path))) return;
      const raw: unknown = JSON.parse(await adapter.read(path));
      if (!Array.isArray(raw)) return;
      this.history = raw
        .filter(
          (t): t is ChatTurn =>
            !!t &&
            typeof t.content === "string" &&
            (t.role === "user" || t.role === "assistant") &&
            (t.sources === undefined || Array.isArray(t.sources))
        )
        .slice(-MAX_TURNS);
    } catch {
      this.history = []; // a truncated/corrupt log just starts the conversation over
    }
  }

  private async saveHistory(): Promise<void> {
    try {
      await this.app.vault.adapter.write(this.historyPath(), JSON.stringify(this.history));
    } catch (e) {
      new Notice(`Could not save chat history: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async replay(): Promise<void> {
    for (let i = 0; i < this.history.length; i++) {
      const turn = this.history[i];
      if (turn.role === "user") {
        this.bubble("user", turn.content);
        continue;
      }
      const sources = this.sourcesFor(turn.sources ?? []);
      await this.renderAnswer({ text: turn.content, sources }, this.questionBefore(i));
    }
  }

  private async clear(): Promise<void> {
    this.history = [];
    this.logEl.empty();
    const adapter = this.app.vault.adapter;
    const path = this.historyPath();
    if (await adapter.exists(path)) await adapter.remove(path);
    this.bubble("system", "Chat cleared.");
  }

  /** The user question a stored assistant turn answered ("" if the log starts mid-conversation). */
  private questionBefore(i: number): string {
    const prev = this.history[i - 1];
    return prev && prev.role === "user" ? prev.content : "";
  }

  /** Rebuild the numbered source list of a stored answer from its citekeys. */
  private sourcesFor(citekeys: string[]): AnswerSource[] {
    const style = this.plugin.settings.citeStyle;
    return citekeys.map((ck, i) => {
      const item = this.plugin.library.getItem(ck);
      return {
        n: i + 1,
        citekey: ck,
        title: item?.title ? String(item.title) : ck,
        formatted: item ? formatCitation(item, style) : ck,
      };
    });
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
      const ans = await this.rag.answer(query, this.history.slice(-CONTEXT_TURNS));
      thinking.remove();
      await this.renderAnswer(ans, query);
      this.history.push({ role: "user", content: query });
      // Keep this turn's source order so follow-up turns can resolve its [n] anchors.
      this.history.push({ role: "assistant", content: ans.text, sources: ans.sources.map((s) => s.citekey) });
      if (this.history.length > MAX_TURNS) this.history = this.history.slice(-MAX_TURNS);
      await this.saveHistory();
    } catch (e) {
      thinking.remove();
      const msg = e instanceof Error ? e.message : String(e);
      this.bubble("system", `⚠ ${msg}`);
    }
  }

  private async renderAnswer(ans: RagAnswer, question: string): Promise<void> {
    const wrap = this.logEl.createDiv({ cls: "srag-bubble srag-assistant" });
    const body = wrap.createDiv({ cls: "srag-answer" });
    // Neutralize embeds/images before rendering (`![[…]]` → `[[…]]`, `![…](…)` → `[…](…)`):
    // model output steered by a malicious note could otherwise auto-load an external image
    // (exfil beacon) or transclude a private note. Render-time only — history keeps ans.text.
    const safeText = ans.text.replace(/!\[/g, "[");
    await MarkdownRenderer.render(this.app, safeText, body, "", this);

    if (ans.sources.length) {
      const src = wrap.createDiv({ cls: "srag-sources" });
      src.createDiv({ cls: "srag-sources-head", text: "Sources" });
      for (const s of ans.sources) {
        const row = src.createDiv({ cls: "srag-source" });
        row.createSpan({ cls: "srag-source-n", text: `[${s.n}]` });
        row.createSpan({ cls: "srag-source-text", text: ` ${s.formatted}` });
        row.onclick = () => void this.openCitekey(s.citekey);
      }
    }
    const save = wrap.createEl("button", { cls: "srag-save-answer", text: "Save as note" });
    save.onclick = () =>
      void this.saveAnswer(question, ans.text, ans.sources.map((s) => s.citekey));
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  /** Write one answer to `Chat/<date> <question>.md` with its `[n]` anchors rewritten to
   *  `[@citekey]`, so "Update bibliography" can finish the draft. */
  private async saveAnswer(question: string, text: string, citekeys: string[]): Promise<void> {
    const folder = "Chat";
    if (!this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => {});
    }
    const date = new Date().toISOString().slice(0, 10);
    const stem = question.replace(/\s+/g, " ").trim().slice(0, 40).trim() || "answer";
    const out = `## Question\n\n${question}\n\n## Answer\n\n${anchorsToCitekeys(text, citekeys)}\n`;
    await this.plugin.writeAndOpen(`${folder}/${date} ${stem}.md`, out);
  }

  /** Command entry point: save the most recent answer in this pane. */
  async saveLastAnswer(): Promise<void> {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const turn = this.history[i];
      if (turn.role !== "assistant") continue;
      await this.saveAnswer(this.questionBefore(i), turn.content, turn.sources ?? []);
      return;
    }
    new Notice("No answer to save yet");
  }

  private async openCitekey(citekey: string): Promise<void> {
    const file = this.plugin.library.getFile(citekey); // note filename ≠ citekey
    if (file) await this.app.workspace.getLeaf(false).openFile(file);
    else new Notice(`Note not found: ${citekey}`);
  }
}
