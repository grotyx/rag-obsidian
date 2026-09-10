# Obsidian community-store submission — review pass

Snapshot from a full pass against `eslint-plugin-obsidianmd` v0.4.2 (the linter the Obsidian
team publishes for plugin review) and the published guidelines:
- https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin (the page the task brief calls
  "Submission requirements for plugins" has been renamed/merged into this one upstream — see
  **Submission process has changed** below)
- https://docs.obsidian.md/Reference/Manifest

No PR was opened against `obsidianmd/obsidian-releases` and no fork/clone was made — the user
submits.

## 1. Lint: before / after

`npm run lint` runs `eslint main.ts src` against `eslint-plugin-obsidianmd`'s `recommended`
config (bundles ESLint core + `typescript-eslint` type-checked rules + the Obsidian-specific
rule set). Counts by rule, top offenders first:

| Rule | Before | After | Notes |
|---|---:|---:|---|
| `@typescript-eslint/no-unsafe-member-access` | 197 | 197 | untyped external JSON — see §4 |
| `@typescript-eslint/no-unsafe-assignment` | 88 | 88 | untyped external JSON — see §4 |
| `obsidianmd/ui/sentence-case` | 51 | 37 | 14 fixed; rest are false positives (acronyms/proper nouns) — see §3 |
| `@typescript-eslint/no-unsafe-argument` | 30 | 28 | 2 fixed (`TagRenameModal`), rest untyped JSON |
| `@typescript-eslint/no-unsafe-call` | 24 | 24 | untyped external JSON — see §4 |
| `eslint-comments/require-description` | 19 | 0 | fixed — removed stale disable comments |
| `eslint-comments/no-restricted-disable` | 19 | 0 | fixed — same comments; disabling `no-explicit-any` is itself against the ruleset |
| `obsidianmd/prefer-create-el` | 16 | 0 | fixed — `createEl("div"/"span",…)` → `createDiv`/`createSpan`, raw `document.createElement`/`createDocumentFragment` → `createSpan`/`createEl`/`createFragment` |
| `@typescript-eslint/no-base-to-string` | 16 | 16 | untyped external JSON — see §4 |
| `obsidianmd/no-static-styles-assignment` | 14 | 0 | fixed — moved to CSS classes in `styles.css` |
| `@typescript-eslint/no-unsafe-return` | 11 | 11 | untyped external JSON — see §4 |
| `@typescript-eslint/restrict-template-expressions` | 9 | 9 | untyped external JSON — see §4 |
| `@typescript-eslint/no-unnecessary-type-assertion` | 6 | 0 | fixed — redundant casts removed |
| `obsidianmd/no-unsupported-api` | 5 | 4 | 1 fixed (`revealLeaf` → bumped `minAppVersion`); 3 are feature-detected `secretStorage` — see §5 |
| `obsidianmd/rule-custom-message` (`no-console`) | 3 of 5 | 0 | fixed — `console.log` → `console.debug` in `index/manager.ts` |
| `obsidianmd/rule-custom-message` (`no-new-func`) | 2 of 5 | 2 | known exception — CDN dynamic-import trick, see §2 |
| `obsidianmd/settings-tab/no-manual-html-headings` | 5 | 0 | fixed — `<h2>` → `new Setting(...).setHeading()` |
| `@typescript-eslint/no-deprecated` (`display()`) | 4 | 4 | expected — `require-display` mandates `display()` below minAppVersion 1.13.0; the two rules trade off against each other |
| `obsidianmd/prefer-window-timers` | 3 | 3 | known exception — pure-logic modules run under Node in `npm test`, `window` doesn't exist there — see §2 |
| `@typescript-eslint/no-implied-eval` | 2 | 2 | known exception — CDN dynamic-import trick, see §2 |
| `@typescript-eslint/no-misused-promises` | 1 | 0 | fixed — extracted `ImportModal.loadFile` |
| `@typescript-eslint/no-floating-promises` | 1 | 0 | fixed — `await workspace.revealLeaf(leaf)` |
| `no-useless-escape` | 1 | 0 | fixed — unnecessary `\/` in a character class |
| unused eslint-disable directive | 1 | 0 | fixed — removed with the rest of the stale disables |
| `obsidianmd/settings-tab/prefer-setting-definitions` | 1 | 1 | not mechanical — see §6 |
| `@typescript-eslint/no-explicit-any` | 0* | 17 | *was hidden behind now-removed disable comments; warn-only, non-blocking |
| **Total** | **454 errors / 75 warnings** | **381 errors / 62 warnings** | |

`npm run build` and `npm test` (106/106 checks) both still pass after every change in this pass.

## 2. Known exceptions (left as-is, by design)

These conflict with documented project decisions in `CLAUDE.md` or with the test harness, and
were left untouched per the task brief ("do not refactor / do not silently revert a locked
decision"):

- **`new Function("u","return import(u)")` (`src/ingest/pdf.ts`, `src/index/providers/transformers.ts`)**
  — flagged by both `no-implied-eval` and `no-new-func`. This is the documented CDN-runtime-import
  trick (CLAUDE.md → Conventions) that keeps pdfjs and Transformers.js out of the ~1MB bundle.
  There is no safer standard way to do a fully dynamic `import()` of a URL that esbuild won't try
  to resolve at bundle time.
- **Bare `setTimeout` in `src/graph/openalex.ts`, `src/ingest/ncbi.ts`, `src/llm/client.ts`**
  — flagged by `prefer-window-timers` (wants `window.setTimeout`). These are the project's
  "pure-logic" modules (CLAUDE.md → Conventions: "must not import `obsidian` beyond
  `requestUrl`/…") that also run under Node in `npm test` via `test/obsidian-shim.ts`, which does
  not shim `window`. Switching to `window.setTimeout` would throw at test time.
- **`App.secretStorage` used without a version guard beyond the null check
  (`main.ts`, 3 call sites)** — flagged by `no-unsupported-api` (requires Obsidian 1.11.4+,
  `minAppVersion` is 1.7.2). `secretStore()` already returns `null` when `app.secretStorage` is
  `undefined`, and both `loadSettings`/`saveSettings` branch on that — this *is* the correct
  feature-detection pattern the guidelines ask for elsewhere; the linter's API-version check
  can't see that the call is behind a runtime guard, only that the declared `minAppVersion` is
  older than the API. No code change needed.
- **`@typescript-eslint/no-deprecated` on `display()` (×4, `src/settings.ts`)** — `display()` is
  marked deprecated in favor of `getSettingDefinitions()` (Obsidian 1.13+), but
  `settings-tab/require-display` in the same ruleset *requires* `display()` while
  `minAppVersion < 1.13.0`. The two rules are in tension by construction; keeping `display()` is
  correct for the declared minimum version. See §6 for the larger fix.
- **Node built-ins in `src/mcp/bridge.ts` and `src/mcp/http.ts`** — the optional MCP feature is
  desktop-only, gated by `Platform.isDesktopApp`, and covered by a narrow ESLint override. Shared
  and mobile paths remain free of Node APIs. The server binds only to `127.0.0.1`, authenticates a
  per-session 256-bit token, and stops during plugin unload. See `docs/MCP.md`.

## 3. `obsidianmd/ui/sentence-case` — 37 remaining false positives

The rule capitalizes only the first character of a string and flags every other capital letter,
so it has no notion of acronyms or proper nouns. The Obsidian style guide's own rule is "only the
first word, and proper nouns, should be capitalized" — the remaining 37 warnings are exactly
that: `DOI`, `PMID`, `PubMed`, `arXiv`, `BibTeX`, `RIS`, `NBIB`, `MEDLINE`, `CSL-JSON`, `OpenAlex`,
`Unpaywall`, `NCBI`, `MeSH`, `OA`, `API`, `URL`, `Korean`, `Pandoc`, and literal format templates
like `(Author, Year)` that show the user what the rendered citation will look like. "Fixing" these
to the linter's suggestion (`pubmed`, `doi`, `korean`, …) would make the UI text wrong, not
correct. 14 genuine issues were fixed: stray "RAG Obsidian" self-branding in ribbon tooltips and
pane titles (stale from before the display-name rename to "Academic Paper Citation Manager"),
placeholder text that should start capitalized (`"discectomy"` → `"Discectomy"`, etc.), and one
settings label (`top-K` → `top-k`).

## 4. `@typescript-eslint/no-unsafe-*` / `no-base-to-string` / `restrict-template-expressions` — 355 findings, out of scope

These come from `typescript-eslint`'s type-checked tier (bundled into `eslint-plugin-obsidianmd`'s
own `recommended` config, not something this pass added) firing on `any`-typed external JSON:
Crossref/PubMed/OpenAlex/Unpaywall API responses, and the three LLM provider response shapes in
`src/llm/client.ts` (Anthropic / OpenAI-compatible / Ollama each return a different JSON body).
Silencing them properly means writing real TypeScript interfaces for every external response
shape across roughly a dozen files — a genuine typing refactor, not a mechanical fix, and outside
this task's "do not refactor" instruction. It is also not part of Obsidian's actual review
criteria (manifest validity, sample-code removal, `eval`/`innerHTML` safety, resource cleanup —
not general TypeScript strictness); it's a byproduct of the plugin's `recommended` config pulling
in `tseslint.configs.recommendedTypeChecked` for every `.ts` file. Left for a future pass; not a
store-review blocker.

## 5. Manifest changes

| Field | Before | After | Reason |
|---|---|---|---|
| `minAppVersion` | `1.5.0` | `1.7.2` | `obsidianmd/no-unsupported-api` found `Workspace.revealLeaf` (used unconditionally in `main.ts`, `activateView()`) requires 1.7.2. This was a real gap: on Obsidian 1.5.0–1.7.1 the sidebar-reveal call could throw. `App.secretStorage` (1.11.4+) is intentionally *not* the new floor — it's already feature-detected (§2). |

`version`, `package.json` version, and `versions.json` were **not** touched, per the task brief.
`id`, `name`, `author`, `authorUrl`, `description`, `isDesktopOnly` were reviewed and left as-is
(see §7 for the one open risk, on `id`).

## 6. Checklist — pass/fail

| Item | Status | Notes |
|---|---|---|
| `manifest.json`: `id` lowercase + hyphens | ⚠️ pass with a caveat | see §7 |
| `manifest.json`: `name` no "Obsidian"/"Plugin", sentence case-ish, unique | ✅ | "Academic Paper Citation Manager" |
| `manifest.json`: `description` present, accurate, ≲250 chars | ✅ | 167 chars |
| `manifest.json`: `author` present | ✅ | "Sang-Min Park, M.D., Ph.D." |
| `manifest.json`: `authorUrl` valid if present | ✅ | `https://sangmin.me/` |
| `manifest.json`: `fundingUrl` present or correctly omitted | ✅ | correctly omitted (none configured) |
| `manifest.json`: `minAppVersion` accurate | ✅ | fixed, see §5 |
| `manifest.json`: `isDesktopOnly` accurate | ⚠️ pass with a caveat | `false` because the core plugin remains mobile-capable; MCP alone is explicitly desktop-gated. Device QA remains open. |
| `LICENSE` file at repo root | ✅ | MIT, valid copyright line (`obsidianmd/validate-license` reports clean) |
| `README.md` describes features/usage | ✅ | present, both `README.md` and `README.ko.md` |
| `versions.json` present | ✅ | present, unmodified per task brief |
| No `console.log` (only warn/error/debug) | ✅ | fixed (3× in `index/manager.ts`) |
| No `innerHTML`/`outerHTML`/`insertAdjacentHTML` | ✅ | zero hits, confirmed by `no-unsanitized/*` (clean) and grep |
| No hardcoded `.obsidian` paths | ✅ | `obsidianmd/hardcoded-config-path` clean |
| `normalizePath()` used for constructed vault paths | ✅ | used throughout `data/library.ts`, `commands/*` |
| No `var` | ✅ | zero hits |
| `registerEvent`/`registerDomEvent` for listeners that need cleanup | ✅ | vault/workspace listeners go through `registerEvent`; view-owned DOM listeners are torn down when the pane's `contentEl` is emptied/rebuilt (no bare `document`-level listeners left running) |
| `Platform` checks before desktop-only APIs | ✅ | MCP's server is constructed only behind `Platform.isDesktopApp`, and its Node imports are type-only or dynamic; shared network calls still use `requestUrl` |
| Settings headings via `setHeading()`, not `<h1>`/`<h2>` | ✅ | fixed, see §1 |
| Settings headings don't repeat "settings" | ✅ | ("Library", "Retrieval (semantic search)", "Chat (citation-grounded answers)", "Citation graph", "Writing") |
| Sentence case in UI text | ✅* | *37 residual linter false positives, see §3 |
| Commands not prefixed with the plugin name | ✅ | every `addCommand` name omits "RAG Obsidian" / "Academic Paper Citation Manager"; the two `obsidianmd/commands/*` naming rules report clean |
| No default hotkeys | ✅ | no `hotkeys:` set on any command (`obsidianmd/commands/no-default-hotkeys` clean) |
| Sample/placeholder class names renamed | ✅ | `obsidianmd/sample-names` clean, no `MyPlugin`/`SampleSettingTab` left |
| `this.app`, not global `app` | ✅ | zero bare `app.`/`window.app` references outside test/dev tooling |
| `getSettingDefinitions()` (Obsidian 1.13+ settings search) | ❌ not done | flagged as a warning (`prefer-setting-definitions`); requires restructuring every `Setting(...)` call into the declarative API *and* raising `minAppVersion` to 1.13.0 — a real feature addition, not a mechanical fix. Left for a future pass. |

## 7. Open risk: plugin `id` contains "obsidian"

The current [Manifest reference](https://docs.obsidian.md/Reference/Manifest) states the `id`
"can't contain `obsidian`". `rag-obsidian` violates this literally. CLAUDE.md documents this as a
deliberate, locked decision — the id is kept because changing it would orphan every existing
user's settings and OS-keychain secretStorage entries, and because 445 currently-listed plugins
already have `obsidian` in their id (verified live against `community-plugins.json` while writing
this doc — grandfathered from before the rule was written down, or never enforced retroactively).

This task did not change the id, per the brief. The risk for a **new** submission: the directory
now processes submissions through an automated review (see §8) that may enforce this rule
literally on first submission, unlike the grandfathered older entries. If the review rejects on
this specific point, the only fix is renaming the id (a breaking change for anyone who has
already installed a dev build) — worth a quick manual check on community.obsidian.md before
relying on the grandfather precedent.

## 8. Submission process has changed since the task brief was written

The task brief describes a PR-based flow against `obsidianmd/obsidian-releases`
(`community-plugins.json` + a PR). As of the current developer docs
(https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin), submission is now done through
**community.obsidian.md** (sign in with an Obsidian account, link GitHub, "Add your plugin"), not
a hand-edited JSON entry + pull request. The directory reads `manifest.json` at the HEAD of the
default branch directly. The JSON block below is provided anyway, in the exact shape the (still
git-backed) directory data uses, in case the web form asks for/validates the same fields, or in
case a PR-based path is still available for some cases:

```json
{
  "id": "rag-obsidian",
  "name": "Academic Paper Citation Manager",
  "author": "Sang-Min Park, M.D., Ph.D.",
  "description": "AI-native citation manager for Obsidian: PubMed keyword search, LLM paper summaries, MeSH topic tags, and CSL-JSON markdown reference notes with @-cite + bibliography.",
  "repo": "grotyx/rag-obsidian"
}
```

(`repo` is `owner/name` from `git remote -v`: `https://github.com/grotyx/rag-obsidian.git`.)

### If a PR is still the right path, title/body to paste

**Title:**
```
Add Academic Paper Citation Manager plugin
```

**Body:**
```
- [x] I have read the developer policies at https://docs.obsidian.md/Developer+policies.
- [x] I have read the plugin guidelines at https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines.
- [x] My plugin follows the naming conventions in the plugin guidelines.
- [x] My README.md describes the plugin's purpose and provides clear usage instructions.
- [x] I have tested the plugin on desktop and it works as expected. (Mobile is a claimed but not
      yet independently verified target — see ROADMAP.md Phase 3 item 12.)
- [x] I have added a LICENSE file to the repository.
- [x] I understand that if I don't follow the naming conventions, my plugin may be rejected.
```

### Before submitting (regardless of which flow applies)

1. Cut a GitHub release tagged `manifest.json`'s `version` exactly (`x.y.z`, no `v` prefix), with
   `main.js`, `manifest.json`, and `styles.css` attached as binary assets — this repo's release
   procedure is already documented in CLAUDE.md's "Version bump procedure".
2. Re-run `npm run lint`, `npm run build`, `npm test` on the exact commit being tagged.
3. Double-check §7 above (the `id` risk) on community.obsidian.md before relying on the
   grandfather precedent.
