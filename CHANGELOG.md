# Changelog

All notable changes to Academic Paper Citation Manager (plugin id `rag-obsidian`).
Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions follow SemVer.

## [0.4.9] — 2026-09-07

### Changed

- **Notes get at least five topic tags.** PubMed's MeSH is authoritative but thin on recent
  papers, and blanket headings such as "Humans" are dropped, so a paper could land with three or
  four tags — or with author keywords only. When the tags that would actually be written come to
  fewer than five, the summary's own MeSH suggestions top them up, snapped to official NLM
  headings first (never invented). "Summarize and tag references (fill gaps)" now also picks up
  notes that have too few tags, not only notes with none, and asks for headings alone rather
  than re-summarizing a paper it already summarized.
- **The worker pool is sized for the LLM, not for PubMed.** 15 papers are in flight regardless
  of the PubMed key; NCBI's own ceiling (3 requests/second, 10 with a key) is held by a request
  gate inside the PubMed client, so extra workers queue there instead of drawing HTTP 429s.

## [0.4.8] — 2026-09-07

### Changed

- **Adding papers and filling gaps now run several at a time.** Both walked their list one
  paper at a time, and each paper waits on a PubMed record, sometimes a PMC full text, and a
  summary — so a batch took as long as the sum of its parts. The network and LLM half now runs
  3 at a time, or 6 when a PubMed API key is set (NCBI allows 3 requests/second without one and
  10 with). Measured in a real vault: 14 papers added with summaries and MeSH tags in 119 s,
  about 9 s each.
- Vault writes stay sequential on purpose: `createReference` derives the citekey and filename
  from what is already in the vault, so concurrent creates could pick the same name. Duplicates
  are also checked before and after the parallel phase, since two selected hits can be the same
  work.

## [0.4.7] — 2026-09-07

### Added

- **"Summarize and tag references (fill gaps)"** — writes the AI summary and MeSH tags into
  references that were added without them: the LLM key missing at the time, the summary toggle
  off, or the paper not yet MeSH-indexed. Notes that already have both are skipped, so it is
  safe to re-run. It re-reads each PubMed record once for the abstract, the MeSH headings and
  the PMC id, so open-access papers are summarized from the full text here too. The docs had
  promised this batch backfill since 0.3.0; it never existed outside a terminal script.

### Changed

- **Search PubMed: "Max results" now starts at 20** instead of 8.

## [0.4.6] — 2026-09-07

### Changed

- **A fresh install is configured for OpenRouter.** Both providers now default to
  OpenAI-compatible with the base URL set to `https://openrouter.ai/api/v1`, chat on
  `deepseek/deepseek-v4-flash-0731` (answers on `deepseek/deepseek-v4-pro-0813`) and embeddings
  on `openai/text-embedding-3-small`. One key then covers chat, summaries and embeddings and
  nothing has to be installed locally. Existing vaults keep their own settings.
- The provider, model and base-URL hints in settings now say which id shape belongs to which
  endpoint, since OpenRouter prefixes model ids and OpenAI does not.

### Removed

- **The "Enable ontology" toggle**, which never did anything — no code read it. MeSH tags are
  attached automatically when a paper is added from PubMed; an ontology pack is an optional
  extra applied by its own command, and the settings text says so now. The pack path hint also
  spells out that the `.json` extension is required.

### Fixed

- Korean README: the version badge had been stuck at 0.3.0 since that release — only the
  English badge was being bumped. CLAUDE.md's release procedure now names both.

## [0.4.5] — 2026-09-07

### Fixed

- **"Find duplicates" now catches the case it was written for** — it compared one signature
  per note (DOI, else PMID, else title), so the same paper added once by DOI and once from
  PubMed sat in different groups and the report said "No duplicates found". Notes are
  grouped when they share **any** identifier, transitively, which is the rule add-time dedup
  has always used. The grouping is now a pure function (`duplicateGroups`) with a test.
- **Docs pointed at a citation style that does not exist** — every example used
  `csl: european-spine-journal`, which is not in the CSL repository (404) and not bundled,
  so anyone following the README got "Citation style not found" and a silent fall back to
  the lightweight formatter. The bundled id for European Spine Journal is
  `springer-basic-brackets`.

### Changed

- README (en + ko): the install section leads with **BRAT** and a plain release download,
  so the plugin can be installed without a terminal. Building from source moved down to
  option C.

## [0.4.4] — 2026-09-07

### Changed

- **Renamed to "Academic Paper Citation Manager"** — Obsidian's community-plugin guidelines
  do not allow "Obsidian" in a plugin name (none of the 7 371 listed plugins carry it), and the
  store listing is the next step. The plugin **id stays `rag-obsidian`**, so the settings
  folder, `data.json` and the OS-keychain entries are untouched: existing vaults just see the
  shorter name.

- Docs: CLAUDE.md module map covers the 0.3.x/0.4.x modules (PubMed search, summarize,
  Unpaywall, retraction, import, export) and records the plugin-managed frontmatter, the
  `CONTACT_EMAIL` test variable, and the in-app CDP testing notes. READMEs list the two
  commands the tables had missed (find open-access PDF, tag with ontology concepts) and the
  Korean one gains the contact-e-mail note.

## [0.4.3] — 2026-09-07

Correctness release: three review passes over the 0.4.1/0.4.2 work plus in-vault testing
against a live Obsidian, OpenRouter, PubMed, OpenAlex and Unpaywall. No breaking changes.

### Fixed

- **Paper summaries stopped failing on Anthropic models** — the summarize call asked for
  16 384 output tokens, above the 8 192 ceiling of several Claude models, so the API answered
  400 for every paper. It asks for 8 192 now.
- **The raised token default now reaches existing vaults** — a stored `llmMaxTokens: 1024`
  (the pre-0.4.2 default) shadowed the new one, so upgrading users kept getting empty
  answers from reasoning models. That exact value is lifted once on load.
- **"Download open-access PDF" works on notes saved by older versions** — those keep the PDF
  link in `oa_url`; the command only read the new `oa_pdf`. It falls back, and the `%PDF-`
  check still rejects a landing page.
- **A re-run of "Find open-access PDF" clears a stale link** instead of leaving a dead
  `oa_pdf` behind to 404 on every download.
- **A citation with an unknown key stays visible** — `[@real; @typo]` rendered as if the typo
  were not there. Reading view and "Compile manuscript" now share one rule: a bracket is
  rewritten only when every key resolves.
- **Annotated bibliography no longer drops a reference** that citeproc skipped; the
  lightweight formatter fills the gap per key, not only when the whole style fails.
- **"Copy citation" only strips a leading `1. `**, so an entry whose text genuinely starts
  with a number (a corporate author like "3. Bundesliga …") survives.
- Reading-view rendering scans the library once per block instead of once per citekey, and
  the citation cache is evicted when a note is deleted or renamed.
- **"Check retraction status" is labelled OpenAlex**, which is what it queries — the command
  said Crossref.
- Talk scripts and deck: the citation style follows the note's `csl:` line, not its journal
  name (the container-title→style map was never wired up and has been removed); the command
  count says 33, matching `main.ts`.
- **Open-access lookup works once you set your e-mail, and says so when you have not** — the
  hardcoded `anonymous@example.com` fallback made Unpaywall answer 422 for every request, so
  "Find open-access PDF" always reported "No open-access copy found". It now asks for the
  OpenAlex contact e-mail instead.
- **"Compile manuscript" no longer rewrites citations inside code** — a manuscript that
  documents the `[@citekey]` syntax had its code spans and fenced blocks replaced with
  rendered citations. Reading view already skipped code; compile now shares that rule.
- **Bibliographies no longer print "Unread."** — the whole note frontmatter was handed to
  citeproc, and CSL defines a `status` variable, so every reference note's plugin-managed
  `status: unread` rendered into the entry (bibliography, compiled manuscript, copied
  citation, annotated bibliography). Plugin-managed fields are now stripped at the citeproc
  boundary. Found by running the plugin in a real vault.

## [0.4.2] — 2026-09-07

### Fixed

- `reasoning_effort` is recognised on router-prefixed model ids too (OpenRouter's
  `openai/gpt-5.1`), not only bare `o*` / `gpt-5*`.

### Added

- **Separate chat model** — Settings → *Chat model (optional)*: "Chat with library" can run a
  stronger model than paper summaries and PDF metadata extraction, which keep the default
  model. Empty means "same as default", so nothing changes for existing setups.
- README (en + ko): OpenRouter setup — one key and base URL drive both chat and embeddings.
- Settings: "OpenAlex contact email" is now **"Contact e-mail"** — the same address goes to
  OpenAlex, Unpaywall and PubMed, and open-access lookup does not work without it.
- 52 integration checks (chat-model routing).

### Changed

- **Max answer tokens** default 1024 → 8192, slider range 1024–32768, and the setting now says
  it applies to Anthropic only (OpenAI-compatible and Ollama endpoints use their own default).
  Reasoning models spend the budget on thinking before they emit an answer, so 1024 could
  return an empty reply; paper summaries ask for 16384 for the same reason.
- The integration suite builds its throwaway vault in `_testvault-auto/`, so a hand-made
  `_testvault/` for click-testing survives `npm test` (the suite wipes its vault each run).

## [0.4.1] — 2026-09-06

Code-review release: two review passes (`main.ts`, then all of `src/`) — 30 findings, all
fixed, no breaking changes. The index `meta.json` gains per-note content hashes: run
**"Rebuild search index" once** after upgrading; until then each note re-embeds once on its
first edit (as before) and then settles.

### Fixed (main.ts)

- **"Rebuild search index" command now rebuilds** (it only opened the Search view).
- **Citation syntax is one grammar everywhere** — reading view and "Compile manuscript" now
  use the same Pandoc rules as `extractCitekeys`: `[@a; @b]` renders both keys,
  `[@key, p. 23]` / `[-@key]` / `[see @key]` resolve, `[@key]` inside code spans / fenced
  blocks is left alone, and unknown brackets (e.g. an e-mail) are not turned into spans.
- **Open-access PDF download** refuses non-PDF bodies (a landing page stored in `oa_url` was
  saved as `PDFs/<citekey>.pdf`), and network failures in Unpaywall / Crossref-retraction /
  download show a notice instead of a stuck "Downloading…" toast and an unhandled rejection.
- **"Update bibliography" / "Compile manuscript"** recognise `## References` on the first
  line and without a trailing newline (no more duplicated sections).
- **"Extract PDF highlights"** no longer swallows a following `# H1` section on re-extraction.
- **"Find duplicates"** uses the same DOI/title normalisation as add-time dedup (no more
  false groups for short titles like "Editorial", `doi.org/` prefixes now match).
- **"Enrich metadata"** counts only notes it actually changed and asks PubMed first when the
  gap is the abstract (Crossref rarely has one).
- Generated notes ("Related to …", "Annotated bibliography — …") sanitise citekey-derived
  file names in one place (`writeAndOpen`).
- A key pasted or synced into `data.json` after the secretStorage migration is adopted
  (it was silently discarded in favour of the keychain copy).

### Changed (main.ts)

- **Annotated bibliography** renders the whole list in one citeproc pass (was one engine
  build per reference — seconds of UI freeze on big libraries) and lists entries in the
  style's order; "Copy citation" strips the `1. ` prefix of numeric styles.
- Export / citation-count backfill use the single-pass `Library.entries()` (no per-note
  vault scans).
- Reading-view citation cache is invalidated per note (whole cache only when a reference
  note changes), shares one in-flight render between blocks, and never caches a failed render.

### Fixed (src/)

- **Clicking a search hit / chat source / related-paper row opens the note again** — the
  views built `<folder>/<citekey>.md`, but notes are named `YYYY-Journal-Author-Word.md`
  since 0.3.x; they now resolve through `Library.getFile`.
- **Re-adding a paper deleted earlier in the session** no longer reports "Already in
  library" (session dedup entries are ignored once their note is gone).
- **Index persistence can no longer corrupt itself** — rebuild, debounced reindex and
  delete/rename are serialized, and a burst of edits persists once instead of per note.
- **PDF highlight extraction** honours `quadPoints` (pdfjs ≥ 4 returns a `Float32Array`),
  so multi-line highlights no longer pull in whole lines / the neighbouring column.
- **Retraction check** flags only `is_retracted` or "RETRACTED:" / "Retracted article:"
  titles (a paper *about* retractions is not retracted); DOIs are normalized + encoded.
- **OpenAI summaries** — `reasoning_effort` is only sent to reasoning models
  (`gpt-4o-*` answered 400); **Anthropic summaries** get a 4096-token cap so the KR summary
  and MeSH sections are no longer truncated away.
- **BibTeX / RIS export** tolerates numeric `page:` / `volume:` frontmatter.
- **Import PDF** dedups like every other add path; a PDF of a paper already in the library
  is attached to the existing note (text appended once).
- `detectId` accepts PubMed article URLs; PubMed dates keep the day in both add paths.
- Chat context escapes `</source>` inside retrieved passages (prompt-injection boundary).
- `added:` is the local calendar date, not UTC.

### Changed (src/)

- **Citation-graph build** no longer re-embeds every note: writing `openalex_id` (or any
  other plugin-managed frontmatter) leaves the chunk text unchanged and the indexer skips it
  (content hash stored in `meta.json`). One vault pass instead of `getItem()` per note.
- Embedding provider instance is cached per `provider:model` (Transformers.js kept
  rebuilding its ONNX pipeline on every search).
- PubMed add fetches each record's XML once (abstract + MeSH + keywords) and shares the
  name/date parsers with `metadata.ts`.
- 50 integration checks.

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
