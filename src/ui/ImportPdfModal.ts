import { App, FuzzySuggestModal, TFile, Notice, normalizePath } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { PdfImporter } from "../ingest/pdfImport";
import { isPdfMagic } from "../ingest/pdf";
import { safePdfName } from "../data/library";
import { resolvePdfLink } from "../ingest/pdfStash";
import { MAX_PDF_BYTES, uniquePath } from "../util/capture";

/** Pick a PDF from the vault — or from the computer (button / drop) — to import as a reference. */
export class ImportPdfModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private plugin: ScholarRagPlugin) {
    super(app);
    this.setPlaceholder("Pick a PDF to import…");
  }

  onOpen(): void {
    void super.onOpen();
    const row = this.modalEl.createDiv({ cls: "setting-item-description" });
    const input = row.createEl("input", { type: "file", attr: { accept: "application/pdf,.pdf", hidden: "" } });
    const btn = row.createEl("button", { text: "Choose a PDF from your computer…" });
    row.createSpan({ text: " or drop one here" });
    btn.onclick = () => input.click();
    input.onchange = () => this.fromComputer(input.files?.[0]);
    this.modalEl.addEventListener("dragover", (e) => e.preventDefault());
    this.modalEl.addEventListener("drop", (e) => {
      e.preventDefault();
      this.fromComputer(e.dataTransfer?.files[0]);
    });
  }

  private fromComputer(file: File | undefined): void {
    if (!file) return;
    this.close();
    void importExternalPdf(this.app, this.plugin, file);
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

/** Copy a PDF from outside the vault into `PDFs/` (never over an existing file), run the normal
 *  import on the copy, then name it after the note's citekey when that name is free. */
export async function importExternalPdf(app: App, plugin: ScholarRagPlugin, file: File): Promise<void> {
  if (file.size > MAX_PDF_BYTES) {
    new Notice(`That PDF is ${(file.size / 1048576).toFixed(0)} MB; the limit is ${MAX_PDF_BYTES / 1048576} MB.`);
    return;
  }
  const notice = new Notice(`Importing ${file.name}…`, 0);
  let copy: TFile | null = null;
  try {
    const data = await file.arrayBuffer();
    if (!isPdfMagic(data)) throw new Error("not a PDF file");
    const dir = normalizePath("PDFs");
    if (!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir).catch(() => {});
    const base = safePdfName(file.name.replace(/\.pdf$/i, "")) || "imported";
    const path = uniquePath(dir, base, "pdf", (p) => !!app.vault.getAbstractFileByPath(p));
    const made = await app.vault.createBinary(path, data);
    copy = made;
    const note = await new PdfImporter(app, plugin.library, plugin.settings).importFile(made);
    copy = null; // the note may link it now, so a later failure must not trash it
    // Name the copy after the citekey (the convention the PDF commands look for) when it is the linked PDF.
    let citekey = "";
    let linked = false;
    await app.fileManager.processFrontMatter(note, (fm: Record<string, unknown>) => {
      citekey = typeof fm.citekey === "string" ? fm.citekey : "";
      const link = resolvePdfLink(fm.pdf);
      linked = !!link && app.metadataCache.getFirstLinkpathDest(link, note.path)?.path === made.path;
    });
    if (!linked) {
      await app.fileManager.trashFile(made); // the note already had another PDF
    } else {
      const safe = safePdfName(citekey);
      const target = normalizePath(`${dir}/${safe}.pdf`);
      if (safe && target !== made.path && !app.vault.getAbstractFileByPath(target)) {
        await app.fileManager.renameFile(made, target);
      }
    }
    notice.hide();
    new Notice(`Imported: ${note.basename}`);
    void app.workspace.getLeaf(true).openFile(note);
  } catch (e) {
    notice.hide();
    if (copy) await app.fileManager.trashFile(copy).catch(() => {});
    new Notice(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
