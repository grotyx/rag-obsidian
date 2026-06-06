import { App, FuzzySuggestModal, TFile, Notice } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { PdfImporter } from "../ingest/pdfImport";

/** Pick a PDF from the vault to import as a reference. */
export class ImportPdfModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private plugin: ScholarRagPlugin) {
    super(app);
    this.setPlaceholder("Pick a PDF to import…");
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((f) => f.extension.toLowerCase() === "pdf");
  }

  getItemText(f: TFile): string {
    return f.path;
  }

  onChooseItem(f: TFile): void {
    const notice = new Notice(`Importing ${f.name}…`, 0);
    const importer = new PdfImporter(this.app, this.plugin.library, this.plugin.settings);
    importer
      .importFile(f)
      .then((note) => {
        notice.hide();
        new Notice(`Imported: ${note.basename}`);
        void this.app.workspace.getLeaf(true).openFile(note);
      })
      .catch((e) => {
        notice.hide();
        new Notice(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
      });
  }
}
