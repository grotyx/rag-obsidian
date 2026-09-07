# Roadmap — from a full read of the code at 0.4.12 (2026-09-08)

What the code looks like today: 6.4k lines of TypeScript, 34 commands, 21 settings, three runtime
dependencies (Orama, citeproc-js, and Obsidian itself). 66 live integration checks. Three code-review
passes and two days of in-vault testing sit behind the 0.4.x line, so the *existing* features are in
good shape. What follows is what is missing, what is fragile, and what should be cut — ordered by how
much it changes the daily experience for a clinician-researcher running PubMed searches through
OpenRouter.

## Phase 1 — things that bite during normal use (do first)

1. **Cancel and progress for batches.** Adding 50 papers or filling gaps over a whole library now runs
   15 papers at a time, which is fast but unstoppable: the only feedback is a transient Notice and
   there is no way to abort short of closing Obsidian. One `AbortController` threaded through
   `mapPool`, a status-bar item showing `12/50 · 3 failed`, and an Escape/Cancel that lets in-flight
   papers finish and skips the rest. Every batch command benefits at once.
2. **Persist what a lookup already learned.** Notes store the PMID but not the PMC id, and the LLM's
   MeSH line from a summary is thrown away after tagging. "Fill gaps" therefore re-fetches the record
   and re-asks the model for headings it already produced. Write `PMCID` and `mesh_terms` at creation;
   the backfill then works offline for most notes and costs nothing on re-run.
3. **Re-summarize one reference, on demand.** The batch commands skip notes that already have a
   summary, so a poor summary (or one made by an older model) cannot be redone without hand-editing
   frontmatter. A per-note command that replaces the summary block and updates `summary_source` —
   and records `summary_model` so a model upgrade can target only the old ones.
4. ~~**Retire the Gemini-era scripts.**~~ Done (see CHANGELOG `[Unreleased]`) — `fetch-refs.cjs` and
   `retag.cjs` removed; `to-docx.cjs` and `deploy.cjs` kept.
5. **Split `main.ts`.** 1,253 lines and every command lives there. Not user-visible, but each of the
   last ten fixes touched it and reviewers keep finding coupling bugs in it (the frontmatter-write
   order, the citation cache). Move commands into `commands/{library,writing,openaccess,backfill}.ts`;
   `main.ts` keeps lifecycle and wiring only.

## Phase 2 — the workflow gaps found while using it

6. **Chat that survives closing the pane.** `ChatView` keeps history in memory only; close the sidebar
   and the conversation is gone. Persist the last N turns per vault and add **"Save answer as note"** —
   the answer with its `[n]` anchors rewritten to `[@citekey]`, so a chat result becomes a citable
   draft paragraph. This is the step from "ask" to "write" that the talk promises.
7. **Summary language as a setting.** The prompt hardcodes an English section summary plus a Korean
   one. Right for this vault, wrong for anyone else who installs from the store. One dropdown
   (`en`, `ko`, `en+ko`, or a free-text language), threaded into `summarizeSource`.
8. **Search filters in the UI.** `SearchFilters` already supports a year range and the deck advertises
   author/year/journal filters, but the search pane exposes little of it. Year range and tag chips
   are cheap; author needs the index to carry `author` as a facet (one schema field, one rebuild).
9. **Scope for "fill gaps".** Whole library or nothing. Add "current note", "selected folder", and
   "notes tagged X" — the same `mapPool` loop over a narrower `entries()` filter.

## Phase 3 — what makes it the thing the talk describes

10. **A visual citation map.** `RelatedView` is a text list; the deck shows a graph. Draw the in-library
    citation edges as an SVG force layout inside the pane (no dependency — ~150 lines), with "missing"
    papers as dashed nodes you can click to add. This is the feature no other Obsidian plugin has, and
    right now you cannot *see* it.
11. **Community-store submission.** Every known blocker is cleared: no "Obsidian" in the name,
    `innerHTML` 0, `var` 0, `console.log` 2, LICENSE, `versions.json`, tagged releases with the three
    assets. Remaining: run the official validator, then the PR to `obsidianmd/obsidian-releases`.
    Do this after Phase 1 so the reviewed version is the one with cancel/progress.
12. **Mobile QA.** `isDesktopOnly: false` is a claim, not a test. pdfjs and Transformers.js load from
    CDN at runtime, `secretStorage` is desktop-only on older builds, and the OA download writes binary.
    One pass on iOS with the citation workflow (no embeddings) is the minimum before the store
    listing says mobile works.

## Phase 4 — scale (only when a library gets there)

13. **Index engine for thousands of notes.** Orama holds everything in memory and re-serialises the
    whole database on each persist. Fine at hundreds; at several thousand notes the rebuild and the
    JSON write become the slow path. The `VectorStore` wrapper already isolates Orama, so a
    `sqlite-vec` backend (desktop only, via the Electron sqlite) can be swapped in without touching
    callers. Not before a real library shows the pain.

## Cut

- **Ontology packs.** The toggle never worked (removed in 0.4.6), the pack path silently fell back to
  an eight-concept demo, and MeSH now gives every PubMed paper five or more authoritative tags. The
  "ontology-aware retrieval" roadmap item was the reason the feature existed; MeSH tags plus the
  hybrid index cover the use case. Remove `src/ontology/`, the command, the two settings, and the
  sample pack — about 400 lines and one less thing to explain in the store listing. If a custom
  vocabulary is ever needed, tags are the extension point.

## Not doing

- A summary-quality benchmark. Tempting, but the prompt is already delimiter-parsed and the failure
  modes seen so far were all plumbing (token budgets, key missing, write order), not prose quality.
- A settings migration framework. One-off migrations (the 1024-token lift) are three lines each;
  a framework for them is more code than the migrations.

## Order and size

| Phase | Items | Rough effort |
|---|---|---|
| 1 | cancel/progress, persist PMCID+MeSH, re-summarize one, delete scripts, split main.ts | 2 days |
| 2 | chat persistence + save-as-note, summary language, search filters, fill-gaps scope | 2–3 days |
| 3 | visual graph, store submission, mobile QA | 3–4 days |
| 4 | sqlite-vec | when needed |
| Cut | ontology | half a day |

Phase 1 first: items 1–3 are what you hit every day, item 4 removes a live footgun, item 5 makes the
rest cheaper. The ontology cut can ride along with item 5 since both touch `main.ts` wiring.
