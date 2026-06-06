import { ItemView, WorkspaceLeaf } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { RefEntry } from "../data/library";
import { AddReferenceModal } from "./AddReferenceModal";
import { VIEW_TYPE_SEARCH } from "./SearchView";
import { VIEW_TYPE_CHAT } from "./ChatView";
import { VIEW_TYPE_RELATED } from "./RelatedView";
import { ImportPdfModal } from "./ImportPdfModal";

export const VIEW_TYPE_LIBRARY = "rag-obsidian-library";

export class LibraryView extends ItemView {
  private plugin: ScholarRagPlugin;
  private filter = "";
  private listEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: ScholarRagPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_LIBRARY;
  }
  getDisplayText(): string {
    return "RAG Obsidian library";
  }
  getIcon(): string {
    return "book-open";
  }

  async onOpen(): Promise<void> {
    this.render();
    this.registerEvent(this.app.metadataCache.on("changed", () => this.renderList()));
    this.registerEvent(this.app.vault.on("delete", () => this.renderList()));
    this.registerEvent(this.app.vault.on("rename", () => this.renderList()));
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private render(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass("rag-obsidian-library");

    const header = c.createDiv({ cls: "srag-header" });
    const addBtn = header.createEl("button", { text: "+ Add" });
    addBtn.onclick = () => new AddReferenceModal(this.app, this.plugin).open();

    const searchBtn = header.createEl("button", { text: "🔍 Search" });
    searchBtn.onclick = () => void this.plugin.activateView(VIEW_TYPE_SEARCH);

    const chatBtn = header.createEl("button", { text: "💬 Chat" });
    chatBtn.onclick = () => void this.plugin.activateView(VIEW_TYPE_CHAT);

    const relBtn = header.createEl("button", { text: "🕸 Related" });
    relBtn.onclick = () => void this.plugin.activateView(VIEW_TYPE_RELATED);

    const pdfBtn = header.createEl("button", { text: "📎 PDF" });
    pdfBtn.onclick = () => new ImportPdfModal(this.app, this.plugin).open();

    const search = header.createEl("input", { type: "text", placeholder: "Filter…" });
    search.value = this.filter;
    search.oninput = () => {
      this.filter = search.value.toLowerCase();
      this.renderList();
    };

    this.listEl = c.createDiv({ cls: "srag-list" });
    this.renderList();
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();
    const entries = this.plugin.library.list().filter((e) => this.match(e));
    this.listEl.createEl("div", {
      cls: "srag-count",
      text: `${entries.length} reference(s)`,
    });
    for (const e of entries) {
      const row = this.listEl.createDiv({ cls: "srag-row" });
      row.createEl("div", { cls: "srag-title", text: e.title });
      row.createEl("div", {
        cls: "srag-meta",
        text: [e.authors, e.year].filter(Boolean).join(" · "),
      });
      row.onclick = () => void this.app.workspace.getLeaf(false).openFile(e.file);
    }
  }

  private match(e: RefEntry): boolean {
    if (!this.filter) return true;
    return `${e.title} ${e.authors} ${e.year} ${e.citekey}`
      .toLowerCase()
      .includes(this.filter);
  }
}
