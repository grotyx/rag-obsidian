import { App, Modal, Setting, SuggestModal } from "obsidian";
import type { SearchHit } from "../index/store";
import type { Paragraph } from "../write/evidence";

/** Pick one of the references the index matched against a paragraph → insert `[@citekey]`. */
export class CiteSuggestModal extends SuggestModal<SearchHit> {
  constructor(
    app: App,
    private hits: SearchHit[],
    private onPick: (hit: SearchHit) => void
  ) {
    super(app);
    this.setPlaceholder("Cite which reference?");
  }

  getSuggestions(query: string): SearchHit[] {
    const q = query.toLowerCase();
    return this.hits.filter((h) => `${h.citekey} ${h.title}`.toLowerCase().includes(q));
  }

  renderSuggestion(h: SearchHit, el: HTMLElement): void {
    el.addClass("srag-suggestion");
    el.createDiv({ cls: "srag-sug-key", text: `${h.title} · ${h.year || "n.d."} · ${h.score.toFixed(2)}` });
    el.createDiv({ cls: "srag-sug-meta", text: h.text.replace(/\s+/g, " ").slice(0, 160) });
  }

  onChooseSuggestion(h: SearchHit): void {
    this.onPick(h);
  }
}

/** Report of paragraphs that assert something and cite nothing, one "Suggest" button each. */
export class UnsupportedClaimsModal extends Modal {
  constructor(
    app: App,
    private claims: Paragraph[],
    private onSuggest: (claim: Paragraph) => void
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: `Unsupported claims (${this.claims.length})` });
    contentEl.createEl("p", {
      text: "Declarative paragraphs above ## References with no [@citekey]. Suggest searches the index for evidence and inserts the citation at the end of the paragraph.",
      cls: "setting-item-description",
    });
    for (const claim of this.claims) {
      new Setting(contentEl)
        .setName(claim.text.replace(/\s+/g, " ").slice(0, 120))
        .addButton((b) =>
          b.setButtonText("Suggest").onClick(() => {
            this.close();
            this.onSuggest(claim);
          })
        );
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
