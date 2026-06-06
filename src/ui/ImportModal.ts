import { App, Modal, Notice, Setting } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { parseLibrary } from "../ingest/import";

/** Paste or load a Zotero/EndNote/Mendeley export (BibTeX / RIS / CSL-JSON) → reference notes. */
export class ImportModal extends Modal {
  private plugin: ScholarRagPlugin;
  private text = "";

  constructor(app: App, plugin: ScholarRagPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Import references" });
    contentEl.createEl("p", {
      text: "Paste a BibTeX (.bib), RIS (.ris), PubMed NBIB/MEDLINE (.nbib), or CSL-JSON export — or load a file. Duplicates (same DOI / PMID / title) are skipped.",
      cls: "setting-item-description",
    });

    const fileInput = contentEl.createEl("input", { type: "file" });
    fileInput.accept = ".bib,.ris,.nbib,.json,.txt";
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files?.[0];
      if (f) {
        this.text = await f.text();
        area.value = this.text;
      }
    });

    const area = contentEl.createEl("textarea");
    area.style.width = "100%";
    area.style.height = "12em";
    area.style.fontFamily = "var(--font-monospace)";
    area.placeholder = "@article{smith2020, title={...}, author={Smith, Jane}, year={2020}, ... }";
    area.addEventListener("input", () => (this.text = area.value));

    new Setting(contentEl).addButton((b) =>
      b.setButtonText("Import").setCta().onClick(() => void this.run())
    );
  }

  private async run(): Promise<void> {
    const items = parseLibrary(this.text);
    if (!items.length) {
      new Notice("Could not parse any references (BibTeX / RIS / CSL-JSON).");
      return;
    }
    const notice = new Notice(`Importing 0/${items.length}…`, 0);
    let added = 0;
    let skipped = 0;
    for (const item of items) {
      try {
        const dup = this.plugin.library.findDuplicate(item);
        if (dup) {
          skipped++;
        } else {
          await this.plugin.library.createReference(item);
          added++;
        }
        notice.setMessage(`Importing ${added + skipped}/${items.length}…`);
      } catch (e) {
        console.error("[RAG Obsidian] import failed", e);
      }
    }
    notice.hide();
    new Notice(`Imported ${added} reference${added === 1 ? "" : "s"}${skipped ? `, skipped ${skipped} duplicate(s)` : ""}.`);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
