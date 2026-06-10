# Changelog

All notable changes to Academic Paper Obsidian Citation Manager (plugin id `rag-obsidian`).
Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions follow SemVer.

## [0.4.0] — 2026-06-10

Stability & security release: a deep code review pass (bug fixes), key storage migration,
and a security audit with hardening. No breaking changes; the index format gains a
path→citekey map (older indexes load fine).

### Added

- **secretStorage for API keys** — Anthropic / OpenAI / PubMed keys migrate automatically
  into Obsidian's `secretStorage` (OS keychain); `data.json` keeps them blanked. Older
  Obsidian versions fall back to the previous `data.json` behavior.
- **Add-time dedup hardening** — a session registry of normalized DOI / PMID / title
  catches double-adds that the metadata cache is too stale to see (including the same
  paper added once by DOI and once by PMID).
- **PMID confirmation** — typing bare digits into the Add modal now previews the fetched
  title / author / year and asks for a confirm click before creating the note (a pasted
  year like `2024` no longer silently adds an unrelated 1970s paper).
- **Multi-turn chat citations** — assistant turns remember their source order; earlier
  `[n]` anchors are rewritten to `[@citekey]` for the model, so follow-up answers can no
  longer mis-attribute claims to the wrong paper.

### Fixed

- **"Update bibliography" / "Compile manuscript" no longer delete content after the
  `## References` section** (e.g. an `## Appendix`) — only the References section itself
  is replaced.
- **"Rename tag" only touches library notes**, not the entire vault.
- **Index integrity**: an empty-library rebuild no longer poisons the index (which made
  all later indexing silently no-op); switching embedding models then editing a note no
  longer drops that note from the index; deleting a note whose filename differs from its
  citekey no longer leaves stale chunks behind; index writes are atomic (crash-safe) and
  validated on restore; duplicate citekeys can't abort a rebuild halfway.
- **Citation graph**: DOIs are normalized/encoded for OpenAlex (https://doi.org/-prefixed
  and SICI DOIs resolve now); titles with commas no longer 403 the title-search fallback;
  a wrong title match can no longer permanently backfill a bad `openalex_id`; transient
  failures keep the previous graph nodes instead of dropping them; "missing papers"
  counts deduplicate per-paper references (the sample-library count corrects 10 → 9).
- **Metadata**: trailing punctuation stripped from pasted DOIs; PubMed abstracts parsed
  from XML instead of storing the whole formatted citation blob; non-Latin first authors
  get an `anon` citekey fallback instead of colliding bare-year keys.
- **Citations & writing**: `[@key, p. 23]` locators and `[-@key]` parse correctly and
  code blocks are ignored; author-less references format without a leading orphan period;
  `@`-autocomplete no longer doubles brackets after a typed `[`.
- **Ontology**: cyclic packs can't hang `descendants()`; aliases containing punctuation
  ("Diabetes Mellitus, Type 2") now match; invalid pack files surface a Notice instead of
  a silent sample-pack fallback.
- **UI**: Add modal guards against double-submits; library pane only re-renders for
  reference-folder changes (debounced); PubMed key field is masked; progress notices
  always close on errors; export/report commands reliably open the file they create.

### Security

- `window.open` is restricted to http(s) URLs — a poisoned metadata record can no longer
  supply a `javascript:` URL.
- Open-access PDF downloads sanitize the citekey before building the save path and
  require an http(s) source URL.
- Rendered chat answers strip image/embed syntax (no auto-loading external beacons or
  note transclusions from model output); retrieved passages are delimited as quoted data
  with an explicit instruction that they are not instructions.
- CSL style ids from frontmatter are validated (no path traversal into vault reads or the
  styles CDN); PubMed API key is URL-encoded and kept out of thrown error messages.

## [0.3.0] — 2026-06-06

Rounds the tool into a full Zotero / EndNote replacement: journal-accurate citations
(citeproc-js / CSL), library import & export, and ~30 library-management commands.

### Added

- **Journal-style citations (CSL)** — "Update bibliography" renders the `## References`
  list in a real journal style via citeproc-js over the CSL-JSON frontmatter, and
  reading-view `[@citekey]` renders the matching in-text label (numeric `[1]` /
  superscript / author-date), numbered in document order. Bundled offline styles: Spine,
  The Spine Journal, European Spine Journal, AMA, APA + en-US locale; any other CSL style
  id is fetched from the CSL repo and cached. (`cite/csl.ts`)
- **Per-manuscript citation style** — a note's own `csl:` (or `citation-style:`)
  frontmatter overrides the global style, so each paper targets its journal
  (e.g. `csl: european-spine-journal`).
- **Import existing libraries** — "Import references": paste or load a **BibTeX / RIS /
  CSL-JSON** export (Zotero / EndNote / Mendeley) → reference notes, duplicates skipped.
  (`ingest/import.ts`, `ui/ImportModal.ts`)
- **Export** — library → **BibTeX / RIS / CSL-JSON** (`cite/export.ts`).
- **Duplicate detection** — match by DOI / PMID / normalized title on add / import; the
  Add modal opens the existing note instead.
- **Add by title** — free text in the Add modal runs an OpenAlex title search → metadata.
- **Compile manuscript** — a `(compiled)` copy with every `[@citekey]` resolved to its
  styled in-text label + a `## References` list (Pandoc-ready).
- **Library utilities** (~30 commands) — reading status + **reading queue** · live
  **Dataview dashboard** · **find duplicates** · **citation counts** + **retraction check**
  (OpenAlex) · **open-access PDF** download + **PDF highlight extraction** · **open online** ·
  **copy citation** · **suggest related papers** · **annotated bibliography** · **rename
  tags** · **enrich metadata** · **export citation network** (Mermaid).

### Fixed

- `openCitekey` / `getItem` resolve by frontmatter citekey (filenames are decoupled).
- Review pass: decode arbitrary numeric HTML entities; brace-aware BibTeX field parsing
  (deep nesting); `$`-safe highlight insertion; dependent-style cycle guard; non-Latin
  `authorTag` fallback.

## [0.2.0] — 2026-06-06

Renamed to **Academic Paper Obsidian Citation Manager** (display name; plugin id stays
`rag-obsidian`). Adds an in-app PubMed → summary → tagged-note workflow plus CLI tooling.

### Added

- **PubMed keyword search** — ribbon/command "Search PubMed": query → results (with
  open-access badge) → select → add as reference notes. (`ingest/pubmedSearch.ts`,
  `ui/PubmedSearchModal.ts`)
- **LLM paper summaries** — section-wise English (Background/Methods/Results/Conclusions)
  + concise Korean, written into each note. Uses the full text for open-access papers
  (PMC), the abstract otherwise. Runs at `reasoning_effort: high` (Gemini 3.x thinking).
  (`ingest/summarize.ts`)
- **MeSH topic tags for the graph view** — real PubMed MeSH descriptors when indexed;
  otherwise LLM-suggested terms snapped to official NLM MeSH headings (db=mesh); author
  keywords always appended; generic check-tags dropped and spelling variants folded.
- **Readable note filenames** — `YYYY-JournalAbbr-AuthorInitials-TitleWord` (e.g.
  `2022-SpineJ-ParkSM-Biportal.md`), decoupled from the short `[@citekey]`.
- **Tooling** — `scripts/fetch-refs.cjs` (CLI: search→summary→tagged note),
  `scripts/retag.cjs` (re-tag existing notes), `npm run deploy` (build + copy into vault),
  `.env` config.

### Fixed

- OpenAI/Gemini embedding order when the provider omits the `index` field for item 0.
- LLM MeSH fallback now triggers on zero MeSH *descriptors* (not zero terms), so an
  un-indexed paper with only author keywords still gets proper topic tags.

## [0.1.0] — 2026-06-04

First consolidated release. Phases 0–5 + optional ontology, verified by a 40-check
integration harness (live Crossref / PubMed / OpenAlex, Orama, mock LLM, pdfjs).

### Added

- **Bibliography manager (Phase 0)** — add references by DOI / PMID / arXiv (Crossref,
  PubMed E-utilities, arXiv); creates `References/<citekey>.md` notes with CSL-JSON
  frontmatter; unique-citekey collision handling; Library sidebar (browse + filter).
- **Semantic search (Phase 1)** — contextual-prefix chunking; Orama hybrid (BM25 + vector)
  index with JSON persistence and incremental reindex on edit/create/delete; pluggable
  embeddings (Ollama default · OpenAI/compatible · Transformers.js experimental); dimension
  auto-discovery; Search sidebar with rebuild.
- **Citation-grounded chat (Phase 2)** — provider-agnostic LLM client (Anthropic / OpenAI /
  Ollama); retrieval → numbered sources → `[n]`-anchored answer → formatted source list
  (APA / Vancouver / Plain); Chat sidebar.
- **PDF import (Phase 3)** — pdfjs text extraction (loaded from CDN at runtime); embedded
  DOI/arXiv detection → metadata fetch, else LLM metadata extraction; creates a note and
  stashes extracted text for indexing.
- **Citation graph (Phase 4)** — OpenAlex `referenced_works` edges (no LLM); per-note
  references-in-library, cited-by-in-library, bibliographic coupling, and "papers you're
  missing"; back-fills `openalex_id` into frontmatter; Related sidebar.
- **Writing support (Phase 5)** — `@` citekey autocomplete inserting `[@citekey]`;
  "Update bibliography" command rendering a sorted `## References` section; in-text
  `(Author, Year)` rendering in reading view (toggle).
- **Ontology (optional)** — pluggable JSON packs (`{ scheme, concepts:[{id,label,synonyms?,parents?}] }`)
  with alias linking and IS_A ancestor/descendant/expand; built-in spine sample; "Tag note
  with ontology concepts" command. SNOMED not bundled (license) — supply your own export.
- **Test harness** — `npm test` bundles real source against an Obsidian shim and runs a live
  integration suite.

### Notes

- Pure TypeScript plugin; `main.js` is built (esbuild) and shipped via release, not committed.
- API keys stored in `data.json` for now; `secretStorage` migration planned.
- Lightweight citation formatter; full CSL (citeproc-js) planned.

[0.1.0]: #010--2026-06-04
