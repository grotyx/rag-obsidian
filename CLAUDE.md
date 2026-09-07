# Academic Paper Citation Manager — Project Rules (orchestrator)

> Display name: **Academic Paper Citation Manager** · plugin id stays `rag-obsidian`
> (no "Obsidian" in the name — the community-plugin guidelines forbid it; the id may keep it,
> as 445 listed plugins do, and changing the id would orphan settings + keychain entries)
> (folder / `data.json` / `community-plugins.json` key unchanged).

**Version**: 0.4.12 · **Status**: Phase 0–5 + ontology + PubMed/LLM-summary/MeSH + CSL citations + import/export + library utilities + review/security pass (71 integration checks green)
**Docs**: [README](README.md) (user) · [PLAN](PLAN.md) (design/roadmap) · [CHANGELOG](CHANGELOG.md)

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
| Architecture | Pure Obsidian plugin (TypeScript), local-first, no companion server |
| Bib source of truth | One markdown note per reference, CSL-JSON field names in YAML frontmatter |
| Domain | General academic; ontology is an **optional** pluggable pack |
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
```

## Module map (`src/`)

| File | Responsibility |
|---|---|
| `types.ts` | `ScholarRagSettings`, `DEFAULT_SETTINGS`, CSL-JSON types, enums |
| `settings.ts` | Settings tab UI (Library / Retrieval / Chat / Citation graph / Writing / Ontology) |
| `data/reference.ts` | citekey generation, CSL-JSON → markdown note builder |
| `data/library.ts` | CRUD over `References/`, `getItem`/`getFile` (by frontmatter citekey, **not** filename), `entries()` single-pass scan (`list()` delegates), `findDuplicate` (add-time) + `matchKeys`/`duplicateGroups` (report, groups on any shared identifier) |
| `ingest/metadata.ts` | `detectId` + Crossref / PubMed / arXiv fetchers → CSLItem |
| `ingest/ncbi.ts` | the one queue every E-utilities request waits in (3/s, 10/s with a key) |
| `ingest/pdf.ts` | pdfjs (CDN runtime load, injectable) text extraction + `findIdentifier` |
| `ingest/pdfImport.ts` | PDF → text → metadata (id-fetch or LLM) → dedup → note + stash text |
| `ingest/pubmedSearch.ts` | esearch/esummary + one `fetchPubmedRecord` efetch (abstract + MeSH + keywords + PMC id), PMC full text, `buildTags` (MeSH-first, tops up to `MIN_TAGS`, verifies suggestions against the MeSH database) |
| `ingest/summarize.ts` | EN sections + KR summary + MeSH terms from an LLM (`maxTokens` 8192) |
| `ingest/unpaywall.ts` | `findOpenAccess` — scans every `oa_locations` entry for a PDF; requires a contact e-mail |
| `ingest/retraction.ts` | `checkRetraction` via OpenAlex `is_retracted` (+ "RETRACTED:" title guard) |
| `ingest/import.ts` | BibTeX / RIS / `.nbib` / CSL-JSON parsing → CSLItem[] |
| `index/embedding.ts` | `EmbeddingProvider` interface + factory |
| `util/pool.ts` | `mapPool` bounded concurrency + `POOL_WIDTH` (15, sized for the LLM wait) — the network/LLM half of a batch; vault writes stay sequential |
| `index/providers/{ollama,openai,transformers}.ts` | embedding backends |
| `index/chunker.ts` | contextual-prefix chunking, frontmatter helpers, `chunkHash` (reindex change detector) |
| `index/store.ts` | Orama hybrid index wrapper + JSON persist/restore |
| `index/manager.ts` | build / incremental reindex / search / persist orchestration (all mutations serialized; unchanged notes skip re-embedding) |
| `graph/openalex.ts` | OpenAlex client (`resolveWork`, `fetchTitles`) |
| `graph/citations.ts` | citation graph build + `referencesInLibrary`/`citedByInLibrary`/`coupled`/`missingFrequent` |
| `llm/client.ts` | provider-agnostic chat (Anthropic / OpenAI / Ollama) via `requestUrl`, with 429/5xx backoff |
| `chat/rag.ts` | retrieve → number sources → [n] grounded answer → resolve citations |
| `cite/csl.ts` | citeproc-js rendering: bundled styles + CSL-repo fetch/cache, per-note `csl:` override |
| `cite/format.ts` | CSL-JSON → APA / Vancouver / Plain (lightweight fallback; `cite/csl.ts` is primary) |
| `cite/bibliography.ts` | citation grammar shared by every renderer: `extractCitekeys`, `citePattern`/`keysInCite`, `replaceCitations` (skips code), `resolveCluster` (all keys or none), `splitAtReferences`, `buildBibliography`, `inTextLabel` |
| `cite/export.ts` | library → BibTeX / RIS / CSL-JSON |
| `cite/suggest.ts` | `@`-autocomplete EditorSuggest → inserts `[@citekey]` |
| `ontology/pack.ts` | `Ontology`: alias linking + IS_A ancestors/descendants/expand |
| `ontology/sample.ts` | built-in tiny spine pack |
| `ontology/manager.ts` | load pack (user JSON or sample) + tag active note |
| `ui/{LibraryView,SearchView,ChatView,RelatedView}.ts` | sidebar panes |
| `ui/{AddReferenceModal,ImportPdfModal,ImportModal,PubmedSearchModal,TagRenameModal}.ts` | modals |
| `main.ts` | plugin lifecycle, views, commands, ribbons, events, bibliography + citation rendering |

## Commands (dev)

```bash
npm install            # deps
npm run dev            # esbuild watch → main.js (use while testing in a vault; Cmd-R to reload Obsidian)
npm run build          # tsc -noEmit + esbuild production
npm run typecheck      # tsc only
npm test               # bundles test/integration.ts (obsidian shim) → live integration suite (71 checks)
```

## Testing approach (important)

There is no Obsidian headless runner. `test/integration.ts` bundles the **real source modules**
with `obsidian` aliased to `test/obsidian-shim.ts` (a thin Node stand-in: `requestUrl`→fetch,
`stringifyYaml`/`parseYaml`→js-yaml). It exercises the genuine pipeline against **live** APIs
(Crossref, PubMed, OpenAlex), Orama, a mock LLM HTTP server, and a pdfjs stub. ~90% of the
plugin is validated this way. Run with `npm test`. Extend by adding numbered sections.

**Verified live**: metadata fetch, note build, chunking, Orama hybrid + persist/restore, embedding
provider contract (Ollama 896-dim), LLM client request/parse (mock), citation formatting,
OpenAlex citation graph (real edges + "missing"), pdf text extraction (real 19-page PDF),
bibliography, ontology link/IS_A.

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
a version bump needs `app.commands.executeCommandById("app:reload")`, not just a plugin toggle.

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

## Providers & defaults

- **Embeddings**: OpenAI-compatible `openai/text-embedding-3-small` against OpenRouter (default —
  one key also covers chat) · Ollama `nomic-embed-text` (local, needs `ollama pull` + a server
  started with embeddings) · Transformers.js (experimental, CDN). Dimension auto-discovered from
  the first response.
- **LLM (chat)**: OpenAI-compatible against OpenRouter (default: `deepseek/deepseek-v4-flash-0731`,
  chat `deepseek/deepseek-v4-pro-0813`) · Anthropic · Ollama.
  `chatModel` (optional) overrides `llmModel` for "Chat with library" only. `llmMaxTokens`
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
- Plugin-managed frontmatter (`citekey`, `status`, `added`, `tags`, `concepts`, `pdf`,
  `summary_source`, `oa_url`, `oa_pdf`, `oa_version`, `retracted`, `cited_by_count`,
  `openalex_id`) shares the note with CSL-JSON fields and is stripped in `cite/csl.ts`
  (`PLUGIN_FIELDS`) — CSL defines `status`, so leaving it in printed "Unread." in every entry.
  `oa_url` is the record a human opens; `oa_pdf` is what the download command fetches.
- secretStorage vs sync: `data.json` (keys blanked) syncs, the OS keychain doesn't. A device
  without `secretStorage` keeps its key in `data.json`; a non-empty key found there is adopted
  as newer on load, but every save re-blanks it, so mixed setups must re-enter keys per device.

## Roadmap / next (see PLAN.md)

1. **Ontology-aware retrieval** (Tier 3: IS_A query expansion in `index/manager.search`).
2. Mobile QA; community-store submission (BRAT beta first).
3. Large-library index engine (sqlite-vec) — Orama index is in-memory.

Done: citeproc-js full CSL (v0.3.0) · cross-identifier dedup on add · secretStorage for API keys (v0.4.0).

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
