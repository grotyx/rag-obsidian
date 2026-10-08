<p align="center">
  <img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/assets/logo.svg" width="128" alt="Logotipo de Refwright">
</p>

<h1 align="center">Refwright</h1>

<p align="center"><i>Antes “Academic Paper Citation Manager”: el mismo complemento, el mismo id, los mismos ajustes.</i></p>

<p align="center">Tus notas en Markdown <b>son</b> la biblioteca de referencias.<br>Busca en PubMed, obtén resúmenes con IA y cita en el estilo de cualquier revista: un sustituto de Zotero / EndNote dentro de Obsidian.</p>

<p align="center">
  <a href="https://community.obsidian.md/plugins/academic-paper-citation-manager"><img alt="Descargas en Obsidian" src="https://img.shields.io/badge/dynamic/json?logo=obsidian&color=7c3aed&label=downloads&query=%24%5B%22academic-paper-citation-manager%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json"></a>
  <a href="https://github.com/grotyx/rag-obsidian/releases/latest"><img alt="versión" src="https://img.shields.io/badge/version-0.8.6-8b5cf6"></a>
  <a href="https://obsidian.md"><img alt="Obsidian" src="https://img.shields.io/badge/Obsidian-1.11.4%2B-a78bfa"></a>
  <a href="https://github.com/grotyx/rag-obsidian/blob/main/LICENSE"><img alt="licencia" src="https://img.shields.io/badge/license-MIT-green"></a>
</p>

<p align="center"><a href="#-instalación">Instalación</a> · <a href="https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/es.md">Guía del usuario</a> · <a href="#-funciones">Funciones</a> · <a href="https://github.com/grotyx/rag-obsidian/blob/main/docs/MCP.md">Claude Code / Codex</a> · <a href="#manuwright">manuwright</a> · <a href="https://github.com/grotyx/rag-obsidian/blob/main/CHANGELOG.md">Historial de cambios</a></p>

<p align="center"><a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <a href="README.zh.md">中文</a> · <a href="README.ja.md">日本語</a> · <b>Español</b> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.pt.md">Português</a></p>

<table>
  <tr>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/es/03-pubmed-search.png" alt="Añadir artículos desde PubMed"><br><b>Añadir artículos desde PubMed</b></td>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/es/07-cite-suggest.png" alt="Citar con @"><br><b>Citar con @</b></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/es/10-chat.png" alt="Chatear con tu biblioteca"><br><b>Chatear con tu biblioteca</b></td>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/es/12-related.png" alt="Mapa de citas"><br><b>Mapa de citas</b></td>
  </tr>
</table>

Cada referencia es una nota `.md` sencilla con frontmatter [CSL-JSON](https://citationstyles.org/),
de modo que tu biblioteca sigue siendo portable, duradera y tuya. Sin aplicación externa,
sin cuenta, sin backend: solo tu vault.

---

## 📖 Guía del usuario

Una guía paso a paso con capturas de pantalla, desde añadir artículos hasta exportar un manuscrito a Word:
[English](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/en.md) · [한국어](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/ko.md) · [中文](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/zh.md) · [日本語](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/ja.md) · **[Español](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/es.md)** · [Deutsch](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/de.md) · [Français](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/fr.md) · [Português](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/pt.md)

[![Citas y una bibliografía generada en Obsidian](https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/es/08-bibliography.png)](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/es.md)

---

## ✨ Funciones

**📥 Reunir**
- **Busca en PubMed por palabra clave** dentro de Obsidian → elige artículos → notas.
- Añade por **DOI / PMID / arXiv**, o por **título del artículo** (búsqueda automática).
- **Importa** una biblioteca existente: **BibTeX · RIS · PubMed `.nbib` · CSL-JSON**, o directamente
  desde un **Zotero 7** en ejecución (la biblioteca entera o una sola colección).

**🧠 Resumir (IA)**
- Un LLM escribe en cada nota un **resumen por secciones** (Background / Methods / Results /
  Conclusions). *Summary language* (Settings → Chat) permite elegir inglés, coreano,
  ambos (predeterminado: inglés + un resumen conciso en coreano) o cualquier otro idioma por su nombre.
- Usa el **texto completo** en los artículos de acceso abierto (PubMed Central) y el resumen (abstract) en el resto.

**🏷️ Organizar**
- Etiqueta automáticamente cada nota con **términos temáticos MeSH** → la **vista de grafo** de Obsidian agrupa
  tus artículos por tema.
- **Grafo de citas** (OpenAlex): referencias / citado por dentro de tu biblioteca, y recomendaciones de
  *"citados con frecuencia pero ausentes"*, dibujadas como un **mapa** en el panel Related (los nodos sólidos son
  notas que ya tienes; los discontinuos, artículos que no tienes; haz clic en un nodo discontinuo para añadirlo). Se construye una vez
  con el botón del panel; las referencias que añadas después se incorporan solas.
- Estado de lectura, **panel de control** (dashboard), recuento de citas. El **panel Library** ordena por año, título,
  autor, citas o fecha de alta, con filtros rápidos (con PDF / sin PDF / sin leer / retractados).
- **Duplicados**: encuéntralos y luego **fusiónalos**: se conserva una nota, los datos que faltan se completan con las demás
  y las citas `[@old]` se reescriben en todo el vault.
- **Comprobación de retractaciones** para una nota o para toda la biblioteca (OpenAlex), con una nota de informe.
- **Revisión sistemática**: un **panel de cribado** (include / exclude / maybe, preguntas clave, nivel de
  evidencia, diseño, motivos de exclusión, atajos de teclado) y un **diagrama de flujo PRISMA 2020** para todas las
  referencias o para una etiqueta.
- **PDFs**: descarga copias de acceso abierto de todas las referencias que no tengan una (Unpaywall), o
  **vincula una carpeta de PDFs** que ya tengas, emparejados por nombre de archivo, DOI, PMID o título.

**✍️ Citar y escribir**
- Escribe `@` → el autocompletado inserta `[@citekey]`.
- **"Update bibliography"** genera una lista `## References` en un auténtico **estilo de revista**
  (citeproc-js / CSL); las marcas en el texto se muestran en consonancia (`[1]`, superíndice o autor–año).
- **Estilo por manuscrito** mediante el frontmatter `csl:` de la nota, o **Choose citation style…** y
  busca entre unos 10.000 estilos de revista por nombre de revista.
- Las citas se muestran mientras escribes en **Live Preview**; pasa el cursor (**hover**) sobre una para ver el artículo.
- **Check references in this manuscript** antes del envío: referencias ausentes de la biblioteca,
  retractadas, sin DOI o con metadatos incompletos.
- **Compile manuscript** → una copia limpia con las citas resueltas → exporta a **`.docx`**.

**🔎 Buscar y chatear**
- **Búsqueda semántica** híbrida (BM25 + vectores) y **chat fundamentado en citas** que responde
  solo a partir de tu biblioteca, con fuentes `[n]`.
- **Recuperación medida** (0.8.1): un **reranker cross-encoder** alojado (unos 0,0002 $ por búsqueda), **expansión de consultas**
  (tu propio vocabulario de búsqueda + términos de entrada de MeSH) y **traducción automática** de las preguntas en coreano (o en cualquier
  otro idioma distinto del inglés). En un benchmark clínico de 96 preguntas sobre 16.578 artículos, el nDCG@10 pasó
  de 0,53 a 0,81 para las preguntas en inglés y de 0,18 a 0,83 para las en coreano.
- **Búsqueda a nivel de hallazgo** para Claude Code / Codex (MCP `search_findings`): resultados individuales
  (tamaño del efecto, IC, p y la cita textual) a partir de la sección `## Evidence (extracted)` de una nota.
- **Filtros en los paneles de búsqueda *y* de chat**: acota por **rango de años** de publicación, por **autor**
  (apellido) y por **etiqueta**: escribe en el cuadro de etiquetas (se autocompleta con las etiquetas que ya hay en
  tu biblioteca) y pulsa Enter para añadir un chip; si añades varios, el artículo debe llevarlos todos.
  Los filtros pertenecen al panel y no a los ajustes; en el panel de chat delimitan en qué
  artículos puede basarse una respuesta, y la lista de fuentes de la respuesta indica cómo se acotó.
- **Claude Code / Codex mediante MCP (escritorio):** permite que una IA externa busque en la biblioteca activa,
  encuentre, añada y resuma artículos, cree/edite/mueva/envíe a la papelera notas Markdown con seguridad, y compile un
  manuscrito con citas. La prosa de los resúmenes la aporta Claude/Codex; la vía MCP nunca llama al LLM de
  chat, resumen o reranking de este complemento. Hay botones de configuración para Claude Code, Codex, OpenCode y
  Antigravity; las siete herramientas de edición de notas se pueden desactivar.
- **Sin clave de API para el LLM (escritorio):** el chat y los resúmenes pueden ejecutarse con tu
  **Codex CLI** u **OpenCode CLI** con sesión iniciada. Los embeddings de búsqueda siguen necesitando OpenRouter/OpenAI
  u Ollama en local.

---

## 📦 Instalación

> **Publicado en el directorio de la comunidad de Obsidian:**
> [community.obsidian.md/plugins/academic-paper-citation-manager](https://community.obsidian.md/plugins/academic-paper-citation-manager).
> La versión 0.6.0 cambió el id del complemento; quien siga en la 0.5.x debe seguir una vez la
> [guía de migración](docs/MIGRATION-0.6.md).

### Opción A — Complementos de la comunidad (recomendada)

1. Obsidian → **Settings → Community plugins** → desactiva el Restricted mode si está activado.
2. **Browse** → busca **Refwright** → **Install** → **Enable**.

Obsidian lo actualiza como cualquier otro complemento (**Settings → Community plugins → Check for updates**).
Solo escritorio (Obsidian 1.11.4+).

¿Lo instalaste antes con **BRAT**? El id y la carpeta del complemento son los mismos, así que tus ajustes y el
índice se conservan: quita el complemento de la lista de BRAT y sigue actualizando desde Community plugins.

<details>
<summary><b>Opción B — Descargar una versión (manual)</b></summary>

Desde la [última versión](https://github.com/grotyx/rag-obsidian/releases/latest), descarga
`main.js`, `manifest.json` y `styles.css` en

```text
<your vault>/.obsidian/plugins/academic-paper-citation-manager/
```

(crea la carpeta si no existe), luego recarga Obsidian y activa el complemento en
**Settings → Community plugins**. Para actualizar hay que volver a descargar los tres archivos.


</details>

<details>
<summary><b>Opción C — Compilarlo tú mismo</b></summary>

Requiere [Node.js 18+](https://nodejs.org) y [git](https://git-scm.com).

```bash
git clone https://github.com/grotyx/rag-obsidian.git
cd rag-obsidian
npm install

cp .env.example .env        # Windows: copy .env.example .env
# edit .env → set VAULT_PLUGIN_DIR to <your vault>/.obsidian/plugins/academic-paper-citation-manager

npm run deploy              # builds + copies the plugin into your vault
```

Después, en Obsidian: **Settings → Community plugins → activa el complemento** → recarga (`Ctrl/Cmd-R`).


</details>

<details>
<summary><b>Opción D — Vault sincronizado en la nube (sin compilar en el segundo equipo)</b></summary>

Si tu vault está en OneDrive / iCloud / Dropbox / Obsidian Sync, el complemento compilado viaja
**dentro** del vault (`<vault>/.obsidian/plugins/academic-paper-citation-manager/`). En otro equipo basta con
abrir el vault sincronizado y activar el complemento: sin Node y sin compilar.


</details>

---

## 🚀 Inicio rápido (5 minutos)

1. **Recarga** Obsidian (`Ctrl/Cmd-R`) y comprueba que el complemento está activado.
2. **Configura tu proveedor de IA**: Settings → la pestaña del complemento → consulta **Proveedores** más abajo.
3. **Añade un artículo**: icono de la cinta **🔍 Search PubMed**, escribe un tema, selecciona resultados → **Add**.
   Cada uno se convierte en una nota en `References/` con un resumen de IA + etiquetas temáticas.
4. **Escribe y cita**: en cualquier nota, escribe `@` y elige una referencia → `[@citekey]`.
5. **Bibliografía**: `Ctrl/Cmd-P` → **Update bibliography** → una lista `## References` en
   el estilo de revista que hayas elegido.

> El flujo de citas **no necesita embeddings**. La búsqueda semántica y el chat son opcionales y
> requieren un único **Rebuild search index**.

### Conectar Claude Code o Codex

En Obsidian Desktop, abre **Settings → Refwright → External AI (MCP)**,
activa el acceso y copia el comando de Claude Code o la configuración de Codex generados. Mantén este
vault abierto mientras uses las herramientas. Consulta la [guía completa de MCP](docs/MCP.md) para ver la lista de herramientas,
el flujo de edición seguro, ejemplos de prompts, el modelo de seguridad y la resolución de problemas.

MCP delega el razonamiento y la redacción en Claude Code o Codex. No llama a **Chat with library**,
al resumen de artículos ni al reranker LLM; solo la búsqueda en la biblioteca y la reconstrucción del índice pueden usar el
proveedor de embeddings configurado.

Para una importación completa, pide al cliente que añada y resuma el artículo. Seguirá
`add_reference` → `get_reference_source` → `save_reference_summary`: se prefiere el texto completo de PMC,
el resumen (abstract) es la alternativa, y el hash vigente de la nota evita sobrescribir ediciones simultáneas.

---

<a id="manuwright"></a>

## 🖋️ Escribe el artículo con manuwright

[**manuwright**](https://github.com/grotyx/Academic_writing_c_claudecode) es un proyecto complementario del mismo autor: un flujo de trabajo
para manuscritos médicos con agentes de IA (Claude Code, Codex, Antigravity, opencode, Muse). Hace que el agente
planifique antes de escribir, cite solo fuentes registradas, tome cada número de tus archivos de resultados
y supere controles de verificación antes del envío. Usa el servidor MCP de este complemento como su
biblioteca de referencias:

- **La biblioteca se comparte con todos los agentes.** `manuwright obsidian connect` registra el servidor MCP de este
  complemento (`rag-obsidian`) en cada agente instalado, de modo que cualquiera de ellos puede buscar en tus
  artículos mientras redacta. `manuwright obsidian install` también puede instalar el complemento en un vault
  y activar el acceso MCP por ti.
- **Obsidian encuentra artículos; manuwright decide qué se puede citar.** `manuwright evidence
  import-obsidian <citekey>` copia una nota de referencia en el `knowledge/evidence.md` del artículo: los
  campos CSL pasan a ser la cita, el resumen de IA del complemento rellena los campos de resumen
  y el citekey se convierte en el id `[EVID:citekey]`. Las entradas importadas empiezan como *abstract-only* hasta que
  hayas leído el texto completo.

```sh
uv tool install git+https://github.com/grotyx/Academic_writing_c_claudecode
manuwright obsidian status          # vaults with this plugin, and which agents are connected
manuwright obsidian connect         # add the rag-obsidian MCP server to your agents
manuwright evidence import-obsidian lv2024efficacy
```

<p align="center"><img src="https://raw.githubusercontent.com/grotyx/Academic_writing_c_claudecode/main/docs/images/manual/43_obsidian_import_evidence.png" width="720" alt="manuwright importando una referencia de la biblioteca de Obsidian a evidence.md"></p>

manuwright es opcional: el complemento funciona por sí solo, y manuwright funciona sin Obsidian.
Mantén Obsidian abierto con el acceso MCP activado mientras los agentes usen la biblioteca. Consulta el
[manual de manuwright](https://github.com/grotyx/Academic_writing_c_claudecode/blob/main/docs/manual.md#3b-your-obsidian-library-optional-recommended).

---

## ⚙️ Proveedores

Intercambiables, todos a través de `requestUrl` de Obsidian en Obsidian Desktop:

**De fábrica, ambos están configurados con el proveedor compatible con OpenAI apuntando a OpenRouter**, así que una
sola clave cubre el chat, los resúmenes de artículos y los embeddings, y no hay que instalar nada en local.
Pega la clave y listo; todo lo demás es opcional.

- **LLM** (chat + resúmenes): OpenAI / compatible (predeterminado) · Anthropic · Ollama (local) ·
  **Codex CLI** · **OpenCode CLI**. *Chat model* es opcional y sustituye al modelo predeterminado solo en **Chat with library**;
  merece la pena un modelo más potente ahí, ya que los resúmenes y la extracción de metadatos de PDF siguen con el
  modelo predeterminado, más económico.
- **Embeddings** (búsqueda + chat): OpenAI / compatible (predeterminado) · Ollama (local).
- **Sin clave de API: Codex CLI / OpenCode CLI** (escritorio). Si ya usas Codex (sesión de ChatGPT)
  u OpenCode, elígelo como proveedor de LLM: cada llamada de chat, resumen y reranking se ejecuta a través de
  esa CLI con tu propia sesión, y el complemento no guarda ninguna clave. Deja *Default model* vacío para
  usar el modelo predeterminado de la CLI, o indica uno (`gpt-5.1-codex`; para OpenCode, `provider/model`). La CLI
  se localiza en las carpetas de instalación habituales, o bien indica *CLI executable*; **Test** la comprueba. Las llamadas se ejecutan
  desde una carpeta temporal vacía y sin la configuración de usuario de la CLI (sus servidores MCP y hooks
  se iniciarían, si no, en cada llamada), tardan unos 4–7 s cada una y se lanzan de tres en tres en los procesos por lotes.
  Los embeddings siguen necesitando OpenRouter/OpenAI u Ollama.
- **Ubicación del índice**: *Keep the search index outside the vault* (escritorio) lo guarda en la
  carpeta de datos de aplicaciones del equipo, de modo que un vault sincronizado no vuelve a subirlo tras cada cambio; cada
  dispositivo construye entonces el suyo.
- **Recuperación**: *Results (top-k)* es el número de pasajes con los que se construye una respuesta (20 por defecto; como
  máximo tres por referencia, para que un artículo largo no ocupe todos los puestos). *Rerank chat results with
  the LLM* está desactivado por defecto: si lo activas, el chat recupera el doble de pasajes y hace que el
  modelo los ordene primero por relevancia, con una solicitud adicional por pregunta.

> Los ids de modelo de OpenRouter llevan un prefijo de proveedor (`openai/…`, `deepseek/…`). También se puede apuntar la URL base
> a `https://api.openai.com/v1`; en ese caso, quita el prefijo de los ids de modelo.

**¿Usas OpenRouter?** Elige el proveedor **OpenAI** tanto para el chat como para los embeddings: una clave,
una URL base, cientos de modelos:

| Ajuste | Valor |
|---|---|
| Chat / Embedding provider | `OpenAI` |
| OpenAI base URL (shared) | `https://openrouter.ai/api/v1` |
| Chat model | cualquier id de OpenRouter, p. ej. `deepseek/deepseek-v4-flash` |
| Embedding model | `openai/text-embedding-3-small` |
| API key (OpenRouter or OpenAI) | tu clave de OpenRouter ([openrouter.ai/keys](https://openrouter.ai/keys)) |

**¿Usas Google Gemini?** Elige el proveedor **OpenAI** y apúntalo al endpoint de Google:

| Ajuste | Valor |
|---|---|
| Chat provider | `OpenAI` |
| Chat model | `gemini-3.5-flash` |
| Embedding provider | `OpenAI` |
| Embedding model | `gemini-embedding-001` |
| OpenAI base URL (shared) | `https://generativelanguage.googleapis.com/v1beta/openai` |
| API key (OpenRouter or OpenAI) | tu clave de Gemini ([Google AI Studio](https://aistudio.google.com/apikey)) |

---

## ✍️ Escribir un artículo (sin complementos de Zotero / Word)

```text
Obsidian:  write Manuscript.md  →  type @ to cite  →  set the journal: csl: springer-basic-brackets
           Ctrl/Cmd-P → "Compile manuscript"        →  Manuscript (compiled).md
           Ctrl/Cmd-P → "Export manuscript to Word (.docx)"  →  Manuscript.docx (needs Pandoc)
```

- **Compile manuscript** resuelve cada `[@citekey]` a su marca en el texto con el estilo elegido y añade
  la lista `## References`, lista para Pandoc / el envío.
- **Export manuscript to Word (.docx)** compila igual y ejecuta Pandoc con la plantilla
  académica incluida: Times New Roman 12 pt, interlineado doble, en negro. Pandoc se localiza en las carpetas de
  instalación habituales; indica su ruta en Settings → Writing si está en otro sitio.
  (`scripts/to-docx.cjs` hace lo mismo desde un terminal.)

---

## 🎨 Estilos de cita

Las bibliografías y las marcas en el texto usan **citeproc-js** sobre tu CSL-JSON, el mismo motor
que usa Zotero.

- **Global:** Settings → *Bibliography style (CSL)*. Incluidos sin conexión: **Spine · The Spine
  Journal · European Spine Journal · AMA · APA**. O escribe cualquier id de estilo (p. ej. `nature`,
  `the-lancet`): se descarga del [repositorio CSL](https://github.com/citation-style-language/styles)
  y se guarda en caché.
- **Por manuscrito:** añade `csl:` al frontmatter de la nota, que prevalece sobre el estilo global.

```yaml
---
csl: springer-basic-brackets
---
```

| Revista | Valor de `csl:` |
|---|---|
| Spine | `spine` |
| The Spine Journal | `elsevier-vancouver` |
| European Spine Journal | `springer-basic-brackets` |
| Global Spine Journal | `american-medical-association` |
| cualquier otra | cualquier id del repositorio de estilos CSL |

---

## 🧰 Comandos

| Grupo | Comandos |
|---|---|
| **Add** | Search PubMed · Add by DOI / PMID / arXiv / title · Import (BibTeX / RIS / nbib / CSL-JSON / Zotero) · Import PDF |
| **Read** | Mark unread / reading / read · Reading queue · Find open-access PDF · Download open-access PDF · Download open-access PDF files for references without one · Link PDF files in a folder to references · Extract PDF highlights · Index linked PDF files · Index this note's PDF · Open reference online |
| **Organize** | Summarize and tag references (fill gaps) · Summarize and tag this reference · Summarize and tag references in a folder or tag… · Re-summarize this reference · Re-summarize references made by an older model · Open screening pane · Create PRISMA flow diagram · Library dashboard · Find duplicates · Merge duplicates… · Backfill citation counts · Check retraction (this note / all) · Rename tag · Enrich metadata · Suggest related papers · Export citation network |
| **Write** | `@` autocomplete · Suggest citations for selection · Find unsupported claims · Update bibliography · Choose citation style… · Check references in this manuscript · Compile manuscript · Export manuscript to Word (.docx) · Copy citation · Export annotated bibliography · Save latest chat answer as note |
| **Search** | Search library (semantic) · Chat with library · Show related papers · Build citation graph · Rebuild search index |
| **Export** | Library → BibTeX / RIS / CSL-JSON |

---

## 🛠️ Para desarrolladores

```bash
npm run dev        # esbuild watch → main.js
npm run deploy     # build + copy into the vault (VAULT_PLUGIN_DIR in .env)
npm run build      # tsc + esbuild production
npm test           # live integration suite + MCP contract/security checks
```

Script auxiliar (terminal, sin necesidad de Obsidian); la ruta se toma de `.env`:

```bash
node scripts/to-docx.cjs "Manuscript (compiled).md"                  # compiled md → styled .docx
```

Consulta [`docs/MCP.md`](./docs/MCP.md) para configurar la IA externa,
[`docs/MIGRATION-0.6.md`](./docs/MIGRATION-0.6.md) para la migración desde la 0.5.x y
[`CLAUDE.md`](./CLAUDE.md) para el mapa de módulos.

---

## ⚠️ Notas y limitaciones

- El id del complemento compatible con la comunidad es `academic-paper-citation-manager`. El nombre de la conexión MCP
  sigue siendo `rag-obsidian`; ambos identificadores son independientes.
- Los nombres de archivo son **legibles** (`2022-SpineJ-ParkSM-Biportal.md`); el `citekey:` corto del
  frontmatter es el identificador de `[@cite]`.
- La exportación a `.docx` necesita **Pandoc**; la extracción de resaltados de PDF necesita un PDF con anotaciones.
- Esta versión es **solo para escritorio** porque el puente MCP en vivo (opcional) usa APIs de Node. Mantén
  Obsidian Desktop y el vault de destino abiertos mientras uses MCP.
- Es posible que el panel Properties de Obsidian muestre una advertencia por el frontmatter CSL anidado; los datos son válidos.
- Indica **Contact e-mail** en los ajustes: OpenAlex, Unpaywall y PubMed lo usan, y
  la búsqueda de PDF de acceso abierto no funciona sin él.
- Las claves de API se guardan en el llavero del sistema operativo (secretStorage de Obsidian) y se vacían en `data.json`; en un
  vault sincronizado, introduce la clave una vez por dispositivo.
- Las compilaciones y los despliegues desde el código fuente incluyen estilos CSL en `styles/` (CC BY-SA 3.0; véase
  `styles/README.md`). Las instalaciones desde la comunidad descargan y guardan en caché el estilo/locale CSL seleccionado si no
  está en los tres archivos de la versión. El código del complemento es MIT.
- La instalación en móvil no es compatible desde la 0.6.0; véase [docs/MOBILE.md](docs/MOBILE.md).

## 🔒 Red y privacidad

- La búsqueda de referencias envía identificadores o consultas a Crossref, NCBI PubMed/PMC, OpenAlex,
  Unpaywall y arXiv según haga falta. Los estilos/locales CSL pueden descargarse del repositorio oficial de CSL en
  GitHub. PDF.js va incluido en el complemento; no se carga código ejecutable desde ninguna CDN.
  Las solicitudes de red están sujetas a las políticas de privacidad de los servicios contactados.
- Las funciones de IA envían el texto fuente seleccionado y el prompt al proveedor que configures: un
  endpoint compatible con OpenAI (incluidos OpenRouter o Gemini), Anthropic u Ollama. Las claves de API se
  guardan en Obsidian SecretStorage cuando está disponible; las versiones antiguas de Obsidian recurren al
  `data.json` del complemento. El complemento no tiene telemetría, publicidad, servicio de cuentas ni backend alojado.
- Con *Rerank results with a cross-encoder* activado (predeterminado), la consulta de búsqueda y los
  pasajes recuperados se envían al endpoint de rerank de OpenRouter. Con *Translate non-English searches* activado
  (predeterminado), una consulta que no esté en inglés se envía a tu modelo de chat para traducirla. *Build MeSH synonym list
  for search* envía a NCBI E-utilities las etiquetas temáticas más comunes de tu biblioteca.
- MCP escucha solo en `127.0.0.1` autenticado. Escribe un puente generado junto al complemento
  y un archivo de descubrimiento de corta duración en el directorio temporal del sistema operativo (fuera del
  vault); ambos contienen datos de conexión, nunca el contenido de las notas ni las claves de API de los proveedores. Las herramientas MCP pueden
  leer y modificar el Markdown del vault solo cuando activas el acceso MCP. Consulta [el modelo de seguridad
  de MCP](docs/MCP.md#editing-and-deletion-safeguards).
- **Programas locales (escritorio, opcional).** Dos funciones ejecutan un programa ya instalado en tu
  equipo, y solo cuando las usas: los proveedores de LLM **Codex CLI / OpenCode CLI** (el prompt
  y el texto fuente van a esa CLI, que los envía a su propio proveedor con tu sesión; el
  complemento no guarda ninguna clave y omite la configuración de usuario de la CLI) y **Export manuscript to Word**
  (Pandoc, ejecutado en local sobre el manuscrito compilado). El complemento nunca descarga ni instala
  ninguno de los dos programas.
- **Archivos fuera del vault (escritorio, opcional).** Con "Keep the search index outside the vault"
  activado, el índice se escribe en la carpeta de datos de aplicaciones del sistema operativo
  (`~/Library/Application Support`, `%LOCALAPPDATA%` o `~/.local/share`, dentro de
  `academic-paper-citation-manager/`; hasta la 0.8.1 era la carpeta de caché, que los programas de limpieza vacían).
  Las llamadas a la CLI y a Pandoc usan una carpeta temporal que se elimina tras cada llamada.

## 👤 Autor

**Profesor Sang-Min Park, M.D., Ph.D.**
Departamento de Cirugía Ortopédica, Seoul National University Bundang Hospital,
Seoul National University College of Medicine
🌐 [sangmin.me](https://sangmin.me/)

## 📄 Licencia

MIT (código del complemento). PDF.js, incluido en el complemento, conserva su licencia Apache-2.0 completa y el aviso de modificación en `main.js`; los
estilos/locales CSL conservan su licencia CC BY-SA 3.0 (véase [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)).
