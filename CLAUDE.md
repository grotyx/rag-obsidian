# Academic Paper Citation Manager — Project Rules (orchestrator)

> Display name: **Academic Paper Citation Manager** · plugin id stays `rag-obsidian`
> (no "Obsidian" in the name — the community-plugin guidelines forbid it; the id may keep it,
> as 445 listed plugins do, and changing the id would orphan settings + keychain entries)
> (folder / `data.json` / `community-plugins.json` key unchanged).

**Version**: 0.5.2 · **Status**: Phase 0–5 + live-vault Claude Code/Codex MCP + external summary workflow (integration and MCP checks green)
**Docs**: [README](README.md) (user) · [MCP](docs/MCP.md) (Claude Code/Codex) · [PLAN](PLAN.md) (design/roadmap) · [CHANGELOG](CHANGELOG.md)

> This file orchestrates the project for any future session. Read it first when resuming.

## What this is

A **standalone, local-first, AI-native bibliography manager for Obsidian** — a Zotero/EndNote
replacement where **markdown (CSL-JSON frontmatter) is the database**, with semantic search,
citation-grounded chat, a citation graph, and PDF import layered on top. Pure TypeScript
Obsidian plugin, no backend, no Zotero dependency, mobile-capable.

Born from a separate `rag_research` project (a Neo4j+Python medical GraphRAG system):
the *concepts* were ported to TS, generalized beyond medicine, and put inside Obsidian. No code
is shared — see PLAN.md §8 for what was ported conceptually.

## Locked decisions (do not silently revert)

| Decision | Choice |
|---|---|
| Architecture | Pure Obsidian plugin (TypeScript), local-first; optional desktop MCP uses an ephemeral authenticated loopback server, never a remote/standalone backend |
| Bib source of truth | One markdown note per reference, CSL-JSON field names in YAML frontmatter |
| Domain | General academic (domain-agnostic core) |
| Goal | Personal tool first, open-source later |

## Architecture / data flow

```
Add by DOI/PMID/arXiv ─┐                         ┌─ LibraryView (browse/filter)
Import PDF ────────────┤→ References/<citekey>.md │─ SearchView (hybrid retrieve)
                       │  (CSL-JSON frontmatter)  │─ ChatView (cited answers)
                       └──────────┬───────────────┘─ RelatedView (citation graph)
                                  ▼
        chunk (contextual prefix [title|section|year])
                                  ▼
        EmbeddingProvider → Orama hybrid index (BM25+vector)  ← persisted to plugin dir
                                  ▼
        retrieve top-K → LLMClient → answer with [n] anchors → citeproc/format → sources
        OpenAlex referenced_works → CitationGraph (related / coupled / "missing")

Claude Code / Codex → generated stdio bridge → authenticated 127.0.0.1 MCP server
                    → library/index/vault/cite engine (no plugin LLM calls)
```

## Module map (`src/`)

| File | Responsibility |
|---|---|
| `types.ts` | `ScholarRagSettings`, `DEFAULT_SETTINGS`, CSL-JSON types, enums |
| `settings.ts` | Settings tab UI (Library / Retrieval / Chat / Citation graph / Writing) |
| `data/reference.ts` | citekey generation, CSL-JSON → markdown note builder |
| `data/library.ts` | CRUD over `References/`, `getItem`/`getFile` (by frontmatter citekey, **not** filename), `entries()` single-pass scan (`list()` delegates), `findDuplicate` (add-time) + `matchKeys`/`duplicateGroups` (report, groups on any shared identifier) + `BackfillScope`/`inScope` (pure filter for fill-gaps scoping) |
| `ingest/metadata.ts` | `detectId` + Crossref / PubMed / arXiv fetchers → CSLItem |
| `ingest/ncbi.ts` | the one queue every E-utilities request waits in (3/s, 10/s with a key) |
| `ingest/pdf.ts` | pdfjs (CDN runtime load, injectable) text extraction + `findIdentifier` |
| `ingest/pdfImport.ts` | PDF → text → metadata (id-fetch or LLM) → dedup → note + stash text |
| `ingest/pdfStash.ts` | the one writer of the `## Full text (extracted)` stash: `hasStashedText` / `appendStash` (idempotent, `STASH_MAX_CHARS` 200k cap + `…[truncated]`, the same cap `extractPdfText` stops at) / `resolvePdfLink` (`pdf:` frontmatter → linkpath, `#anchor`/`|alias` stripped) |
| `ingest/pubmedSearch.ts` | esearch/esummary + one `fetchPubmedRecord` efetch (abstract + MeSH + keywords + PMC id), PMC full text, `buildTags` (MeSH-first, tops up to `MIN_TAGS`, verifies suggestions against the MeSH database) |
| `ingest/summarize.ts` | structured-section summary (+ MeSH terms) from an LLM, language controlled by `summaryLanguage` (`en` / `ko` / `en+ko` default / free text) via `buildSysPrompt`; `maxTokens` 8192 |
| `ingest/unpaywall.ts` | `findOpenAccess` — scans every `oa_locations` entry for a PDF; requires a contact e-mail |
| `ingest/retraction.ts` | `checkRetraction` via OpenAlex `is_retracted` (+ "RETRACTED:" title guard) |
| `ingest/import.ts` | BibTeX / RIS / `.nbib` / CSL-JSON parsing → CSLItem[] |
| `index/embedding.ts` | `EmbeddingProvider` interface + factory |
| `util/pool.ts` | `mapPool` bounded concurrency + `POOL_WIDTH` (15, sized for the LLM wait) — the network/LLM half of a batch; vault writes stay sequential. Takes an optional `AbortSignal`: cancelling lets in-flight items finish, starts no new ones, and still resolves (unstarted slots come back empty) |
| `index/providers/{ollama,openai,transformers}.ts` | embedding backends |
| `index/chunker.ts` | contextual-prefix chunking, frontmatter helpers (`yearFromIssued`, `authorNames`), `chunkHash` (reindex change detector) |
| `index/store.ts` | Orama hybrid index wrapper + JSON persist/restore + `SearchFilters` (year range, tag AND, author) over the `tags`/`author` `enum[]` facets + `describeFilters` (one-line label, `""` = unfiltered); `INDEX_SCHEMA` is the rebuild marker |
| `index/manager.ts` | build / incremental reindex / search / persist orchestration (all mutations serialized; unchanged notes skip re-embedding); `search` over-fetches ×3 and thins via `capPerReference` |
| `index/rerank.ts` | retrieval quality, no Obsidian imports: `capPerReference` (≤3 chunks per reference, tops back up from the spill so k is still returned), `rerankHits`/`buildRerankUser`/`parseRerankOrder` (optional LLM reranker behind `llmRerank`; any failure falls back to retrieval order) |
| `graph/openalex.ts` | OpenAlex client (`resolveWork`, `fetchTitles`) |
| `graph/citations.ts` | citation graph build + `referencesInLibrary`/`citedByInLibrary`/`coupled`/`missingFrequent` + `refIds` (raw cited ids, for the map's dashed nodes) + incremental upkeep: `enqueue` (debounced, one OpenAlex lookup per newly added note, no-op until the graph has been built once), `prune` (drops nodes whose note is gone), `onChange` (views redraw when either fires) |
| `graph/layout.ts` | `layoutGraph` — deterministic force-directed layout (circle seeding, no RNG) + `topByDegree` node cap; pure math behind the Related pane's SVG map |
| `llm/client.ts` | provider-agnostic chat (Anthropic / OpenAI / Ollama) via `requestUrl`, with 429/5xx backoff; `noReasoning` sends OpenRouter's `reasoning:{enabled:false}` (that host only — a plain OpenAI endpoint 400s on the unknown field) |
| `chat/rag.ts` | retrieve (under optional `SearchFilters`) → number sources → [n] grounded answer → resolve citations |
| `cite/csl.ts` | citeproc-js rendering: bundled styles + CSL-repo fetch/cache, per-note `csl:` override |
| `cite/format.ts` | CSL-JSON → APA / Vancouver / Plain (lightweight fallback; `cite/csl.ts` is primary) |
| `cite/bibliography.ts` | citation grammar shared by every renderer: `extractCitekeys`, `citePattern`/`keysInCite`, `replaceCitations` (skips code), `resolveCluster` (all keys or none), `anchorsToCitekeys` (chat `[n]` → `[@key]` clusters), `splitAtReferences`, `buildBibliography`, `inTextLabel` |
| `cite/export.ts` | library → BibTeX / RIS / CSL-JSON |
| `cite/suggest.ts` | `@`-autocomplete EditorSuggest → inserts `[@citekey]` |
| `commands/library.ts` | dashboard, duplicates, reading queue, status, citation-count backfill, enrich, rename tag, export, citation network, suggest related |
| `write/evidence.ts` | `paragraphsOf` (prose paragraphs above `## References`, with offsets + `cited`; headings/fences/frontmatter/comments/callouts/tables skipped), `looksLikeClaim` heuristic, `unsupportedClaims`, `rankHits` (chunk hits → one row per citekey), `citationInsertion`/`citationEdit` (where a new `[@key]` goes: inside the sentence, merged into a known cluster) |
| `commands/writing.ts` | update bibliography, compile manuscript, copy citation, annotated bibliography, suggest citations for selection, find unsupported claims |
| `commands/openaccess.ts` | Unpaywall lookup, OA PDF download (+ stashes the saved PDF's text), retraction check, PDF highlight extraction |
| `commands/pdfs.ts` | `indexLinkedPdfs` / `indexLinkedPdfActive` — extract + stash the text of linked PDFs that have none (pool width 2: pdfjs is CPU-bound in the renderer; writes sequential, one note written as its text lands) + `findPdfFile`, the one resolver (`pdf:` link → `PDFs/<citekey>.pdf`) shared with `commands/openaccess.ts` |
| `commands/backfill.ts` | `backfillSummaries` — summaries + MeSH tags for notes added without them, scoped via `BackfillScope`/`inScope` (`src/data/library.ts`) to all, one note, a folder, or a tag |
| `commands/summaries.ts` | re-summarize one note, or every note whose `summary_model` is not the current one |
| `mcp/protocol.ts` | minimal JSON-RPC/MCP initialize, tools/list and tools/call contract |
| `mcp/bridge.ts` | source generator for the standalone Node stdio bridge written beside `main.js` |
| `mcp/http.ts` | desktop-only authenticated loopback lifecycle, discovery file, setup snippets, realpath containment |
| `mcp/vault.ts` | Markdown-only vault CRUD, pagination, hash-based concurrency checks, serialized writes |
| `mcp/service.ts` | library/PubMed/search/writing tool schemas and dispatch, including external source-read/summary-save; deliberately bypasses chat/summary/rerank LLM paths |
| `write/manuscript.ts` | pure citation compilation shared by the Obsidian command and MCP output-copy tool |
| `ui/{LibraryView,SearchView}.ts` | sidebar panes |
| `ui/FilterRow.ts` | the year-range / author / tag-chip filter row shared by `SearchView` and `ChatView` (`new FilterRow(host, plugin)` → `.filters(): SearchFilters`, `.clear()`); state is pane-local and never persisted |
| `ui/RelatedView.ts` | citation-graph pane: SVG map (`graph/layout.ts`, ≤40 nodes; dashed node → `AddReferenceModal` prefilled with the OpenAlex id) above the unchanged text lists |
| `ui/ChatView.ts` | chat pane — a `FilterRow` between log and input scopes the next answer (its `describeFilters` label rides along on the persisted turn and heads the source list), history persisted to `<pluginDir>/chat.json` (last 50 messages; the model still sees the last 8), Clear chat, and "Save as note" per answer → `Chat/<date> <question>.md` |
| `ui/progress.ts` | `startBatch`/`cancelBatch` — status-bar progress with a ✕ for the two batch commands, one batch at a time, hands out the `AbortSignal` |
| `ui/CiteSuggestModal.ts` | `CiteSuggestModal` (pick a retrieved reference → insert `[@citekey]`) + `UnsupportedClaimsModal` (uncited claim paragraphs, one **Suggest** button each) |
| `ui/{AddReferenceModal,ImportPdfModal,ImportModal,PubmedSearchModal,TagRenameModal,BackfillScopeModal}.ts` | modals |
| `main.ts` | plugin lifecycle, views, `addCommand` wiring, ribbons, events, citation rendering + shared plumbing (`writeAndOpen`, `activeRef`, `styleForNote`) |

## Commands (dev)

```bash
npm install            # deps
npm run dev            # esbuild watch → main.js (use while testing in a vault; Cmd-R to reload Obsidian)
npm run build          # tsc -noEmit + esbuild production
npm run typecheck      # tsc only
npm run lint            # eslint-plugin-obsidianmd over main.ts + src/ (community-store review checks)
npm run test:mcp       # MCP protocol/bridge/HTTP/service/vault security contract checks
npm test               # MCP checks + live integration suite (188 checks)
```

## Testing approach (important)

There is no Obsidian headless runner. `test/integration.ts` bundles the **real source modules**
with `obsidian` aliased to `test/obsidian-shim.ts` (a thin Node stand-in: `requestUrl`→fetch,
`stringifyYaml`/`parseYaml`→js-yaml). It exercises the genuine pipeline against **live** APIs
(Crossref, PubMed, OpenAlex), Orama, a mock LLM HTTP server, and a pdfjs stub. ~90% of the
plugin is validated this way. Run with `npm test`. Extend by adding numbered sections.

`test/mcp.ts` also launches the generated bridge as a real child process against the actual
loopback server. It covers JSON-RPC correlation, authentication, discovery-file permissions and
cleanup, request limits, traversal/symlink containment, edit hashes, serialized writes, tool
contracts, PubMed add/source/summary semantics, hash-conflict protection, and source-preserving
manuscript compilation.

**Verified live**: metadata fetch, note build, chunking, Orama hybrid + persist/restore, embedding
provider contract (Ollama 896-dim), LLM client request/parse (mock), citation formatting,
OpenAlex citation graph (real edges + "missing"), pdf text extraction (real 19-page PDF),
bibliography.

**Needs in-vault (runtime-CDN, can't node-test)**: pdfjs loaded from CDN in the plugin (the
*algorithm* is verified against the local build), Transformers.js embeddings from CDN.

**In-app testing without clicking**: launch with `open -a Obsidian --args --remote-debugging-port=9222`,
then drive the renderer over CDP (`http://127.0.0.1:9222/json/list` → `Runtime.evaluate`) — e.g.
`app.commands.executeCommandById("rag-obsidian:update-bibliography")`,
`app.plugins.plugins["rag-obsidian"].library.entries()`. This reaches the CDN-loaded paths and the
real Obsidian API; the vault's plugin folder must hold copies of `main.js`/`manifest.json`/`styles.css`
(a symlink to the repo makes Obsidian hang on "loading plugins"). A minimized window stops
rendering (`document.visibilityState === "hidden"`, so reading-view checks return nothing) —
restore it from the same console with
`require("@electron/remote").getCurrentWindow().restore()`. Obsidian caches `manifest.json`, so
a version bump needs `app.commands.executeCommandById("app:reload")`, not just a plugin toggle — and a
`disablePlugin`/`enablePlugin` toggle has been seen to keep the *previous* `main.js`, so after copying a
new build, `app:reload` before trusting any in-app check.

**Environment**: `EMBED_MODEL` picks the Ollama model for the embedding section (default
`qwen2.5:0.5b`; without a local Ollama it falls back to a deterministic embedder and still
passes). `CONTACT_EMAIL` enables the live Unpaywall check — skipped when unset, so no personal
address lives in the repo.

**Test vault**: `_testvault/` is the hand-made click-test vault (plugin symlinked into
`.obsidian/plugins/`); `npm test` builds its own throwaway `_testvault-auto/` and wipes it each
run. A vault elsewhere works too (see `.env` → `VAULT_PLUGIN_DIR`, and `npm run deploy`).

## Conventions

- TypeScript, strict null checks, esbuild single-file bundle (`main.js`, gitignored — ship via release).
- **Pure-logic modules must not import `obsidian`** beyond `requestUrl`/`stringifyYaml`/`parseYaml`/
  `normalizePath` (so they stay testable via the shim). UI/manager modules may use the full API.
- All network calls go through Obsidian `requestUrl` (CORS-safe desktop+mobile), never raw `fetch`.
- Heavy/optional deps (pdfjs, transformers.js) are **loaded from CDN at runtime** via a
  `new Function("u","return import(u)")` trick so they stay out of the bundle.
- Frontmatter uses **CSL-JSON field names verbatim** (`container-title`, `issued.date-parts`, …).
- Embedding index is tagged with `provider:model`; on mismatch it won't restore → user rebuilds.
- API keys live in Obsidian `secretStorage` (synced from in-memory settings on save; `data.json`
  stores them blanked). On apps without `secretStorage` they fall back to `data.json` as before.
- **Mobile guard rule**: no `require`/`fs`/`path`/`electron`/`Buffer`/`process.*`/raw `fetch`
  in shared/mobile paths (see Testing above — `requestUrl` and the vault adapter cover every
  network/file need on mobile). The sole exception is `src/mcp/{bridge,http}.ts`, dynamically
  reached only behind `Platform.isDesktopApp`; MCP is hidden on mobile. A desktop-only API with no small mobile-safe equivalent (e.g. `window.open`,
  `navigator.clipboard`) gets a fallback to a `Notice` showing the raw value, not a `Platform.isMobile`
  block that hides the feature — see `main.ts`'s `safeOpenExternal` and `src/commands/writing.ts`'s
  `copyCitation`. The CDN-loaded pdfjs/Transformers.js stay as-is (locked decision), but their
  loaders rethrow a clear "…is unavailable: …" error on a blocked/failed dynamic import instead of
  a raw fetch error. See `docs/MOBILE.md`.

## Providers & defaults

- **Embeddings**: OpenAI-compatible `openai/text-embedding-3-small` against OpenRouter (default —
  one key also covers chat) · Ollama `nomic-embed-text` (local, needs `ollama pull` + a server
  started with embeddings) · Transformers.js (experimental, CDN). Dimension auto-discovered from
  the first response.
- **LLM (chat)**: OpenAI-compatible against OpenRouter (default: `deepseek/deepseek-v4-flash-0731`,
  chat `deepseek/deepseek-v4-pro-0813`) · Anthropic · Ollama.
  `chatModel` (optional) overrides `llmModel` for "Chat with library" only. The chat answer, the reranker,
  summaries, MeSH suggestions and PDF metadata extraction all pass `noReasoning`, so on OpenRouter they send `reasoning:{enabled:false}` — both
  read already-ranked sources, and a hybrid-reasoning model otherwise spends ~4k thinking tokens
  (50s vs 8s measured on a 40-passage rerank) for no gain. `llmMaxTokens`
  (default 8192) caps the **Anthropic** body only; the OpenAI-compatible and Ollama bodies send
  no cap. Reasoning models bill thinking against that budget — a low cap returns empty content.

## Known gotchas

- Ollama may run **without embeddings** (`501 … start with --embeddings`); chat still works.
- Node `fetch` to `localhost` can hit IPv6 `::1` while Ollama is IPv4 — use `127.0.0.1` in tests
  (Obsidian's `requestUrl` handles this itself).
- Crossref often omits abstracts; PubMed efetch supplies them.
- `openalexMailto` (settings: "Contact e-mail") is one address shared by OpenAlex, Unpaywall and
  PubMed. Unpaywall **requires** it — without one, `findOpenAccess` throws with a message naming
  the setting rather than reporting "no OA copy".
- Obsidian Properties UI may warn on nested CSL frontmatter (`author`/`issued`) — data is valid.
- Cross-identifier dedup on add: session registry + normalized-DOI/PMID/title match in
  `findDuplicate`; bare-digit PMID input requires a confirm click in the Add modal.
- Plugin-managed frontmatter (`citekey`, `status`, `added`, `tags`, `mesh_terms`, `pdf`,
  `summary_source`, `summary_model`, `oa_url`, `oa_pdf`, `oa_version`, `retracted`, `cited_by_count`,
  `openalex_id`) shares the note with CSL-JSON fields and is stripped in `cite/csl.ts`
  (`PLUGIN_FIELDS`) — CSL defines `status`, so leaving it in printed "Unread." in every entry.
  `PMCID` sits beside them but is **not** stripped: it is a real CSL variable, so citeproc may
  legitimately print it. `mesh_terms` stores the canonical headings behind `tags` so the
  fill-gaps command can reuse them instead of re-asking the model.
  `oa_url` is the record a human opens; `oa_pdf` is what the download command fetches.
  `summary_model` records the `llmModel` that wrote the summary — "Re-summarize references made
  by an older model" selects on it, so a note missing the key counts as stale.
- secretStorage vs sync: `data.json` (keys blanked) syncs, the OS keychain doesn't. A device
  without `secretStorage` keeps its key in `data.json`; a non-empty key found there is adopted
  as newer on load, but every save re-blanks it, so mixed setups must re-enter keys per device.

## Roadmap / next

See [ROADMAP.md](ROADMAP.md). Phases 1–3 and 5 are shipped (0.4.13–0.4.19); what remains is the store
submission (`docs/STORE_SUBMISSION.md`), an on-device iOS pass (`docs/MOBILE.md`) and Phase 4 (sqlite-vec,
only when a library outgrows Orama).

Done: citeproc-js full CSL (v0.3.0) · cross-identifier dedup on add · secretStorage for API keys
(v0.4.0) · `main.ts` split into `src/commands/` + the concept-pack feature dropped (MeSH covers it).

## Resuming from another folder

```bash
git clone <repo> rag-obsidian && cd rag-obsidian && npm install
ln -sfn "$(pwd)" "/path/to/Vault/.obsidian/plugins/rag-obsidian"
npm run dev
# Obsidian: enable community plugins, enable RAG Obsidian, Cmd-R after rebuilds
```

## Version bump procedure

Update **all three** on a release: `manifest.json`, `package.json`, `versions.json` (+ a
CHANGELOG.md entry + the Version line in this file and the **version badge in both
`README.md` and `README.ko.md`** — the Korean badge sat at 0.3.0 for four releases because
only the English one was being edited). Then commit `vX.Y.Z: summary`.
The deck (`presentation/build_deck.py`) reads its version from `manifest.json`, but the prose
docs (`lecture_script.md`, `slides_content.md`, `lecture_script_tts.md`) hardcode it — grep `v0.X`
under `presentation/`; the TTS script spells it in Hangul (`영 점 사`), grep `점` there.

## Git

- Branch `main`, solo dev, direct push.
- Never commit: `node_modules/`, `main.js`, `data.json`, `_test*`, `_testvault/`, `.obsidian/` (all gitignored).
- Commit subjects: `feat:`/`fix:`/`docs:`/`chore:` or `vX.Y.Z: summary` for releases.
