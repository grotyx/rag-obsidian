import { App, Modal, Notice, Setting, TextComponent } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { detectId, fetchMetadata } from "../ingest/metadata";
import { resolveWork } from "../graph/openalex";
import { CSLItem } from "../types";

export class AddReferenceModal extends Modal {
  private plugin: ScholarRagPlugin;
  private input = "";

  constructor(app: App, plugin: ScholarRagPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Add reference" });
    contentEl.createEl("p", {
      text: "Paste a DOI, PubMed ID (PMID), or arXiv ID / URL — or type a paper title to search.",
      cls: "setting-item-description",
    });

    let textComp: TextComponent | undefined;
    new Setting(contentEl).setName("Identifier").addText((t) => {
      textComp = t;
      t.setPlaceholder("10.1038/nature14539  ·  26017442  ·  2005.11401");
      t.onChange((v) => (this.input = v));
      t.inputEl.style.width = "100%";
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void this.submit();
      });
    });

    new Setting(contentEl).addButton((b) =>
      b.setButtonText("Fetch & add").setCta().onClick(() => void this.submit())
    );

    window.setTimeout(() => textComp?.inputEl.focus(), 0);
  }

  private async submit(): Promise<void> {
    const raw = this.input.trim();
    if (!raw) {
      new Notice("Enter an identifier");
      return;
    }
    const id = detectId(raw);
    const notice = new Notice(
      id.kind === "unknown" ? `Searching "${raw}"…` : `Fetching ${id.kind.toUpperCase()} ${id.value}…`,
      0
    );
    try {
      let item: CSLItem;
      if (id.kind === "unknown") {
        // Treat free text as a title search (OpenAlex → DOI/PMID → rich metadata).
        const w = await resolveWork({ type: "article-journal", title: raw }, this.plugin.settings.openalexMailto);
        if (!w) {
          notice.hide();
          new Notice("No match — paste a DOI / PMID / arXiv ID, or refine the title");
          return;
        }
        const sub = detectId(w.doi || w.pmid || "");
        item = sub.kind === "unknown"
          ? { type: "article-journal", title: w.title, openalex_id: w.openalexId }
          : await fetchMetadata(sub, this.plugin.settings.pubmedApiKey);
      } else {
        item = await fetchMetadata(id, this.plugin.settings.pubmedApiKey);
      }
      const dup = this.plugin.library.findDuplicate(item);
      if (dup) {
        notice.hide();
        new Notice(`Already in library: ${dup}`);
        this.close();
        const existing = this.plugin.library.getFile(dup);
        if (existing) await this.app.workspace.getLeaf(true).openFile(existing);
        return;
      }
      const file = await this.plugin.library.createReference(item);
      notice.hide();
      new Notice(`Added: ${item.title ?? file.basename}`);
      this.close();
      await this.app.workspace.getLeaf(true).openFile(file);
    } catch (e) {
      notice.hide();
      console.error("[RAG Obsidian] fetch failed", e);
      new Notice(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
