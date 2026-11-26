import type ScholarRagPlugin from "../../main";
import { SearchFilters } from "../index/store";
import { tagKey, tagsOf } from "../util/json";

/** Year range + author + tag chips, shared by the search and chat panes.
 *  State is view-local — deliberately not persisted to settings. */
export class FilterRow {
  private tags: string[] = [];
  private textInputs: HTMLInputElement[] = [];
  private fromEl: HTMLInputElement;
  private toEl: HTMLInputElement;
  private authorEl: HTMLInputElement;
  private tagEl: HTMLInputElement;
  private chipsEl: HTMLElement;

  constructor(host: HTMLElement, private plugin: ScholarRagPlugin) {
    const row = host.createDiv({ cls: "srag-filters" });
    // filters() reads the boxes themselves, so a value typed but not yet "changed" still counts.
    const field = (type: string, cls: string, ph: string) => {
      const el = row.createEl("input", { type, placeholder: ph, cls });
      this.textInputs.push(el);
      return el;
    };
    this.fromEl = field("number", "srag-year", "From");
    this.toEl = field("number", "srag-year", "To");
    this.authorEl = field("text", "srag-author", "Author");

    const listId = `srag-tags-${Math.random().toString(36).slice(2)}`;
    const tagInput = (this.tagEl = field("text", "srag-tag-input", "Tag"));
    tagInput.setAttr("list", listId);
    const datalist = row.createEl("datalist");
    datalist.id = listId;
    for (const t of this.libraryTags()) datalist.createEl("option", { value: t });
    tagInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      this.commitTag();
    });
    tagInput.addEventListener("change", () => this.commitTag()); // a datalist pick with the mouse
 // a datalist pick with the mouse

    this.chipsEl = host.createDiv({ cls: "srag-chips" });
    this.renderChips();
  }

  /** Turn the text in the tag box into a chip (Enter, a datalist pick, or a Search / Send click). */
  private commitTag(): void {
    const t = tagKey(this.tagEl.value);
    this.tagEl.value = "";
    if (t && !this.tags.includes(t)) {
      this.tags.push(t);
      this.renderChips();
    }
  }

  filters(): SearchFilters {
    this.commitTag();
    const yearFrom = Number(this.fromEl.value.trim());
    const yearTo = Number(this.toEl.value.trim());
    const author = this.authorEl.value.trim();
    return {
      ...(yearFrom ? { yearFrom } : {}),
      ...(yearTo ? { yearTo } : {}),
      ...(author ? { author } : {}),
      ...(this.tags.length ? { tags: [...this.tags] } : {}),
    };
  }

  clear(): void {
    this.tags = [];
    for (const el of this.textInputs) el.value = "";
    this.renderChips();
  }

  private renderChips(): void {
    this.chipsEl.empty();
    for (const t of this.tags) {
      const chip = this.chipsEl.createSpan({ cls: "srag-chip", text: t });
      const x = chip.createEl("button", { cls: "srag-chip-x", text: "✕" });
      x.setAttribute("aria-label", `Remove tag ${t}`);
      x.onclick = () => {
        this.tags = this.tags.filter((v) => v !== t);
        this.renderChips();
      };
    }
  }

  /** Every tag present on a reference note, for the tag input's autocomplete. */
  private libraryTags(): string[] {
    const seen = new Set<string>();
    for (const e of this.plugin.library.cachedEntries()) {
      for (const t of tagsOf(e.item.tags)) seen.add(t);
    }
    return [...seen].sort();
  }
}
