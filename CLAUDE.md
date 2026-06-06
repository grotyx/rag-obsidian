# Academic Paper Obsidian Citation Manager — Project Rules (orchestrator)

> Display name: **Academic Paper Obsidian Citation Manager** · plugin id stays `rag-obsidian`
> (folder / `data.json` / `community-plugins.json` key unchanged).

**Version**: 0.3.0 · **Status**: Phase 0–5 + ontology + PubMed/LLM-summary/MeSH + CSL citations + import/export + library utilities (40 integration checks green)
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
| `data/library.ts` | CRUD over `References/`, `getItem`, `list` (via metadataCache) |
| `ingest/metadata.ts` | `detectId` + Crossref / PubMed / arXiv fetchers → CSLItem |
| `ingest/pdf.ts` | pdfjs (CDN runtime load, injectable) text extraction + `findIdentifier` |
| `ingest/pdfImport.ts` | PDF → text → metadata (id-fetch or LLM) → note + stash text |
| `index/embedding.ts` | `EmbeddingProvider` interface + factory |
| `index/providers/{ollama,openai,transformers}.ts` | embedding backends |
| `index/chunker.ts` | contextual-prefix chunking, frontmatter helpers |
| `index/store.ts` | Orama hybrid index wrapper + JSON persist/restore |
| `index/manager.ts` | build / incremental reindex / search / persist orchestration |
| `graph/openalex.ts` | OpenAlex client (`resolveWork`, `fetchTitles`) |
| `graph/citations.ts` | citation graph build + `referencesInLibrary`/`citedByInLibrary`/`coupled`/`missingFrequent` |
| `llm/client.ts` | provider-agnostic chat (Anthropic / OpenAI / Ollama) via `requestUrl` |
| `chat/rag.ts` | retrieve → number sources → [n] grounded answer → resolve citations |
| `cite/format.ts` | CSL-JSON → APA / Vancouver / Plain (lightweight; citeproc-js is future) |
| `cite/bibliography.ts` | `extractCitekeys`, `buildBibliography`, `inTextLabel` |
| `cite/suggest.ts` | `@`-autocomplete EditorSuggest → inserts `[@citekey]` |
| `ontology/pack.ts` | `Ontology`: alias linking + IS_A ancestors/descendants/expand |
| `ontology/sample.ts` | built-in tiny spine pack |
| `ontology/manager.ts` | load pack (user JSON or sample) + tag active note |
| `ui/{LibraryView,SearchView,ChatView,RelatedView}.ts` | sidebar panes |
| `ui/{AddReferenceModal,ImportPdfModal}.ts` | modals |
| `main.ts` | plugin lifecycle, views, commands, ribbons, events, bibliography + citation rendering |

## Commands (dev)

```bash
npm install            # deps
npm run dev            # esbuild watch → main.js (use while testing in a vault; Cmd-R to reload Obsidian)
npm run build          # tsc -noEmit + esbuild production
npm run typecheck      # tsc only
npm test               # bundles test/integration.ts (obsidian shim) → live integration suite (40 checks)
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

**Test vault**: a local Obsidian vault with the plugin deployed (see `.env` →
`VAULT_PLUGIN_DIR`, and `npm run deploy`). Open in Obsidian to click-test.

## Conventions

- TypeScript, strict null checks, esbuild single-file bundle (`main.js`, gitignored — ship via release).
- **Pure-logic modules must not import `obsidian`** beyond `requestUrl`/`stringifyYaml`/`parseYaml`/
  `normalizePath` (so they stay testable via the shim). UI/manager modules may use the full API.
- All network calls go through Obsidian `requestUrl` (CORS-safe desktop+mobile), never raw `fetch`.
- Heavy/optional deps (pdfjs, transformers.js) are **loaded from CDN at runtime** via a
  `new Function("u","return import(u)")` trick so they stay out of the bundle.
- Frontmatter uses **CSL-JSON field names verbatim** (`container-title`, `issued.date-parts`, …).
- Embedding index is tagged with `provider:model`; on mismatch it won't restore → user rebuilds.
- API keys currently live in `data.json` (gitignored). **TODO**: migrate to Obsidian `secretStorage`.

## Providers & defaults

- **Embeddings**: Ollama `nomic-embed-text` (default, needs `ollama pull` + server with embeddings) ·
  OpenAI/compatible · Transformers.js (experimental, CDN). Dimension auto-discovered from first response.
- **LLM (chat)**: Anthropic `claude-haiku-4-5-20251001` (default, needs key) · OpenAI · Ollama.

## Known gotchas

- Ollama may run **without embeddings** (`501 … start with --embeddings`); chat still works.
- Node `fetch` to `localhost` can hit IPv6 `::1` while Ollama is IPv4 — use `127.0.0.1` in tests
  (Obsidian's `requestUrl` handles this itself).
- Crossref often omits abstracts; PubMed efetch supplies them.
- Obsidian Properties UI may warn on nested CSL frontmatter (`author`/`issued`) — data is valid.
- Same work added via DOI and PMID → two notes (cross-identifier dedup is a future feature).

## Roadmap / next (see PLAN.md)

1. **citeproc-js full CSL** (10k+ styles) replacing the lightweight `cite/format.ts`.
2. **Ontology-aware retrieval** (Tier 3: IS_A query expansion in `index/manager.search`).
3. **Cross-identifier dedup** on add (match DOI/PMID/title vs existing).
4. **secretStorage** migration for API keys.
5. Mobile QA; community-store submission (BRAT beta first).

## Resuming from another folder

```bash
git clone <repo> rag-obsidian && cd rag-obsidian && npm install
ln -sfn "$(pwd)" "/path/to/Vault/.obsidian/plugins/rag-obsidian"
npm run dev
# Obsidian: enable community plugins, enable RAG Obsidian, Cmd-R after rebuilds
```

## Version bump procedure

Update **all three** on a release: `manifest.json`, `package.json`, `versions.json` (+ a
CHANGELOG.md entry + the Version line in this file and README). Then commit `vX.Y.Z: summary`.

## Git

- Branch `main`, solo dev, direct push.
- Never commit: `node_modules/`, `main.js`, `data.json`, `_test*`, `_testvault/`, `.obsidian/` (all gitignored).
- Commit subjects: `feat:`/`fix:`/`docs:`/`chore:` or `vX.Y.Z: summary` for releases.
