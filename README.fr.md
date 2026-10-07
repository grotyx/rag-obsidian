<p align="center">
  <img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/assets/logo.svg" width="128" alt="Logo de Refwright">
</p>

<h1 align="center">Refwright</h1>

<p align="center"><i>Anciennement « Academic Paper Citation Manager » — même plugin, même identifiant, mêmes réglages.</i></p>

<p align="center">Vos notes markdown <b>sont</b> la bibliothèque de références.<br>Recherchez dans PubMed, obtenez des résumés par IA, citez dans le style de n'importe quelle revue — une alternative à Zotero / EndNote au cœur d'Obsidian.</p>

<p align="center">
  <a href="https://community.obsidian.md/plugins/academic-paper-citation-manager"><img alt="Téléchargements Obsidian" src="https://img.shields.io/badge/dynamic/json?logo=obsidian&color=7c3aed&label=downloads&query=%24%5B%22academic-paper-citation-manager%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json"></a>
  <a href="https://github.com/grotyx/rag-obsidian/releases/latest"><img alt="version" src="https://img.shields.io/badge/version-0.8.6-8b5cf6"></a>
  <a href="https://obsidian.md"><img alt="Obsidian" src="https://img.shields.io/badge/Obsidian-1.11.4%2B-a78bfa"></a>
  <a href="https://github.com/grotyx/rag-obsidian/blob/main/LICENSE"><img alt="licence" src="https://img.shields.io/badge/license-MIT-green"></a>
</p>

<p align="center"><a href="#-installation">Installation</a> · <a href="https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/fr.md">Guide d'utilisation</a> · <a href="#-fonctionnalités">Fonctionnalités</a> · <a href="https://github.com/grotyx/rag-obsidian/blob/main/docs/MCP.md">Claude Code / Codex</a> · <a href="#manuwright">manuwright</a> · <a href="https://github.com/grotyx/rag-obsidian/blob/main/CHANGELOG.md">Journal des modifications</a></p>

<p align="center"><a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <a href="README.zh.md">中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <b>Français</b> · <a href="README.pt.md">Português</a></p>

<table>
  <tr>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/en/03-pubmed-search.png" alt="Ajouter des articles depuis PubMed"><br><b>Ajouter des articles depuis PubMed</b></td>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/en/07-cite-suggest.png" alt="Citer avec @"><br><b>Citer avec @</b></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/en/10-chat.png" alt="Dialoguer avec votre bibliothèque"><br><b>Dialoguer avec votre bibliothèque</b></td>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/en/12-related.png" alt="Carte des citations"><br><b>Carte des citations</b></td>
  </tr>
</table>

Chaque référence est une simple note `.md` dotée d'un frontmatter [CSL-JSON](https://citationstyles.org/),
si bien que votre bibliothèque reste portable, pérenne et à vous. Aucune application externe,
aucun compte, aucun serveur — rien que votre vault.

---

## 📖 Guide d'utilisation

Un guide pas à pas avec captures d'écran, de l'ajout des articles à l'export d'un manuscrit Word :
[English](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/en.md) · [한국어](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/ko.md) · [中文](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/zh.md) · [日本語](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/ja.md) · [Español](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/es.md) · [Deutsch](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/de.md) · **[Français](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/fr.md)** · [Português](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/pt.md)

[![Citations et bibliographie générée dans Obsidian](https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/en/08-bibliography.png)](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/fr.md)

---

## ✨ Fonctionnalités

**📥 Collecter**
- **Recherche PubMed par mots-clés** directement dans Obsidian → sélection des articles → notes.
- Ajout par **DOI / PMID / arXiv**, ou par **titre d'article** (recherche automatique).
- **Import** d'une bibliothèque existante — **BibTeX · RIS · PubMed `.nbib` · CSL-JSON**, ou
  directement depuis un **Zotero 7** en cours d'exécution (toute la bibliothèque ou une seule collection).

**🧠 Résumer (IA)**
- Un LLM rédige dans chaque note un **résumé section par section** (Background / Methods / Results /
  Conclusions). Le réglage *Summary language* (Settings → Chat) permet de choisir l'anglais, le coréen,
  les deux (par défaut : l'anglais plus un résumé coréen concis), ou toute autre langue désignée par son nom.
- Utilise le **texte intégral** pour les articles en accès libre (PubMed Central), le résumé (abstract) sinon.

**🏷️ Organiser**
- Étiquette automatiquement chaque note avec des **termes thématiques MeSH** → la **vue graphe** d'Obsidian
  regroupe vos articles par sujet.
- **Graphe de citations** (OpenAlex) : références / citations reçues au sein de votre bibliothèque, et
  recommandations d'articles *« fréquemment cités mais absents »* — dessinés sous forme de **carte** dans le
  panneau Related (les nœuds pleins sont des notes que vous possédez, les nœuds en pointillés des articles que
  vous n'avez pas ; cliquez sur un nœud en pointillés pour l'ajouter). Construisez-le une fois avec le bouton
  du panneau ; les références ajoutées ensuite l'y rejoignent d'elles-mêmes.
- Statut de lecture, **tableau de bord**, nombre de citations. Le **panneau Library** trie par année, titre,
  auteur, citations ou date d'ajout, avec des filtres rapides (avec PDF / sans PDF / non lu / rétracté).
- **Doublons** : repérez-les, puis **fusionnez-les** — une note est conservée, les lacunes sont comblées à partir
  des autres, et les citations `[@old]` sont réécrites dans tout le vault.
- **Vérification des rétractations** pour une note ou pour toute la bibliothèque (OpenAlex), avec une note de rapport.
- **Revue systématique** : un **panneau de screening** (include / exclude / maybe, questions clés, niveau de
  preuve, design, motifs d'exclusion, raccourcis clavier) et un **diagramme de flux PRISMA 2020** pour toutes les
  références ou pour un tag.
- **PDF** : téléchargez des copies en accès libre pour chaque référence qui n'en a pas (Unpaywall), ou
  **associez un dossier de PDF** que vous possédez déjà — appariés par nom de fichier, DOI, PMID ou titre.

**✍️ Citer et rédiger**
- Tapez `@` → l'autocomplétion insère `[@citekey]`.
- **« Update bibliography »** construit une liste `## References` dans un véritable **style de revue**
  (citeproc-js / CSL) ; les appels de citation dans le texte s'affichent en conséquence (`[1]`, exposant, ou
  auteur–date).
- **Style propre à chaque manuscrit** via le frontmatter `csl:` d'une note — ou **Choose citation style…** et
  recherche parmi environ 10 000 styles de revues par nom de revue.
- Les citations s'affichent pendant la frappe en **Live Preview** ; **survolez**-en une pour voir l'article.
- **Check references in this manuscript** avant la soumission : références absentes de la bibliothèque,
  rétractées, sans DOI, ou aux métadonnées incomplètes.
- **Compile manuscript** → une copie propre avec les citations résolues → export vers **`.docx`**.

**🔎 Rechercher et dialoguer**
- **Recherche sémantique** hybride (BM25 + vecteurs) et **chat fondé sur les citations** qui ne répond
  qu'à partir de votre bibliothèque, avec des sources `[n]`.
- **Récupération mesurée** (0.8.1) : un **reranker cross-encoder** hébergé (environ 0,0002 $ par recherche), une
  **expansion de requête** (votre propre vocabulaire de recherche + termes d'entrée MeSH) et la **traduction
  automatique** des questions en coréen (ou dans toute langue autre que l'anglais). Sur un benchmark clinique de
  96 questions portant sur 16 578 articles, le nDCG@10 est passé de 0,53 à 0,81 pour les questions en anglais et de
  0,18 à 0,83 pour celles en coréen.
- **Recherche au niveau des résultats** pour Claude Code / Codex (MCP `search_findings`) : résultats individuels —
  taille d'effet, IC, p et citation textuelle — tirés de la section `## Evidence (extracted)` d'une note.
- **Filtres dans les panneaux de recherche *et* de chat** — restreignez par **période de publication**, par
  **auteur** (nom de famille) et par **tag** : saisissez dans la zone de tag (elle propose une autocomplétion à
  partir des tags déjà présents dans votre bibliothèque) et appuyez sur Entrée pour ajouter une pastille ; si vous
  en ajoutez plusieurs, un article doit toutes les porter. Les filtres appartiennent au panneau et non aux
  réglages ; dans le panneau de chat, ils délimitent les articles dont une réponse peut s'inspirer, et la liste
  des sources de la réponse indique la restriction appliquée.
- **Claude Code / Codex via MCP (bureau) :** laissez une IA externe interroger la bibliothèque en direct,
  trouver, ajouter et résumer des articles, créer / modifier / déplacer / mettre à la corbeille des notes Markdown
  en toute sécurité, et compiler un manuscrit avec citations. Le texte des résumés vient de Claude/Codex ; la voie
  MCP n'appelle jamais le LLM de chat, de résumé ou de reranking de ce plugin. Des boutons de configuration sont
  fournis pour Claude Code, Codex, OpenCode et Antigravity ; les sept outils d'édition de notes peuvent être désactivés.
- **Aucune clé API nécessaire pour le LLM (bureau) :** le chat et les résumés peuvent passer par votre
  **Codex CLI** ou **OpenCode CLI** déjà connecté. Les embeddings de recherche requièrent toujours OpenRouter/OpenAI
  ou un Ollama local.

---

## 📦 Installation

> **Publié dans le répertoire des plugins communautaires d'Obsidian :**
> [community.obsidian.md/plugins/academic-paper-citation-manager](https://community.obsidian.md/plugins/academic-paper-citation-manager).
> La version 0.6.0 a changé l'identifiant du plugin ; si vous êtes encore en 0.5.x, suivez une fois le
> [guide de migration](docs/MIGRATION-0.6.md).

### Option A — Plugins communautaires (recommandé)

1. Obsidian → **Settings → Community plugins** → désactivez le mode restreint s'il est activé.
2. **Browse** → recherchez **Refwright** → **Install** → **Enable**.

Obsidian le met à jour comme n'importe quel autre plugin (**Settings → Community plugins → Check for updates**).
Bureau uniquement (Obsidian 1.11.4+).

Installé auparavant via **BRAT** ? L'identifiant et le dossier du plugin sont les mêmes, vos réglages et
votre index sont donc conservés : retirez le plugin de la liste de BRAT et continuez à le mettre à jour via les plugins communautaires.

<details>
<summary><b>Option B — Télécharger une version (manuel)</b></summary>

Depuis la [dernière version](https://github.com/grotyx/rag-obsidian/releases/latest), téléchargez
`main.js`, `manifest.json` et `styles.css` dans

```text
<your vault>/.obsidian/plugins/academic-paper-citation-manager/
```

(créez le dossier s'il n'existe pas), puis rechargez Obsidian et activez le plugin sous
**Settings → Community plugins**. Pour le mettre à jour, il faut retélécharger les trois fichiers.


</details>

<details>
<summary><b>Option C — Le compiler soi-même</b></summary>

Nécessite [Node.js 18+](https://nodejs.org) et [git](https://git-scm.com).

```bash
git clone https://github.com/grotyx/rag-obsidian.git
cd rag-obsidian
npm install

cp .env.example .env        # Windows: copy .env.example .env
# edit .env → set VAULT_PLUGIN_DIR to <your vault>/.obsidian/plugins/academic-paper-citation-manager

npm run deploy              # builds + copies the plugin into your vault
```

Puis, dans Obsidian : **Settings → Community plugins → activez le plugin** → rechargez (`Ctrl/Cmd-R`).


</details>

<details>
<summary><b>Option D — Vault synchronisé dans le cloud (sans compilation sur la 2e machine)</b></summary>

Si votre vault se trouve dans OneDrive / iCloud / Dropbox / Obsidian Sync, le plugin compilé voyage
**dans** le vault (`<vault>/.obsidian/plugins/academic-paper-citation-manager/`). Sur une autre machine, ouvrez
simplement le vault synchronisé et activez le plugin — sans Node, sans compilation.


</details>

---

## 🚀 Démarrage rapide (5 minutes)

1. **Rechargez** Obsidian (`Ctrl/Cmd-R`) et vérifiez que le plugin est activé.
2. **Configurez votre fournisseur d'IA** — Settings → l'onglet du plugin → voir **Fournisseurs** ci-dessous.
3. **Ajoutez un article** — icône de la barre latérale **🔍 Search PubMed**, saisissez un sujet, sélectionnez les résultats → **Add**.
   Chacun devient une note dans `References/` avec un résumé IA + des tags thématiques.
4. **Rédigez et citez** — dans n'importe quelle note, tapez `@` et choisissez une référence → `[@citekey]`.
5. **Bibliographie** — `Ctrl/Cmd-P` → **Update bibliography** → une liste `## References` dans
   le style de revue choisi.

> Le flux de travail de citation ne nécessite **aucun embedding**. La recherche sémantique et le chat sont
> facultatifs et demandent un unique **Rebuild search index**.

### Connecter Claude Code ou Codex

Dans Obsidian Desktop, ouvrez **Settings → Refwright → External AI (MCP)**,
activez l'accès, puis copiez la commande Claude Code ou la configuration Codex générée. Gardez ce
vault ouvert pendant l'utilisation des outils. Consultez le [guide MCP complet](docs/MCP.md) pour la liste des outils,
le flux d'édition sécurisé, des exemples de prompts, le modèle de sécurité et le dépannage.

MCP délègue le raisonnement et la rédaction à Claude Code ou Codex. Il n'appelle ni **Chat with library**,
ni le résumé d'articles, ni le reranker LLM ; seuls la recherche dans la bibliothèque et la reconstruction de l'index
peuvent utiliser le fournisseur d'embeddings configuré.

Pour un import complet, demandez au client d'ajouter et de résumer l'article. Il suivra
`add_reference` → `get_reference_source` → `save_reference_summary` : le texte intégral PMC est préféré,
le résumé (abstract) sert de repli, et le hachage de la note à jour empêche d'écraser des modifications concurrentes.

---

<a id="manuwright"></a>

## 🖋️ Rédiger l'article avec manuwright

[**manuwright**](https://github.com/grotyx/Academic_writing_c_claudecode) est un projet compagnon du même auteur : un flux de travail
de rédaction de manuscrits médicaux pour agents IA (Claude Code, Codex, Antigravity, opencode, Muse). Il oblige l'agent à
planifier avant d'écrire, à ne citer que des sources enregistrées, à tirer chaque chiffre de vos fichiers de résultats
et à franchir des étapes de vérification avant la soumission. Il utilise le serveur MCP de ce plugin comme
bibliothèque de références :

- **La bibliothèque est partagée avec chaque agent.** `manuwright obsidian connect` enregistre le serveur MCP
  de ce plugin (`rag-obsidian`) auprès de chaque agent installé, de sorte que n'importe lequel d'entre eux puisse consulter vos
  articles pendant la rédaction. `manuwright obsidian install` peut aussi installer le plugin dans un vault
  et activer pour vous l'accès MCP.
- **Obsidian trouve les articles ; manuwright décide de ce qui peut être cité.** `manuwright evidence
  import-obsidian <citekey>` copie une note de référence dans le `knowledge/evidence.md` de l'article : les
  champs CSL deviennent la citation, le résumé IA du plugin remplit les champs de résumé, et le
  citekey devient l'identifiant `[EVID:citekey]`. Les entrées importées démarrent en *abstract-only* jusqu'à ce que vous
  ayez lu le texte intégral.

```sh
uv tool install git+https://github.com/grotyx/Academic_writing_c_claudecode
manuwright obsidian status          # vaults with this plugin, and which agents are connected
manuwright obsidian connect         # add the rag-obsidian MCP server to your agents
manuwright evidence import-obsidian lv2024efficacy
```

<p align="center"><img src="https://raw.githubusercontent.com/grotyx/Academic_writing_c_claudecode/main/docs/images/manual/43_obsidian_import_evidence.png" width="720" alt="manuwright important une référence de la bibliothèque Obsidian dans evidence.md"></p>

manuwright est facultatif : le plugin fonctionne seul, et manuwright fonctionne sans Obsidian.
Gardez Obsidian ouvert avec l'accès MCP activé pendant que les agents utilisent la bibliothèque. Consultez le
[manuel de manuwright](https://github.com/grotyx/Academic_writing_c_claudecode/blob/main/docs/manual.md#3b-your-obsidian-library-optional-recommended).

---

## ⚙️ Fournisseurs

Modulaires, tous via `requestUrl` d'Obsidian sur Obsidian Desktop :

**Par défaut, les deux sont réglés sur le fournisseur compatible OpenAI pointant vers OpenRouter**, si bien qu'une
seule clé couvre le chat, les résumés d'articles et les embeddings, sans rien installer en local.
Collez la clé et c'est terminé ; tout le reste est facultatif.

- **LLM** (chat + résumés) : OpenAI / compatible (par défaut) · Anthropic · Ollama (local) ·
  **Codex CLI** · **OpenCode CLI**. *Chat model* est facultatif et remplace le modèle par défaut pour **Chat with library** uniquement —
  un modèle plus puissant y est utile, tandis que les résumés et l'extraction des métadonnées de PDF restent sur le
  modèle par défaut, plus économique.
- **Embeddings** (recherche + chat) : OpenAI / compatible (par défaut) · Ollama (local).
- **Sans clé API : Codex CLI / OpenCode CLI** (bureau). Si vous utilisez déjà Codex (connexion ChatGPT)
  ou OpenCode, choisissez-le comme fournisseur de LLM : chaque appel de chat, de résumé et de reranking passe par
  ce CLI avec votre propre connexion, et le plugin ne stocke aucune clé. Laissez *Default model* vide pour
  utiliser le modèle par défaut du CLI, ou nommez-en un (`gpt-5.1-codex` ; pour OpenCode `provider/model`). Le CLI
  est détecté dans les dossiers d'installation habituels, ou renseignez *CLI executable* ; **Test** le vérifie. Les appels s'exécutent
  depuis un dossier temporaire vide, sans la configuration utilisateur du CLI (ses serveurs MCP et ses hooks
  démarreraient sinon à chaque appel), en 4 à 7 s environ chacun, trois à la fois dans les traitements par lots.
  Les embeddings requièrent toujours OpenRouter/OpenAI ou Ollama.
- **Emplacement de l'index** : *Keep the search index outside the vault* (bureau) le stocke dans le
  dossier de données d'application de l'ordinateur, de sorte qu'un vault synchronisé ne le renvoie pas après chaque
  modification ; chaque appareil construit alors le sien.
- **Récupération** : *Results (top-k)* est le nombre de passages à partir desquels une réponse est construite (20 par défaut ; au
  plus trois par référence, afin qu'un long article ne prenne pas toutes les places). *Rerank chat results with
  the LLM* est désactivé par défaut — activé, le chat récupère deux fois plus de passages et demande au
  modèle de les ordonner d'abord par pertinence, au prix d'une requête supplémentaire par question.

> Les identifiants de modèles OpenRouter portent un préfixe de fournisseur (`openai/…`, `deepseek/…`). Pointer l'URL de base
> vers `https://api.openai.com/v1` fonctionne aussi — retirez alors le préfixe des identifiants de modèles.

**Vous utilisez OpenRouter ?** Choisissez le fournisseur **OpenAI** pour le chat comme pour les embeddings — une clé,
une URL de base, des centaines de modèles :

| Réglage | Valeur |
|---|---|
| Chat / Embedding provider | `OpenAI` |
| OpenAI base URL (shared) | `https://openrouter.ai/api/v1` |
| Chat model | n'importe quel identifiant OpenRouter, p. ex. `deepseek/deepseek-v4-flash` |
| Embedding model | `openai/text-embedding-3-small` |
| OpenAI API key | votre clé OpenRouter ([openrouter.ai/keys](https://openrouter.ai/keys)) |

**Vous utilisez Google Gemini ?** Choisissez le fournisseur **OpenAI** et pointez-le vers le point d'accès de Google :

| Réglage | Valeur |
|---|---|
| Chat provider | `OpenAI` |
| Chat model | `gemini-3.5-flash` |
| Embedding provider | `OpenAI` |
| Embedding model | `gemini-embedding-001` |
| OpenAI base URL (shared) | `https://generativelanguage.googleapis.com/v1beta/openai` |
| OpenAI API key | votre clé Gemini ([Google AI Studio](https://aistudio.google.com/apikey)) |

---

## ✍️ Rédiger un article (sans Zotero ni plugins Word)

```text
Obsidian:  write Manuscript.md  →  type @ to cite  →  set the journal: csl: springer-basic-brackets
           Ctrl/Cmd-P → "Compile manuscript"        →  Manuscript (compiled).md
           Ctrl/Cmd-P → "Export manuscript to Word (.docx)"  →  Manuscript.docx (needs Pandoc)
```

- **Compile manuscript** résout chaque `[@citekey]` en son appel de citation mis en forme et ajoute
  la liste `## References` — prêt pour Pandoc / la soumission.
- **Export manuscript to Word (.docx)** compile de la même manière et lance Pandoc avec le modèle
  académique fourni : Times New Roman 12 pt, double interligne, noir. Pandoc est détecté dans les dossiers
  d'installation habituels ; indiquez son chemin sous Settings → Writing s'il se trouve ailleurs.
  (`scripts/to-docx.cjs` fait de même depuis un terminal.)

---

## 🎨 Styles de citation

Les bibliographies et les appels de citation utilisent **citeproc-js** sur votre CSL-JSON — le même moteur
que Zotero.

- **Globalement :** Settings → *Bibliography style (CSL)*. Fournis hors ligne : **Spine · The Spine
  Journal · European Spine Journal · AMA · APA**. Ou saisissez n'importe quel identifiant de style (p. ex. `nature`,
  `the-lancet`) — il est récupéré depuis le [dépôt CSL](https://github.com/citation-style-language/styles)
  puis mis en cache.
- **Par manuscrit :** ajoutez `csl:` au frontmatter de la note — il remplace le style global.

```yaml
---
csl: springer-basic-brackets
---
```

| Revue | Valeur de `csl:` |
|---|---|
| Spine | `spine` |
| The Spine Journal | `elsevier-vancouver` |
| European Spine Journal | `springer-basic-brackets` |
| Global Spine Journal | `american-medical-association` |
| toute autre | n'importe quel identifiant du dépôt de styles CSL |

---

## 🧰 Commandes

| Groupe | Commandes |
|---|---|
| **Add** | Search PubMed · Add by DOI / PMID / arXiv / title · Import (BibTeX / RIS / nbib / CSL-JSON / Zotero) · Import PDF |
| **Read** | Mark unread / reading / read · Reading queue · Find open-access PDF · Download open-access PDF · Download open-access PDF files for references without one · Link PDF files in a folder to references · Extract PDF highlights · Index linked PDF files · Index this note's PDF · Open reference online |
| **Organize** | Summarize and tag references (fill gaps) · Summarize and tag this reference · Summarize and tag references in a folder or tag… · Re-summarize this reference · Re-summarize references made by an older model · Open screening pane · Create PRISMA flow diagram · Library dashboard · Find duplicates · Merge duplicates… · Backfill citation counts · Check retraction (this note / all) · Rename tag · Enrich metadata · Suggest related papers · Export citation network |
| **Write** | `@` autocomplete · Suggest citations for selection · Find unsupported claims · Update bibliography · Choose citation style… · Check references in this manuscript · Compile manuscript · Export manuscript to Word (.docx) · Copy citation · Export annotated bibliography · Save latest chat answer as note |
| **Search** | Search library (semantic) · Chat with library · Show related papers · Build citation graph · Rebuild search index |
| **Export** | Library → BibTeX / RIS / CSL-JSON |

---

## 🛠️ Pour les développeurs

```bash
npm run dev        # esbuild watch → main.js
npm run deploy     # build + copy into the vault (VAULT_PLUGIN_DIR in .env)
npm run build      # tsc + esbuild production
npm test           # live integration suite + MCP contract/security checks
```

Script utilitaire (terminal, Obsidian non requis) — chemin tiré de `.env` :

```bash
node scripts/to-docx.cjs "Manuscript (compiled).md"                  # compiled md → styled .docx
```

Consultez [`docs/MCP.md`](./docs/MCP.md) pour la configuration d'une IA externe,
[`docs/MIGRATION-0.6.md`](./docs/MIGRATION-0.6.md) pour la migration depuis 0.5.x, et
[`CLAUDE.md`](./CLAUDE.md) pour la carte des modules.

---

## ⚠️ Remarques et limites

- L'identifiant du plugin compatible avec le répertoire communautaire est `academic-paper-citation-manager`. Le nom de
  la connexion MCP reste `rag-obsidian` ; ces identifiants sont indépendants.
- Les noms de fichiers sont **lisibles** (`2022-SpineJ-ParkSM-Biportal.md`) ; le `citekey:` court du
  frontmatter est la poignée `[@cite]`.
- L'export `.docx` nécessite **Pandoc** ; l'extraction des surlignages de PDF nécessite un PDF annoté.
- Cette version est **réservée au bureau**, car le pont MCP en direct facultatif utilise des API Node. Gardez
  Obsidian Desktop et le vault cible ouverts pendant l'utilisation de MCP.
- Le panneau Properties d'Obsidian peut signaler un avertissement sur le frontmatter CSL imbriqué — les données sont valides.
- Renseignez **Contact e-mail** dans les réglages : OpenAlex, Unpaywall et PubMed l'utilisent tous, et
  la recherche de PDF en accès libre ne fonctionne pas sans.
- Les clés API sont conservées dans le trousseau du système (secretStorage d'Obsidian) et effacées dans `data.json` ; sur un
  vault synchronisé, saisissez la clé une fois par appareil.
- Les compilations et déploiements depuis les sources incluent des styles CSL sous `styles/` (CC BY-SA 3.0 ; voir
  `styles/README.md`). Les installations communautaires récupèrent et mettent en cache le style/la locale CSL choisi s'il
  n'est pas présent dans les trois fichiers de la version. Le code du plugin est sous licence MIT.
- L'installation sur mobile n'est pas prise en charge depuis la 0.6.0 ; voir [docs/MOBILE.md](docs/MOBILE.md).

## 🔒 Réseau et confidentialité

- La recherche de références envoie des identifiants ou des requêtes à Crossref, NCBI PubMed/PMC, OpenAlex,
  Unpaywall et arXiv, selon les besoins. Les styles/locales CSL peuvent être téléchargés depuis le dépôt GitHub
  officiel de CSL. PDF.js est fourni avec le plugin ; aucun code exécutable n'est chargé depuis un CDN.
  Les requêtes réseau sont soumises aux politiques de confidentialité des services contactés.
- Les fonctions d'IA envoient le texte source sélectionné et le prompt au fournisseur que vous configurez : un
  point d'accès compatible OpenAI (y compris OpenRouter ou Gemini), Anthropic ou Ollama. Les clés API sont
  stockées dans le SecretStorage d'Obsidian lorsqu'il est disponible ; les versions plus anciennes d'Obsidian se rabattent sur le
  `data.json` du plugin. Le plugin n'a ni télémétrie, ni publicité, ni service de comptes, ni serveur hébergé.
- Avec *Rerank results with a cross-encoder* activé (par défaut), la requête de recherche et les
  passages récupérés sont envoyés au point d'accès de reranking d'OpenRouter. Avec *Translate non-English searches* activé
  (par défaut), une requête non anglaise est envoyée à votre modèle de chat pour traduction. *Build MeSH synonym list
  for search* envoie à NCBI E-utilities les tags thématiques courants de votre bibliothèque.
- MCP n'écoute que sur `127.0.0.1`, avec authentification. Il écrit un pont généré à côté du plugin
  et un fichier de découverte éphémère dans le répertoire temporaire du système d'exploitation (hors du
  vault) ; tous deux contiennent des données de connexion, jamais le contenu des notes ni les clés API des fournisseurs. Les outils MCP peuvent
  lire et modifier le Markdown du vault uniquement si vous activez l'accès MCP. Voir [le modèle de sécurité
  de MCP](docs/MCP.md#editing-and-deletion-safeguards).
- **Programmes locaux (bureau, sur option).** Deux fonctions lancent un programme déjà installé sur votre
  ordinateur, et seulement lorsque vous les utilisez : les fournisseurs de LLM **Codex CLI / OpenCode CLI** (le prompt
  et le texte source sont transmis à ce CLI, qui les envoie à son propre fournisseur sous votre connexion ; le
  plugin ne stocke aucune clé et ignore la configuration utilisateur du CLI) et **Export manuscript to Word**
  (Pandoc, exécuté localement sur le manuscrit compilé). Le plugin ne télécharge ni n'installe jamais
  l'un ou l'autre de ces programmes.
- **Fichiers hors du vault (bureau, sur option).** Lorsque « Keep the search index outside the vault »
  est activé, l'index est écrit dans le dossier de données d'application du système d'exploitation
  (`~/Library/Application Support`, `%LOCALAPPDATA%` ou `~/.local/share`, sous
  `academic-paper-citation-manager/` ; jusqu'à la 0.8.1, il s'agissait du dossier de cache, que les utilitaires de nettoyage vident).
  Les appels au CLI et à Pandoc utilisent un dossier temporaire supprimé après chaque appel.

## 👤 Auteur

**Professeur Sang-Min Park, M.D., Ph.D.**
Department of Orthopaedic Surgery, Seoul National University Bundang Hospital,
Seoul National University College of Medicine
🌐 [sangmin.me](https://sangmin.me/)

## 📄 Licence

MIT (code du plugin). PDF.js, fourni avec le plugin, conserve l'intégralité de sa licence Apache-2.0 et sa mention de modification dans `main.js` ; les styles/locales
CSL conservent leur licence CC BY-SA 3.0 (voir [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)).
