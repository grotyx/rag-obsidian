<p align="center">
  <img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/assets/logo.svg" width="128" alt="Logotipo do Refwright">
</p>

<h1 align="center">Refwright</h1>

<p align="center"><i>Antes chamado “Academic Paper Citation Manager” — o mesmo plugin, o mesmo id, as mesmas configurações.</i></p>

<p align="center">Suas notas em markdown <b>são</b> a biblioteca de referências.<br>Pesquise no PubMed, receba resumos por IA, cite em qualquer estilo de periódico — um substituto do Zotero / EndNote dentro do Obsidian.</p>

<p align="center">
  <a href="https://community.obsidian.md/plugins/academic-paper-citation-manager"><img alt="Obsidian downloads" src="https://img.shields.io/badge/dynamic/json?logo=obsidian&color=7c3aed&label=downloads&query=%24%5B%22academic-paper-citation-manager%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json"></a>
  <a href="https://github.com/grotyx/rag-obsidian/releases/latest"><img alt="version" src="https://img.shields.io/badge/version-0.8.3-8b5cf6"></a>
  <a href="https://obsidian.md"><img alt="Obsidian" src="https://img.shields.io/badge/Obsidian-1.11.4%2B-a78bfa"></a>
  <a href="https://github.com/grotyx/rag-obsidian/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-green"></a>
</p>

<p align="center"><a href="#-instalação">Instalar</a> · <a href="https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/pt.md">Guia do usuário</a> · <a href="#-recursos">Recursos</a> · <a href="https://github.com/grotyx/rag-obsidian/blob/main/docs/MCP.md">Claude Code / Codex</a> · <a href="#manuwright">manuwright</a> · <a href="https://github.com/grotyx/rag-obsidian/blob/main/CHANGELOG.md">Changelog</a></p>

<p align="center"><a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <a href="README.zh.md">中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <b>Português</b></p>

<table>
  <tr>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/en/03-pubmed-search.png" alt="Adicionar artigos do PubMed"><br><b>Adicionar artigos do PubMed</b></td>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/en/07-cite-suggest.png" alt="Citar com @"><br><b>Citar com @</b></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/en/10-chat.png" alt="Conversar com a sua biblioteca"><br><b>Conversar com a sua biblioteca</b></td>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/en/12-related.png" alt="Mapa de citações"><br><b>Mapa de citações</b></td>
  </tr>
</table>

Cada referência é uma simples nota `.md` com frontmatter em [CSL-JSON](https://citationstyles.org/),
de modo que sua biblioteca permanece portátil, à prova do futuro e sua. Sem aplicativo externo,
sem conta, sem backend — apenas o seu vault.

---

## 📖 Guia do usuário

Um guia passo a passo com capturas de tela, desde a inclusão de artigos até a exportação de um manuscrito em Word:
[English](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/en.md) · [한국어](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/ko.md) · [中文](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/zh.md) · [日本語](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/ja.md) · [Español](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/es.md) · [Deutsch](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/de.md) · [Français](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/fr.md) · **[Português](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/pt.md)**

[![Citações e bibliografia gerada no Obsidian](https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/en/08-bibliography.png)](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/pt.md)

---

## ✨ Recursos

**📥 Coletar**
- **Pesquise no PubMed por palavra-chave** dentro do Obsidian → escolha os artigos → notas.
- Adicione por **DOI / PMID / arXiv** ou pelo **título do artigo** (busca automática).
- **Importe** uma biblioteca existente — **BibTeX · RIS · PubMed `.nbib` · CSL-JSON** — ou diretamente
  de um **Zotero 7** em execução (biblioteca inteira ou uma coleção).

**🧠 Resumir (IA)**
- Um LLM escreve em cada nota um **resumo seção por seção** (Background / Methods / Results /
  Conclusions). *Summary language* (Settings → Chat) permite escolher inglês, coreano,
  ambos (padrão: inglês + um resumo conciso em coreano) ou qualquer outro idioma pelo nome.
- Usa o **texto completo** dos artigos de acesso aberto (PubMed Central) e, nos demais casos, o resumo (abstract).

**🏷️ Organizar**
- Marca automaticamente cada nota com **termos de tópico MeSH** → a **visualização em grafo** do Obsidian agrupa
  seus artigos por assunto.
- **Grafo de citações** (OpenAlex): referências / citado por na sua biblioteca e recomendações de
  *"frequentemente citados, mas ausentes"* — desenhado como um **mapa** no painel Related (nós sólidos são
  notas que você tem, nós tracejados são artigos que você não tem; clique em um nó tracejado para adicioná-lo). Construa-o uma vez
  pelo botão do painel; as referências adicionadas depois entram nele sozinhas.
- Status de leitura, **dashboard**, contagem de citações. O **painel Library** ordena por ano, título,
  autor, citações ou data de inclusão, com filtros rápidos (com PDF / sem PDF / não lido / retratado).
- **Duplicatas**: encontre-as e depois **mescle-as** — uma nota é mantida, as lacunas são preenchidas com as outras,
  e as citações `[@old]` são reescritas em todo o vault.
- **Verificação de retratação** (retraction check) de uma nota ou da biblioteca inteira (OpenAlex), com uma nota de relatório.
- **Revisão sistemática**: um **painel de triagem** (include / exclude / maybe, key questions, nível
  de evidência, desenho do estudo, motivos de exclusão, atalhos de teclado) e um **diagrama de fluxo PRISMA 2020** para todas as
  referências ou para uma tag.
- **PDFs**: baixe cópias de acesso aberto de cada referência que não tenha PDF (Unpaywall) ou
  **vincule uma pasta de PDFs** que você já tem — a correspondência é feita por nome de arquivo, DOI, PMID ou título.

**✍️ Citar e escrever**
- Digite `@` → o autocompletar insere `[@citekey]`.
- **"Update bibliography"** monta uma lista `## References` em um **estilo de periódico** real
  (citeproc-js / CSL); as marcas no texto são renderizadas de acordo (`[1]`, sobrescrito ou autor–data).
- **Estilo por manuscrito** pelo frontmatter `csl:` de uma nota — ou **Choose citation style…** e
  pesquise cerca de 10.000 estilos de periódicos pelo nome do periódico.
- As citações são renderizadas enquanto você digita no **Live Preview**; passe o **mouse** sobre uma para ver o artigo.
- **Check references in this manuscript** antes da submissão: ausentes da biblioteca,
  retratadas, sem DOI ou com metadados incompletos.
- **Compile manuscript** → uma cópia limpa com as citações resolvidas → exportação para **`.docx`**.

**🔎 Busca e chat**
- **Busca semântica** híbrida (BM25 + vetor) e **chat fundamentado em citações** que responde
  somente a partir da sua biblioteca, com fontes `[n]`.
- **Recuperação medida** (0.8.1): um **reranker cross-encoder** hospedado (cerca de US$ 0,0002 por busca), **expansão de consulta**
  (seu próprio vocabulário de busca + termos de entrada do MeSH) e **tradução automática** de perguntas em coreano (ou em qualquer
  outro idioma que não o inglês). Em um benchmark clínico de 96 perguntas sobre 16.578 artigos, o nDCG@10 subiu
  de 0,53 para 0,81 nas perguntas em inglês e de 0,18 para 0,83 nas em coreano.
- **Busca em nível de achado** para Claude Code / Codex (MCP `search_findings`): resultados individuais —
  tamanho de efeito, IC, p e a citação literal — a partir da seção `## Evidence (extracted)` de uma nota.
- **Filtros nos painéis de busca *e* de chat** — restrinja por **intervalo de anos** de publicação, por **autor**
  (sobrenome) e por **tag**: digite na caixa de tag (ela autocompleta a partir das tags já existentes na
  sua biblioteca) e pressione Enter para adicionar um chip; adicionando vários, o artigo precisa ter todos.
  Os filtros pertencem ao painel, e não às configurações; no painel de chat, eles delimitam em quais
  artigos uma resposta pode se basear, e a lista de fontes da resposta indica como ela foi restringida.
- **Claude Code / Codex via MCP (desktop):** permita que uma IA externa pesquise a biblioteca ativa,
  encontre, adicione e resuma artigos, crie/edite/mova/envie para a lixeira notas Markdown com segurança e compile um
  manuscrito citado. A prosa dos resumos vem do Claude/Codex; o caminho MCP nunca chama o LLM de
  chat, de resumo ou de reranking deste plugin. Há botões de configuração para Claude Code, Codex, OpenCode e
  Antigravity; as sete ferramentas de edição de notas podem ser desativadas.
- **Sem chave de API para o LLM (desktop):** o chat e os resumos podem rodar pelo seu
  **Codex CLI** ou **OpenCode CLI** já autenticado. Os embeddings de busca ainda exigem OpenRouter/OpenAI
  ou um Ollama local.

---

## 📦 Instalação

> **Publicado no diretório da comunidade do Obsidian:**
> [community.obsidian.md/plugins/academic-paper-citation-manager](https://community.obsidian.md/plugins/academic-paper-citation-manager).
> A versão 0.6.0 mudou o id do plugin; quem ainda está na 0.5.x segue o
> [guia de migração](docs/MIGRATION-0.6.md) uma única vez.

### Opção A — Community plugins (recomendada)

1. Obsidian → **Settings → Community plugins** → desative o Restricted mode, se estiver ativado.
2. **Browse** → pesquise **Refwright** → **Install** → **Enable**.

O Obsidian o atualiza como qualquer outro plugin (**Settings → Community plugins → Check for updates**).
Somente desktop (Obsidian 1.11.4+).

Instalou antes pelo **BRAT**? O id e a pasta do plugin são os mesmos, então suas configurações e o
índice são mantidos: remova o plugin da lista do BRAT e continue atualizando pelos Community plugins.

<details>
<summary><b>Opção B — Baixar uma release (manual)</b></summary>

Na [última release](https://github.com/grotyx/rag-obsidian/releases/latest), baixe
`main.js`, `manifest.json` e `styles.css` para

```text
<your vault>/.obsidian/plugins/academic-paper-citation-manager/
```

(crie a pasta se ela não existir), depois recarregue o Obsidian e ative o plugin em
**Settings → Community plugins**. Para atualizar, baixe os três arquivos novamente.


</details>

<details>
<summary><b>Opção C — Compilar você mesmo</b></summary>

Requer [Node.js 18+](https://nodejs.org) e [git](https://git-scm.com).

```bash
git clone https://github.com/grotyx/rag-obsidian.git
cd rag-obsidian
npm install

cp .env.example .env        # Windows: copy .env.example .env
# edit .env → set VAULT_PLUGIN_DIR to <your vault>/.obsidian/plugins/academic-paper-citation-manager

npm run deploy              # builds + copies the plugin into your vault
```

Depois, no Obsidian: **Settings → Community plugins → enable the plugin** → recarregue (`Ctrl/Cmd-R`).


</details>

<details>
<summary><b>Opção D — Vault sincronizado na nuvem (sem compilar na 2ª máquina)</b></summary>

Se o seu vault está no OneDrive / iCloud / Dropbox / Obsidian Sync, o plugin já compilado viaja
**dentro** do vault (`<vault>/.obsidian/plugins/academic-paper-citation-manager/`). Em outra máquina, basta
abrir o vault sincronizado e ativar o plugin — sem Node, sem build.


</details>

---

## 🚀 Início rápido (5 minutos)

1. **Recarregue** o Obsidian (`Ctrl/Cmd-R`) e confirme que o plugin está ativado.
2. **Defina seu provedor de IA** — Settings → a aba do plugin → veja **Provedores** abaixo.
3. **Adicione um artigo** — no ribbon, **🔍 Search PubMed**, digite um tópico, selecione os resultados → **Add**.
   Cada um vira uma nota em `References/` com um resumo por IA + tags de tópico.
4. **Escreva e cite** — em qualquer nota, digite `@` e escolha uma referência → `[@citekey]`.
5. **Bibliografia** — `Ctrl/Cmd-P` → **Update bibliography** → uma lista `## References` no
   estilo de periódico que você escolheu.

> O fluxo de citação **não precisa de embeddings**. A busca semântica e o chat são opcionais e
> exigem uma única execução de **Rebuild search index**.

### Conectar o Claude Code ou o Codex

No Obsidian Desktop, abra **Settings → Refwright → External AI (MCP)**,
ative o acesso e copie o comando gerado para o Claude Code ou a configuração do Codex. Mantenha este
vault aberto enquanto usa as ferramentas. Consulte o [guia completo do MCP](docs/MCP.md) para a lista de ferramentas,
o fluxo de edição segura, exemplos de prompts, o modelo de segurança e a solução de problemas.

O MCP delega o raciocínio e a prosa ao Claude Code ou ao Codex. Ele não chama **Chat with library**,
a sumarização de artigos nem o reranker por LLM; somente a busca na biblioteca e a reconstrução do índice podem usar o
provedor de embeddings configurado.

Para uma importação completa, peça ao cliente que adicione e resuma o artigo. Ele seguirá
`add_reference` → `get_reference_source` → `save_reference_summary`: o texto completo do PMC é preferido,
o resumo (abstract) é a alternativa, e o hash atual da nota impede a sobrescrita de edições simultâneas.

---

<a id="manuwright"></a>

## 🖋️ Escreva o artigo com o manuwright

[**manuwright**](https://github.com/grotyx/Academic_writing_c_claudecode) é um projeto complementar do mesmo autor: um fluxo de trabalho para manuscritos médicos
destinado a agentes de IA (Claude Code, Codex, Antigravity, opencode, Muse). Ele faz o agente
planejar antes de escrever, citar apenas fontes registradas, extrair cada número dos seus arquivos de resultados
e passar por etapas de verificação antes da submissão. Usa o servidor MCP deste plugin como
biblioteca de referências:

- **A biblioteca é compartilhada com todos os agentes.** `manuwright obsidian connect` registra o
  servidor MCP deste plugin (`rag-obsidian`) em cada agente instalado, de modo que qualquer um deles pode pesquisar seus
  artigos enquanto redige. `manuwright obsidian install` também pode instalar o plugin em um vault
  e ativar o acesso MCP para você.
- **O Obsidian encontra os artigos; o manuwright decide o que pode ser citado.** `manuwright evidence
  import-obsidian <citekey>` copia uma nota de referência para o `knowledge/evidence.md` do artigo: os
  campos CSL se tornam a citação, o resumo por IA do plugin preenche os campos de resumo, e o
  citekey se torna o id `[EVID:citekey]`. As entradas importadas começam como *abstract-only* até que você
  tenha lido o texto completo.

```sh
uv tool install git+https://github.com/grotyx/Academic_writing_c_claudecode
manuwright obsidian status          # vaults with this plugin, and which agents are connected
manuwright obsidian connect         # add the rag-obsidian MCP server to your agents
manuwright evidence import-obsidian lv2024efficacy
```

<p align="center"><img src="https://raw.githubusercontent.com/grotyx/Academic_writing_c_claudecode/main/docs/images/manual/43_obsidian_import_evidence.png" width="720" alt="manuwright importando uma referência da biblioteca do Obsidian para o evidence.md"></p>

O manuwright é opcional: o plugin funciona sozinho, e o manuwright funciona sem o Obsidian.
Mantenha o Obsidian aberto, com o acesso MCP ativado, enquanto os agentes usam a biblioteca. Consulte o
[manual do manuwright](https://github.com/grotyx/Academic_writing_c_claudecode/blob/main/docs/manual.md#3b-your-obsidian-library-optional-recommended).

---

## ⚙️ Provedores

Plugáveis, todos pelo `requestUrl` do Obsidian no Obsidian Desktop:

**De fábrica, ambos vêm configurados com o provedor compatível com OpenAI apontando para o OpenRouter**, de modo que uma
única chave cobre o chat, os resumos dos artigos e os embeddings, sem nada para instalar localmente.
Cole a chave e pronto; todo o resto é opcional.

- **LLM** (chat + resumos): OpenAI / compatível (padrão) · Anthropic · Ollama (local) ·
  **Codex CLI** · **OpenCode CLI**. *Chat model* é opcional e substitui o modelo padrão apenas em **Chat with library** —
  vale usar um modelo mais forte ali, já que os resumos e a extração de metadados de PDF continuam no
  padrão mais barato.
- **Embeddings** (busca + chat): OpenAI / compatível (padrão) · Ollama (local).
- **Sem chave de API: Codex CLI / OpenCode CLI** (desktop). Se você já usa o Codex (login do ChatGPT)
  ou o OpenCode, escolha-o como provedor de LLM: cada chamada de chat, resumo e rerank passa por
  essa CLI com o seu próprio login, e o plugin não armazena nenhuma chave. Deixe *Default model* vazio para usar
  o padrão da própria CLI, ou informe um (`gpt-5.1-codex`; no OpenCode, `provider/model`). A CLI
  é localizada nas pastas de instalação habituais, ou defina *CLI executable*; **Test** a verifica. As chamadas rodam
  a partir de uma pasta temporária vazia, com a configuração de usuário da CLI ignorada (seus servidores MCP e hooks
  iniciariam a cada chamada), levando cerca de 4–7 s cada, três por vez em lotes.
  Os embeddings ainda exigem OpenRouter/OpenAI ou Ollama.
- **Local do índice**: *Keep the search index outside the vault* (desktop) o armazena na
  pasta de dados de aplicativos do computador, de modo que um vault sincronizado não o reenvia a cada alteração; cada
  dispositivo então constrói o seu.
- **Recuperação**: *Results (top-k)* é o número de trechos a partir dos quais uma resposta é construída (padrão 20; no
  máximo três por referência, para que um único artigo longo não ocupe todas as vagas). *Rerank chat results with
  the LLM* vem desativado por padrão — ativado, o chat recupera o dobro de trechos e faz o
  modelo ordená-los por relevância antes, com uma requisição extra por pergunta.

> Os ids de modelo do OpenRouter levam um prefixo do fornecedor (`openai/…`, `deepseek/…`). Apontar a URL base
> para `https://api.openai.com/v1` também funciona — retire o prefixo dos ids de modelo.

**Usando o OpenRouter?** Escolha o provedor **OpenAI** tanto para o chat quanto para os embeddings — uma chave,
uma URL base, centenas de modelos:

| Setting | Value |
|---|---|
| Chat / Embedding provider | `OpenAI` |
| OpenAI base URL (shared) | `https://openrouter.ai/api/v1` |
| Chat model | any OpenRouter id, e.g. `deepseek/deepseek-v4-flash` |
| Embedding model | `openai/text-embedding-3-small` |
| OpenAI API key | your OpenRouter key ([openrouter.ai/keys](https://openrouter.ai/keys)) |

**Usando o Google Gemini?** Escolha o provedor **OpenAI** e aponte-o para o endpoint do Google:

| Setting | Value |
|---|---|
| Chat provider | `OpenAI` |
| Chat model | `gemini-3.5-flash` |
| Embedding provider | `OpenAI` |
| Embedding model | `gemini-embedding-001` |
| OpenAI base URL (shared) | `https://generativelanguage.googleapis.com/v1beta/openai` |
| OpenAI API key | your Gemini key ([Google AI Studio](https://aistudio.google.com/apikey)) |

---

## ✍️ Escrevendo um artigo (sem Zotero / plugins do Word)

```text
Obsidian:  write Manuscript.md  →  type @ to cite  →  set the journal: csl: springer-basic-brackets
           Ctrl/Cmd-P → "Compile manuscript"        →  Manuscript (compiled).md
           Ctrl/Cmd-P → "Export manuscript to Word (.docx)"  →  Manuscript.docx (needs Pandoc)
```

- **Compile manuscript** resolve cada `[@citekey]` para a sua marca no texto formatada e acrescenta
  a lista `## References` — pronta para o Pandoc / a submissão.
- **Export manuscript to Word (.docx)** compila da mesma forma e executa o Pandoc com o modelo
  acadêmico incluído: Times New Roman 12 pt, espaçamento duplo, preto. O Pandoc é localizado nas pastas de
  instalação habituais; defina o caminho dele em Settings → Writing se estiver em outro lugar.
  (`scripts/to-docx.cjs` faz o mesmo a partir de um terminal.)

---

## 🎨 Estilos de citação

As bibliografias e as marcas no texto usam o **citeproc-js** sobre o seu CSL-JSON — o mesmo motor
que o Zotero usa.

- **Globalmente:** Settings → *Bibliography style (CSL)*. Incluídos para uso offline: **Spine · The Spine
  Journal · European Spine Journal · AMA · APA**. Ou digite qualquer id de estilo (p. ex. `nature`,
  `the-lancet`) — ele é obtido do [repositório CSL](https://github.com/citation-style-language/styles)
  e guardado em cache.
- **Por manuscrito:** adicione `csl:` ao frontmatter da nota — ele substitui o estilo global.

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

## 🧰 Comandos

| Group | Commands |
|---|---|
| **Add** | Search PubMed · Add by DOI / PMID / arXiv / title · Import (BibTeX / RIS / nbib / CSL-JSON / Zotero) · Import PDF |
| **Read** | Mark unread / reading / read · Reading queue · Find open-access PDF · Download open-access PDF · Download open-access PDF files for references without one · Link PDF files in a folder to references · Extract PDF highlights · Index linked PDF files · Index this note's PDF · Open reference online |
| **Organize** | Summarize and tag references (fill gaps) · Summarize and tag this reference · Summarize and tag references in a folder or tag… · Re-summarize this reference · Re-summarize references made by an older model · Open screening pane · Create PRISMA flow diagram · Library dashboard · Find duplicates · Merge duplicates… · Backfill citation counts · Check retraction (this note / all) · Rename tag · Enrich metadata · Suggest related papers · Export citation network |
| **Write** | `@` autocomplete · Suggest citations for selection · Find unsupported claims · Update bibliography · Choose citation style… · Check references in this manuscript · Compile manuscript · Export manuscript to Word (.docx) · Copy citation · Export annotated bibliography · Save latest chat answer as note |
| **Search** | Search library (semantic) · Chat with library · Show related papers · Build citation graph · Rebuild search index |
| **Export** | Library → BibTeX / RIS / CSL-JSON |

---

## 🛠️ Para desenvolvedores

```bash
npm run dev        # esbuild watch → main.js
npm run deploy     # build + copy into the vault (VAULT_PLUGIN_DIR in .env)
npm run build      # tsc + esbuild production
npm test           # live integration suite + MCP contract/security checks
```

Script auxiliar (terminal, sem precisar do Obsidian) — caminho vindo do `.env`:

```bash
node scripts/to-docx.cjs "Manuscript (compiled).md"                  # compiled md → styled .docx
```

Veja [`docs/MCP.md`](./docs/MCP.md) para a configuração de IA externa,
[`docs/MIGRATION-0.6.md`](./docs/MIGRATION-0.6.md) para a migração da 0.5.x e
[`CLAUDE.md`](./CLAUDE.md) para o mapa de módulos.

---

## ⚠️ Observações e limitações

- O id do plugin compatível com a Community é `academic-paper-citation-manager`. O nome da conexão MCP
  continua `rag-obsidian`; esses identificadores são independentes.
- Os nomes de arquivo são **legíveis** (`2022-SpineJ-ParkSM-Biportal.md`); o `citekey:` curto no
  frontmatter é o identificador usado em `[@cite]`.
- A exportação para `.docx` precisa do **Pandoc**; a extração de destaques de PDF precisa de um PDF com anotações.
- Esta versão é **somente para desktop** porque a ponte MCP ao vivo, opcional, usa APIs do Node. Mantenha o
  Obsidian Desktop e o vault de destino abertos enquanto usa o MCP.
- O painel Properties do Obsidian pode emitir avisos sobre frontmatter CSL aninhado — os dados são válidos.
- Defina **Contact e-mail** nas configurações: OpenAlex, Unpaywall e PubMed o utilizam, e
  a busca de PDFs de acesso aberto não funciona sem um.
- As chaves de API ficam no chaveiro do sistema operacional (secretStorage do Obsidian) e são apagadas do `data.json`; em um
  vault sincronizado, informe a chave uma vez por dispositivo.
- Builds/implantações a partir do código-fonte incluem estilos CSL em `styles/` (CC BY-SA 3.0; veja
  `styles/README.md`). As instalações pela Community obtêm e guardam em cache um estilo/locale CSL selecionado se ele não
  estiver presente nos três arquivos da release. O código do plugin é MIT.
- A instalação em dispositivos móveis não é suportada desde a 0.6.0; veja [docs/MOBILE.md](docs/MOBILE.md).

## 🔒 Rede e privacidade

- A consulta/busca de referências envia identificadores ou consultas ao Crossref, NCBI PubMed/PMC, OpenAlex,
  Unpaywall e arXiv conforme necessário. Estilos/locales CSL podem ser baixados do repositório oficial
  do CSL no GitHub. O PDF.js é incluído no plugin; nenhum código executável é carregado de uma CDN.
  As requisições de rede estão sujeitas às políticas de privacidade dos serviços contatados.
- Os recursos de IA enviam o texto de origem selecionado e o prompt ao provedor que você configurar: um
  endpoint compatível com OpenAI (incluindo OpenRouter ou Gemini), Anthropic ou Ollama. As chaves de API são
  armazenadas no SecretStorage do Obsidian quando disponível; versões mais antigas do Obsidian recorrem ao
  `data.json` do plugin. O plugin não tem telemetria, publicidade, serviço de contas nem backend hospedado.
- Com *Rerank results with a cross-encoder* ativado (padrão), a consulta de busca e os trechos
  recuperados são enviados ao endpoint de rerank do OpenRouter. Com *Translate non-English searches* ativado
  (padrão), uma consulta que não esteja em inglês é enviada ao seu modelo de chat para tradução. *Build MeSH synonym list
  for search* envia os termos de assunto mais comuns da sua biblioteca ao NCBI E-utilities.
- O MCP escuta apenas em `127.0.0.1`, com autenticação. Ele grava uma ponte gerada ao lado do plugin
  e um arquivo de descoberta de curta duração no diretório temporário do sistema operacional (fora do
  vault); ambos contêm dados de conexão, nunca o conteúdo das notas nem as chaves de API dos provedores. As ferramentas MCP podem
  ler e alterar os Markdown do vault somente quando você ativa o acesso MCP. Veja [o modelo de segurança
  do MCP](docs/MCP.md#editing-and-deletion-safeguards).
- **Programas locais (desktop, opcional).** Dois recursos executam um programa já instalado no seu
  computador, e somente quando você os usa: os provedores de LLM **Codex CLI / OpenCode CLI** (o prompt
  e o texto de origem vão para essa CLI, que os envia ao próprio provedor sob o seu login; o
  plugin não armazena chave e ignora a configuração de usuário da CLI) e **Export manuscript to Word**
  (Pandoc, executado localmente sobre o manuscrito compilado). O plugin nunca baixa nem instala
  nenhum dos dois programas.
- **Arquivos fora do vault (desktop, opcional).** Com "Keep the search index outside the vault"
  ativado, o índice é gravado na pasta de dados de aplicativos do sistema operacional
  (`~/Library/Application Support`, `%LOCALAPPDATA%` ou `~/.local/share`, em
  `academic-paper-citation-manager/`; até a 0.8.1 era a pasta de cache, que os programas de limpeza esvaziam).
  As chamadas à CLI e ao Pandoc usam uma pasta temporária que é excluída após cada chamada.

## 👤 Autor

**Professor Sang-Min Park, M.D., Ph.D.**
Department of Orthopaedic Surgery, Seoul National University Bundang Hospital,
Seoul National University College of Medicine
🌐 [sangmin.me](https://sangmin.me/)

## 📄 Licença

MIT (código do plugin). O PDF.js incluído mantém sua licença Apache-2.0 completa e o aviso de modificação no `main.js`; os
estilos/locales CSL mantêm sua licença CC BY-SA 3.0 (veja [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)).
