import { Notice, TFile } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { CSLItem, SummarySections } from "../types";
import { fetchPubmedRecord, fetchPmcFullText, buildTags, MIN_TAGS, PMC_FAILED_LABEL } from "../ingest/pubmedSearch";
import { summarizeSource, suggestMeshTerms } from "../ingest/summarize";
import { summaryBlock } from "../data/reference";
import { replaceSummaryBlock, extractSummaryBlock } from "../cite/bibliography";
import { BackfillScope, inScope } from "../data/library";
import { LLMClient } from "../llm/client";
import { mapPool, poolWidth } from "../util/pool";
import { startBatch } from "../ui/progress";

/** Does the note have a summary heading (`## Summary`, legacy `## Summary (EN)` / `## 요약 (KR)`)?
 *  Read from the metadata cache, so no file is opened. `undefined` (cache not ready) counts as yes:
 *  a note is never re-summarized on a guess. */
export function hasSummaryHeading(headings: { heading: string; level: number }[] | undefined): boolean {
  return !headings || headings.some((h) => h.level === 2 && /^(Summary(\s*\([^)]*\))?|요약 \(KR\))$/.test(h.heading.trim()));
}

/** Write the AI summary and MeSH tags into references that were added without them —
 *  the LLM key missing at the time, the paper not yet MeSH-indexed, or the summary toggle off.
 *  Notes that already have both are skipped, so it is safe to re-run. Scoped to the whole
 *  library by default; pass a `BackfillScope` to narrow it to one note, a folder, or a tag. */
export async function backfillSummaries(
  plugin: ScholarRagPlugin,
  scope: BackfillScope = { kind: "all" }
): Promise<void> {
  // summary_source is written before the summary text (see writeOne), so a crash in between leaves
  // a note marked summarized with no summary: a missing heading counts as a missing summary.
  const needsSummary = (e: { file: TFile; item: CSLItem }) =>
    !e.item.summary_source || !hasSummaryHeading(plugin.app.metadataCache.getFileCache(e.file)?.headings);
  const todo = plugin.library
    .entries()
    .filter((e) => inScope(e, scope))
    // Also picks up notes that only got author keywords: MeSH is what the graph view clusters on.
    .filter((e) => {
      // Nothing to work from: no PubMed record to read and no abstract to summarize. Selecting
      // these would re-run the same lookups on every invocation and change nothing.
      const source = !!e.item.PMID || typeof e.item.abstract === "string";
      if (!source) return false;
      if (needsSummary(e)) return true;
      const n = Array.isArray(e.item.tags) ? e.item.tags.length : e.item.tags ? 1 : 0;
      // Short on tags, but only if the LLM has already been asked and came up short.
      return n < MIN_TAGS && !e.item.mesh_backfilled;
    });
  if (!todo.length) {
    new Notice(
      scope.kind === "all"
        ? "Every reference already has a summary and tags"
        : "Nothing in scope needs a summary or tags"
    );
    return;
  }
  const apiKey = plugin.settings.pubmedApiKey;
  const email = plugin.settings.openalexMailto;
  const llm = new LLMClient(plugin.settings);
  const batch = startBatch(plugin, "Filling gaps", todo.length);
  if (!batch) return;
  let fetched = 0;
  let summarized = 0;
  let tagged = 0;
  let failed = 0;
  let edited = 0; // summary skipped: the note was summarized or edited while the model worked
  let outcome = "Filling gaps failed (see console)";
  interface Prepared {
    entry: (typeof todo)[number];
    summary: SummarySections | null;
    sourceTag: string;
    tags: string[];
    meshTried: boolean;
    /** The note's summary block when the work began; a different one at write time means the user
     *  (or MCP) saved a summary meanwhile, and the model's must not replace it. */
    summaryBefore: string | null;
    /** summary_source was already set but the text is missing (interrupted write): the provenance
     *  is no sign of a summary saved meanwhile, the text is. */
    healing: boolean;
    error: unknown;
  }
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (r: Prepared): Prepared => {
    chain = chain.then(() => writeOne(r));
    return r;
  };
  const writeOne = async (r: Prepared): Promise<void> => {
    if (r.error) {
      console.error("[Refwright] backfill failed", r.entry.citekey, r.error);
      return;
    }
    if (!r.summary && !r.tags.length && !r.meshTried) return;
    let wroteProvenance = false;
    let skipSummary = false;
    let prev: { source: unknown; model: unknown } = { source: undefined, model: undefined };
    const takeBackProvenance = () =>
      // summary_source says "summarized": put back what it was (nothing, or the old tag of a note
      // whose text was missing) so the next run retries this note.
      wroteProvenance
        ? plugin.app.fileManager.processFrontMatter(r.entry.file, (fm: Record<string, unknown>) => {
            if (prev.source === undefined) delete fm.summary_source;
            else fm.summary_source = prev.source;
            if (prev.model === undefined) delete fm.summary_model;
            else fm.summary_model = prev.model;
          }).catch(() => undefined)
        : Promise.resolve();
    try {
      // Frontmatter first: processFrontMatter rewrites the file from its own copy, so a body
      // appended before it is silently dropped.
      await plugin.app.fileManager.processFrontMatter(r.entry.file, (fm: Record<string, unknown>) => {
        if (r.summary && r.sourceTag) {
          // Checked against the note as it is now, in this same write: a summary saved while the
          // model worked has set summary_source already.
          if (fm.summary_source && !r.healing) skipSummary = true;
          else {
            prev = { source: fm.summary_source, model: fm.summary_model };
            fm.summary_source = r.sourceTag;
            fm.summary_model = plugin.settings.llmModel;
            wroteProvenance = true;
          }
        }
        if (r.tags.length) {
          // Merge into the tags as they are now: r.tags is a snapshot from batch start, and the
          // user may have edited tags during the (long) network phase.
          const cur: unknown = fm.tags;
          const now = Array.isArray(cur) ? cur.map(String) : typeof cur === "string" && cur ? [cur] : [];
          fm.tags = [...new Set([...now, ...r.tags])];
        }
        // Only for a note that asked and still came up short. Writing it on a note that
        // reached MIN_TAGS would add a non-CSL key — and a modify event, which re-chunks the
        // note for the search index — for nothing.
        if (r.meshTried) fm.mesh_backfilled = true;
      });
      if (r.tags.length) tagged++;
      if (r.summary && skipSummary) edited++;
      else if (r.summary) {
        const block = summaryBlock(r.summary);
        let changed = false;
        try {
          await plugin.app.vault.process(r.entry.file, (c) => {
            if (extractSummaryBlock(c) !== r.summaryBefore) {
              changed = true;
              return c;
            }
            return replaceSummaryBlock(c, block);
          });
        } catch (err) {
          await takeBackProvenance();
          throw err;
        }
        if (changed) {
          await takeBackProvenance();
          edited++;
        } else summarized++;
      }
    } catch (err) {
      failed++;
      console.error("[Refwright] backfill write failed", r.entry.citekey, err);
    }
  };
  try {
    // Network + LLM in parallel; each result is written the moment it is ready, one write at a
    // time (the chain), so cancelling or closing Obsidian keeps everything finished so far.
    await mapPool(todo, poolWidth(plugin.settings), async (e) => {
      try {
        const pmid = e.item.PMID ? String(e.item.PMID) : "";
        const noteAbstract = (typeof e.item.abstract === "string" && e.item.abstract) || "";
        const noteMesh = (Array.isArray(e.item.mesh_terms) ? e.item.mesh_terms.map(String) : [])
          .filter(Boolean);
        const nTags = Array.isArray(e.item.tags) ? e.item.tags.length : e.item.tags ? 1 : 0;
        // One efetch gives the abstract, the MeSH headings and the PMC id — so skip it when the
        // note already stores everything this run would read from it. A note still missing its
        // PMCID keeps the lookup: the summary below wants the PMC full text.
        const needRecord =
          !!pmid &&
          (!noteAbstract ||
            (nTags < MIN_TAGS && !noteMesh.length) ||
            (needsSummary(e) && !e.item.PMCID));
        const rec = needRecord
          ? await fetchPubmedRecord(pmid, apiKey, email)
          : { abstract: "", descriptors: [], keywords: [], pmc: "" };
        const abstract = noteAbstract || rec.abstract || "";
        const pmc = (typeof e.item.PMCID === "string" && e.item.PMCID) || rec.pmc;

        let summary: SummarySections | null = null;
        let sourceTag = "";
        let summaryBefore: string | null = null;
        const healing = !!e.item.summary_source;
        if (needsSummary(e) && abstract) {
          summaryBefore = extractSummaryBlock(await plugin.app.vault.cachedRead(e.file));
          let src = abstract;
          let label = "PubMed abstract (not open access — full text not retrieved)";
          sourceTag = "pubmed-abstract";
          if (pmc) {
            try {
              const full = await fetchPmcFullText(pmc, apiKey, email);
              if (full) {
                src = full;
                label = `PMC full text (${pmc}) — summarized from the complete article body`;
                sourceTag = "pmc-fulltext";
              }
            } catch (err) {
              label = PMC_FAILED_LABEL; // NCBI failed us: not the same thing as "not open access"
              console.warn("[Refwright] PMC full text failed", pmc, err);
            }
          }
          summary = await summarizeSource(llm, e.item, src, label, plugin.settings.summaryLanguage);
        }

        // Real MeSH first, topped up from the summary when PubMed has fewer than MIN_TAGS.
        // A hand-edited `tags: ube` reads back as a string; spreading that yields ["u","b","e"].
        const raw = e.item.tags;
        const existing = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? [raw] : [];
        let tags: string[] = [];
        let meshTried = false;
        if (existing.length < MIN_TAGS) {
          const opts = { descriptors: rec.descriptors, keywords: rec.keywords, apiKey, email };
          const merged = [...existing];
          const add = (list: string[]) => {
            for (const t of list) if (!merged.includes(t)) merged.push(t);
          };
          // The note's own mesh_terms stand in for a fresh model reply when it has them.
          const stored = noteMesh.length ? noteMesh.join("\n") : undefined;
          add(await buildTags({ ...opts, meshFromSummary: summary?.mesh || stored }));
          // Still short? A note summarized earlier kept no MeSH line — the summary body never
          // stored one — so ask for headings alone rather than re-summarizing the paper.
          if (merged.length < MIN_TAGS && abstract) {
            try {
              const mesh = await suggestMeshTerms(llm, e.item, abstract);
              add(await buildTags({ ...opts, meshFromSummary: mesh }));
              // Only a reply that actually arrived counts as "asked". A failure here must not
              // exclude the note forever — an expired key would otherwise mark the whole
              // library on one run, with no way back except hand-editing YAML.
              meshTried = merged.length < MIN_TAGS;
            } catch (err) {
              // Never lose a summary that already cost a full paper's worth of tokens.
              console.warn("[Refwright] MeSH suggestion failed", e.citekey, err);
            }
          }
          if (merged.length > existing.length) tags = merged;
        }
        return enqueue({ entry: e, summary, sourceTag, tags, meshTried, summaryBefore, healing, error: null });
      } catch (err) {
        failed++;
        return enqueue({ entry: e, summary: null, sourceTag: "", tags: [], meshTried: false, summaryBefore: null, healing: false, error: err });
      } finally {
        batch.tick(++fetched, failed);
      }
    }, batch.signal);

    // Every write was queued as its result landed; wait for the last one.
    await chain;
    const skipped = todo.length - fetched;
    outcome =
      `Summaries added: ${summarized} · tags added: ${tagged}` +
      (edited ? ` · kept ${edited} summaries saved meanwhile` : "") +
      (failed ? ` · failed: ${failed} (see console)` : "") +
      (skipped ? ` · cancelled, ${skipped} not started` : "");
  } finally {
    batch.finish(outcome);
  }
  new Notice(outcome);
}
