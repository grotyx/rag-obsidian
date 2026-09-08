import { Notice, TFile } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { extractPdfText } from "../ingest/pdf";
import { appendStash, hasStashedText, resolvePdfLink } from "../ingest/pdfStash";
import { mapPool } from "../util/pool";
import { startBatch } from "../ui/progress";

/** pdfjs runs in the renderer and is CPU-bound — unlike the network/LLM batches, more workers
 *  just fight over the same thread and freeze the UI. Extraction only; the vault writes below
 *  stay sequential. */
const PDF_WIDTH = 2;

/** Extract the text of every linked PDF that has no `## Full text (extracted)` section yet and
 *  stash it in the note, so the incremental reindex picks the full text up. `only` limits the
 *  run to one note. */
export async function indexLinkedPdfs(plugin: ScholarRagPlugin, only?: TFile): Promise<void> {
  const todo: { note: TFile; pdf: TFile }[] = [];
  let skipped = 0;
  for (const e of plugin.library.entries()) {
    if (only && e.file.path !== only.path) continue;
    const link = resolvePdfLink(e.item.pdf);
    const pdf = link ? plugin.app.metadataCache.getFirstLinkpathDest(link, e.file.path) : null;
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
  try {
    const texts = await mapPool(
      todo,
      PDF_WIDTH,
      async (t) => {
        try {
          const { text } = await extractPdfText(await plugin.app.vault.readBinary(t.pdf));
          if (!text) throw new Error("no extractable text (scanned/image PDF?)");
          return text;
        } catch (err) {
          failed++;
          console.error("[RAG Obsidian] PDF text extraction failed", t.pdf.path, err);
          return "";
        } finally {
          batch.tick(++done, failed);
        }
      },
      batch.signal
    );
    for (let i = 0; i < todo.length; i++) {
      // Empty slot: cancelled before this one started, or extraction failed.
      if (!texts[i]) continue;
      await plugin.app.vault.process(todo[i].note, (body) => appendStash(body, texts[i]));
      indexed++;
    }
    skipped += todo.length - done; // never started — the user cancelled
    outcome = `${indexed} indexed · ${skipped} skipped (no PDF / already indexed) · ${failed} failed`;
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
