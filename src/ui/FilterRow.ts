import type ScholarRagPlugin from "../../main";
import { SearchFilters } from "../index/store";

/** Year range + author + tag chips, shared by the search and chat panes.
 *  State is view-local — deliberately not persisted to settings. */
export class FilterRow {
  private yearFrom = "";
  private yearTo = "";
  private author = "";
  private tags: string[] = [];
  private textInputs: HTMLInputElement[] = [];
  private chipsEl: HTMLElement;

  constructor(host: HTMLElement, private plugin: ScholarRagPlugin) {
    const row = host.createDiv({ cls: "srag-filters" });
    const field = (type: string, cls: string, ph: string, set: (v: string) => void) => {
      const el = row.createEl("input", { type, placeholder: ph, cls });
      el.addEventListener("change", () => set(el.value.trim()));
      this.textInputs.push(el);
      return el;
    };
    field("number", "srag-year", "From", (v) => (this.yearFrom = v));
    field("number", "srag-year", "To", (v) => (this.yearTo = v));
    field("text", "srag-author", "Author", (v) => (this.author = v));

    const listId = `srag-tags-${Math.random().toString(36).slice(2)}`;
    const tagInput = field("text", "srag-tag-input", "Tag", () => {});
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

    this.chipsEl = host.createDiv({ cls: "srag-chips" });
    this.renderChips();
  }

  filters(): SearchFilters {
    const yearFrom = Number(this.yearFrom);
    const yearTo = Number(this.yearTo);
    return {
      ...(yearFrom ? { yearFrom } : {}),
      ...(yearTo ? { yearTo } : {}),
      ...(this.author ? { author: this.author } : {}),
      ...(this.tags.length ? { tags: [...this.tags] } : {}),
    };
  }

  clear(): void {
    this.yearFrom = "";
    this.yearTo = "";
    this.author = "";
    this.tags = [];
    for (const el of this.textInputs) el.value = "";
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
}
