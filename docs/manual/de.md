# Benutzerhandbuch — Refwright

[English](en.md) · [한국어](ko.md) · [中文](zh.md) · [日本語](ja.md) · [Español](es.md) · **Deutsch** · [Français](fr.md) · [Português](pt.md)

Dieses Handbuch führt Sie durch das Plugin, von der Sammlung der Artikel bis zum Export eines
Word-Manuskripts. Alle Screenshots stammen aus dem echten Plugin. Die roten Zahlen in jedem
Screenshot entsprechen den nummerierten Schritten darunter.

**Arbeitsablauf:** Artikel sammeln → lesen und ordnen → suchen und fragen → zitieren → nach Word exportieren

**Inhalt**

0. [Einrichtung](#0-einrichtung)
1. [Die Oberfläche](#1-die-oberfläche)
2. [Artikel aus PubMed hinzufügen](#2-artikel-aus-pubmed-hinzufügen)
3. [Einen Artikel per DOI oder PMID hinzufügen](#3-einen-artikel-per-doi-oder-pmid-hinzufügen)
4. [Referenznotizen](#4-referenznotizen)
5. [Die Bibliothek durchsuchen](#5-die-bibliothek-durchsuchen)
6. [Im Manuskript zitieren](#6-im-manuskript-zitieren)
7. [Semantische Suche](#7-semantische-suche)
8. [Mit der Bibliothek chatten](#8-mit-der-bibliothek-chatten)
9. [Verwandte Artikel](#9-verwandte-artikel)
10. [Manuskript fertigstellen und nach Word exportieren](#10-manuskript-fertigstellen-und-nach-word-exportieren)

---

## 0. Einrichtung

Installieren Sie das Plugin über **Settings → Community plugins → Browse**: Suchen Sie nach
„Academic Paper Citation Manager“, installieren und aktivieren Sie es. Geben Sie anschließend
einmalig Ihren KI-Schlüssel ein.

![Plugin-Einstellungen: Embedding-Anbieter und API-Schlüssel](img/en/13-settings.png)

1. Lassen Sie **Embedding provider** auf `OpenAI / compatible`. Die Standard-Basis-URL ist
   OpenRouter, sodass ein einziger Schlüssel für Suche, Chat und Zusammenfassungen genügt.
2. Fügen Sie Ihren OpenRouter-Schlüssel in **OpenAI API key** ein. Der Schlüssel wird im
   Schlüsselbund Ihres Systems gespeichert, nicht in den Dateien des Vaults.

> **Zum Zitieren ist kein Schlüssel nötig.** Artikel hinzufügen, `@`-Zitate und
> Literaturverzeichnisse funktionieren ohne KI-Schlüssel. Der Schlüssel wird nur für
> Zusammenfassungen, die semantische Suche und den Chat benötigt.

## 1. Die Oberfläche

Das Plugin fügt der linken Ribbon-Leiste drei Symbole und rechts ein Bibliotheksfenster hinzu.

![Obsidian-Fenster mit den Ribbon-Symbolen und dem Bibliotheksfenster](img/en/01-overview.png)

1. **Open library**: öffnet die Liste Ihrer Artikel.
2. **Chat with library**: öffnet einen Chat, der aus Ihren eigenen Artikeln antwortet.
3. **Search PubMed**: durchsucht PubMed und fügt Artikel hinzu.
4. **Library pane**: Jeder Artikel ist eine Notiz. Ein Klick auf einen Titel öffnet die Notiz.

## 2. Artikel aus PubMed hinzufügen

Der schnellste Weg, eine Bibliothek aufzubauen. Suchen Sie, haken Sie die gewünschten Artikel
an, und aus jedem wird eine Notiz mit Zusammenfassung und Themen-Tags.

![Dialog „Search PubMed“ mit Suchergebnissen](img/en/03-pubmed-search.png)

1. Geben Sie unter **Query** eine Suchanfrage ein, zum Beispiel
   `biportal endoscopic lumbar decompression`.
2. Lassen Sie **Summarize with LLM** eingeschaltet, um in jeder Notiz eine nach Abschnitten
   gegliederte Zusammenfassung zu erhalten. Bei Open-Access-Artikeln wird die Zusammenfassung
   aus dem Volltext erstellt.
3. Klicken Sie auf **Search**.
4. Haken Sie die Artikel an, die hinzugefügt werden sollen. Artikel mit der Markierung
   **Open Access** werden aus dem Volltext zusammengefasst.

![Die Schaltfläche „Add selected“ am Ende der Ergebnisse](img/en/04-pubmed-add.png)

1. Klicken Sie unten in der Liste auf **Add selected**. Die beiden Symbole daneben wählen alle
   Einträge aus bzw. heben die Auswahl auf. Jeder Artikel braucht etwa 10–20 Sekunden; wenn er
   fertig ist, erscheint die Meldung „Added 1 reference.“

> **Keine Duplikate.** Ein Artikel, der bereits in Ihrer Bibliothek ist, wird anhand von DOI,
> PMID oder Titel erkannt und nicht erneut hinzugefügt.

## 3. Einen Artikel per DOI oder PMID hinzufügen

Wenn Sie den Artikel kennen, fügen Sie einfach seine Kennung ein. Klicken Sie im
Bibliotheksfenster auf **+ add** oder führen Sie in der Befehlspalette
„Add reference by DOI / PMID / arXiv“ aus.

![Dialog „Add reference“ mit eingegebener DOI](img/en/02-add-reference.png)

1. Geben Sie eine DOI (`10.7759/cureus.46944`), eine PMID (`38021704`) oder eine arXiv-ID ein.
   Auch ein Artikeltitel funktioniert; dann wird danach gesucht.
2. Klicken Sie auf **Fetch & add**. Die Metadaten stammen von Crossref und PubMed.

> **Sie haben ein PDF?** Mit **📎 PDF** im Bibliotheksfenster fügen Sie einen Artikel anhand
> seines PDFs hinzu. Die im PDF enthaltene DOI dient dazu, die Metadaten zu ergänzen.

## 4. Referenznotizen

Jeder Artikel wird als Markdown-Notiz in `References/` gespeichert. Die Dateien sind die
Datenbank, ein separates Programm wie Zotero ist also nicht nötig.

![Eine Referenznotiz mit eingeklappten Properties und dem Abschnitt „Summary“](img/en/05-reference-note.png)

1. **Properties**: Autoren, Jahr, Zeitschrift, DOI, PMID und Tags (aus MeSH). Auch der
   Schlüssel zum Zitieren, der `citekey` (zum Beispiel `lv2024efficacy`), steht hier.
2. **Summary**: Background, Methods, Results und Conclusions. Eigene Notizen schreiben Sie
   weiter unten unter **Notes**.

## 5. Die Bibliothek durchsuchen

Filtern Sie das Bibliotheksfenster, wenn es wächst.

![Bibliotheksfenster, gefiltert nach „stenosis“](img/en/06-library.png)

1. **Filter**: durchsucht Titel, Autoren und Tags. Die Eingabe `stenosis` lässt 15 von
   56 Artikeln übrig. Das Menü rechts daneben ändert die Sortierung (zum Beispiel neuestes
   Jahr zuerst).
2. **Quick filters**: zeigen nur Artikel mit PDF, ohne PDF, ungelesene oder zurückgezogene
   (retracted) Artikel.
3. **+ add**: öffnet den DOI/PMID-Dialog (Abschnitt 3).
4. **📎 PDF**: fügt einen Artikel aus einer PDF-Datei hinzu.

## 6. Im Manuskript zitieren

Schreiben Sie Ihr Manuskript in einer gewöhnlichen Notiz. Tippen Sie `@` an der Stelle, an
der ein Zitat stehen soll.

![Zitatvorschläge nach der Eingabe von @lv](img/en/07-cite-suggest.png)

1. Tippen Sie nach dem `@` einen Teil eines Autorennamens oder Titels, um passende Artikel zu
   sehen. Mit <kbd>Enter</kbd> wird `[@lv2024efficacy]` eingefügt.

### Literaturverzeichnis erstellen

Tragen Sie den Zeitschriftenstil in die Properties der Notiz ein (`csl: spine`) und führen
Sie dann <kbd>Cmd/Ctrl</kbd>+<kbd>P</kbd> → **Update bibliography in current note** aus.

![Formatierte Zitate und das erzeugte Literaturverzeichnis](img/en/08-bibliography.png)

1. In der Leseansicht erscheint jedes `[@citekey]` im Stil der Zeitschrift (hier als hochgestellte
   Zahlen).
2. Am Ende der Notiz wird ein Abschnitt **References** im Format der Zeitschrift geschrieben.
   Führen Sie den Befehl nach dem Hinzufügen oder Entfernen von Zitaten erneut aus, um ihn
   zu aktualisieren.

> **Zeitschriftenstile**: `spine`, `apa`, `american-medical-association`, `elsevier-vancouver`
> und `springer-basic-brackets` sind integriert. Jede andere Stil-ID aus dem
> [CSL-Stilarchiv](https://github.com/citation-style-language/styles), etwa
> `vancouver` oder `nature`, wird bei der ersten Verwendung heruntergeladen. Sie kennen die ID nicht? Führen Sie **Choose citation
> style…** aus und tippen Sie den Namen der Zeitschrift.

## 7. Semantische Suche

Findet Passagen mit ähnlicher Bedeutung, auch wenn die Wörter abweichen. Öffnen Sie sie über
**Search** im Bibliotheksfenster. Klicken Sie zuvor einmal auf **Rebuild index** (bei etwa
50 Artikeln dauert das weniger als eine Minute).

![Suchfenster mit Passagen zu Duraläsionen](img/en/09-search.png)

1. Beschreiben Sie, wonach Sie suchen, zum Beispiel `dural tear and other complications`.
2. Grenzen Sie die Ergebnisse nach Jahresbereich, Autor oder Tag ein.
3. Klicken Sie auf **Search**. Die passenden Passagen werden nach Artikeln gruppiert
   aufgelistet; ein Klick darauf öffnet die zugehörige Notiz.

## 8. Mit der Bibliothek chatten

Die Antworten stammen ausschließlich aus den Artikeln, die Sie gesammelt haben. Die Zahlen in
eckigen Klammern, etwa `[1]` und `[3]`, zeigen, aus welchem Artikel die jeweilige Aussage
stammt.

![Chat-Fenster mit einer Frage und einer belegten Antwort](img/en/10-chat.png)

1. Ihre Frage. Sie können in jeder Sprache fragen.
2. Die Antwort. Die Zahlen in eckigen Klammern sind die Quellen.
3. Das Eingabefeld. Mit <kbd>Enter</kbd> senden Sie die Frage ab. Die Felder darüber
   beschränken die Quellen nach Jahr, Autor oder Tag.

![Quellen unter der Antwort und die Schaltfläche „Save as note“](img/en/11-chat-sources.png)

1. **SOURCES** listet die Artikel hinter der Antwort auf. **Save as note** speichert die
   Antwort im Ordner `Chat/` und wandelt die Quellen in `[@citekey]`-Zitate um.

## 9. Verwandte Artikel

Zeigt, wie sich Ihre Artikel gegenseitig zitieren. Klicken Sie einmal auf **Build citation
graph**, um die Zitationsdaten von OpenAlex abzurufen (bei 56 Artikeln etwa 40 Sekunden).

![Fenster „Related papers“ mit Zitationskarte und Listen](img/en/12-related.png)

1. **Citation map**: Der violette Punkt ist der geöffnete Artikel. Durchgezogene Kreise sind
   Artikel in Ihrer Bibliothek; gestrichelte Kreise sind Artikel, die Sie noch nicht haben.
   Ein Klick auf einen gestrichelten Kreis fügt ihn hinzu.
2. **Listen**: Artikel, die dieser Artikel zitiert, Artikel, die ihn zitieren, Artikel mit
   vielen gemeinsamen Referenzen und Artikel, die Ihre Bibliothek häufig zitiert, aber nicht
   enthält.

## 10. Manuskript fertigstellen und nach Word exportieren

Alle Befehle finden Sie in der Befehlspalette (<kbd>Cmd/Ctrl</kbd>+<kbd>P</kbd>). Geben Sie
„Refwright“ ein, um sie aufzulisten.

![Befehlspalette mit den Befehlen des Plugins](img/en/14-command-palette.png)

1. Tippen Sie hier einen Teil eines Befehlsnamens. Die am häufigsten genutzten Befehle:

| Befehl | Funktion |
|---|---|
| Update bibliography in current note | Schreibt den Abschnitt „References“ des Manuskripts |
| Compile manuscript | Erstellt eine Kopie, in der `[@citekey]` durch formatierte Zitate ersetzt ist |
| Export manuscript to Word (.docx) | Kompiliert und speichert dann eine Word-Datei (benötigt [Pandoc](https://pandoc.org)) |
| Find unsupported claims | Listet Absätze auf, die eine Aussage ohne Zitat enthalten |
| Suggest citations for selection | Schlägt Artikel für den markierten Satz vor |

![Die kompilierte Kopie des Entwurfs](img/en/15-compiled.png)

1. **Compile manuscript** lässt das Original unverändert und öffnet eine neue Notiz
   **Draft (compiled)**. Die Zitate sind formatiert und das Literaturverzeichnis ist angehängt,
   bereit zur Einreichung. Für eine Word-Datei führen Sie **Export manuscript to Word (.docx)** aus.

---

<sub>Screenshots: Plugin v0.7.8 in einem Test-Vault mit 56 Artikeln. Die Chat-Antworten sind unbearbeitete
Modellausgaben. Maintainer erzeugen die Screenshots mit `python scripts/manual/capture.py en` neu.</sub>
