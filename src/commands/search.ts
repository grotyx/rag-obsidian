import { Notice } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { startBatch } from "../ui/progress";
import { arr, text } from "../util/json";

/** Tags used by at least this many references become MeSH lookups; rarer ones are mostly author
 *  keywords that MeSH doesn't have, and each costs an E-utilities call. */
const MIN_USES = 5;

/** "Build MeSH synonym list for search": NLM entry terms for the library's common subject tags
 *  (tags are MeSH headings, slugged) plus stored `mesh_terms`, cached for query expansion.
 *  Resumable — headings already cached are skipped — and cancellable from the status bar. */
export async function buildMeshSynonyms(plugin: ScholarRagPlugin): Promise<void> {
  await plugin.indexManager.ensureExpander(); // so already-cached headings are skipped below
  const uses = new Map<string, number>();
  const exact = new Set<string>();
  for (const e of plugin.library.entries()) {
    const fm = e.item as unknown as Record<string, unknown>;
    for (const t of arr(fm.tags).map(text)) if (t) uses.set(t, (uses.get(t) ?? 0) + 1);
    for (const m of arr(fm.mesh_terms).map(text)) if (m) exact.add(m);
  }
  const headings = [
    ...exact,
    ...[...uses].filter(([, n]) => n >= MIN_USES).map(([t]) => t.replace(/-/g, " ")),
  ].filter((h) => !plugin.indexManager.mesh.has(h));
  if (!headings.length) {
    new Notice("MeSH synonym list is up to date");
    return;
  }
  const batch = startBatch(plugin, "MeSH synonyms", headings.length);
  if (!batch) return;
  let summary = "MeSH synonyms failed (see console)";
  try {
    const { added, failed } = await plugin.indexManager.addMeshHeadings(headings, {
      apiKey: plugin.settings.pubmedApiKey,
      email: plugin.settings.openalexMailto,
      onProgress: (done) => batch.tick(done),
      signal: batch.signal,
    });
    summary = `MeSH synonyms: ${added} headings added${failed ? `, ${failed} failed (run again to retry)` : ""}`;
  } catch (e) {
    console.error("[RAG Obsidian] MeSH synonyms failed", e);
  } finally {
    batch.finish(summary);
  }
}
