import { ItemView, WorkspaceLeaf, debounce, normalizePath } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { RefEntry } from "../data/library";
import { filterAndSort, QuickFilters, SortKey, SORT_OPTIONS } from "./libraryFilter";
import { AddReferenceModal } from "./AddReferenceModal";
import { VIEW_TYPE_SEARCH } from "./SearchView";
import { VIEW_TYPE_CHAT } from "./ChatView";
import { VIEW_TYPE_RELATED } from "./RelatedView";
import { ImportPdfModal } from "./ImportPdfModal";

export const VIEW_TYPE_LIBRARY = "rag-obsidian-library";

const PAGE_SIZE = 200;

const CHIP_DEFS: { key: keyof QuickFilters; label: string }[] = [
  { key: "hasPdf", label: "Has PDF" },
  { key: "noPdf", label: "No PDF" },
  { key: "unread", label: "Unread" },
  { key: "retracted", label: "Retracted" },
];

export class LibraryView extends ItemView {
  private plugin: ScholarRagPlugin;
  private filter = "";
  private sort: SortKey = "year-desc";
  private chips: QuickFilters = {};
  private visibleCount = PAGE_SIZE;
  private listEl!: HTMLElement;
  // renderList, not render: rebuilding the header would drop focus from the filter input
  // while a batch keeps writing frontmatter.
  private refresh = debounce(() => this.renderList(), 300, true);

  constructor(leaf: WorkspaceLeaf, plugin: ScholarRagPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_LIBRARY;
  }
  getDisplayText(): string {
    return "Library";
  }
  getIcon(): string {
    return "book-open";
  }

  async onOpen(): Promise<void> {
    this.render();
    this.registerEvent(this.app.metadataCache.on("changed", (f) => this.onFileEvent(f.path)));
    this.registerEvent(this.app.vault.on("delete", (f) => this.onFileEvent(f.path)));
    this.registerEvent(this.app.vault.on("rename", (f, oldPath) => this.onFileEvent(f.path, oldPath)));
  }

  /** Re-render (debounced) only for files under the references folder. */
  private onFileEvent(path: string, oldPath?: string): void {
    const prefix = normalizePath(this.plugin.settings.referencesFolder) + "/";
    if (path.startsWith(prefix) || oldPath?.startsWith(prefix)) this.refresh();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private render(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass("rag-obsidian-library");

    const header = c.createDiv({ cls: "srag-header" });
    const addBtn = header.createEl("button", { text: "+ add" });
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
    const onInput = debounce(
      () => {
        this.filter = search.value.toLowerCase();
        this.visibleCount = PAGE_SIZE;
        this.renderList();
      },
      150,
      true
    );
    search.oninput = onInput;

    const sortSel = header.createEl("select", { cls: "srag-sort" });
    for (const opt of SORT_OPTIONS) sortSel.createEl("option", { value: opt.key, text: opt.label });
    sortSel.value = this.sort;
    sortSel.onchange = () => {
      this.sort = sortSel.value as SortKey;
      this.visibleCount = PAGE_SIZE;
      this.renderList();
    };

    const chipsRow = c.createDiv({ cls: "srag-quick-chips" });
    for (const def of CHIP_DEFS) {
      const btn = chipsRow.createEl("button", { cls: "srag-quick-chip", text: def.label });
      btn.toggleClass("is-active", !!this.chips[def.key]);
      btn.onclick = () => {
        this.chips[def.key] = !this.chips[def.key];
        if (def.key === "hasPdf" && this.chips.hasPdf) this.chips.noPdf = false;
        if (def.key === "noPdf" && this.chips.noPdf) this.chips.hasPdf = false;
        this.visibleCount = PAGE_SIZE;
        this.render();
      };
    }

    this.listEl = c.createDiv({ cls: "srag-list" });
    this.renderList();
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();
    const all = this.plugin.library.list();
    const matched = filterAndSort(all, { text: this.filter, sort: this.sort, chips: this.chips });
    const shown = Math.min(this.visibleCount, matched.length);

    this.listEl.createDiv({
      cls: "srag-count",
      text: `${shown} shown · ${matched.length} matched · ${all.length} total`,
    });

    for (const e of matched.slice(0, shown)) {
      const row = this.listEl.createDiv({ cls: "srag-row" });
      row.createDiv({ cls: "srag-title", text: e.title });
      row.createDiv({
        cls: "srag-meta",
        text: [e.authors, e.year, e.journal].filter(Boolean).join(" · "),
      });
      this.renderBadges(row, e);
      row.onclick = () => void this.app.workspace.getLeaf(false).openFile(e.file);
    }

    if (matched.length > shown) {
      const more = this.listEl.createEl("button", {
        cls: "srag-show-more",
        text: `Show ${PAGE_SIZE} more (${matched.length - shown} left)`,
      });
      more.onclick = () => {
        this.visibleCount += PAGE_SIZE;
        this.renderList();
      };
    }
  }

  private renderBadges(row: HTMLElement, e: RefEntry): void {
    const badges = row.createDiv({ cls: "srag-badges" });
    if (e.hasPdf) badges.createSpan({ cls: "srag-badge", text: "📄" });
    if (e.retracted) badges.createSpan({ cls: "srag-badge srag-badge-error", text: "⚠ Retracted" });
    if (e.status) badges.createSpan({ cls: "srag-badge", text: e.status });
    if (e.citedBy) badges.createSpan({ cls: "srag-badge", text: `cited ${e.citedBy}` });
  }
}
