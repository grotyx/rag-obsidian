import { App, FuzzySuggestModal, Notice, TFile } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { CSLItem } from "../types";
import { fetchPubmedRecord, fetchPmcFullText } from "../ingest/pubmedSearch";
import { summarizeSource } from "../ingest/summarize";
import { summaryBlock } from "../data/reference";
import { replaceSummaryBlock } from "../cite/bibliography";
import { LLMClient } from "../llm/client";
import { stashedText } from "../ingest/pdfStash";
import { startBatch } from "../ui/progress";
import { confirmModal } from "../ui/ConfirmModal";

/** Re-summarize one note in place. Source preference: the note's own stashed PDF text, else PMC
 *  full text when the PubMed record has one, else the abstract; then swap the existing summary
 *  block for the new one. Returns the `summary_source` tag, or null when there is nothing to summarize. */
async function rewriteSummary(
  plugin: ScholarRagPlugin,
  llm: LLMClient,
  file: TFile,
  item: CSLItem
): Promise<string | null> {
  const apiKey = plugin.settings.pubmedApiKey;
  const email = plugin.settings.openalexMailto;
  const stash = stashedText(await plugin.app.vault.read(file));
  let src: string;
  let label: string;
  let tag: string;
  if (stash) {
    src = stash;
    label = "PDF full text (extracted) — summarized from the complete article body";
    tag = "pdf-fulltext";
  } else {
    const pmid = item.PMID ? String(item.PMID) : "";
    const rec = pmid
      ? await fetchPubmedRecord(pmid, apiKey, email)
      : { abstract: "", descriptors: [], keywords: [], pmc: "" };
    const abstract = (typeof item.abstract === "string" && item.abstract) || rec.abstract || "";
    if (!abstract) return null;
    src = abstract;
    label = "PubMed abstract (not open access — full text not retrieved)";
    tag = "pubmed-abstract";
    if (rec.pmc) {
      const full = await fetchPmcFullText(rec.pmc, apiKey, email);
      if (full) {
        src = full;
        label = `PMC full text (${rec.pmc}) — summarized from the complete article body`;
        tag = "pmc-fulltext";
      }
    }
  }
  const summary = await summarizeSource(llm, item, src, label, plugin.settings.summaryLanguage);
  const model = plugin.settings.llmModel;
  // Frontmatter first: processFrontMatter rewrites the file from its own copy, so a body
  // written before it is silently dropped.
  await plugin.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
    fm.summary_source = tag;
    fm.summary_model = model;
  });
  await plugin.app.vault.process(file, (c) => replaceSummaryBlock(c, summaryBlock(summary)));
  return tag;
}

const sourceName = (tag: string) => (tag === "pmc-fulltext" || tag === "pdf-fulltext" ? "full text" : "abstract");

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
    if (!tag) new Notice("Nothing to summarize (needs a PMID, an `abstract` field or extracted PDF text)");
    else new Notice(`Re-summarized with ${plugin.settings.llmModel} (${sourceName(tag)})`);
  } catch (e) {
    new Notice(`Re-summarize failed: ${e instanceof Error ? e.message : e}`);
  } finally {
    notice.hide();
  }
}

/** Can "Re-summarize references made by an older model" redo this note? Only abstract- or
 *  PMC-based summaries (`pubmed-abstract` / `pmc-fulltext`) by a model other than the current one —
 *  never `pdf-fulltext` or `stored-abstract`, which redoing from the abstract would make worse.
 *  Which of those models to redo is the user's pick (`resummarizeOutdated`): `summary_model` is free
 *  text from MCP clients and CLI runs, so the plugin cannot tell its own summaries from theirs. */
export function isStaleSummary(item: object, model: string): boolean {
  const source = (item as { summary_source?: unknown }).summary_source;
  if (source !== "pubmed-abstract" && source !== "pmc-fulltext") return false;
  return summaryModelOf(item) !== model.trim();
}

/** `summary_model` as recorded, "" when missing (a summary from before the field existed). */
export function summaryModelOf(item: object): string {
  const m = (item as { summary_model?: unknown }).summary_model;
  return typeof m === "string" ? m.trim() : "";
}

/** Candidates per model, most notes first — the choices the picker offers. */
export function staleModelGroups<T extends { item: object }>(entries: T[], model: string): { model: string; entries: T[] }[] {
  const by = new Map<string, T[]>();
  for (const e of entries) {
    if (!isStaleSummary(e.item, model)) continue;
    const k = summaryModelOf(e.item);
    (by.get(k) ?? by.set(k, []).get(k)!).push(e);
  }
  return [...by].map(([m, es]) => ({ model: m, entries: es })).sort((a, b) => b.entries.length - a.entries.length);
}

class ModelPick extends FuzzySuggestModal<{ model: string; count: number }> {
  constructor(app: App, private groups: { model: string; count: number }[], private done: (m: string | null) => void) {
    super(app);
    this.setPlaceholder("Redo the summaries written by which model?");
  }
  getItems() {
    return this.groups;
  }
  getItemText(g: { model: string; count: number }): string {
    return `${g.model || "(no model recorded)"} — ${g.count} notes`;
  }
  onChooseItem(g: { model: string; count: number }): void {
    this.done(g.model);
  }
}

/** Redo every summary that a different (usually older/cheaper) model wrote, or that predates
 *  `summary_model` being recorded at all (see `isStaleSummary`). Only notes that already have a
 *  summary — filling in missing ones is what "Summarize and tag references (fill gaps)" is for. */
export async function resummarizeOutdated(plugin: ScholarRagPlugin): Promise<void> {
  const model = plugin.settings.llmModel;
  const usable = plugin.library.entries().filter((e) => !!e.item.PMID || typeof e.item.abstract === "string");
  const groups = staleModelGroups(usable, model);
  if (!groups.length) {
    new Notice(`No abstract-based summary from another model to redo (current: ${model})`);
    return;
  }
  // Nothing is preselected: the user names the one model whose summaries to replace.
  const picked = await new Promise<string | null>((resolve) => {
    const m = new ModelPick(plugin.app, groups.map((g) => ({ model: g.model, count: g.entries.length })), resolve);
    m.onClose = () => window.setTimeout(() => resolve(null), 0);
    m.open();
  });
  if (picked === null) return;
  const todo = groups.find((g) => g.model === picked)?.entries ?? [];
  if (!todo.length) return;
  const ok = await confirmModal(
    plugin.app,
    "Re-summarize references",
    `${todo.length} summaries written by ${picked || "an unrecorded model"} will be rewritten with ${model}. This uses the LLM once per note and replaces the existing summary text.`,
    "Re-summarize"
  );
  if (!ok) return;
  const batch = startBatch(plugin, "Re-summarizing", todo.length);
  if (!batch) return;
  let done = 0;
  let skipped = 0;
  let failed = 0;
  let outcome = "Re-summarize failed (see console)";
  try {
    // Sequential: one paper's full text per LLM call is already a big request, and a stalled
    // batch is easier to reason about than a stalled pool.
    const llm = new LLMClient(plugin.settings);
    for (const e of todo) {
      if (batch.signal.aborted) break;
      try {
        if (await rewriteSummary(plugin, llm, e.file, e.item)) done++;
        else skipped++;
      } catch (err) {
        failed++;
        console.error("[Refwright] re-summarize failed", e.citekey, err);
      }
      batch.tick(done + skipped + failed, failed);
    }
    const notStarted = todo.length - done - skipped - failed;
    outcome =
      `Re-summarized ${done} with ${model}` +
      (skipped ? ` · skipped ${skipped} (no source text)` : "") +
      (failed ? ` · failed ${failed} (see console)` : "") +
      (notStarted ? ` · cancelled, ${notStarted} not started` : "");
  } finally {
    batch.finish(outcome);
  }
  new Notice(outcome);
}
