import { Notice } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { SummarySections } from "../types";
import { fetchPubmedRecord, fetchPmcFullText, buildTags, MIN_TAGS } from "../ingest/pubmedSearch";
import { summarizeSource, suggestMeshTerms } from "../ingest/summarize";
import { summaryBlock } from "../data/reference";
import { LLMClient } from "../llm/client";
import { mapPool, POOL_WIDTH } from "../util/pool";
import { startBatch } from "../ui/progress";

/** Write the AI summary and MeSH tags into references that were added without them —
 *  the LLM key missing at the time, the paper not yet MeSH-indexed, or the summary toggle off.
 *  Notes that already have both are skipped, so it is safe to re-run. */
export async function backfillSummaries(plugin: ScholarRagPlugin): Promise<void> {
  const todo = plugin.library
    .entries()
    // Also picks up notes that only got author keywords: MeSH is what the graph view clusters on.
    .filter((e) => {
      // Nothing to work from: no PubMed record to read and no abstract to summarize. Selecting
      // these would re-run the same lookups on every invocation and change nothing.
      const source = !!e.item.PMID || typeof e.item.abstract === "string";
      if (!source) return false;
      if (!e.item.summary_source) return true;
      const n = Array.isArray(e.item.tags) ? e.item.tags.length : e.item.tags ? 1 : 0;
      // Short on tags, but only if the LLM has already been asked and came up short.
      return n < MIN_TAGS && !e.item.mesh_backfilled;
    });
  if (!todo.length) {
    new Notice("Every reference already has a summary and tags");
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
  let outcome = "Filling gaps failed (see console)";
  try {
    // Network + LLM in parallel; the vault writes below stay sequential.
    const prepared = await mapPool(todo, POOL_WIDTH, async (e) => {
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
            (!e.item.summary_source && !e.item.PMCID));
        const rec = needRecord
          ? await fetchPubmedRecord(pmid, apiKey, email)
          : { abstract: "", descriptors: [], keywords: [], pmc: "" };
        const abstract = noteAbstract || rec.abstract || "";
        const pmc = (typeof e.item.PMCID === "string" && e.item.PMCID) || rec.pmc;

        let summary: SummarySections | null = null;
        let sourceTag = "";
        if (!e.item.summary_source && abstract) {
          let src = abstract;
          let label = "PubMed abstract (not open access — full text not retrieved)";
          sourceTag = "pubmed-abstract";
          if (pmc) {
            const full = await fetchPmcFullText(pmc, apiKey, email);
            if (full) {
              src = full;
              label = `PMC full text (${pmc}) — summarized from the complete article body`;
              sourceTag = "pmc-fulltext";
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
              console.warn("[RAG Obsidian] MeSH suggestion failed", e.citekey, err);
            }
          }
          if (merged.length > existing.length) tags = merged;
        }
        return { entry: e, summary, sourceTag, tags, meshTried, error: null as unknown };
      } catch (err) {
        failed++;
        return { entry: e, summary: null, sourceTag: "", tags: [] as string[], meshTried: false, error: err };
      } finally {
        batch.tick(++fetched, failed);
      }
    }, batch.signal);

    for (const r of prepared) {
      // Empty slot: the batch was cancelled before this one started.
      if (!r) continue;
      if (r.error) {
        console.error("[RAG Obsidian] backfill failed", r.entry.citekey, r.error);
        continue;
      }
      if (!r.summary && !r.tags.length && !r.meshTried) continue;
      // Frontmatter first: processFrontMatter rewrites the file from its own copy, so a body
      // appended before it is silently dropped.
      await plugin.app.fileManager.processFrontMatter(r.entry.file, (fm) => {
        if (r.summary && r.sourceTag) {
          fm.summary_source = r.sourceTag;
          fm.summary_model = plugin.settings.llmModel;
        }
        if (r.tags.length) fm.tags = r.tags;
        // Only for a note that asked and still came up short. Writing it on a note that
        // reached MIN_TAGS would add a non-CSL key — and a modify event, which re-chunks the
        // note for the search index — for nothing.
        if (r.meshTried) fm.mesh_backfilled = true;
      });
      if (r.tags.length) tagged++;
      if (r.summary) {
        const body = await plugin.app.vault.read(r.entry.file);
        await plugin.app.vault.modify(
          r.entry.file,
          `${body.replace(/\s*$/, "")}\n\n${summaryBlock(r.summary).join("\n")}\n`
        );
        summarized++;
      }
    }
    const skipped = todo.length - fetched;
    outcome =
      `Summaries added: ${summarized} · tags added: ${tagged}` +
      (failed ? ` · failed: ${failed} (see console)` : "") +
      (skipped ? ` · cancelled, ${skipped} not started` : "");
  } finally {
    batch.finish(outcome);
  }
  new Notice(outcome);
}
