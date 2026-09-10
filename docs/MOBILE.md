# Mobile readiness

`manifest.json` sets `isDesktopOnly: false`, but no iOS/Android device has run this plugin yet.
This is a **code-level** audit: every desktop-leaning API call was traced, and mobile-breaking
paths were either confirmed safe, given a mobile-safe fallback, or given a clear failure notice
instead of an uncaught exception. It is not a substitute for the manual QA pass below.

The optional Claude Code/Codex **MCP integration is desktop-only by design**. Its settings and
Node-based loopback server are gated by `Platform.isDesktopApp`; this does not change the manifest
because citation, library, search, and chat features remain available on mobile.

## Feature matrix

| Feature | Verdict | Notes |
|---|---|---|
| Add reference by DOI / PMID / arXiv | Works | `requestUrl` only (Crossref/PubMed/arXiv) |
| PubMed search & import | Works | `requestUrl` + NCBI queue, no Node APIs |
| Import BibTeX / RIS / .nbib / CSL-JSON | Works | `<input type="file">` + `File.text()`, standard web APIs |
| Library browse / dashboard / duplicates / reading queue / status | Works | vault + frontmatter only |
| Semantic search (OpenAI-compatible / OpenRouter embeddings) | Works | `requestUrl` |
| Semantic search (Ollama embeddings) | Desktop-only in practice | Ollama has no iOS/Android app; only works if `Ollama URL` points at a LAN address reachable from the device, not `localhost` |
| Claude Code / Codex MCP | Desktop-only | Requires a local Node stdio process and authenticated `127.0.0.1` server; settings explain this and do not start it on mobile |
| Semantic search (Transformers.js, experimental) | Untested | CDN + in-browser WASM inference; now fails with a clear Notice instead of a raw loader error if the CDN import is blocked (`src/index/providers/transformers.ts`) |
| Chat with library | Works | `src/llm/client.ts` is `requestUrl`-only for all three providers |
| Chat history persistence / "Save as note" | Works | `vault.adapter.write` / vault note creation |
| Citation graph (RelatedView) | Works | OpenAlex via `requestUrl`; "missing" node click now falls back to a `Notice` with the URL if `window.open` is unavailable (`src/ui/RelatedView.ts`, reuses `main.ts` `safeOpenExternal`) |
| Citation rendering / CSL styles / bibliography / manuscript compile | Works | citeproc-js is pure JS; style cache uses `vault.adapter.write` |
| Copy citation to clipboard | Works | `navigator.clipboard.writeText` with an existing try/catch fallback to a `Notice` showing the text (`src/commands/writing.ts`) |
| Export library (BibTeX/RIS/CSL-JSON) | Works | written to a vault note, no download link |
| Import PDF into library | Untested (guarded) | `src/ingest/pdf.ts` loads pdfjs from a CDN via `new Function("u","return import(u)")`; a blocked/unsupported dynamic import now throws "PDF reading is unavailable: …" instead of a raw fetch error, which `ImportPdfModal` already surfaces as a `Notice` |
| PDF highlight extraction | Untested (guarded) | Same pdfjs CDN path as above; failure surfaces as a clear `Notice` in `extractHighlights` (`src/commands/openaccess.ts`) |
| Find / download open-access PDF | Works | Unpaywall via `requestUrl`; PDF bytes saved with `vault.createBinary`/`modifyBinary` (no Node `fs`) |
| Retraction check | Works | OpenAlex via `requestUrl` |
| API key storage | Works | Obsidian `secretStorage` (OS keychain) when present, else falls back to plaintext in `data.json` — both paths already existed; the settings tab now states which one is active |

## What changed for mobile

- `src/ui/RelatedView.ts`: the "missing paper" row no longer calls `window.open` directly — it
  goes through `main.ts`'s `safeOpenExternal` (now public), which already falls back to a
  `Notice` with the URL when `window.open` isn't available.
- `src/ingest/pdf.ts`, `src/index/providers/transformers.ts`: the CDN dynamic `import()` is now
  wrapped in a `try/catch` that rethrows a clear "…is unavailable: could not load … from the CDN"
  error instead of letting a raw module-loader error surface. The loader itself (the
  `new Function` trick) is untouched — this only improves the message the existing UI-layer
  `catch` blocks already show as a `Notice`.
- `src/settings.ts` / `main.ts`: added a one-line note in the settings tab (`hasSecretStorage()`)
  telling the user whether API keys are in the OS keychain or in plaintext `data.json`.

No shared/mobile code path found an unguarded desktop-only API (no `require`, `fs`, `path`, `electron`,
`Buffer`, `process.*`, `child_process`, `XMLHttpRequest`, `WebSocket`, or download-link tricks).
All network calls already went through `requestUrl`; all binary writes already went through the
vault adapter.

`src/mcp/bridge.ts` and `src/mcp/http.ts` intentionally use Node built-ins. Their imports are
type-only or dynamic, and `main.ts` constructs the server only after `Platform.isDesktopApp`; the
setting toggle is unavailable on mobile. The production bundle keeps Node built-ins external.

## What still needs a real device

- Whether the CDN dynamic `import()` for pdfjs / Transformers.js actually resolves inside the iOS
  Obsidian webview (CSP and `new Function` support are the open questions — the code now degrades
  to a clear error either way, but "PDF import works on iOS" is unverified).
- Whether `navigator.clipboard.writeText` is available (it has a `Notice` fallback either way).
- Whether `<input type="file">` opens the expected iOS document/file picker for BibTeX/RIS import.
- General touch/UI layout of the sidebar panes (Search/Chat/Related/Library) on a small screen —
  not addressed here, this audit is API-safety only, not responsive-layout QA.

## Manual QA script (iOS, ~15 minutes)

1. Install Obsidian Mobile, enable Community plugins, enable **Academic Paper Citation Manager**.
   Expect: plugin loads without error, ribbon icons appear.
2. Open plugin Settings. Expect: a line near the top saying whether API keys are stored in the
   OS keychain or in `data.json`. Enter an OpenRouter (or OpenAI-compatible) API key.
3. Command palette → **Add reference by DOI/PMID/arXiv** → paste a DOI (e.g. `10.1038/nphys1170`).
   Expect: a new note under `References/` with populated CSL-JSON frontmatter.
4. Command palette → **Search PubMed** → search a term → import one result.
   Expect: a note with MeSH-derived tags.
5. Open the Search sidebar pane → **Build index** → search a phrase from an imported abstract.
   Expect: ranked results with snippets, no error Notice.
6. Open the Chat sidebar pane → ask a question about your library.
   Expect: a `[n]`-cited answer with a Sources list; tap **Save as note** → a note appears under
   `Chat/`.
7. On a reference note with `[@citekey]` citations, run **Update bibliography**.
   Expect: a `## Bibliography` section is inserted/refreshed.
8. On a reference note, run **Copy citation**.
   Expect: either the clipboard receives the formatted citation, or a `Notice` shows the text
   directly — never a silent failure.
9. Open the Related sidebar pane → **Build citation graph** → tap an entry under "Frequently
   cited by your library, but missing".
   Expect: the OpenAlex page opens (in-app or system browser), or, if that's unavailable, a
   `Notice` shows the URL instead of nothing happening.
10. Run **Import PDF into library** on a PDF already stored in the vault, then **Find
    open-access PDF** + **Download open-access PDF** on a note with a DOI.
    Expect: PDF import either succeeds or shows a clear "PDF reading is unavailable: …" Notice
    (no crash); the OA PDF download saves a binary file under `PDFs/`.
