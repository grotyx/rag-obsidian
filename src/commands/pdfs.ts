import { Notice, TFile, normalizePath } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { extractPdfText } from "../ingest/pdf";
import { appendStash, hasStashedText, resolvePdfLink } from "../ingest/pdfStash";
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
  const link = resolvePdfLink(pdfValue);
  const linked = link ? plugin.app.metadataCache.getFirstLinkpathDest(link, notePath) : null;
  if (linked) return linked;
  const guess = plugin.app.vault.getAbstractFileByPath(normalizePath(`PDFs/${citekey}.pdf`));
  return guess instanceof TFile ? guess : null;
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
