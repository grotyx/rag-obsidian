import { App, TFile } from "obsidian";
import { ScholarRagSettings, CSLItem } from "../types";
import { Library } from "../data/library";
import { extractPdfText, findIdentifier } from "./pdf";
import { appendStash } from "./pdfStash";
import { fetchMetadata } from "./metadata";
import { LLMClient } from "../llm/client";

/** Import a PDF: extract text → resolve metadata (by embedded DOI/arXiv, else LLM)
 *  → create a reference note → stash extracted text so the indexer embeds it. */
export class PdfImporter {
  constructor(
    private app: App,
    private library: Library,
    private settings: ScholarRagSettings
  ) {}

  async importFile(pdf: TFile): Promise<TFile> {
    const data = await this.app.vault.readBinary(pdf);
    const { text } = await extractPdfText(data); // throws on a scanned/image PDF

    let item: CSLItem | null = null;
    const id = findIdentifier(text);
    if (id) {
      try {
        item = await fetchMetadata(id, this.settings.pubmedApiKey);
      } catch {
        /* fall back to LLM extraction */
      }
    }
    if (!item) item = await this.llmExtract(text);
    if (!item.title) item.title = pdf.basename;

    // Same paper already in the library (added by DOI earlier, or the PDF imported twice):
    // attach the PDF + text to the existing note instead of creating a duplicate.
    const dup = this.library.findDuplicate(item);
    const note = (dup && this.library.getFile(dup)) || (await this.library.createReference(item));
    await this.attach(note, pdf, text);
    return note;
  }

  private async attach(note: TFile, pdf: TFile, text: string): Promise<void> {
    // Frontmatter first: processFrontMatter rewrites the file from its own copy, so a body
    // appended before it is silently dropped.
    await this.app.fileManager.processFrontMatter(note, (fm) => {
      fm.pdf = `[[${pdf.path}]]`;
    });
    await this.app.vault.process(note, (body) => appendStash(body, text));
  }

  private async llmExtract(text: string): Promise<CSLItem> {
    const head = text.slice(0, 4000);
    const llm = new LLMClient(this.settings);
    const prompt =
      "Extract bibliographic metadata from this article's opening text. " +
      'Return ONLY minified JSON with keys: title (string), authors (array of {family, given}), ' +
      "year (number), container_title (string), abstract (string). Use null when unknown.\n\nTEXT:\n" +
      head;
    const raw = await llm.chat([{ role: "user", content: prompt }], "You output only valid minified JSON.");
    const json = this.parseJson(raw);
    return {
      type: "article-journal",
      title: typeof json.title === "string" ? json.title : "",
      author: Array.isArray(json.authors) ? json.authors : [],
      "container-title": typeof json.container_title === "string" ? json.container_title : undefined,
      abstract: typeof json.abstract === "string" ? json.abstract : undefined,
      issued: json.year ? { "date-parts": [[Number(json.year)]] } : undefined,
    };
  }

  private parseJson(raw: string): any {
    const m = raw.match(/\{[\s\S]*\}/);
    try {
      return m ? JSON.parse(m[0]) : {};
    } catch {
      return {};
    }
  }
}
