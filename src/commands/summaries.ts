import { Notice, TFile } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { CSLItem } from "../types";
import { fetchPubmedRecord, fetchPmcFullText } from "../ingest/pubmedSearch";
import { summarizeSource } from "../ingest/summarize";
import { summaryBlock } from "../data/reference";
import { replaceSummaryBlock } from "../cite/bibliography";
import { LLMClient } from "../llm/client";

/** Re-summarize one note in place: same source as the backfill (PMC full text when the PubMed
 *  record has one, else the abstract), then swap the existing summary block for the new one.
 *  Returns the `summary_source` tag, or null when there is nothing to summarize. */
async function rewriteSummary(
  plugin: ScholarRagPlugin,
  llm: LLMClient,
  file: TFile,
  item: CSLItem
): Promise<string | null> {
  const apiKey = plugin.settings.pubmedApiKey;
  const email = plugin.settings.openalexMailto;
  const pmid = item.PMID ? String(item.PMID) : "";
  const rec = pmid
    ? await fetchPubmedRecord(pmid, apiKey, email)
    : { abstract: "", descriptors: [], keywords: [], pmc: "" };
  const abstract = (typeof item.abstract === "string" && item.abstract) || rec.abstract || "";
  if (!abstract) return null;

  let src = abstract;
  let label = "PubMed abstract (not open access — full text not retrieved)";
  let tag = "pubmed-abstract";
  if (rec.pmc) {
    const full = await fetchPmcFullText(rec.pmc, apiKey, email);
    if (full) {
      src = full;
      label = `PMC full text (${rec.pmc}) — summarized from the complete article body`;
      tag = "pmc-fulltext";
    }
  }
  const summary = await summarizeSource(llm, item, src, label, plugin.settings.summaryLanguage);
  const model = plugin.settings.llmModel;
  // Frontmatter first: processFrontMatter rewrites the file from its own copy, so a body
  // written before it is silently dropped.
  await plugin.app.fileManager.processFrontMatter(file, (fm) => {
    fm.summary_source = tag;
    fm.summary_model = model;
  });
  const content = await plugin.app.vault.read(file);
  await plugin.app.vault.modify(file, replaceSummaryBlock(content, summaryBlock(summary)));
  return tag;
}

const sourceName = (tag: string) => (tag === "pmc-fulltext" ? "full text" : "abstract");

/** Redo the summary on the active reference note — the batch command skips notes that already
 *  have one, so a poor summary is otherwise stuck until someone hand-edits the frontmatter. */
export async function resummarizeActive(plugin: ScholarRagPlugin): Promise<void> {
  const r = plugin.activeRef();
  if (!r) return;
  const item = plugin.library.getItem(String(r.fm.citekey));
  if (!item) {
    new Notice("Reference not found in the library");
    return;
  }
  const notice = new Notice("Re-summarizing…", 0);
  try {
    const tag = await rewriteSummary(plugin, new LLMClient(plugin.settings), r.file, item);
    if (!tag) new Notice("Nothing to summarize (needs a PMID or an `abstract` field)");
    else new Notice(`Re-summarized with ${plugin.settings.llmModel} (${sourceName(tag)})`);
  } catch (e) {
    new Notice(`Re-summarize failed: ${e instanceof Error ? e.message : e}`);
  } finally {
    notice.hide();
  }
}

/** Redo every summary that a different (usually older/cheaper) model wrote, or that predates
 *  `summary_model` being recorded at all. Only notes that already have a summary — filling in
 *  missing ones is what "Summarize and tag references (fill gaps)" is for. */
export async function resummarizeOutdated(plugin: ScholarRagPlugin): Promise<void> {
  const model = plugin.settings.llmModel;
  const todo = plugin.library.entries().filter((e) => {
    if (!e.item.summary_source) return false;
    if (e.item.summary_model === model) return false;
    return !!e.item.PMID || typeof e.item.abstract === "string";
  });
  if (!todo.length) {
    new Notice(`Every summary is already from ${model}`);
    return;
  }
  const notice = new Notice(`Re-summarizing ${todo.length} notes…`, 0);
  let done = 0;
  let skipped = 0;
  let failed = 0;
  try {
    // Sequential: one paper's full text per LLM call is already a big request, and a stalled
    // batch is easier to reason about than a stalled pool.
    const llm = new LLMClient(plugin.settings);
    for (const e of todo) {
      try {
        if (await rewriteSummary(plugin, llm, e.file, e.item)) done++;
        else skipped++;
      } catch (err) {
        failed++;
        console.error("[RAG Obsidian] re-summarize failed", e.citekey, err);
      }
      notice.setMessage(`Re-summarizing ${done + skipped + failed}/${todo.length}…`);
    }
  } finally {
    notice.hide();
  }
  new Notice(
    `Re-summarized ${done} with ${model}` +
      (skipped ? ` · skipped ${skipped} (no source text)` : "") +
      (failed ? ` · failed ${failed} (see console)` : "")
  );
}
