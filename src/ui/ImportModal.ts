import { App, Modal, Notice, Setting } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { parseLibrary } from "../ingest/import";
import { fetchZoteroCollections, fetchZoteroItems } from "../ingest/zotero";
import type { CSLItem } from "../types";

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

    this.zoteroSection(contentEl);

    const fileInput = contentEl.createEl("input", { type: "file" });
    fileInput.accept = ".bib,.ris,.nbib,.json,.txt";
    fileInput.addEventListener("change", () => void this.loadFile(fileInput, area));

    const area = contentEl.createEl("textarea", { cls: "srag-textarea-mono" });
    area.placeholder = "@article{smith2020, title={...}, author={Smith, Jane}, year={2020}, ... }";
    area.addEventListener("input", () => (this.text = area.value));

    new Setting(contentEl).addButton((b) =>
      b.setButtonText("Import").setCta().onClick(() => void this.run())
    );
  }

  private zoteroSection(el: HTMLElement): void {
    let collection: string | null = null;
    let dropdownHost: Setting | null = null;
    new Setting(el)
      .setName("From Zotero")
      .setDesc("Reads your running Zotero 7 directly. In Zotero, turn on 'Allow other applications on this computer to communicate with Zotero' (advanced settings).")
      .addButton((b) =>
        b.setButtonText("Connect").onClick(async () => {
          try {
            const cols = await fetchZoteroCollections();
            dropdownHost?.settingEl.remove();
            collection = null; // the rebuilt dropdown shows "Whole library"
            dropdownHost = new Setting(el)
              .setName("Collection")
              .addDropdown((d) => {
                d.addOption("", "Whole library");
                for (const c of cols) d.addOption(c.key, c.path);
                d.onChange((v) => (collection = v || null));
              })
              .addButton((imp) =>
                imp.setButtonText("Import from Zotero").setCta().onClick(() => void this.runZotero(collection))
              );
            el.insertBefore(dropdownHost.settingEl, el.children[3] ?? null);
          } catch (e) {
            new Notice(e instanceof Error ? e.message : String(e), 10000);
          }
        })
      );
  }

  private async runZotero(collection: string | null): Promise<void> {
    const notice = new Notice("Reading from Zotero…", 0);
    let items: CSLItem[];
    try {
      items = await fetchZoteroItems(collection, (n) => notice.setMessage(`Reading from Zotero… ${n}`));
    } catch (e) {
      notice.hide();
      new Notice(e instanceof Error ? e.message : String(e), 10000);
      return;
    }
    notice.hide();
    if (!items.length) {
      new Notice("Zotero returned no references.");
      return;
    }
    await this.addAll(items);
  }

  private async loadFile(fileInput: HTMLInputElement, area: HTMLTextAreaElement): Promise<void> {
    const f = fileInput.files?.[0];
    if (f) {
      this.text = await f.text();
      area.value = this.text;
    }
  }

  private async run(): Promise<void> {
    const items = parseLibrary(this.text);
    if (!items.length) {
      new Notice("Could not parse any references (BibTeX / RIS / CSL-JSON).");
      return;
    }
    await this.addAll(items);
  }

  /** The one add loop: findDuplicate → createReference, progress notice, final count. */
  private async addAll(items: CSLItem[]): Promise<void> {
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
