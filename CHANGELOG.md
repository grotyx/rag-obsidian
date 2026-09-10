# Changelog

All notable changes to Academic Paper Citation Manager (plugin id `rag-obsidian`).
Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versions follow SemVer.

## [Unreleased]

## [0.5.2] — 2026-09-10

### Added

- **Claude Code and Codex can now complete reference summaries without using Obsidian's LLM.**
  `get_reference_source` returns PMC open-access full text when available and otherwise an abstract;
  `save_reference_summary` writes the external model's structured summary with source/model
  provenance while preserving Notes and Highlights.
- `add_reference` now returns the next MCP action, and the server instructions teach clients the
  default `add_reference` → `get_reference_source` → external generation →
  `save_reference_summary` workflow.

### Safety

- Summary writes require the source read's current SHA-256 and stop with `CONTENT_CHANGED` instead
  of overwriting a note edited during generation. The plugin performs no LLM request in this flow.

## [0.5.1] — 2026-09-10

### Fixed

- **MCP now starts on Windows Obsidian.** Electron's renderer cannot resolve dynamic imports such
  as `import("node:crypto")`, which stopped startup before `mcp-bridge.cjs` could be generated and
  left Claude Code with `CONNECTION_CLOSED`. Desktop Node built-ins are now loaded synchronously
  with a lazy `require()` only after the existing desktop guard. Mobile paths remain untouched.

## [0.5.0] — 2026-09-10

### Added

- **Claude Code and Codex can use the live Obsidian vault through MCP.** Enable it in
  Settings → External AI (MCP), then copy the generated Claude Code command or Codex config.
  A standalone stdio bridge connects to the running desktop plugin over an authenticated
  `127.0.0.1` port; there is no remote service or persistent companion daemon.
- **Sixteen focused MCP tools** cover library/index status, hybrid evidence search, index rebuild,
  reference/tag browsing, PubMed search, explicit-identifier reference import, paged Markdown
  reads, create/update/exact-replace/move/trash, and cited manuscript compilation.
- **Safe external note management.** Paths are vault-relative Markdown only, the Obsidian config
  folder and traversal are blocked, symlinks are checked by real path, creates never overwrite,
  writes are serialized, and edits/moves/trash require the latest whole-note SHA-256. Trash uses
  Obsidian's recoverable trash behavior.
- **MCP contract and security checks** exercise the generated bridge as a child process, actual
  loopback HTTP authentication, discovery-file permissions and cleanup, request limits, JSON-RPC
  request correlation, path/symlink containment, mutation conflicts, every tool family, and
  source-preserving manuscript compilation.
- Complete English and Korean setup, workflow, security, and troubleshooting guides in
  `docs/MCP.md` and `docs/MCP.ko.md`.

### Changed

- Manuscript rendering is now shared pure logic used by both the existing Obsidian command and
  MCP. MCP compilation writes a separate output note and requires its current hash before replacing
  an existing output; the source manuscript is never changed.
- Production builds keep Node built-ins external for the desktop-only MCP transport. The rest of
  the plugin remains mobile-capable and the MCP controls explain their desktop requirement.

### Privacy

- The MCP path does **not** call Chat with library, paper-summary LLMs, or the LLM reranker. Claude
  Code or Codex owns all reasoning and prose. Library search and index rebuild may use only the
  embedding provider already configured in Obsidian.
- A new random 256-bit token is created per server start. Discovery and bridge files use owner-only
  permissions where supported; stopping/unloading removes discovery state and closes the port.

## [0.4.19] — 2026-09-09

### Changed

- **Summaries, MeSH suggestions and PDF metadata extraction skip the thinking pass too.** Same
  reasoning as the chat answer: each has its source text in front of it and a fixed output shape,
  so on OpenRouter they now send `reasoning: {enabled: false}`. Honest measurement: unlike the
  reranker (4,223 thinking tokens, 50s → 8s), these paths barely reasoned to begin with (~145
  tokens), so the saving is small — a real re-summarize takes ~20s either way and still returns
  full EN sections plus the Korean block.

## [0.4.18] — 2026-09-09

### Added

- **A per-reference cap on retrieval.** One paper whose PDF full text is stashed in the note splits
  into dozens of chunks and used to take every slot: on a real question, 20 retrieved passages came
  from only 10 papers, half of them from two. Retrieval now over-fetches and keeps at most three
  chunks per reference, topping the list back up from what it skipped when few papers match — so a
  question only three papers can answer still gets its full top-k. Same question, after: 20 passages
  across 13 papers.

- **Chat answers no longer wait on the model thinking first.** On OpenRouter, "Chat with library"
  and the reranker both send `reasoning: {enabled: false}`: the sources are already retrieved and
  ranked, so the answer is a reading-and-citing job that thinking tokens were only slowing down.
  Sent to OpenRouter only — a plain OpenAI endpoint rejects the unknown field.

- **Optional LLM reranking of chat results** (`Settings → Rerank chat results with the LLM`, off by
  default). With it on, chat retrieves twice as many passages and has the model order them by how
  well they answer the question before the answer is written — one extra request per question. A
  reranker that fails, times out, or replies with something unparseable falls back to the retrieval
  order, so an answer is never blocked on it.

### Changed

- **Retrieval returns 20 chunks, not 8.** Eight passages is thin for a real question against a
  library of any size — an answer would lean on two or three papers when a dozen had something to
  say. New installs default to 20 (`Settings → Results (top-k)`, still 3–30); an existing vault
  keeps whatever it already had.

## [0.4.17] — 2026-09-09

### Added

- **"Build citation graph" is a command.** It used to exist only as a button inside the Related
  pane, which you had to open first to find it. It is now in the palette next to "Show related
  papers"; the button stays and runs the same job.

### Fixed

- **The citation graph keeps itself current.** It was built once, by hand, from the Related pane's
  button — every reference added afterwards was invisible to it until you remembered to press that
  button again, which is what made the pane look broken on a growing library. A note added to a
  built graph now joins it on its own (one OpenAlex request for the new paper; the papers already
  citing it need no re-fetch), and a deleted or renamed-away note is pruned. Views subscribed via
  `CitationGraph.onChange` redraw when that happens, so the Related pane fills in behind you
  instead of showing "this note isn't in the citation graph yet". A graph that was never built
  stays empty and silent — no background traffic for a feature you haven't used.

- **The chat can build the search index itself.** With no index, the chat pane told you to go to
  the search pane and click "Rebuild index" — a dead end at the moment you asked your first
  question. The notice now carries the button.

## [0.4.16] — 2026-09-08

### Added

- **Citations land inside the sentence.** Suggest-citations / unsupported-claims insert `[@key]` before the terminal full stop and after a space (`stays [@key].`), merging into an existing cluster when the cursor sits on one.

- **The search pane's filters reach the chat.** The year-range / author / tag-chip row is now a
  shared component (`src/ui/FilterRow.ts`) and sits in the chat pane too, between the log and the
  input: whatever is set there scopes the retrieval behind the next answer. A scoped answer labels
  its source list with what it was narrowed to (`Sources (2022–2025 · tag: endoscopy · author: kim)`),
  an unscoped one still just says `Sources`, and a question that filters everything away says so
  and suggests loosening the filters. The label is kept with the persisted turn, so a replayed
  conversation still shows the scope each answer was given under; the filter row itself is
  pane-local and starts empty, and "Clear" resets it.
- **Evidence for the paragraph you are writing.** Two editor commands. **Suggest citations for
  selection** hybrid-searches the selected text (or the paragraph under the cursor), lists the
  best-matching references with title · year · score and the matching chunk, and inserts
  `[@citekey]` at the cursor — merging into the cluster the cursor sits right behind, so
  `[@a]` becomes `[@a; @b]`. **Find unsupported claims** walks the paragraphs above
  `## References`, flags the ones that assert something (≥ 8 words, ends in a full stop, not a
  question, not signposting or a figure pointer) and cite nothing, and offers a one-click
  *Suggest* per paragraph that inserts the citation at that paragraph's end.
- **Index the PDFs you already have.** A note whose `pdf:` links a file in the vault (an OA
  download, or a link you made by hand) contributed nothing to search beyond its abstract. Two
  commands now fix that: **Index linked PDFs** walks the library, extracts the text of every
  linked PDF that has no `## Full text (extracted)` section yet, and stashes it in the note so the
  incremental reindex embeds it (progress + ✕ cancel in the status bar); **Index this note's PDF**
  does the one in the active pane. **Download open-access PDF** now stashes the text of the file it
  just saved, so a downloaded paper is searchable without a second command — if pdfjs cannot load
  (mobile webview, CDN blocked) the download still succeeds and says the text was not indexed.
  The stash marker, the ~200k-character cap and the `pdf:` link parsing live in one place
  (`src/ingest/pdfStash.ts`), which PDF import now writes through too — so its stash grew from
  20k to the same 200k cap.

### Fixed

- **Annotated bibliography reads the new `## Summary` heading** (0.4.14 changed the heading; the export still only matched `## Summary (EN)`).
- **A whole-paragraph selection cites at the right place.** A triple-click selection carries its
  trailing newline, so "Suggest citations for selection" put the `[@key]` at the start of the
  *next* line; the insertion point is now the paragraph's own end.
- **Suggest citations offers more than one reference.** Only the top-K chunks were retrieved
  before being collapsed to one row per reference, so a paper indexed with its full text could
  own the whole list; retrieval now asks for five times top-K.
- **"Index linked PDFs" and "Extract PDF highlights" find the same file.** Both now share one
  resolver: the `pdf:` link first, then `PDFs/<citekey>.pdf`. A link with a page anchor
  (`[[paper.pdf#page=3]]`) resolves too, instead of counting as "no PDF".
- **A citation can no longer land in the wrong note.** If you open another note while the
  evidence search is running, the suggestion says so instead of inserting into the note you
  switched to.
- **Cancelling "Index linked PDFs" reports honestly.** The notes the cancel stopped are counted
  as `· N cancelled` rather than as "skipped (no PDF / already indexed)".
- **Cluster merge is stricter and punctuation-aware.** Citing next to `[@a].` now yields
  `[@a; @b].` instead of `[@a] [@b].`, and a bracket that merely contains an `@` (an e-mail
  address, say) is left alone: a cluster is only merged into when every key in it is a citekey
  in your library.
- **Callouts, tables and comments are not claims.** `%%…%%` and `<!-- … -->` blocks, `>` quote
  lines and `|` table rows are no longer offered by "Find unsupported claims" or picked up as
  the paragraph under the cursor.

### Changed

- Internal: the extracted-text cap and the "no extractable text" check live once in
  `src/ingest/pdf.ts`/`src/ingest/pdfStash.ts` instead of at each call site; "Index linked PDFs"
  writes each note as its text lands (a crash mid-batch keeps what is done); `RagAnswer` no
  longer echoes the filters back and `FilterRow` lost its unused `onChange` argument.

## [0.4.15] — 2026-09-08

> Requires Obsidian 1.7.2 or newer (`Workspace.revealLeaf`); earlier releases claimed 1.5.0.

### Added

- **A drawn citation map in the Related pane.** Above the existing lists, the pane renders the
  active reference's neighbourhood as an SVG force layout: the active paper pinned at the centre,
  the library papers it cites and that cite it as solid nodes (a small arrowhead shows which way
  the citation runs), bibliographically coupled papers on a dashed edge, and the frequently-cited
  works you *don't* have as dashed nodes. Clicking a solid node opens that note; clicking a dashed
  one opens **Add reference** prefilled with the work's OpenAlex id, so a gap in the library is one
  click from being filled. Hovering a node shows the full title. The map caps at the 40
  best-connected nodes so a hub paper stays readable, and says how many were left out; the text
  lists below are unchanged and remain the accessible fallback.

### Changed

- **Review pass on the Phase 3 work.** The citation map draws its local neighbourhood immediately and adds the dashed "missing" nodes when OpenAlex answers (offline, the local map stays and the list heading says so); titles are looked up once per pane refresh instead of one vault scan per node; `missingFrequent` is cached per graph build; rim labels are no longer clipped. `detectId` recognises OpenAlex ids and `openalex.org` URLs (`fetchMetadata` resolves them to a DOI/PMID), so the Add-reference box and the map's dashed nodes share one path. A MeSH term NCBI could not be asked about stays a tag but is no longer written to `mesh_terms`.

- **Citation map nodes render.** `createSvg` adds class tokens one at a time, so the node group's two classes are passed as an array; a space-joined string threw and left the map with edges only (caught in the vault, not by the layout tests).

- **`npm run lint` is a usable gate.** The untyped-JSON `no-unsafe-*` backlog and the six documented exceptions (feature-detected `secretStorage`, the two CDN loaders) are warnings in `eslint.config.mjs`; the run fails only on findings a store review would block on.
- **Unverifiable MeSH terms split on commas.** When NCBI cannot be reached, a comma-separated suggestion is kept as its pieces rather than as one long tag.

- **Mobile guards.** Code-level mobile audit (no device changes behavior on desktop): the
  citation-graph "missing paper" link now falls back to a `Notice` when `window.open` isn't
  available, the pdfjs/Transformers.js CDN loaders raise a clear "…is unavailable" message
  instead of a raw fetch error when the dynamic import is blocked, and the settings tab now
  states whether API keys are in the OS keychain or in `data.json`. See `docs/MOBILE.md` for
  the full feature matrix and a manual iOS QA script.
- **Community-store review pass.** Added `eslint-plugin-obsidianmd` (`npm run lint`) and worked
  through its findings against the [plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines):
  settings-tab headings now use `setHeading()` instead of raw `<h2>`, inline `element.style.*`
  assignments moved to CSS classes, `document.createElement`/`createDocumentFragment` in the
  citation-rendering path switched to the cross-window-safe `createSpan`/`createEl`/`createFragment`
  helpers, stray `console.log` calls became `console.debug`, redundant ribbon/pane "RAG Obsidian"
  self-branding was dropped, and `minAppVersion` was corrected to `1.7.2` (the real floor for
  `Workspace.revealLeaf`, found by the linter's API-version check). See
  `docs/STORE_SUBMISSION.md` for the full checklist, the remaining known exceptions (the CDN
  dynamic-import trick, `secretStorage` feature-detection, and the untyped-JSON `no-unsafe-*`
  backlog), and the submission text.

## [0.4.14] — 2026-09-08

### Added

- **Chat that survives closing the pane.** The chat log is persisted to the plugin folder
  (`chat.json`, last 50 messages) and replayed when the pane reopens — sources and all. The
  model still only sees the last 8 messages, so prompt cost is unchanged. A **Clear** button
  next to Send wipes the log and the file.
- **"Save as note"** on every answer, plus the command **Save latest chat answer as note**
  (`save-chat-answer`). It writes `Chat/<yyyy-mm-dd> <question>.md` holding the question and the
  answer with its `[n]` anchors rewritten to `[@citekey]` clusters — so a chat result is a
  citable draft that **Update bibliography** can finish. Adjacent anchors (`[1][3]`) collapse
  into one `[@a; @c]` cluster; a run holding a number with no source behind it is left exactly
  as written, and anchors inside code are never touched.
- **Scope for "Summarize and tag references (fill gaps)"** — three new ways to run it besides
  the whole library: **"Summarize and tag this reference"** (the active note), and
  **"Summarize and tag references in a folder or tag…"**, which opens a fuzzy picker over the
  folders under the references folder and every distinct tag in the library. The batch command
  itself is unchanged when run with no scope.
- **Year, tag and author filters in the search pane.** Under the query box: a **From**/**To**
  year range, an **Author** box (family name, case-insensitive), and a **Tag** box that
  autocompletes from the tags already in the library and turns each entry into a removable
  chip. Several chips are ANDed — a hit must carry every one of them. The filters live on the
  pane (not in settings), so they reset when Obsidian restarts, and they apply to **"Search
  library"** only; chat retrieval is unfiltered.

- **Summary language setting** — a new "Summary language" dropdown (English / Korean /
  English + Korean / Custom…) controls what language `summarizeSource` writes AI paper
  summaries in. Default `en+ko` keeps the existing English-sections-plus-Korean behaviour;
  `en` or `ko` write structured sections in one language only; a free-text language name (via
  Custom…) asks for the same structured summary in that language instead. The note heading is
  now a single stable `## Summary` regardless of language (previously `## Summary (EN)` /
  `## 요약 (KR)`), so "Re-summarize this reference" and the backfill still find and replace it —
  the matcher also still recognises the old two-heading shape on existing notes.

### Changed

- **Search index schema bumped to 2** — chunks now carry `author` (family names, lowercased) as
  a filterable facet, and `tags` changed from a full-text field to an exact-value one so a
  multi-word tag such as `Spinal Fusion` can be filtered on as a single value. An index built
  by an older version can't answer the new filters, so it is dropped on load exactly like an
  embedding-model change: the pane shows *"Index not built"* until you run **Rebuild search
  index** once. Nothing in the vault changes — only the plugin's own index files.

### Fixed

- **MeSH verification treats an HTTP error as an error.** A 4xx/5xx from the NCBI mesh database used to read as "no such heading" and be cached, so one rate-limit reply could strip tags for the rest of the session.
- **A two-sided year filter no longer throws.** `SearchFilters` sent Orama `{ gte, lte }` on one
  property, which it rejects with `INVALID_FILTER_OPERATION` — nothing exercised both bounds at
  once until the search pane started offering them. It now uses `between`.

## [0.4.13] — 2026-09-08

### Added

- **Cancel and progress for the two batch operations** — "Add selected" in the PubMed search
  modal and "Summarize and tag references (fill gaps)". Both now show live progress in the
  status bar (`Adding 12/50 · 3 failed`) with a ✕ that stops the batch; the command palette's
  **Cancel current batch** does the same for the keyboard. Cancelling lets the papers already
  in flight finish and writes them — the closing notice says how many were written and how many
  were never started. Only one batch runs at a time. Previously a 50-paper add could only be
  stopped by quitting Obsidian.
- **"Re-summarize this reference"** — redoes the summary on the active reference note and
  replaces the existing `## Summary (EN)` / `## 요약 (KR)` block in place (a following
  `## Notes` / `## References` / `# Appendix` survives). Source is the same as the batch
  backfill: PMC full text when the PubMed record has one, else the abstract. Until now a poor
  summary — or one from a cheaper model — could only be redone by hand-editing frontmatter,
  because the batch command skips notes that already have one.
- **"Re-summarize references made by an older model"** — rewrites every note whose summary a
  different model produced. Notes with no source text are skipped; progress is shown as it goes.
- **`summary_model` frontmatter** — the `llmModel` id that wrote the summary, recorded on note
  creation, by the backfill and by both commands above. A note without the key counts as stale,
  so the first run after upgrading picks up everything summarized before 0.4.13.

### Removed

- **`scripts/fetch-refs.cjs` and `scripts/retag.cjs`.** Both predate the in-app commands
  ("Search PubMed" and "Summarize and tag references (fill gaps)") they duplicate.
  `retag.cjs` was worse than redundant: it still branched on `descriptors.length` instead of
  counting what `keywordsToTags` actually yields — the tagging bug fixed in the plugin in
  0.4.9 — so running it would re-introduce four-tag notes. `scripts/to-docx.cjs` and
  `scripts/deploy.cjs` are unaffected; they have no in-app equivalent.
- **The ontology pack.** It never worked as advertised: the toggle that was supposed to enable it
  read nothing, and a pack path that did not resolve fell back silently to an 8-concept spine
  demo, so "Tag note with ontology concepts" tagged papers with a handful of unrelated ids. Real
  MeSH headings on every PubMed reference cover the use case. Gone: `src/ontology/`, the
  `tag-concepts` command, the "Ontology (optional)" settings section, the `ontologyPackPath`
  setting and the `concepts` frontmatter field.

### Changed

- **Notes now keep what a lookup already learned: `PMCID` and `mesh_terms`.** A PubMed note
  stores its PMC id (CSL's own `PMCID` variable — not stripped from citations) and the canonical
  MeSH headings that produced its tags. "Summarize and tag references (fill gaps)" reads both
  instead of re-fetching the PubMed record and re-asking the model for headings it already
  produced; a note that already has an abstract, a `PMCID` and `mesh_terms` makes no network
  call at all for the MeSH step.
- **`main.ts` split into `src/commands/`** (`library`, `writing`, `openaccess`, `backfill`).
  `main.ts` keeps the plugin lifecycle, command wiring and the shared plumbing the modules call.
  Internal only — command ids, names and behaviour are unchanged.

### Fixed
- MeSH verification no longer caches a transient NCBI error (429/offline) as "not a heading"; unverifiable terms are kept verbatim instead of being dropped for the rest of the session.

## [0.4.12] — 2026-09-08

### Fixed

- **Mixed-tier NCBI requests keep the stricter spacing.** The queue timed each turn by that
  turn's own tier, but the wait is measured from the *previous* request — so a call made with an
  API key could fire 110 ms after a keyless one that had counted against the address's 3/s
  budget. The gap is now the larger of the two neighbours.

## [0.4.11] — 2026-09-07

Second review pass. The tag top-up was splitting MeSH headings in half.

### Fixed

- **Inverted MeSH headings are no longer torn apart.** NLM publishes names like
  "Decompression, Surgical" and "Diabetes Mellitus, Type 2" — the comma is part of the heading —
  and the parser split on commas, turning one real heading into two fragments. "Surgical" is
  itself a heading, so nothing looked wrong while the correct term was lost. Headings are read
  one per line, and a line that is not a heading is offered to the MeSH database piece by piece,
  so a model that answers with a comma list still works.
- **Suggested headings are verified, not pattern-matched.** Anything the MeSH database does not
  recognise is dropped instead of kept verbatim, which removes the whole class of "a sentence
  became a tag" bugs — no prose heuristics left to tune.
- **Real headings that begin with a digit survive** ("5-Methylcytosine", "3T3 Cells"); the
  list-marker strip was eating them.
- **A failed MeSH request no longer excludes a note forever.** `mesh_backfilled` was written
  before the call, so an expired key marked every under-tagged note in one run with no way back
  except hand-editing YAML. It is written only when a reply arrived and the note is still short.
- **Notes with nothing to work from** — no PubMed record and no abstract — are skipped instead
  of re-queued on every run.
- **Retry backoff is jittered.** 15 workers that hit the limit together also woke together and
  reproduced the burst; the delay is now spread across a random 0.5–1.5× window.
- MeSH lookups are memoised, so the same handful of headings is not re-resolved for every paper
  in a batch.

### Changed

- Tests: the retry path had no coverage at all (`MAX_ATTEMPTS = 1` left the suite green) and the
  gate test had dropped the stricter keyless tier. Both are covered now — a mock endpoint that
  answers 429 with `Retry-After` and then 200, and an assertion on the 3/s ceiling — along with
  inverted headings, digit-leading headings and list markers. The obsidian shim forwards real
  response headers so the `Retry-After` branch is reachable.

## [0.4.10] — 2026-09-07

Review pass over 0.4.9. Raising the worker pool to 15 exposed everything below.

### Fixed

- **Rate-limited LLM calls are retried instead of dropped.** 15 papers in flight can push a
  provider over its per-minute budget; the client threw on the first 429 and the paper was
  added without its summary. HTTP 408/409/429/5xx now back off (honouring `Retry-After`) and
  retry up to four times.
- **A failed MeSH suggestion no longer throws away the summary** that was just paid for, and
  the note is no longer marked failed for it.
- **A model that answers in prose cannot write a sentence into your tags.** Unmatched terms
  survive canonicalisation verbatim, so "Here are 8 MeSH headings…" became a tag. The heading
  list is parsed at the point tags are built, so every caller is covered.
- **`tags:` written as a bare string** (`tags: ube`) is read as one tag instead of being spread
  into single letters.
- **"Fill gaps" is idempotent again.** A note that cannot reach five tags — no PubMed record, a
  niche topic — was re-selected on every run and re-charged an LLM call plus a round of MeSH
  lookups. The attempt is recorded in `mesh_backfilled` and not repeated.
- **The MeSH-only request asks for 4096 tokens**, not 512: a reasoning model spent the smaller
  budget on thinking and returned empty text, so tags were silently never added.
- **The NCBI queue no longer charges for an idle wait** (it sleeps only the remainder of the
  gap since the last request), and it stopped inferring the rate tier by searching the query
  string for "api_key" — a contact address containing that substring selected the wrong tier.
- **Every NCBI request goes through one queue.** The gate covered `ingest/pubmedSearch.ts` only,
  leaving three call sites in `ingest/metadata.ts` free to blow the same limit; it now lives in
  `ingest/ncbi.ts` and both modules route through it.

### Changed

- Tests: the pool/gate checks compared constants to constants and could not fail. They now
  measure the gate's actual spacing across concurrent callers, assert an idle gate returns at
  once, and check the tag minimum against `MIN_TAGS` rather than a lower literal. Each was
  mutation-checked.

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
