# Obsidian RAG Bibliography Manager — Concept & Plan

**Status:** Phase 0–5 + ontology built (verified, 40 integration checks green) · **Date:** 2026-06-04
**Working name:** *RAG Obsidian* (alt: ObsiCite, Athenaeum, Marginalia, Codex)

---

## 0. Locked decisions

| Decision | Choice | Consequence |
|---|---|---|
| Architecture | **Pure Obsidian plugin (TypeScript, local-first)** | No Python reuse. Mobile-capable. Zero-setup install. Weaker graph traversal in JS — solved by citation-edge graph, not LLM entity graph. |
| Bibliographic truth | **Standalone Obsidian-native** (1 markdown note/reference, CSL-JSON in YAML frontmatter) | True Zotero/EndNote replacement. Git-friendly plain text. Metadata fetched by DOI/PMID/arXiv/ISBN. No Zotero dependency. |
| Domain | **General academic (domain-agnostic core)** | Works for any field. Ontology (SNOMED/MeSH) added as an **optional pluggable enrichment pack**, not baked in. |
| Goal | **Personal tool first, open-source later** | Optimize my own workflow now; clean up + BRAT + community store after it works. |

---

## 1. The opportunity (why this is worth building)

The Obsidian ecosystem splits into two worlds that never touch:

- **Bibliography plugins** (Citation 1.3k★ stale, Zotero Integration 1.7k★, ZotLit 948★, BibLib 78★ standalone, PDF++ 2.3k★): citekey/keyword lookup, Zotero sync, PDF annotation. **No AI, no semantic search, mostly Zotero-dependent.**
- **AI/RAG plugins** (Smart Connections 5.1k★, Copilot 7.1k★, Khoj 35k★): chat-with-vault, embeddings, note-level retrieval. **Bibliography-unaware: no author/year/DOI facets, note-level not passage-level citations, no formatted references, no cross-paper synthesis.**

**Nobody bridges them.** The unoccupied intersection:

> semantic + metadata-faceted retrieval → passage-level evidence → properly formatted citations → multi-paper synthesis — all inside Obsidian, markdown as the database.

This is exactly the slice the existing `rag_research` engine already proves works (hybrid search, evidence ranking, 7 citation styles, synthesis) — minus the writing/notes environment Obsidian provides for free, minus the Neo4j/Python weight, generalized beyond spine surgery.

---

## 2. Core principles

1. **Markdown is the database.** Every reference is a plain `.md` note with CSL-JSON frontmatter. Survives the plugin. Git-diffable. The BibLib model, validated.
2. **Local-first, provider-optional.** Default works offline with bundled local embeddings. Power users plug in Ollama or cloud APIs. No vendor lock.
3. **Citation-grounded, always.** Every AI answer cites passages → resolves to formatted in-text citations + a source list. Never "from your vault" hand-waving.
4. **Cheap graph, not expensive graph.** Use the *free, structured* citation graph (OpenAlex referenced_works/citing_works) instead of expensive LLM entity extraction. GraphRAG-lite.
5. **Mobile is a constraint, not an afterthought.** No `child_process`, no native SQLite, no localhost server. Everything degrades gracefully on mobile.

---

## 3. Data model

### Reference note (source of truth)

`References/smith2020deep.md`:

```yaml
---
type: article-journal            # CSL-JSON type
citekey: smith2020deep
title: "Deep residual learning for image recognition"
author:
  - { family: Smith, given: John }
  - { family: Doe, given: Jane }
issued: { date-parts: [[2020, 5]] }
container-title: "Nature"
volume: "521"
page: "436-444"
DOI: "10.1038/nature14539"
PMID: "26017442"
URL: "https://..."
abstract: "..."
keyword: [deep learning, cnn]
# --- plugin-managed ---
tags: [reading/done, project/thesis]
status: read                      # unread | reading | read
pdf: "[[Attachments/PDFs/smith2020deep.pdf]]"
added: 2026-06-04
openalex_id: "W2194775991"        # for citation graph
# --- optional ontology pack ---
concepts: [{ id: "264887000", label: "Lumbar spinal stenosis", scheme: snomed }]
---

## Notes
My own literature note / annotations / highlights here. Wikilinks to other refs:
[[smith2020deep]] builds on [[he2015resnet]].

## Highlights
- p.438 "..." (linked from PDF++)
```

- Frontmatter uses **CSL-JSON field names verbatim** → feeds citeproc-js directly with zero mapping.
- Body is free notes + extracted highlights → also embedded and searchable.

### Vault layout

```
Vault/
├── References/                  # 1 md note per paper  (the bibliography)
│   └── smith2020deep.md
├── Attachments/PDFs/            # original PDFs
├── Notes/                       # your permanent/project notes (wikilink to refs)
├── Manuscripts/                 # drafts you write, with [@citekey] cites
└── .obsidian/plugins/rag-obsidian/
    └── index/                   # gitignored: embeddings, citation graph, caches
        ├── vectors.orama        # hybrid BM25+vector index
        ├── citations.json       # OpenAlex edge graph
        ├── model.json           # which embedding model built the index
        └── ontology/*.json      # optional ontology packs
```

---

## 4. Tech stack (chosen, with rationale)

| Concern | Choice | Why |
|---|---|---|
| Language/build | TypeScript + esbuild (official template) | Standard Obsidian plugin path. |
| Vector + keyword store | **Orama** (`@orama/orama`) | Pure JS, zero-dep, **built-in hybrid BM25+vector** = Tier-0 retrieval out of the box, works on mobile, ~80KB. Abstraction layer lets desktop swap to `sqlite-vec` later for scale. |
| Embeddings (default) | **Transformers.js** + `multilingual-e5-small` (or bge-small-en) | Offline, zero-setup, mobile-OK, multilingual (Korean+English notes). 384-dim. |
| Embeddings (optional) | Ollama (`nomic-embed-text`, `bge-m3`) · OpenAI/Voyage API | Power/quality tiers behind one `EmbeddingProvider` interface. |
| LLM (chat/synthesis/extract) | Provider-agnostic via `requestUrl`: Anthropic (Claude Haiku/Sonnet), OpenAI, Ollama | `requestUrl` bypasses CORS desktop+mobile. Default Claude (continuity with current work). |
| Metadata fetch | Crossref (DOI), PubMed E-utilities (PMID), arXiv, OpenAlex, Google Books (ISBN) | All free, all via `requestUrl`. |
| Citation graph | **OpenAlex API** (`referenced_works`, `cited_by`) | Structured, free, no LLM, more reliable than LLM entity extraction for papers. |
| Citation formatting | **citeproc-js** (`@citation-js/core` + CSL styles) | Any of 10k+ CSL styles for free — beats hand-porting 7 styles, matches domain-agnostic goal. Frontmatter is already CSL-JSON. |
| PDF text | Obsidian's bundled **pdf.js** (`page.getTextContent()`) | No extra bundle. Section/page provenance for grounding. |
| Reranker (optional) | cross-encoder `ms-marco-MiniLM-L-6-v2` via Transformers.js, or LLM rerank | Add only when recall feels weak. |
| Key storage | Obsidian v1.11+ `secretStorage` API | Keys out of synced `data.json`. |

**Secret-storage note:** plaintext keys in `data.json` were the documented failure of every audited plugin — use `app.secretStorage`.

---

## 5. Retrieval architecture (tiered)

Build cheapest-first; each tier is independently useful.

**Tier 0 — Hybrid + metadata facet (MVP).**
Query → Orama hybrid (BM25 + vector) over chunks → filter by frontmatter facets (author, year-range, tag, status, concept) → top-K.
- Chunk = reference abstract + body notes + (optional) PDF full text.
- **Contextual embedding prefix** `[title | section | year]` on each chunk (proven win from `rag_research`).
- Optional **HyDE**: embed a hypothetical answer for hard queries (port the idea).

**Tier 1 — Citation graph expansion (the differentiator).**
After Tier 0 returns top papers, expand 1-hop over the OpenAlex citation graph:
- co-cited / co-citing papers in *your* library → boost.
- "papers I'm missing": works cited by many of my top hits but absent from my library → surface as suggestions.
- No LLM cost. This is what Smart Connections / Copilot structurally cannot do.

**Tier 2 — Optional LLM rerank + synthesis grounding.**
Rerank top-20 with cross-encoder or LLM; pass to synthesis with passage anchors.

**Tier 3 — Optional ontology expansion (medical pack).**
If an ontology pack is loaded, expand query concept via IS_A (children/siblings) before retrieval — ports `graph_context_expander`.

*(Full Microsoft GraphRAG / LLM entity-graph deliberately skipped: too expensive/noisy for a personal library. LazyGraphRAG / LightRAG kept as a far-future escape hatch only if synthesis quality demands it.)*

### Passage-level citation grounding (the academic killer feature)

1. Each chunk carries `{ note_path, citekey, title, authors, year, doi, section, char_range }`.
2. Synthesis prompt: write prose, attach `[citekey]` anchors per claim, list anchors in a `citations[]` array (port the quantitative-data-extraction emphasis from `rag_research`).
3. Post-process: resolve anchors → citeproc-js → render in-text cites + a formatted source list in the user's chosen CSL style.

---

## 6. Plugin module layout

```
src/
├── main.ts                  # lifecycle, settings, commands, view registration
├── data/
│   ├── reference.ts         # Reference model, CSL-JSON <-> frontmatter
│   ├── library.ts           # CRUD over References/, vault watcher
│   └── csl.ts               # CSL-JSON helpers
├── ingest/
│   ├── metadata.ts          # Crossref/PubMed/arXiv/OpenAlex/ISBN fetchers
│   ├── pdf.ts               # pdf.js text + section/page extraction
│   └── chunker.ts           # contextual-prefix chunking
├── index/
│   ├── embedding.ts         # EmbeddingProvider interface
│   ├── providers/           # transformers.ts, ollama.ts, openai.ts
│   ├── store.ts             # Orama hybrid index + persistence + incremental reindex
├── graph/
│   ├── citations.ts         # OpenAlex graph build + persist
│   └── expand.ts            # 1-hop expansion, missing-paper finder
├── retrieve/
│   ├── search.ts            # Tier 0 hybrid + facet filter
│   ├── rerank.ts            # optional cross-encoder/LLM rerank
│   └── ontology.ts          # optional IS_A expansion
├── chat/
│   ├── rag.ts               # retrieve -> assemble anchored context -> LLM
│   └── synthesis.ts         # multi-paper synthesis / lit-review draft
├── cite/
│   ├── citeproc.ts          # citeproc-js wrapper, style registry
│   └── bibliography.ts      # scan [@citekey] in manuscript -> render bib
├── llm/
│   └── client.ts            # provider-agnostic requestUrl LLM client
├── ontology/
│   └── pack.ts              # load JSON ontology pack, alias linker, LLM proposer
└── ui/
    ├── LibraryView.ts       # browsable bibliography, facets
    ├── ChatView.ts          # citation-grounded chat sidebar
    ├── RelatedView.ts       # citation-graph "related / missing papers"
    └── AddReferenceModal.ts # paste DOI/PMID -> create note
```

---

## 7. Roadmap (phased, each phase independently useful)

### Phase 0 — Standalone bibliography manager (skeleton)
- Plugin scaffold (TS + esbuild), settings, `secretStorage`.
- Reference model + CSL-JSON frontmatter read/write.
- "Add reference by DOI/PMID/arXiv" → Crossref/PubMed fetch → create `References/<citekey>.md`.
- LibraryView: list/search/filter by frontmatter.
- **Deliverable:** a usable Zotero-free reference manager. No RAG yet, already valuable.

### Phase 1 — Semantic search (index)
- `EmbeddingProvider` interface + Transformers.js default.
- Chunk abstracts + notes (+ optional PDF text) with contextual prefix.
- Orama hybrid index, persist to plugin dir, incremental reindex on vault change.
- Semantic-search command + facet filters.
- **Deliverable:** Smart-Connections-class search, but bibliography-aware (filter by author/year/tag).

### Phase 2 — Citation-grounded chat (core differentiator)
- Provider-agnostic LLM client.
- RAG chat: retrieve → anchored context → answer with `[citekey]` → citeproc-js → in-text cites + source list.
- Multi-paper synthesis prompt.
- **Deliverable:** ask "what do my papers say about X?" → cited answer in APA/Vancouver/etc.

### Phase 3 — PDF pipeline
- Drop PDF → pdf.js text + Claude Haiku metadata extraction → auto-create reference note + index.
- Section/page provenance for grounding.
- Optional highlight import (PDF++ backlink style).
- **Deliverable:** PDF-in → searchable, cited, organized.

### Phase 4 — Citation graph (GraphRAG-lite)
- OpenAlex fetch + local citation graph.
- RelatedView: "related via citations", co-citation clusters.
- "Papers you're missing" finder.
- Graph expansion in retrieval (Tier 1).
- **Deliverable:** the structurally-unique feature no other plugin has.

### Phase 5 — Writing support
- Scan `[@citekey]` in a manuscript note → render full bibliography in chosen style.
- In-text citation autocomplete.
- Optional literature-review draft generator (port EQUATOR/writing-guide concepts as opt-in templates).

### Phase 6 — Polish & release
- Settings UX, docs, mobile QA, BRAT beta → community store submission (security scan compliant).

### Optional — Ontology pack (medical)
- JSON ontology loader + alias linker + LLM concept proposer (ports `snomed_proposer`).
- IS_A expansion in retrieval (Tier 3).
- Concept tags in frontmatter + optional materialized concept notes for graph view.
- Ship open ontologies (MeSH/MONDO); user imports licensed SNOMED locally.

---

## 8. What to port *conceptually* from `rag_research` (rewrite as TS/data, not copy)

- Metadata-extraction prompt (PDF → structured fields).
- Contextual embedding prefix `[title | section | year]`.
- HyDE query embedding.
- LLM reranker prompt.
- Quantitative-data emphasis in synthesis prompts.
- Evidence/authority ranking — generalize to: recency + OpenAlex citation count + venue.
- Citation styles → replaced by citeproc-js (CSL) for generality.
- SNOMED linker / IS_A expansion → optional ontology pack.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Orama in-memory strain at ~100k chunks on mobile | Index abstracts+notes by default; PDF full-text opt-in/desktop. Chunked persistence. Swap to sqlite-vec on desktop behind store abstraction. |
| Transformers.js slow on CPU/mobile | Small model; background indexing (web worker on desktop); allow Ollama/API embeddings. |
| `requestUrl` no streaming | Non-streamed chat for v1 (acceptable); revisit. |
| Embedding model swap = full reindex | Store model id with index; warn + reindex on change. |
| pdf.js extraction quality varies | Allow manual abstract; metadata extraction is best-effort + editable. |
| SNOMED licensing | Don't bundle; ship open ontologies, user imports own release. |
| Same work added via both DOI and PMID → two notes | **Cross-identifier dedup** (future): on add, match incoming DOI/PMID/title against existing notes, offer merge. Today: unique-citekey suffix avoids overwrite but creates a duplicate note. |
| Crossref often omits abstracts | Enrich via PubMed efetch / OpenAlex when DOI lacks abstract (verified: nature14539 had no Crossref abstract; PubMed supplied it). |

---

## 10. Immediate next step

Phase 0 scaffold: esbuild TS plugin + reference CSL-JSON model + "add by DOI" (Crossref) + LibraryView.
That alone replaces Zotero for basic use and establishes the data model everything else builds on.
