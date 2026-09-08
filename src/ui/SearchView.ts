import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { SearchHit } from "../index/store";
import { FilterRow } from "./FilterRow";

export const VIEW_TYPE_SEARCH = "rag-obsidian-search";

export class SearchView extends ItemView {
  private plugin: ScholarRagPlugin;
  private query = "";
  private filterRow!: FilterRow;
  private statusEl!: HTMLElement;
  private resultsEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: ScholarRagPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_SEARCH;
  }
  getDisplayText(): string {
    return "Search";
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

    this.filterRow = new FilterRow(c, this.plugin);

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

  private async doSearch(): Promise<void> {
    if (!this.query) return;
    this.resultsEl.empty();
    const loading = this.resultsEl.createDiv({ cls: "srag-count", text: "Searching…" });
    try {
      const hits = await this.plugin.indexManager.search(this.query, this.filterRow.filters());
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
      const filtered = Object.keys(this.filterRow.filters()).length > 0;
      this.resultsEl.createDiv({
        cls: "srag-count",
        text: filtered ? "No results — try loosening the filters." : "No results.",
      });
      return;
    }
    for (const h of hits) {
      const row = this.resultsEl.createDiv({ cls: "srag-hit" });
      const head = row.createDiv({ cls: "srag-hit-head" });
      head.createSpan({ cls: "srag-title", text: h.title });
      head.createSpan({
        cls: "srag-badge",
        text: `${h.section}${h.year ? " · " + h.year : ""}`,
      });
      row.createDiv({
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
