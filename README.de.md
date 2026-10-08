<p align="center">
  <img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/assets/logo.svg" width="128" alt="Refwright-Logo">
</p>

<h1 align="center">Refwright</h1>

<p align="center"><i>Früher „Academic Paper Citation Manager“ — dasselbe Plugin, dieselbe ID, dieselben Einstellungen.</i></p>

<p align="center">Ihre Markdown-Notizen <b>sind</b> die Referenzbibliothek.<br>PubMed durchsuchen, KI-Zusammenfassungen erhalten, in jedem Zeitschriftenstil zitieren — ein Ersatz für Zotero / EndNote direkt in Obsidian.</p>

<p align="center">
  <a href="https://community.obsidian.md/plugins/academic-paper-citation-manager"><img alt="Obsidian downloads" src="https://img.shields.io/badge/dynamic/json?logo=obsidian&color=7c3aed&label=downloads&query=%24%5B%22academic-paper-citation-manager%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json"></a>
  <a href="https://github.com/grotyx/rag-obsidian/releases/latest"><img alt="version" src="https://img.shields.io/badge/version-0.8.7-8b5cf6"></a>
  <a href="https://obsidian.md"><img alt="Obsidian" src="https://img.shields.io/badge/Obsidian-1.11.4%2B-a78bfa"></a>
  <a href="https://github.com/grotyx/rag-obsidian/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-green"></a>
</p>

<p align="center"><a href="#-installation">Installation</a> · <a href="https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/de.md">Benutzerhandbuch</a> · <a href="#-funktionen">Funktionen</a> · <a href="https://github.com/grotyx/rag-obsidian/blob/main/docs/MCP.md">Claude Code / Codex</a> · <a href="#manuwright">manuwright</a> · <a href="https://github.com/grotyx/rag-obsidian/blob/main/CHANGELOG.md">Changelog</a></p>

<p align="center"><a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <a href="README.zh.md">中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.es.md">Español</a> · <b>Deutsch</b> · <a href="README.fr.md">Français</a> · <a href="README.pt.md">Português</a></p>

<table>
  <tr>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/en/03-pubmed-search.png" alt="Artikel aus PubMed hinzufügen"><br><b>Artikel aus PubMed hinzufügen</b></td>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/en/07-cite-suggest.png" alt="Mit @ zitieren"><br><b>Mit @ zitieren</b></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/en/10-chat.png" alt="Mit Ihrer Bibliothek chatten"><br><b>Mit Ihrer Bibliothek chatten</b></td>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/en/12-related.png" alt="Zitationskarte"><br><b>Zitationskarte</b></td>
  </tr>
</table>

Jede Referenz ist eine schlichte `.md`-Notiz mit [CSL-JSON](https://citationstyles.org/)-Frontmatter.
So bleibt Ihre Bibliothek portabel, zukunftssicher und in Ihrer Hand. Keine externe App,
kein Konto, kein Backend — nur Ihr Vault.

---

## 📖 Benutzerhandbuch

Eine Schritt-für-Schritt-Anleitung mit Screenshots, vom Hinzufügen der Artikel bis zum Export eines Word-Manuskripts:
[English](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/en.md) · [한국어](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/ko.md) · [中文](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/zh.md) · [日本語](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/ja.md) · [Español](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/es.md) · **[Deutsch](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/de.md)** · [Français](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/fr.md) · [Português](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/pt.md)

[![Zitate und ein erzeugtes Literaturverzeichnis in Obsidian](https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/en/08-bibliography.png)](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/de.md)

---

## ✨ Funktionen

**📥 Sammeln**
- **PubMed per Stichwort durchsuchen** direkt in Obsidian → Artikel auswählen → Notizen.
- Hinzufügen per **DOI / PMID / arXiv** oder über den **Artikeltitel** (automatische Suche).
- **Import** einer bestehenden Bibliothek — **BibTeX · RIS · PubMed `.nbib` · CSL-JSON** oder direkt
  aus einem laufenden **Zotero 7** (gesamte Bibliothek oder eine Collection).

**🧠 Zusammenfassen (KI)**
- Ein LLM schreibt eine **nach Abschnitten gegliederte Zusammenfassung** (Background / Methods /
  Results / Conclusions) in jede Notiz. *Summary language* (Settings → Chat) wählt Englisch, Koreanisch,
  beides (Standard: Englisch + eine knappe koreanische Zusammenfassung) oder eine beliebige andere Sprache
  über ihren Namen.
- Nutzt bei Open-Access-Artikeln den **Volltext** (PubMed Central), sonst das Abstract.

**🏷️ Ordnen**
- Versieht jede Notiz automatisch mit **MeSH-Themenbegriffen** → die **Graphansicht** von Obsidian gruppiert Ihre
  Artikel nach Fachgebiet.
- **Zitationsgraph** (OpenAlex): Referenzen / zitiert von in Ihrer Bibliothek sowie Empfehlungen
  *„häufig zitiert, aber nicht vorhanden“* — dargestellt als **Karte** im Related-Fenster (durchgezogene Knoten sind
  Notizen, die Sie haben, gestrichelte sind Artikel, die Sie nicht haben; ein Klick auf einen gestrichelten Knoten fügt ihn hinzu). Einmalig
  über die Schaltfläche des Fensters aufbauen; später hinzugefügte Referenzen werden von selbst ergänzt.
- Lesestatus, **Dashboard**, Zitationszahlen. Das **Library-Fenster** sortiert nach Jahr, Titel,
  Autor, Zitationen oder Datum des Hinzufügens, mit Schnellfiltern (mit PDF / ohne PDF / ungelesen / zurückgezogen).
- **Duplikate**: aufspüren und dann **zusammenführen** — eine Notiz bleibt erhalten, Lücken werden aus den anderen gefüllt,
  `[@old]`-Zitate werden im gesamten Vault umgeschrieben.
- **Retraction-Prüfung** für eine Notiz oder die gesamte Bibliothek (OpenAlex), mit einer Berichtsnotiz.
- **Systematic review**: ein **Screening-Fenster** (include / exclude / maybe, Schlüsselfragen, Evidenzgrad,
  Studiendesign, Ausschlussgründe, Tastaturkürzel) und ein **PRISMA-2020-Flussdiagramm** für alle
  Referenzen oder ein Tag.
- **PDFs**: Open-Access-Kopien für jede Referenz ohne PDF herunterladen (Unpaywall) oder
  einen **Ordner mit vorhandenen PDFs verknüpfen** — zugeordnet über Dateiname, DOI, PMID oder Titel.

**✍️ Zitieren & Schreiben**
- `@` tippen → die Autovervollständigung fügt `[@citekey]` ein.
- **„Update bibliography“** erstellt eine `## References`-Liste in einem echten **Zeitschriftenstil**
  (citeproc-js / CSL); die Zitate im Text werden passend dargestellt (`[1]`, hochgestellt oder Autor–Jahr).
- **Stil pro Manuskript** über das `csl:`-Frontmatter einer Notiz — oder **Choose citation style…** und
  Suche in rund 10.000 Zeitschriftenstilen nach Zeitschriftenname.
- Zitate werden beim Tippen in **Live Preview** dargestellt; mit dem Mauszeiger darüber (**Hover**) sehen Sie den Artikel.
- **Check references in this manuscript** vor der Einreichung: in der Bibliothek fehlend,
  zurückgezogen, ohne DOI oder mit unvollständigen Metadaten.
- **Compile manuscript** → eine saubere Kopie mit aufgelösten Zitaten → Export nach **`.docx`**.

**🔎 Suchen & Chatten**
- Hybride **semantische Suche** (BM25 + Vektor) und **belegbasierter Chat**, der
  nur aus Ihrer Bibliothek antwortet, mit `[n]`-Quellen.
- **Gemessene Retrieval-Qualität** (0.8.1): ein gehosteter **Cross-Encoder-Reranker** (etwa 0,0002 $ pro Suche), **Query Expansion**
  (Ihr eigenes Suchvokabular + MeSH-Entry-Terms) und **automatische Übersetzung** koreanischer (oder beliebiger
  nicht englischer) Fragen. Bei einem klinischen Benchmark mit 96 Fragen über 16.578 Artikel stieg nDCG@10
  von 0,53 auf 0,81 für englische und von 0,18 auf 0,83 für koreanische Fragen.
- **Suche auf Ebene einzelner Ergebnisse** für Claude Code / Codex (MCP `search_findings`): einzelne Resultate —
  Effektgröße, CI, p-Wert und das wörtliche Zitat — aus dem Abschnitt `## Evidence (extracted)` einer Notiz.
- **Filter im Such- *und* im Chat-Fenster** — Eingrenzung nach **Publikationsjahr** (von–bis), nach **Autor**
  (Familienname) und nach **Tag**: Tippen Sie in das Tag-Feld (es ergänzt automatisch aus den Tags, die bereits in
  Ihrer Bibliothek vorkommen) und drücken Sie Enter, um einen Chip hinzuzufügen; bei mehreren muss ein Artikel alle tragen.
  Die Filter gehören zum jeweiligen Fenster und nicht zu den Einstellungen; im Chat-Fenster legen sie fest, auf
  welche Artikel eine Antwort zurückgreifen darf, und die Quellenliste der Antwort nennt die Eingrenzung.
- **Claude Code / Codex über MCP (Desktop):** Ein externer KI-Assistent kann die laufende Bibliothek durchsuchen,
  Artikel finden, hinzufügen und zusammenfassen, Markdown-Notizen sicher anlegen/bearbeiten/verschieben/löschen und ein
  zitiertes Manuskript kompilieren. Die Zusammenfassungstexte stammen von Claude/Codex; der MCP-Pfad ruft nie das
  Chat-, Zusammenfassungs- oder Reranking-LLM dieses Plugins auf. Einrichtungsschaltflächen für Claude Code, Codex, OpenCode und
  Antigravity; die sieben Werkzeuge zum Bearbeiten von Notizen lassen sich abschalten.
- **Kein API-Schlüssel für das LLM nötig (Desktop):** Chat und Zusammenfassungen können über Ihre
  angemeldete **Codex CLI** oder **OpenCode CLI** laufen. Die Embeddings für die Suche benötigen weiterhin OpenRouter/OpenAI
  oder ein lokales Ollama.

---

## 📦 Installation

> **Im Obsidian-Community-Verzeichnis veröffentlicht:**
> [community.obsidian.md/plugins/academic-paper-citation-manager](https://community.obsidian.md/plugins/academic-paper-citation-manager).
> Version 0.6.0 hat die Plugin-ID geändert; wer noch auf 0.5.x ist, folgt einmalig der
> [Migrationsanleitung](docs/MIGRATION-0.6.md).

### Option A — Community plugins (empfohlen)

1. Obsidian → **Settings → Community plugins** → den Restricted mode ausschalten, falls er aktiv ist.
2. **Browse** → nach **Refwright** suchen → **Install** → **Enable**.

Obsidian aktualisiert es wie jedes andere Plugin (**Settings → Community plugins → Check for updates**).
Nur Desktop (Obsidian 1.11.4+).

Früher über **BRAT** installiert? Plugin-ID und Ordner sind dieselben, Ihre Einstellungen und
der Index bleiben also erhalten: Entfernen Sie das Plugin aus der BRAT-Liste und aktualisieren Sie weiter über die Community plugins.

<details>
<summary><b>Option B — Release herunterladen (manuell)</b></summary>

Laden Sie aus dem [neuesten Release](https://github.com/grotyx/rag-obsidian/releases/latest)
`main.js`, `manifest.json` und `styles.css` herunter nach

```text
<your vault>/.obsidian/plugins/academic-paper-citation-manager/
```

(legen Sie den Ordner an, falls er nicht existiert), laden Sie Obsidian neu und aktivieren Sie das Plugin unter
**Settings → Community plugins**. Zum Aktualisieren laden Sie die drei Dateien erneut herunter.


</details>

<details>
<summary><b>Option C — Selbst bauen</b></summary>

Erfordert [Node.js 18+](https://nodejs.org) und [git](https://git-scm.com).

```bash
git clone https://github.com/grotyx/rag-obsidian.git
cd rag-obsidian
npm install

cp .env.example .env        # Windows: copy .env.example .env
# edit .env → set VAULT_PLUGIN_DIR to <your vault>/.obsidian/plugins/academic-paper-citation-manager

npm run deploy              # builds + copies the plugin into your vault
```

Dann in Obsidian: **Settings → Community plugins → das Plugin aktivieren** → neu laden (`Ctrl/Cmd-R`).


</details>

<details>
<summary><b>Option D — Vault mit Cloud-Synchronisation (kein Build auf dem zweiten Rechner)</b></summary>

Liegt Ihr Vault in OneDrive / iCloud / Dropbox / Obsidian Sync, wandert das gebaute Plugin
**im** Vault mit (`<vault>/.obsidian/plugins/academic-paper-citation-manager/`). Auf einem anderen Rechner genügt es,
den synchronisierten Vault zu öffnen und das Plugin zu aktivieren — kein Node, kein Build.


</details>

---

## 🚀 Schnellstart (5 Minuten)

1. Obsidian **neu laden** (`Ctrl/Cmd-R`) und prüfen, dass das Plugin aktiviert ist.
2. **KI-Anbieter festlegen** — Settings → Tab des Plugins → siehe **Anbieter** weiter unten.
3. **Artikel hinzufügen** — im Ribbon **🔍 Search PubMed**, ein Thema eingeben, Ergebnisse auswählen → **Add**.
   Jeder wird zu einer Notiz in `References/` mit KI-Zusammenfassung und Themen-Tags.
4. **Schreiben & zitieren** — in einer beliebigen Notiz `@` tippen und eine Referenz wählen → `[@citekey]`.
5. **Literaturverzeichnis** — `Ctrl/Cmd-P` → **Update bibliography** → eine `## References`-Liste im
   gewählten Zeitschriftenstil.

> Der Zitier-Workflow benötigt **keine Embeddings**. Semantische Suche & Chat sind optional und
> erfordern einmalig **Rebuild search index**.

### Claude Code oder Codex verbinden

Öffnen Sie in Obsidian Desktop **Settings → Refwright → External AI (MCP)**,
aktivieren Sie den Zugriff und kopieren Sie dann den erzeugten Claude-Code-Befehl bzw. die Codex-Konfiguration. Lassen Sie diesen
Vault geöffnet, solange Sie die Werkzeuge nutzen. Die [vollständige MCP-Anleitung](docs/MCP.md) enthält die Werkzeugliste,
den sicheren Bearbeitungs-Workflow, Beispiel-Prompts, das Sicherheitsmodell und die Fehlersuche.

MCP überlässt Schlussfolgerungen und Texte Claude Code oder Codex. Es ruft weder **Chat with library**,
die Artikelzusammenfassung noch den LLM-Reranker auf; nur die Bibliothekssuche bzw. der Neuaufbau des Index kann den konfigurierten
Embedding-Anbieter verwenden.

Für einen vollständigen Import bitten Sie den Client, den Artikel hinzuzufügen und zusammenzufassen. Er folgt
`add_reference` → `get_reference_source` → `save_reference_summary`: Der PMC-Volltext wird bevorzugt,
das Abstract ist die Rückfalloption, und ein aktueller Notiz-Hash verhindert das Überschreiben gleichzeitiger Änderungen.

---

<a id="manuwright"></a>

## 🖋️ Das Paper mit manuwright schreiben

[**manuwright**](https://github.com/grotyx/Academic_writing_c_claudecode) ist ein Begleitprojekt desselben Autors: ein Workflow für medizinische Manuskripte
für KI-Agenten (Claude Code, Codex, Antigravity, opencode, Muse). Er lässt den Agenten
vor dem Schreiben planen, nur registrierte Quellen zitieren, jede Zahl aus Ihren Ergebnisdateien übernehmen
und vor der Einreichung Verifikationsschritte bestehen. Er nutzt den MCP-Server dieses Plugins als
Referenzbibliothek:

- **Die Bibliothek wird mit jedem Agenten geteilt.** `manuwright obsidian connect` registriert den
  MCP-Server dieses Plugins (`rag-obsidian`) bei jedem installierten Agenten, sodass jeder von ihnen Ihre
  Artikel durchsuchen kann, während er schreibt. `manuwright obsidian install` kann das Plugin auch in einen Vault installieren
  und den MCP-Zugriff für Sie einschalten.
- **Obsidian findet Artikel; manuwright entscheidet, was zitiert werden darf.** `manuwright evidence
  import-obsidian <citekey>` kopiert eine Referenznotiz in die `knowledge/evidence.md` des Papers: Die
  CSL-Felder werden zum Zitat, die KI-Zusammenfassung des Plugins füllt die Zusammenfassungsfelder, und der
  Citekey wird zur ID `[EVID:citekey]`. Importierte Einträge gelten zunächst als *abstract-only*, bis Sie
  den Volltext gelesen haben.

```sh
uv tool install git+https://github.com/grotyx/Academic_writing_c_claudecode
manuwright obsidian status          # vaults with this plugin, and which agents are connected
manuwright obsidian connect         # add the rag-obsidian MCP server to your agents
manuwright evidence import-obsidian lv2024efficacy
```

<p align="center"><img src="https://raw.githubusercontent.com/grotyx/Academic_writing_c_claudecode/main/docs/images/manual/43_obsidian_import_evidence.png" width="720" alt="manuwright importiert eine Referenz aus der Obsidian-Bibliothek in evidence.md"></p>

manuwright ist optional: Das Plugin funktioniert eigenständig, und manuwright funktioniert ohne Obsidian.
Lassen Sie Obsidian mit aktiviertem MCP-Zugriff geöffnet, solange Agenten die Bibliothek nutzen. Siehe das
[manuwright-Handbuch](https://github.com/grotyx/Academic_writing_c_claudecode/blob/main/docs/manual.md#3b-your-obsidian-library-optional-recommended).

---

## ⚙️ Anbieter

Austauschbar, alles über `requestUrl` von Obsidian in Obsidian Desktop:

**Ab Werk sind beide auf den OpenAI-kompatiblen Anbieter mit OpenRouter eingestellt**, sodass ein
einziger Schlüssel Chat, Artikelzusammenfassungen und Embeddings abdeckt und nichts lokal installiert werden muss.
Fügen Sie den Schlüssel ein, und Sie sind fertig; alles Weitere ist optional.

- **LLM** (Chat + Zusammenfassungen): OpenAI / kompatibel (Standard) · Anthropic · Ollama (lokal) ·
  **Codex CLI** · **OpenCode CLI**. *Chat model* ist optional und überschreibt das Standardmodell nur für **Chat with library** —
  dort lohnt sich ein stärkeres Modell, während Zusammenfassungen und die Extraktion von PDF-Metadaten beim
  günstigeren Standardmodell bleiben.
- **Embeddings** (Suche + Chat): OpenAI / kompatibel (Standard) · Ollama (lokal).
- **Kein API-Schlüssel: Codex CLI / OpenCode CLI** (Desktop). Wenn Sie bereits Codex (ChatGPT-Login)
  oder OpenCode nutzen, wählen Sie es als LLM-Anbieter: Jeder Chat-, Zusammenfassungs- und Rerank-Aufruf läuft über
  diese CLI mit Ihrem eigenen Login, und das Plugin speichert keinen Schlüssel. Lassen Sie *Default model* leer für
  den Standard der CLI oder nennen Sie eines (`gpt-5.1-codex`; bei OpenCode `provider/model`). Die CLI
  wird in den üblichen Installationsordnern gefunden, oder Sie setzen *CLI executable*; **Test** prüft sie. Die Aufrufe laufen
  aus einem leeren temporären Ordner mit übersprungener Benutzerkonfiguration der CLI (deren MCP-Server und Hooks
  würden sonst bei jedem Aufruf starten), dauern etwa 4–7 s je Aufruf und laufen in Batches zu dritt parallel.
  Embeddings benötigen weiterhin OpenRouter/OpenAI oder Ollama.
- **Index location**: *Keep the search index outside the vault* (Desktop) legt ihn im
  App-Data-Ordner des Computers ab, damit ein synchronisierter Vault ihn nicht nach jeder Änderung neu hochlädt; jedes
  Gerät baut dann seinen eigenen auf.
- **Retrieval**: *Results (top-k)* gibt an, aus wie vielen Passagen eine Antwort aufgebaut wird (Standard 20; höchstens
  drei pro Referenz, damit ein langer Artikel nicht alle Plätze belegt). *Rerank chat results with
  the LLM* ist standardmäßig aus — eingeschaltet ruft der Chat doppelt so viele Passagen ab und lässt das
  Modell sie zuerst nach Relevanz ordnen, mit einer zusätzlichen Anfrage pro Frage.

> OpenRouter-Modell-IDs tragen ein Anbieterpräfix (`openai/…`, `deepseek/…`). Die Basis-URL stattdessen auf
> `https://api.openai.com/v1` zu setzen funktioniert ebenfalls — lassen Sie dann das Präfix der Modell-IDs weg.

**OpenRouter im Einsatz?** Wählen Sie für Chat und Embeddings den Anbieter **OpenAI** — ein Schlüssel,
eine Basis-URL, Hunderte Modelle:

| Setting | Value |
|---|---|
| Chat / Embedding provider | `OpenAI` |
| OpenAI base URL (shared) | `https://openrouter.ai/api/v1` |
| Chat model | any OpenRouter id, e.g. `deepseek/deepseek-v4-flash` |
| Embedding model | `openai/text-embedding-3-small` |
| API key (OpenRouter or OpenAI) | your OpenRouter key ([openrouter.ai/keys](https://openrouter.ai/keys)) |

**Google Gemini im Einsatz?** Wählen Sie den Anbieter **OpenAI** und verweisen Sie ihn auf den Endpunkt von Google:

| Setting | Value |
|---|---|
| Chat provider | `OpenAI` |
| Chat model | `gemini-3.5-flash` |
| Embedding provider | `OpenAI` |
| Embedding model | `gemini-embedding-001` |
| OpenAI base URL (shared) | `https://generativelanguage.googleapis.com/v1beta/openai` |
| API key (OpenRouter or OpenAI) | your Gemini key ([Google AI Studio](https://aistudio.google.com/apikey)) |

---

## ✍️ Ein Paper schreiben (ohne Zotero- / Word-Plugins)

```text
Obsidian:  write Manuscript.md  →  type @ to cite  →  set the journal: csl: springer-basic-brackets
           Ctrl/Cmd-P → "Compile manuscript"        →  Manuscript (compiled).md
           Ctrl/Cmd-P → "Export manuscript to Word (.docx)"  →  Manuscript.docx (needs Pandoc)
```

- **Compile manuscript** löst jedes `[@citekey]` in sein formatiertes Zitat im Text auf und hängt
  die `## References`-Liste an — bereit für Pandoc / die Einreichung.
- **Export manuscript to Word (.docx)** kompiliert auf dieselbe Weise und startet Pandoc mit der mitgelieferten
  akademischen Vorlage: Times New Roman 12 pt, zweizeilig, schwarz. Pandoc wird in den üblichen
  Installationsordnern gefunden; liegt es woanders, setzen Sie seinen Pfad unter Settings → Writing.
  (`scripts/to-docx.cjs` leistet dasselbe weiterhin im Terminal.)

---

## 🎨 Zitierstile

Literaturverzeichnisse und Zitate im Text nutzen **citeproc-js** auf Basis Ihres CSL-JSON — dieselbe Engine,
die Zotero verwendet.

- **Global:** Settings → *Bibliography style (CSL)*. Offline mitgeliefert: **Spine · The Spine
  Journal · European Spine Journal · AMA · APA**. Oder geben Sie eine beliebige Stil-ID ein (z. B. `nature`,
  `the-lancet`) — sie wird aus dem [CSL-Repository](https://github.com/citation-style-language/styles) geladen
  und zwischengespeichert.
- **Pro Manuskript:** `csl:` im Frontmatter der Notiz ergänzen — es überschreibt den globalen Stil.

```yaml
---
csl: springer-basic-brackets
---
```

| Zeitschrift | `csl:`-Wert |
|---|---|
| Spine | `spine` |
| The Spine Journal | `elsevier-vancouver` |
| European Spine Journal | `springer-basic-brackets` |
| Global Spine Journal | `american-medical-association` |
| alle anderen | jede ID aus dem CSL-Stilarchiv |

---

## 🧰 Befehle

| Gruppe | Befehle |
|---|---|
| **Add** | Search PubMed · Add by DOI / PMID / arXiv / title · Import (BibTeX / RIS / nbib / CSL-JSON / Zotero) · Import PDF |
| **Read** | Mark unread / reading / read · Reading queue · Find open-access PDF · Download open-access PDF · Download open-access PDF files for references without one · Link PDF files in a folder to references · Extract PDF highlights · Index linked PDF files · Index this note's PDF · Open reference online |
| **Organize** | Summarize and tag references (fill gaps) · Summarize and tag this reference · Summarize and tag references in a folder or tag… · Re-summarize this reference · Re-summarize references made by an older model · Open screening pane · Create PRISMA flow diagram · Library dashboard · Find duplicates · Merge duplicates… · Backfill citation counts · Check retraction (this note / all) · Rename tag · Enrich metadata · Suggest related papers · Export citation network |
| **Write** | `@` autocomplete · Suggest citations for selection · Find unsupported claims · Update bibliography · Choose citation style… · Check references in this manuscript · Compile manuscript · Export manuscript to Word (.docx) · Copy citation · Export annotated bibliography · Save latest chat answer as note |
| **Search** | Search library (semantic) · Chat with library · Show related papers · Build citation graph · Rebuild search index |
| **Export** | Library → BibTeX / RIS / CSL-JSON |

---

## 🛠️ Für Entwickler

```bash
npm run dev        # esbuild watch → main.js
npm run deploy     # build + copy into the vault (VAULT_PLUGIN_DIR in .env)
npm run build      # tsc + esbuild production
npm test           # live integration suite + MCP contract/security checks
```

Hilfsskript (Terminal, Obsidian nicht nötig) — Pfad aus `.env`:

```bash
node scripts/to-docx.cjs "Manuscript (compiled).md"                  # compiled md → styled .docx
```

Siehe [`docs/MCP.md`](./docs/MCP.md) für die Einrichtung externer KI,
[`docs/MIGRATION-0.6.md`](./docs/MIGRATION-0.6.md) für die Migration von 0.5.x und
[`CLAUDE.md`](./CLAUDE.md) für die Modulübersicht.

---

## ⚠️ Hinweise & Einschränkungen

- Die Community-kompatible Plugin-ID lautet `academic-paper-citation-manager`. Der MCP-Verbindungsname
  bleibt `rag-obsidian`; diese Bezeichner sind voneinander unabhängig.
- Dateinamen sind **lesbar** (`2022-SpineJ-ParkSM-Biportal.md`); der kurze `citekey:` im
  Frontmatter ist das Kürzel für `[@cite]`.
- Der `.docx`-Export benötigt **Pandoc**; die Extraktion von PDF-Highlights benötigt ein PDF mit Annotationen.
- Diese Version ist **nur für Desktop**, weil die optionale MCP-Live-Bridge Node-APIs nutzt. Lassen Sie
  Obsidian Desktop und den Ziel-Vault geöffnet, solange Sie MCP verwenden.
- Das Properties-Fenster von Obsidian kann bei verschachteltem CSL-Frontmatter warnen — die Daten sind gültig.
- Tragen Sie in den Einstellungen die **Contact e-mail** ein: OpenAlex, Unpaywall und PubMed nutzen sie alle, und
  die Suche nach Open-Access-PDFs funktioniert ohne sie nicht.
- API-Schlüssel liegen im Schlüsselbund des Betriebssystems (secretStorage von Obsidian) und sind in `data.json` geleert; in einem
  synchronisierten Vault geben Sie den Schlüssel einmal pro Gerät ein.
- Source-Builds/Deployments enthalten CSL-Stile unter `styles/` (CC BY-SA 3.0; siehe
  `styles/README.md`). Community-Installationen laden einen gewählten CSL-Stil/eine Locale herunter und speichern sie zwischen, falls
  sie in den drei Release-Dateien nicht enthalten sind. Der Plugin-Code steht unter MIT.
- Die Installation auf Mobilgeräten wird seit 0.6.0 nicht unterstützt; siehe [docs/MOBILE.md](docs/MOBILE.md).

## 🔒 Netzwerk und Datenschutz

- Die Suche nach Referenzen sendet bei Bedarf Kennungen oder Suchanfragen an Crossref, NCBI PubMed/PMC, OpenAlex,
  Unpaywall und arXiv. CSL-Stile/Locales können aus dem offiziellen CSL-GitHub-Repository heruntergeladen werden. PDF.js ist im Plugin gebündelt; es wird kein ausführbarer Code aus einem CDN geladen.
  Für Netzwerkanfragen gelten die Datenschutzbestimmungen der kontaktierten Dienste.
- KI-Funktionen senden den ausgewählten Quelltext und den Prompt an den von Ihnen konfigurierten Anbieter: einen
  OpenAI-kompatiblen Endpunkt (einschließlich OpenRouter oder Gemini), Anthropic oder Ollama. API-Schlüssel werden,
  sofern verfügbar, in Obsidian SecretStorage gespeichert; ältere Obsidian-Versionen weichen auf die `data.json` des Plugins aus.
  Das Plugin hat keine Telemetrie, keine Werbung, keinen Kontodienst und kein gehostetes Backend.
- Bei eingeschaltetem *Rerank results with a cross-encoder* (Standard) werden die Suchanfrage und die abgerufenen
  Passagen an den Rerank-Endpunkt von OpenRouter gesendet. Bei eingeschaltetem *Translate non-English searches*
  (Standard) wird eine nicht englische Suchanfrage zur Übersetzung an Ihr Chat-Modell gesendet. *Build MeSH synonym list
  for search* sendet die häufigen Themen-Tags Ihrer Bibliothek an NCBI E-utilities.
- MCP lauscht nur auf dem authentifizierten `127.0.0.1`. Es schreibt eine erzeugte Bridge neben das Plugin
  und eine kurzlebige Discovery-Datei in das temporäre Verzeichnis des Betriebssystems (außerhalb des
  Vaults); beide enthalten Verbindungsdaten, niemals Notizinhalte oder API-Schlüssel von Anbietern. MCP-Werkzeuge können
  Markdown im Vault nur lesen und ändern, wenn Sie den MCP-Zugriff aktivieren. Siehe [das MCP-Sicherheitsmodell](docs/MCP.md#editing-and-deletion-safeguards).
- **Lokale Programme (Desktop, Opt-in).** Zwei Funktionen starten ein bereits auf Ihrem
  Computer installiertes Programm, und zwar nur, wenn Sie sie nutzen: die LLM-Anbieter **Codex CLI / OpenCode CLI** (der Prompt
  und der Quelltext gehen an diese CLI, die sie unter Ihrem Login an ihren eigenen Anbieter weiterreicht; das
  Plugin speichert keinen Schlüssel und überspringt die Benutzerkonfiguration der CLI) und **Export manuscript to Word**
  (Pandoc, lokal auf dem kompilierten Manuskript ausgeführt). Das Plugin lädt keines der beiden Programme herunter und installiert sie auch nicht.
- **Dateien außerhalb des Vaults (Desktop, Opt-in).** Ist „Keep the search index outside the vault“
  eingeschaltet, wird der Index in den App-Data-Ordner des Betriebssystems geschrieben
  (`~/Library/Application Support`, `%LOCALAPPDATA%` oder `~/.local/share`, jeweils unter
  `academic-paper-citation-manager/`; bis 0.8.1 war es der Cache-Ordner, den Bereinigungsprogramme leeren).
  CLI- und Pandoc-Aufrufe nutzen einen temporären Ordner, der nach jedem Aufruf gelöscht wird.

## 👤 Autor

**Professor Sang-Min Park, M.D., Ph.D.**
Department of Orthopaedic Surgery, Seoul National University Bundang Hospital,
Seoul National University College of Medicine
🌐 [sangmin.me](https://sangmin.me/)

## 📄 Lizenz

MIT (Plugin-Code). Das gebündelte PDF.js behält seine vollständige Apache-2.0-Lizenz und den Änderungshinweis in `main.js`; die CSL-
Stile/Locales behalten ihre Lizenz CC BY-SA 3.0 (siehe [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)).
