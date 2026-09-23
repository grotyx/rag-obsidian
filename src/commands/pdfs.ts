import { Notice, TFile, normalizePath } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { extractPdfText } from "../ingest/pdf";
import { appendStash, hasStashedText, resolvePdfLink } from "../ingest/pdfStash";
import { matchPdf, PdfCandidate, PdfMatch } from "../data/pdfMatch";
import { yearFromIssued } from "../index/chunker";
import { mapPool } from "../util/pool";
import { startBatch } from "../ui/progress";

/** pdfjs runs in the renderer and is CPU-bound — unlike the network/LLM batches, more workers
 *  just fight over the same thread and freeze the UI. Extraction only; the vault writes below
 *  stay sequential. */
const PDF_WIDTH = 2;

/** The one way a reference note's PDF is located: the `pdf:` link first, then the
 *  `PDFs/<citekey>.pdf` the download command writes. Shared so "Index linked PDFs" and
 *  "Extract PDF highlights" can never disagree about which file a note points at. */
export function findPdfFile(
  plugin: ScholarRagPlugin,
  pdfValue: unknown,
  notePath: string,
  citekey: string
): TFile | null {
  return plugin.library.pdfFile(pdfValue, notePath, citekey);
}

/** Extract the text of every linked PDF that has no `## Full text (extracted)` section yet and
 *  stash it in the note, so the incremental reindex picks the full text up. `only` limits the
 *  run to one note. */
export async function indexLinkedPdfs(plugin: ScholarRagPlugin, only?: TFile): Promise<void> {
  const todo: { note: TFile; pdf: TFile }[] = [];
  let skipped = 0;
  for (const e of plugin.library.entries()) {
    if (only && e.file.path !== only.path) continue;
    const pdf = findPdfFile(plugin, e.item.pdf, e.file.path, e.citekey);
    if (!pdf || hasStashedText(await plugin.app.vault.cachedRead(e.file))) {
      skipped++;
      continue;
    }
    todo.push({ note: e.file, pdf });
  }
  if (!todo.length) {
    new Notice(`Nothing to index · ${skipped} skipped (no PDF / already indexed)`);
    return;
  }

  const batch = startBatch(plugin, "Indexing PDFs", todo.length);
  if (!batch) return;
  let done = 0;
  let failed = 0;
  let indexed = 0;
  let outcome = "Indexing PDFs failed (see console)";
  // Vault writes stay sequential (and off the extraction pool) but happen as each text lands:
  // a crash mid-batch keeps what was already stashed, and only the in-flight texts are held.
  let writes: Promise<void> = Promise.resolve();
  try {
    await mapPool(
      todo,
      PDF_WIDTH,
      async (t) => {
        try {
          const { text } = await extractPdfText(await plugin.app.vault.readBinary(t.pdf));
          writes = writes
            .catch(() => {}) // an earlier note's failed write must not fail this one
            .then(async () => {
              await plugin.app.vault.process(t.note, (body) => appendStash(body, text));
              indexed++;
            });
          await writes;
        } catch (err) {
          failed++;
          console.error("[RAG Obsidian] PDF text extraction failed", t.pdf.path, err);
        } finally {
          batch.tick(++done, failed);
        }
      },
      batch.signal
    );
    const cancelled = todo.length - done; // never started — the user cancelled
    outcome =
      `${indexed} indexed · ${skipped} skipped (no PDF / already indexed) · ${failed} failed` +
      (cancelled ? ` · ${cancelled} cancelled` : "");
  } finally {
    batch.finish(outcome);
  }
  new Notice(outcome);
}

/** Same, for the reference note in the active pane. */
export async function indexLinkedPdfActive(plugin: ScholarRagPlugin): Promise<void> {
  const r = plugin.activeRef();
  if (r) await indexLinkedPdfs(plugin, r.file);
}

/** Explicit `pdf:` link this note's frontmatter already resolves to, or null. Deliberately
 *  ignores the `PDFs/<citekey>.pdf` fallback `findPdfFile` also tries — "Link PDFs in a folder"
 *  exists precisely to turn that implicit fallback into a real frontmatter link. */
function resolvedPdfLink(plugin: ScholarRagPlugin, pdfValue: unknown, notePath: string): TFile | null {
  const link = resolvePdfLink(pdfValue);
  return link ? plugin.app.metadataCache.getFirstLinkpathDest(link, notePath) : null;
}

/** Match every PDF in a folder (recursive) to a library reference and write a `pdf:` link.
 *  Pass 1 matches by filename == citekey (no extraction). Pass 2 extracts the remaining PDFs'
 *  text (pool width `PDF_WIDTH`, same CPU-bound reasoning as `indexLinkedPdfs`) and matches by
 *  DOI / PMID / title via `matchPdf`. A note with no stashed text gets the pass-2 extraction
 *  stashed for free; pass-1 matches are left for "Index linked PDFs" to pick up. */
export async function linkPdfsInFolder(plugin: ScholarRagPlugin, folderPath: string): Promise<void> {
  const entries = plugin.library.entries();

  const linkedPaths = new Set<string>();
  let candidates: PdfCandidate[] = [];
  const citekeyToFile = new Map<string, TFile>();
  for (const e of entries) {
    const linked = resolvedPdfLink(plugin, e.item.pdf, e.file.path);
    if (linked) {
      linkedPaths.add(linked.path);
      continue;
    }
    candidates.push({
      citekey: e.citekey,
      DOI: e.item.DOI,
      PMID: e.item.PMID,
      title: e.item.title,
      year: yearFromIssued(e.item.issued) || undefined,
    });
    citekeyToFile.set(e.citekey, e.file);
  }

  // The vault root comes back as "" or "/", and no vault path starts with "/".
  const folder = normalizePath(folderPath).replace(/^\/+|\/+$/g, "");
  const prefix = folder ? `${folder}/` : "";
  const found = plugin.app.vault
    .getFiles()
    .filter((f) => f.extension.toLowerCase() === "pdf" && f.path.startsWith(prefix) && !linkedPaths.has(f.path));
  // A wikilink can't carry `#`, `|`, `[`, `]` or `^` in its target, so a `pdf:` link to such a
  // file would resolve to nothing. List those for renaming instead of writing a dead link.
  const unlinkable = found.filter((f) => /[#|[\]^]/.test(f.path));
  // Nothing left to link to: don't extract every orphan PDF only to report it unmatched.
  const pdfs = candidates.length ? found.filter((f) => !unlinkable.includes(f)) : [];

  if (!pdfs.length && !unlinkable.length) {
    new Notice(`Nothing to link · ${found.length} unlinked PDF(s), ${candidates.length} reference(s) without a PDF`);
    return;
  }

  const batch = startBatch(plugin, "Linking PDFs", pdfs.length);
  if (!batch) return;

  const unmatched: TFile[] = [];
  const byType: Record<PdfMatch["by"], number> = { name: 0, doi: 0, pmid: 0, title: 0 };
  let done = 0;
  let failed = 0;
  let outcome = "Linking PDFs failed (see console)";

  const link = async (pdf: TFile, m: PdfMatch, text?: string): Promise<void> => {
    candidates = candidates.filter((c) => c.citekey !== m.citekey);
    const note = citekeyToFile.get(m.citekey);
    if (!note) return;
    await plugin.app.fileManager.processFrontMatter(note, (fm) => {
      fm.pdf = `[[${pdf.path}]]`;
    });
    if (text != null && !hasStashedText(await plugin.app.vault.cachedRead(note))) {
      await plugin.app.vault.process(note, (body) => appendStash(body, text));
    }
    byType[m.by]++;
  };

  try {
    // Pass 1: filename == citekey, no extraction, no pool (nothing CPU-bound to parallelize).
    const pass2: TFile[] = [];
    for (const pdf of pdfs) {
      if (batch.signal.aborted) break;
      try {
        const m = matchPdf(pdf.basename, null, candidates);
        if (m) await link(pdf, m);
        else pass2.push(pdf);
      } catch (err) {
        failed++;
        console.error("[RAG Obsidian] Link PDFs (name pass) failed", pdf.path, err);
      } finally {
        batch.tick(++done, failed);
      }
    }

    // Pass 2: extract text, match by DOI / PMID / title.
    let writes: Promise<void> = Promise.resolve();
    await mapPool(
      pass2,
      PDF_WIDTH,
      async (pdf) => {
        try {
          const { text } = await extractPdfText(await plugin.app.vault.readBinary(pdf));
          writes = writes
            .catch(() => {}) // an earlier note's failed write must not fail this one
            .then(async () => {
              const m = matchPdf(pdf.basename, text.slice(0, 4000), candidates);
              if (m) await link(pdf, m, text);
              else unmatched.push(pdf);
            });
          await writes;
        } catch (err) {
          failed++;
          console.error("[RAG Obsidian] Link PDFs (content pass) failed", pdf.path, err);
        } finally {
          batch.tick(++done, failed);
        }
      },
      batch.signal
    );

    const linked = byType.name + byType.doi + byType.pmid + byType.title;
    const cancelled = pdfs.length - done;
    outcome =
      `${linked} linked (${byType.name} name · ${byType.doi} doi · ${byType.pmid} pmid · ${byType.title} title) · ` +
      `${unmatched.length} unmatched · ${failed} failed` +
      (unlinkable.length ? ` · ${unlinkable.length} need renaming` : "") +
      (cancelled ? ` · ${cancelled} cancelled` : "");
  } finally {
    batch.finish(outcome);
  }

  if (unmatched.length || unlinkable.length) {
    const report =
      `# PDF link report\n\n${unmatched.length} unmatched PDF(s) in "${folderPath}":\n\n` +
      unmatched.map((f) => `- ${f.path}`).join("\n") +
      "\n" +
      (unlinkable.length
        ? `\n${unlinkable.length} PDF(s) skipped — rename them without # | [ ] ^ and run again:\n\n` +
          unlinkable.map((f) => `- ${f.path}`).join("\n") +
          "\n"
        : "");
    await plugin.writeAndOpen(normalizePath("PDF link report.md"), report);
  }
  new Notice(outcome);
}
