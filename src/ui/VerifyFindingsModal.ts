import { Modal, Notice, TFile } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { Finding, evidenceSection, parseFindings, quoteInSource, setFindingFields } from "../data/findings";
import { localDate } from "../data/reference";
import { locateQuote, normalizePages } from "../data/verify";
import { findPdfFile } from "../commands/pdfs";
import { extractPdfPages } from "../ingest/pdf";
import { stashedText } from "../ingest/pdfStash";
import { str } from "../util/json";

/** "Verify findings in this note": each extracted finding with the PDF page its quote sits on
 *  (or, without a PDF, whether the quote is in the stashed text / abstract). A quote that is
 *  nowhere is the signal worth looking at. */
export class VerifyFindingsModal extends Modal {
  constructor(private plugin: ScholarRagPlugin, private note: TFile, private fm: Record<string, unknown>) {
    super(plugin.app);
  }

  onOpen(): void {
    this.titleEl.setText("Verify findings");
    void this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async render(): Promise<void> {
    const { contentEl } = this;
    const content = await this.plugin.app.vault.cachedRead(this.note);
    const findings = parseFindings(content);
    if (!findings.length) {
      contentEl.createEl("p", { text: "This note has no extracted findings." });
      return;
    }
    const status = contentEl.createEl("p", { cls: "setting-item-description", text: "Reading source text…" });

    // Pages of the linked PDF; else the stash / abstract (the Evidence section itself is not a source).
    const pdf = findPdfFile(this.plugin, this.fm.pdf, this.note.path, String(this.fm.citekey));
    let pages: string[] | null = null;
    if (pdf) {
      try {
        pages = normalizePages(await extractPdfPages(await this.plugin.app.vault.readBinary(pdf)));
        if (!pages.some((p) => p.length)) pages = null;
      } catch (e) {
        console.error("[Refwright] verify: PDF read failed", pdf.path, e);
      }
    }
    const text = stashedText(content) || str(this.fm.abstract);
    status.setText(
      pages && pdf
        ? `Checked against ${pdf.name} (${pages.length} pages).`
        : text
          ? "No readable PDF linked: checked against the extracted text or abstract."
          : "No PDF, extracted text or abstract to check against."
    );

    let missing = 0;
    for (const f of findings) {
      const page = pages ? locateQuote(f.quote, pages) : null;
      const found = page !== null || (!pages && quoteInSource(f.quote, text));
      if (!found) missing++;
      this.row(f, page, found, pages !== null ? pdf : null);
    }
    status.setText(`${status.getText()} ${missing ? `${missing} of ${findings.length} not found.` : "All quotes found."}`);
  }

  private row(f: Finding, page: number | null, found: boolean, pdf: TFile | null): void {
    const row = this.contentEl.createDiv({ cls: "srag-verify-row" });
    const head = [f.kind, f.outcome, f.effect, f.ci && `CI ${f.ci}`, f.p && `p ${f.p}`].filter(Boolean).join(" · ");
    row.createDiv({ text: head, cls: "srag-verify-head" });
    row.createEl("blockquote", { text: f.quote });
    const bar = row.createDiv({ cls: "srag-verify-bar" });
    bar.createSpan({
      text: !found ? "Not found" : page !== null ? `p. ${page}` : "Found in extracted text",
      cls: found ? "" : "srag-verify-missing",
    });
    if (f.verified) bar.createSpan({ text: `verified ${f.verified}`, cls: "setting-item-description" });
    if (pdf && page !== null) {
      bar.createEl("button", { text: "Open at page" }).onclick = () => {
        void this.plugin.app.workspace.openLinkText(`${pdf.path}#page=${page}`, this.note.path, true);
      };
    }
    if (found && !f.verified) {
      const btn = bar.createEl("button", { text: "Mark verified" });
      btn.onclick = () => void this.markVerified(f, page, btn);
    }
  }

  private async markVerified(f: Finding, page: number | null, btn: HTMLButtonElement): Promise<void> {
    const fields: Record<string, string> = { verified: localDate() };
    if (page !== null) fields.page = String(page);
    let done = false;
    await this.plugin.app.vault.process(this.note, (c) => {
      const next = setFindingFields(c, f, fields);
      done = next !== null && next !== c;
      return next ?? c;
    });
    if (done) btn.replaceWith(createSpan({ text: `verified ${fields.verified}`, cls: "setting-item-description" }));
    else new Notice("That finding changed in the note; reopen the check");
  }
}

/** The command: only a note that has an Evidence section. */
export function openVerifyFindings(plugin: ScholarRagPlugin): void {
  const r = plugin.activeRef();
  if (!r) return;
  void plugin.app.vault.cachedRead(r.file).then((c) => {
    if (!evidenceSection(c)) new Notice("This note has no extracted findings section");
    else new VerifyFindingsModal(plugin, r.file, r.fm).open();
  });
}
