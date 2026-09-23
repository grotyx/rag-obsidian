import { ItemView, WorkspaceLeaf, Notice, TFile } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { BackfillScope, inScope } from "../data/library";
import {
  applyScreening,
  DESIGNS,
  EXCLUDE_REASONS,
  excludeNeedsReason,
  IncludeValue,
  KQ_IDS,
  Level,
  LEVELS,
  ScreeningFields,
} from "../data/screening";
import { extractSummaryBlock } from "../cite/bibliography";

export const VIEW_TYPE_SCREENING = "rag-obsidian-screening";

type StatusFilter = "unscreened" | "pending" | "included" | "excluded" | "all";
type Entry = ReturnType<ScholarRagPlugin["library"]["entries"]>[number];
type QueueItem = { citekey: string; file: TFile };

function matchesStatus(e: Entry, status: StatusFilter): boolean {
  switch (status) {
    case "all":
      return true;
    case "unscreened":
      return !e.item.include;
    case "pending":
      return e.item.include === "pending";
    case "included":
      return e.item.include === "include";
    case "excluded":
      return e.item.include === "exclude";
  }
}

/** One-record-at-a-time abstract screening: decide include/exclude/pending, tag key questions,
 *  evidence level and study design, and write it through the same `applyScreening` the MCP
 *  `set_reference_fields` tool uses, so a human and an external AI screener can never disagree
 *  about what tags a decision produces. */
export class ScreeningView extends ItemView {
  private plugin: ScholarRagPlugin;
  private scopeTag = ""; // "" = all references
  private statusFilter: StatusFilter = "unscreened";
  private queue: QueueItem[] = [];
  private index = 0;
  private working: { kq: Set<string>; level?: Level; design?: string; note: string } = { kq: new Set(), note: "" };
  private loadedMtime: number | null = null;
  private writing = false;

  private progressEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private errorEl!: HTMLElement;
  private noteInput!: HTMLTextAreaElement;
  private levelChips: { lvl: Level; el: HTMLElement }[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: ScholarRagPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_SCREENING;
  }
  getDisplayText(): string {
    return "Screening";
  }
  getIcon(): string {
    return "check-check";
  }

  async onOpen(): Promise<void> {
    const c = this.contentEl;
    c.empty();
    c.addClass("rag-obsidian-screening");

    const header = c.createDiv({ cls: "srag-header" });
    const scopeSelect = header.createEl("select");
    scopeSelect.createEl("option", { value: "", text: "All references" });
    const tagSet = new Set<string>();
    for (const e of this.plugin.library.entries()) {
      const raw = e.item.tags;
      const tags = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? [raw] : [];
      for (const t of tags) tagSet.add(t);
    }
    for (const tag of [...tagSet].sort()) scopeSelect.createEl("option", { value: tag, text: `#${tag}` });
    scopeSelect.value = this.scopeTag;
    scopeSelect.onchange = () => {
      this.scopeTag = scopeSelect.value;
      this.index = 0;
      this.recompute();
    };

    const statusSelect = header.createEl("select");
    const statuses: [StatusFilter, string][] = [
      ["unscreened", "Unscreened"], ["pending", "Pending"], ["included", "Included"],
      ["excluded", "Excluded"], ["all", "All"],
    ];
    for (const [value, text] of statuses) statusSelect.createEl("option", { value, text });
    statusSelect.value = this.statusFilter;
    statusSelect.onchange = () => {
      this.statusFilter = statusSelect.value as StatusFilter;
      this.index = 0;
      this.recompute();
    };

    this.progressEl = c.createDiv({ cls: "srag-count" });
    this.errorEl = c.createDiv({ cls: "srag-badge-error" });
    this.bodyEl = c.createDiv({ cls: "srag-screening-body" });

    this.registerDomEvent(document, "keydown", this.onKeydown);
    this.recompute();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private currentScope(): BackfillScope {
    return this.scopeTag ? { kind: "tag", tag: this.scopeTag } : { kind: "all" };
  }

  private recompute(): void {
    const scoped = this.plugin.library.entries().filter((e) => inScope(e, this.currentScope()));
    this.queue = scoped.filter((e) => matchesStatus(e, this.statusFilter)).map((e) => ({ citekey: e.citekey, file: e.file }));
    if (this.index >= this.queue.length) this.index = Math.max(0, this.queue.length - 1);
    this.renderProgress(scoped);
    void this.showCurrent();
  }

  private renderProgress(scoped: Entry[]): void {
    const included = scoped.filter((e) => e.item.include === "include").length;
    const excluded = scoped.filter((e) => e.item.include === "exclude").length;
    const pending = scoped.filter((e) => e.item.include === "pending").length;
    const unscreened = scoped.filter((e) => !e.item.include).length;
    const pos = this.queue.length ? this.index + 1 : 0;
    this.progressEl.setText(
      `${pos} of ${this.queue.length} in queue · included ${included} · excluded ${excluded} · pending ${pending} · unscreened ${unscreened}`
    );
  }

  private currentEntry(): Entry | null {
    const item = this.queue[this.index];
    if (!item) return null;
    const file = this.plugin.app.vault.getAbstractFileByPath(item.file.path);
    if (!(file instanceof TFile)) return null;
    return this.plugin.library.entries().find((e) => e.citekey === item.citekey) ?? null;
  }

  private async showCurrent(): Promise<void> {
    this.errorEl.setText("");
    this.bodyEl.empty();
    const entry = this.currentEntry();
    if (!entry) {
      this.bodyEl.createEl("p", { text: "No records match this scope and filter.", cls: "srag-count" });
      this.loadedMtime = null;
      return;
    }
    this.loadedMtime = entry.file.stat.mtime;
    const item = entry.item;
    const kq = Array.isArray(item.kq) ? (item.kq as unknown[]).map(String) : [];
    this.working = {
      kq: new Set(kq),
      level: LEVELS.includes(String(item.level) as Level) ? (String(item.level) as Level) : undefined,
      design: typeof item.design === "string" ? item.design : undefined,
      note: typeof item.screening_note === "string" ? item.screening_note : "",
    };

    this.bodyEl.createEl("h2", { text: item.title || entry.citekey });
    const meta = [entry.authors, entry.year, entry.journal].filter(Boolean).join(" · ");
    this.bodyEl.createEl("p", { text: meta, cls: "srag-count" });

    const links = this.bodyEl.createDiv({ cls: "srag-badges" });
    if (item.PMID) {
      const a = links.createEl("a", { text: `PMID: ${item.PMID}`, href: "#" });
      a.onclick = (evt) => { evt.preventDefault(); this.plugin.safeOpenExternal(`https://pubmed.ncbi.nlm.nih.gov/${item.PMID}/`); };
    }
    if (item.DOI) {
      const a = links.createEl("a", { text: `DOI: ${item.DOI}`, href: "#" });
      a.onclick = (evt) => { evt.preventDefault(); this.plugin.safeOpenExternal(`https://doi.org/${item.DOI}`); };
    }
    const openBtn = links.createEl("a", { text: "Open note", href: "#" });
    openBtn.onclick = (evt) => { evt.preventDefault(); void this.plugin.app.workspace.getLeaf(false).openFile(entry.file); };

    const tags = Array.isArray(item.tags) ? item.tags.map(String) : [];
    if (tags.length) {
      const tagsEl = this.bodyEl.createDiv({ cls: "srag-badges" });
      for (const t of tags) tagsEl.createSpan({ cls: "srag-badge", text: t });
    }

    const abstractEl = this.bodyEl.createEl("p", { text: "Loading…", cls: "srag-snippet" });
    abstractEl.setText(await this.currentAbstract(entry));

    this.renderControls(entry);
  }

  private async currentAbstract(entry: Entry): Promise<string> {
    if (typeof entry.item.abstract === "string" && entry.item.abstract.trim()) return entry.item.abstract;
    try {
      const content = await this.plugin.app.vault.cachedRead(entry.file);
      return extractSummaryBlock(content) || "(no abstract)";
    } catch {
      return "(no abstract)";
    }
  }

  private renderControls(entry: Entry): void {
    const controls = this.bodyEl.createDiv({ cls: "srag-screening-controls" });

    const decisionRow = controls.createDiv({ cls: "srag-header" });
    const includeBtn = decisionRow.createEl("button", { text: "Include (i)" });
    includeBtn.onclick = () => void this.commit("include");
    const excludeBtn = decisionRow.createEl("button", { text: "Exclude (e)" });
    excludeBtn.onclick = () => void this.commit("exclude");
    const maybeBtn = decisionRow.createEl("button", { text: "Maybe / pending (m)" });
    maybeBtn.onclick = () => void this.commit("pending");

    controls.createDiv({ text: "Key questions", cls: "srag-count" });
    const kqRow = controls.createDiv({ cls: "srag-quick-chips" });
    for (const id of KQ_IDS) {
      const chip = kqRow.createEl("button", { text: id, cls: "srag-quick-chip" });
      const sync = () => chip.toggleClass("is-active", this.working.kq.has(id));
      sync();
      chip.onclick = () => {
        if (this.working.kq.has(id)) this.working.kq.delete(id);
        else this.working.kq.add(id);
        sync();
      };
    }

    controls.createDiv({ text: "Level", cls: "srag-count" });
    const levelRow = controls.createDiv({ cls: "srag-quick-chips" });
    this.levelChips = [];
    for (const lvl of LEVELS) {
      const chip = levelRow.createEl("button", { text: lvl, cls: "srag-quick-chip" });
      chip.toggleClass("is-active", this.working.level === lvl);
      chip.onclick = () => this.setLevel(lvl);
      this.levelChips.push({ lvl, el: chip });
    }

    controls.createDiv({ text: "Design", cls: "srag-count" });
    const designSelect = controls.createEl("select");
    designSelect.createEl("option", { value: "", text: "(unset)" });
    for (const d of DESIGNS) designSelect.createEl("option", { value: d, text: d });
    designSelect.value = this.working.design ?? "";
    designSelect.onchange = () => { this.working.design = designSelect.value || undefined; };

    controls.createDiv({ text: "Screening note", cls: "srag-count" });
    this.noteInput = controls.createEl("textarea", { cls: "srag-chat-input" });
    this.noteInput.value = this.working.note;
    this.noteInput.rows = 3;
    this.noteInput.oninput = () => { this.working.note = this.noteInput.value; };

    const reasonRow = controls.createDiv({ cls: "srag-quick-chips" });
    for (const reason of EXCLUDE_REASONS) {
      const chip = reasonRow.createEl("button", { text: reason, cls: "srag-quick-chip" });
      chip.onclick = () => {
        this.working.note = reason;
        this.noteInput.value = reason;
      };
    }
  }

  private buildFields(include: IncludeValue): ScreeningFields {
    return {
      kq: [...this.working.kq],
      include,
      level: this.working.level,
      design: this.working.design,
      screening_note: this.working.note.trim() || undefined,
    };
  }

  private async commit(include: IncludeValue): Promise<void> {
    if (this.writing) return;
    const item = this.queue[this.index];
    if (!item) return;
    const note = this.working.note.trim();
    if (include === "include" && this.working.kq.size === 0) {
      this.errorEl.setText("Include requires at least one key question.");
      return;
    }
    if (include === "exclude" && excludeNeedsReason(note)) {
      this.errorEl.setText("Exclude requires a reason — pick one or type it in the note.");
      return;
    }
    this.errorEl.setText("");
    this.writing = true;
    try {
      const fresh = this.plugin.app.vault.getAbstractFileByPath(item.file.path);
      if (!(fresh instanceof TFile) || (this.loadedMtime !== null && fresh.stat.mtime !== this.loadedMtime)) {
        new Notice("This note changed on disk — reloading it instead of overwriting.");
        this.recompute();
        return;
      }
      try {
        await this.plugin.app.fileManager.processFrontMatter(fresh, (fm) => {
          applyScreening(fm, this.buildFields(include));
        });
      } catch (e) {
        this.errorEl.setText(e instanceof Error ? e.message : String(e));
        return;
      }
      this.plugin.library.invalidateKeyCache();
      const key = item.citekey;
      // metadataCache re-parses the note asynchronously, so entries() still holds the old
      // decision here — overlay the one we just wrote.
      const scoped = this.plugin.library
        .entries()
        .filter((e) => inScope(e, this.currentScope()))
        .map((e) => (e.citekey === key ? { ...e, item: { ...e.item, include } } : e));
      this.queue = scoped.filter((e) => matchesStatus(e, this.statusFilter)).map((e) => ({ citekey: e.citekey, file: e.file }));
      const stillAt = this.queue.findIndex((q) => q.citekey === key);
      this.index = stillAt >= 0 ? Math.min(stillAt + 1, this.queue.length - 1) : Math.min(this.index, Math.max(0, this.queue.length - 1));
      this.renderProgress(scoped);
      await this.showCurrent();
    } finally {
      this.writing = false;
    }
  }

  private onKeydown = (evt: KeyboardEvent): void => {
    if (!this.contentEl.contains(document.activeElement)) return;
    // Not while typing in any field (the design <select> jumps by letter), and never with a
    // modifier: Cmd+E / Cmd+I are Obsidian's own shortcuts.
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement) return;
    if (evt.metaKey || evt.ctrlKey || evt.altKey) return;
    switch (evt.key) {
      case "i": case "I": evt.preventDefault(); void this.commit("include"); break;
      case "e": case "E": evt.preventDefault(); void this.commit("exclude"); break;
      case "m": case "M": evt.preventDefault(); void this.commit("pending"); break;
      case "j": case "J": case "ArrowRight":
        evt.preventDefault();
        if (this.index < this.queue.length - 1) { this.index++; void this.showCurrent(); }
        break;
      case "k": case "K": case "ArrowLeft":
        evt.preventDefault();
        if (this.index > 0) { this.index--; void this.showCurrent(); }
        break;
      case "1": case "2": case "3": case "4": case "5":
        evt.preventDefault();
        this.setLevel(evt.key);
        break;
    }
  };

  private setLevel(lvl: Level): void {
    this.working.level = lvl;
    for (const { lvl: l, el } of this.levelChips) el.toggleClass("is-active", l === lvl);
  }
}
