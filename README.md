# Academic Paper Citation Manager

[![version](https://img.shields.io/badge/version-0.4.13-blue)](./CHANGELOG.md)
[![license](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Obsidian](https://img.shields.io/badge/Obsidian-1.5%2B-7c3aed)](https://obsidian.md)

**English** · [한국어](README.ko.md)

> A standalone, AI-native **citation manager for Obsidian** — search PubMed, get AI
> summaries, auto-tag by topic, and cite in any journal style. A Zotero / EndNote
> replacement where your **markdown notes are the database**.

Every reference is a plain `.md` note with [CSL-JSON](https://citationstyles.org/)
frontmatter, so your library stays portable, future-proof, and yours. No external app,
no account, no backend — just your vault.

---

## ✨ Features

**📥 Collect**
- **Search PubMed by keyword** inside Obsidian → pick papers → notes.
- Add by **DOI / PMID / arXiv**, or by **paper title** (auto-lookup).
- **Import** an existing library — **BibTeX · RIS · PubMed `.nbib` · CSL-JSON**.

**🧠 Summarize (AI)**
- An LLM writes a **section-by-section English summary** (Background / Methods / Results /
  Conclusions) **and a concise Korean summary** into each note.
- Uses the **full text** for open-access papers (PubMed Central), the abstract otherwise.

**🏷️ Organize**
- Auto-tags every note with **MeSH topic terms** → Obsidian's **graph view** clusters your
  papers by subject.
- **Citation graph** (OpenAlex): references / cited-by in your library, and *"frequently
  cited but missing"* recommendations.
- Reading status, **dashboard**, duplicate finder, citation counts, retraction check.

**✍️ Cite & write**
- Type `@` → autocomplete inserts `[@citekey]`.
- **"Update bibliography"** builds a `## References` list in a real **journal style**
  (citeproc-js / CSL); in-text marks render to match (`[1]`, superscript, or author–date).
- **Per-manuscript style** via a note's `csl:` frontmatter.
- **Compile manuscript** → a clean copy with citations resolved → export to **`.docx`**.

**🔎 Search & chat**
- Hybrid **semantic search** (BM25 + vector) and **citation-grounded chat** that answers
  only from your library, with `[n]` sources.

---

## 📦 Installation

> Not in the community-plugin store yet, so it will not show up in Obsidian's plugin search.
> Pick whichever route suits you — **A needs no terminal**.

### Option A — BRAT (recommended: installs and auto-updates)

[BRAT](https://github.com/TfTHacker/obsidian42-brat) installs plugins straight from GitHub and
keeps them updated.

1. Obsidian → **Settings → Community plugins** → Browse → install and enable **BRAT**.
2. Command palette (`Ctrl/Cmd-P`) → **BRAT: Add a beta plugin for testing**.
3. Paste `grotyx/rag-obsidian` → **Add plugin**.
4. **Settings → Community plugins** → enable **Academic Paper Citation Manager**.

BRAT then pulls each new release for you.

### Option B — Download a release (no terminal, no BRAT)

From the [latest release](https://github.com/grotyx/rag-obsidian/releases/latest), download
`main.js`, `manifest.json` and `styles.css` into

```text
<your vault>/.obsidian/plugins/rag-obsidian/
```

(create the folder if it does not exist), then reload Obsidian and enable the plugin under
**Settings → Community plugins**. Updating means downloading the three files again.

### Option C — Build it yourself

Requires [Node.js 18+](https://nodejs.org) and [git](https://git-scm.com).

```bash
git clone https://github.com/grotyx/rag-obsidian.git
cd rag-obsidian
npm install

cp .env.example .env        # Windows: copy .env.example .env
# edit .env → set VAULT_PLUGIN_DIR to <your vault>/.obsidian/plugins/rag-obsidian

npm run deploy              # builds + copies the plugin into your vault
```

Then in Obsidian: **Settings → Community plugins → enable the plugin** → reload (`Ctrl/Cmd-R`).

### Option D — Cloud-synced vault (no build on the 2nd machine)

If your vault is in OneDrive / iCloud / Dropbox / Obsidian Sync, the built plugin travels
**inside** the vault (`<vault>/.obsidian/plugins/rag-obsidian/`). On another machine just
open the synced vault and enable the plugin — no Node, no build.

---

## 🚀 Quick start (5 minutes)

1. **Reload** Obsidian (`Ctrl/Cmd-R`) and confirm the plugin is enabled.
2. **Set your AI provider** — Settings → the plugin's tab → see **Providers** below.
3. **Add a paper** — ribbon **🔍 Search PubMed**, type a topic, select results → **Add**.
   Each becomes a note in `References/` with an AI summary + topic tags.
4. **Write & cite** — in any note, type `@` and pick a reference → `[@citekey]`.
5. **Bibliography** — `Ctrl/Cmd-P` → **Update bibliography** → a `## References` list in
   your chosen journal style.

> The citation workflow needs **no embeddings**. Semantic search & chat are optional and
> require a one-off **Rebuild search index**.

---

## ⚙️ Providers

Pluggable, all through Obsidian's `requestUrl` (works on desktop and mobile):

**Out of the box both are set to the OpenAI-compatible provider pointed at OpenRouter**, so a
single key covers chat, paper summaries and embeddings and nothing has to be installed locally.
Paste the key and you are done; everything else is optional.

- **LLM** (chat + summaries): OpenAI / compatible (default) · Anthropic · Ollama (local).
  *Chat model* is optional and overrides the default model for **Chat with library** only —
  worth a stronger model there, since summaries and PDF metadata extraction stay on the
  cheaper default.
- **Embeddings** (search + chat): OpenAI / compatible (default) · Ollama (local) ·
  Transformers.js.

> OpenRouter model ids carry a vendor prefix (`openai/…`, `deepseek/…`). Pointing the base URL
> at `https://api.openai.com/v1` instead works too — drop the prefix from the model ids.

**Using OpenRouter?** Pick the **OpenAI** provider for both chat and embeddings — one key,
one base URL, hundreds of models:

| Setting | Value |
|---|---|
| Chat / Embedding provider | `OpenAI` |
| OpenAI base URL (shared) | `https://openrouter.ai/api/v1` |
| Chat model | any OpenRouter id, e.g. `deepseek/deepseek-v4-flash` |
| Embedding model | `openai/text-embedding-3-small` |
| OpenAI API key | your OpenRouter key ([openrouter.ai/keys](https://openrouter.ai/keys)) |

**Using Google Gemini?** Pick the **OpenAI** provider and point it at Google's endpoint:

| Setting | Value |
|---|---|
| Chat provider | `OpenAI` |
| Chat model | `gemini-3.5-flash` |
| Embedding provider | `OpenAI` |
| Embedding model | `gemini-embedding-001` |
| OpenAI base URL (shared) | `https://generativelanguage.googleapis.com/v1beta/openai` |
| OpenAI API key | your Gemini key ([Google AI Studio](https://aistudio.google.com/apikey)) |

---

## ✍️ Writing a paper (without Zotero / Word plugins)

```text
Obsidian:  write Manuscript.md  →  type @ to cite  →  set the journal: csl: springer-basic-brackets
           Ctrl/Cmd-P → "Compile manuscript"        →  Manuscript (compiled).md
Terminal:  node scripts/to-docx.cjs "Manuscript (compiled).md"   →  styled .docx (needs Pandoc)
```

- **Compile manuscript** resolves every `[@citekey]` to its styled in-text mark and appends
  the `## References` list — ready for Pandoc / submission.
- `scripts/to-docx.cjs` (or the bundled manuscript-docx workflow) renders Times New Roman
  12 pt, double-spaced, black `.docx`.

---

## 🎨 Citation styles

Bibliographies and in-text marks use **citeproc-js** over your CSL-JSON — the same engine
Zotero uses.

- **Globally:** Settings → *Bibliography style (CSL)*. Bundled offline: **Spine · The Spine
  Journal · European Spine Journal · AMA · APA**. Or type any style id (e.g. `nature`,
  `the-lancet`) — it's fetched from the [CSL repo](https://github.com/citation-style-language/styles)
  and cached.
- **Per manuscript:** add `csl:` to the note's frontmatter — it overrides the global style.

```yaml
---
csl: springer-basic-brackets
---
```

| Journal | `csl:` value |
|---|---|
| Spine | `spine` |
| The Spine Journal | `elsevier-vancouver` |
| European Spine Journal | `springer-basic-brackets` |
| Global Spine Journal | `american-medical-association` |
| anything else | any id from the CSL styles repo |

---

## 🧰 Commands

| Group | Commands |
|---|---|
| **Add** | Search PubMed · Add by DOI / PMID / arXiv / title · Import (BibTeX / RIS / nbib / CSL-JSON) · Import PDF |
| **Read** | Mark unread / reading / read · Reading queue · Find open-access PDF · Download open-access PDF · Extract PDF highlights · Open reference online |
| **Organize** | Summarize and tag references (fill gaps) · Summarize and tag this reference · Summarize and tag references in a folder or tag… · Re-summarize this reference · Re-summarize references made by an older model · Library dashboard · Find duplicates · Backfill citation counts · Check retraction · Rename tag · Enrich metadata · Suggest related papers · Export citation network |
| **Write** | `@` autocomplete · Update bibliography · Compile manuscript · Copy citation · Export annotated bibliography |
| **Search** | Search library (semantic) · Chat with library · Show related papers · Rebuild search index |
| **Export** | Library → BibTeX / RIS / CSL-JSON |

---

## 🛠️ For developers

```bash
npm run dev        # esbuild watch → main.js
npm run deploy     # build + copy into the vault (VAULT_PLUGIN_DIR in .env)
npm run build      # tsc + esbuild production
npm test           # live integration suite (73 checks)
```

Helper script (terminal, no Obsidian needed) — path from `.env`:

```bash
node scripts/to-docx.cjs "Manuscript (compiled).md"                  # compiled md → styled .docx
```

See [`CLAUDE.md`](./CLAUDE.md) for the module map and [`PLAN.md`](./PLAN.md) for design notes.

---

## ⚠️ Notes & limitations

- **Plugin id stays `rag-obsidian`** (folder / `data.json` key) even though the display name
  is "Academic Paper Citation Manager".
- Filenames are **readable** (`2022-SpineJ-ParkSM-Biportal.md`); the short `citekey:` in
  frontmatter is the `[@cite]` handle.
- `.docx` export needs **Pandoc**; PDF highlight extraction needs a PDF with annotations.
- Obsidian's Properties panel may warn on nested CSL frontmatter — the data is valid.
- Set **Contact e-mail** in settings: OpenAlex, Unpaywall and PubMed all use it, and
  open-access PDF lookup does not work without one.
- API keys live in the OS keychain (Obsidian ≥ 1.11.4) and are blanked in `data.json`; on a
  synced vault, enter the key once per device.
- Bundled CSL styles under `styles/` are CC BY-SA 3.0 (see `styles/README.md`); plugin code
  is MIT.

## 👤 Author

**Professor Sang-Min Park, M.D., Ph.D.**
Department of Orthopaedic Surgery, Seoul National University Bundang Hospital,
Seoul National University College of Medicine
🌐 [sangmin.me](https://sangmin.me/)

## 📄 License

MIT (plugin code). Bundled CSL styles/locales retain their CC BY-SA 3.0 license.
