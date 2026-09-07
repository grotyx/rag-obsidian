import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { SearchHit, SearchFilters } from "../index/store";

export const VIEW_TYPE_SEARCH = "rag-obsidian-search";

export class SearchView extends ItemView {
  private plugin: ScholarRagPlugin;
  private query = "";
  // Filter state lives on the view only — deliberately not persisted to settings.
  private yearFrom = "";
  private yearTo = "";
  private author = "";
  private tags: string[] = [];
  private statusEl!: HTMLElement;
  private resultsEl!: HTMLElement;
  private chipsEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: ScholarRagPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_SEARCH;
  }
  getDisplayText(): string {
    return "RAG Obsidian search";
  }
  getIcon(): string {
    return "search";
  }

  async onOpen(): Promise<void> {
    this.render();
  }
  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private render(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass("rag-obsidian-search");

    const bar = c.createDiv({ cls: "srag-header" });
    const input = bar.createEl("input", { type: "text", placeholder: "Semantic search…" });
    input.value = this.query;
    const go = bar.createEl("button", { text: "Search" });
    const run = () => {
      this.query = input.value.trim();
      void this.doSearch();
    };
    go.onclick = run;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") run();
    });

    this.renderFilters(c);

    const tools = c.createDiv({ cls: "srag-tools" });
    const rebuild = tools.createEl("button", { text: "Rebuild index" });
    rebuild.onclick = () => void this.rebuild();

    this.statusEl = c.createDiv({ cls: "srag-count" });
    this.resultsEl = c.createDiv({ cls: "srag-results" });
    this.updateStatus();
    window.setTimeout(() => input.focus(), 0);
  }

  private updateStatus(): void {
    const m = this.plugin.indexManager;
    this.statusEl.setText(
      m.ready
        ? `${m.count} chunks indexed · ${m.modelId}`
        : "Index not built — click “Rebuild index”."
    );
  }

  private async rebuild(): Promise<void> {
    await this.plugin.rebuildIndex();
    this.updateStatus();
  }

  /** Year range + author + tag chips. Applies to this pane only, not to chat retrieval. */
  private renderFilters(c: HTMLElement): void {
    const row = c.createDiv({ cls: "srag-filters" });
    const num = (ph: string, val: string, set: (v: string) => void) => {
      const el = row.createEl("input", { type: "number", placeholder: ph, cls: "srag-year" });
      el.value = val;
      el.addEventListener("change", () => set(el.value.trim()));
      return el;
    };
    num("From", this.yearFrom, (v) => (this.yearFrom = v));
    num("To", this.yearTo, (v) => (this.yearTo = v));

    const author = row.createEl("input", { type: "text", placeholder: "Author", cls: "srag-author" });
    author.value = this.author;
    author.addEventListener("change", () => (this.author = author.value.trim()));

    const listId = `srag-tags-${Math.random().toString(36).slice(2)}`;
    const tagInput = row.createEl("input", { type: "text", placeholder: "Tag", cls: "srag-tag-input" });
    tagInput.setAttr("list", listId);
    const datalist = row.createEl("datalist");
    datalist.id = listId;
    for (const t of this.libraryTags()) datalist.createEl("option", { value: t });
    tagInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const t = tagInput.value.trim();
      if (t && !this.tags.includes(t)) {
        this.tags.push(t);
        this.renderChips();
      }
      tagInput.value = "";
    });

    this.chipsEl = c.createDiv({ cls: "srag-chips" });
    this.renderChips();
  }

  private renderChips(): void {
    this.chipsEl.empty();
    for (const t of this.tags) {
      const chip = this.chipsEl.createSpan({ cls: "srag-chip", text: t });
      const x = chip.createSpan({ cls: "srag-chip-x", text: "✕" });
      x.onclick = () => {
        this.tags = this.tags.filter((v) => v !== t);
        this.renderChips();
      };
    }
  }

  /** Every tag present on a reference note, for the tag input's autocomplete. */
  private libraryTags(): string[] {
    const seen = new Set<string>();
    for (const e of this.plugin.library.entries()) {
      const tags = e.item.tags;
      if (Array.isArray(tags)) for (const t of tags) seen.add(String(t));
    }
    return [...seen].sort();
  }

  private filters(): SearchFilters {
    const yearFrom = Number(this.yearFrom);
    const yearTo = Number(this.yearTo);
    return {
      ...(yearFrom ? { yearFrom } : {}),
      ...(yearTo ? { yearTo } : {}),
      ...(this.author ? { author: this.author } : {}),
      ...(this.tags.length ? { tags: [...this.tags] } : {}),
    };
  }

  private async doSearch(): Promise<void> {
    if (!this.query) return;
    this.resultsEl.empty();
    const loading = this.resultsEl.createDiv({ cls: "srag-count", text: "Searching…" });
    try {
      const hits = await this.plugin.indexManager.search(this.query, this.filters());
      loading.remove();
      this.renderHits(hits);
    } catch (e) {
      loading.remove();
      new Notice(`Search failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private renderHits(hits: SearchHit[]): void {
    this.resultsEl.empty();
    if (hits.length === 0) {
      const filtered = Object.keys(this.filters()).length > 0;
      this.resultsEl.createDiv({
        cls: "srag-count",
        text: filtered ? "No results — try loosening the filters." : "No results.",
      });
      return;
    }
    for (const h of hits) {
      const row = this.resultsEl.createDiv({ cls: "srag-hit" });
      const head = row.createDiv({ cls: "srag-hit-head" });
      head.createEl("span", { cls: "srag-title", text: h.title });
      head.createEl("span", {
        cls: "srag-badge",
        text: `${h.section}${h.year ? " · " + h.year : ""}`,
      });
      row.createEl("div", {
        cls: "srag-snippet",
        text: h.text.length > 320 ? h.text.slice(0, 320) + "…" : h.text,
      });
      row.onclick = () => void this.openCitekey(h.citekey);
    }
  }

  private async openCitekey(citekey: string): Promise<void> {
    const file = this.plugin.library.getFile(citekey); // note filename ≠ citekey
    if (file) await this.app.workspace.getLeaf(false).openFile(file);
    else new Notice(`Note not found: ${citekey}`);
  }
}
