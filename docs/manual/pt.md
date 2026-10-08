# Guia do usuário — Refwright

[English](en.md) · [한국어](ko.md) · [中文](zh.md) · [日本語](ja.md) · [Español](es.md) · [Deutsch](de.md) · [Français](fr.md) · **Português**

Este guia percorre o plugin desde a coleta de artigos até a exportação de um manuscrito em Word.
Todas as capturas de tela foram feitas com o plugin real. Os números vermelhos de cada captura
correspondem aos passos numerados logo abaixo dela.

**Fluxo de trabalho:** coletar artigos → ler e organizar → buscar e perguntar → citar → exportar para o Word

**Sumário**

0. [Configuração](#0-configuração)
1. [A tela](#1-a-tela)
2. [Adicionar artigos do PubMed](#2-adicionar-artigos-do-pubmed)
3. [Adicionar um artigo por DOI ou PMID](#3-adicionar-um-artigo-por-doi-ou-pmid)
4. [Notas de referência](#4-notas-de-referência)
5. [Navegar pela biblioteca](#5-navegar-pela-biblioteca)
6. [Citar no manuscrito](#6-citar-no-manuscrito)
7. [Busca semântica](#7-busca-semântica)
8. [Conversar com a sua biblioteca](#8-conversar-com-a-sua-biblioteca)
9. [Artigos relacionados](#9-artigos-relacionados)
10. [Finalizar o manuscrito e exportar para o Word](#10-finalizar-o-manuscrito-e-exportar-para-o-word)

---

## 0. Configuração

Instale em **Settings → Community plugins → Browse**: pesquise "Refwright", instale e ative. Depois, informe sua chave de IA uma única vez.

![Configurações do plugin: provedor de embeddings e chave de API](img/en/13-settings.png)

1. Deixe **Embedding provider** em `OpenAI / compatible`. A URL base padrão é a do
   OpenRouter, então uma única chave cobre a busca, o chat e os resumos.
2. Cole sua chave do **OpenRouter** ([openrouter.ai/keys](https://openrouter.ai/keys)) em **API key (OpenRouter or OpenAI)**. A chave fica guardada no chaveiro
   do sistema, e não nos arquivos do vault. Uma chave da OpenAI também funciona, mas só se você
   mudar **OpenAI base URL** para `https://api.openai.com/v1`; com a URL padrão, ela precisa ser
   do OpenRouter.

> **Não é preciso chave para citar.** Adicionar artigos, citações com `@` e bibliografias funcionam
> sem uma chave de IA. A chave só é necessária para resumos, busca semântica e chat.

## 1. A tela

O plugin adiciona três ícones à barra lateral esquerda (ribbon) e um painel da biblioteca à direita.

![Janela do Obsidian com os ícones do ribbon e o painel da biblioteca](img/en/01-overview.png)

1. **Open library**: abre a lista dos seus artigos.
2. **Chat with library**: abre um chat que responde a partir dos seus próprios artigos.
3. **Search PubMed**: pesquisa no PubMed e adiciona artigos.
4. **Painel da biblioteca**: cada artigo é uma nota. Clique em um título para abrir a nota correspondente.

## 2. Adicionar artigos do PubMed

A maneira mais rápida de montar uma biblioteca. Pesquise, marque os artigos desejados e cada um vira uma
nota com resumo e tags de tópico.

![Caixa de diálogo Search PubMed com resultados](img/en/03-pubmed-search.png)

1. Digite uma busca em **Query**, por exemplo `biportal endoscopic lumbar decompression`.
2. Mantenha **Summarize with LLM** ativado para obter um resumo seção por seção em cada nota. Nos
   artigos de acesso aberto, o resumo é escrito a partir do texto completo.
3. Clique em **Search**.
4. Marque os artigos a adicionar. Os artigos marcados com **Open Access** são resumidos a partir do texto completo.

![O botão Add selected na parte inferior dos resultados](img/en/04-pubmed-add.png)

1. Clique em **Add selected** no fim da lista. Os dois ícones ao lado dele selecionam todos
   e limpam a seleção. Cada artigo leva cerca de 10 a 20 segundos; um aviso "Added 1 reference."
   aparece quando termina.

> **Sem duplicatas.** Um artigo que já está na sua biblioteca é reconhecido por DOI, PMID ou
> título e não é adicionado novamente.

## 3. Adicionar um artigo por DOI ou PMID

Quando você já conhece o artigo, cole o identificador dele. Clique em **+ add** no painel da biblioteca, ou execute
"Add reference by DOI / PMID / arXiv" na paleta de comandos.

![Caixa de diálogo Add reference com um DOI preenchido](img/en/02-add-reference.png)

1. Informe um DOI (`10.7759/cureus.46944`), um PMID (`38021704`) ou um ID do arXiv. O título de um artigo
   também serve; nesse caso ele é pesquisado.
2. Clique em **Fetch & add**. Os metadados vêm do Crossref e do PubMed.

> **Tem um PDF?** Use **📎 PDF** no painel da biblioteca para adicionar um artigo a partir do PDF. O DOI
> contido no PDF é usado para preencher os metadados.

## 4. Notas de referência

Cada artigo é salvo como uma nota Markdown em `References/`. Os arquivos são o banco de dados, de modo que
não há um programa separado como o Zotero.

![Uma nota de referência com as propriedades recolhidas e a seção Summary](img/en/05-reference-note.png)

1. **Properties**: autores, ano, periódico, DOI, PMID e tags (do MeSH). A chave usada para
   citar, o `citekey` (por exemplo `lv2024efficacy`), também está aqui.
2. **Summary**: Background, Methods, Results e Conclusions. Escreva suas próprias anotações em
   **Notes**, mais abaixo.

## 5. Navegar pela biblioteca

Filtre o painel da biblioteca à medida que ela cresce.

![Painel da biblioteca filtrado por "stenosis"](img/en/06-library.png)

1. **Filter**: busca em títulos, autores e tags. Digitar `stenosis` deixa 15 dos 56 artigos.
   O menu à direita altera a ordenação (por exemplo, ano mais recente primeiro).
2. **Quick filters**: mostram apenas os artigos com PDF, sem PDF, não lidos ou retratados.
3. **+ add**: abre a caixa de diálogo de DOI / PMID (seção 3).
4. **📎 PDF**: adiciona um artigo a partir de um arquivo PDF.

## 6. Citar no manuscrito

Escreva seu manuscrito em uma nota comum. Digite `@` onde uma citação deve entrar.

![Sugestões de citação após digitar @lv](img/en/07-cite-suggest.png)

1. Depois de `@`, digite parte do nome de um autor ou do título para ver os artigos correspondentes. Pressione
   <kbd>Enter</kbd> para inserir `[@lv2024efficacy]`.

### Gerar a bibliografia

Coloque o estilo do periódico nas propriedades da nota (`csl: spine`) e execute
<kbd>Cmd/Ctrl</kbd>+<kbd>P</kbd> → **Update bibliography in current note**.

![Citações formatadas e a lista de References gerada](img/en/08-bibliography.png)

1. No modo de leitura, cada `[@citekey]` aparece no estilo do periódico (aqui, números
   sobrescritos).
2. Uma seção **References** é escrita no fim da nota, no formato do periódico. Execute
   o comando de novo depois de adicionar ou remover citações para atualizá-la.

> **Estilos de periódico**: `spine`, `apa`, `american-medical-association`, `elsevier-vancouver`
> e `springer-basic-brackets` já vêm incluídos. Qualquer outro ID de estilo do
> [repositório de estilos CSL](https://github.com/citation-style-language/styles), como
> `vancouver` ou `nature`, é baixado no primeiro uso. Não sabe o ID? Execute **Choose citation
> style…** e digite o nome do periódico.

## 7. Busca semântica

Encontra trechos de significado semelhante, mesmo quando as palavras são diferentes. Abra-a com **Search**
no painel da biblioteca. Clique em **Rebuild index** uma vez antes (menos de um minuto para cerca de 50 artigos).

![Painel Search com trechos sobre dural tears](img/en/09-search.png)

1. Descreva o que você procura, por exemplo `dural tear and other complications`.
2. Restrinja os resultados por intervalo de anos, autor ou tag.
3. Clique em **Search**. Os trechos correspondentes são listados por artigo; clique em um para abrir a nota dele.

## 8. Conversar com a sua biblioteca

As respostas vêm somente dos artigos que você coletou. Os números entre colchetes, como `[1]` e
`[3]`, indicam de qual artigo vem cada afirmação.

![Painel de chat com uma pergunta e uma resposta com citações](img/en/10-chat.png)

1. Sua pergunta. Você pode perguntar em qualquer idioma.
2. A resposta. Os números entre colchetes são as fontes.
3. A caixa de pergunta. Pressione <kbd>Enter</kbd> para enviar. Os campos acima dela limitam as fontes
   por ano, autor ou tag.

![Fontes abaixo da resposta e o botão Save as note](img/en/11-chat-sources.png)

1. **SOURCES** lista os artigos por trás da resposta. **Save as note** salva a resposta na
   pasta `Chat/` e transforma as fontes em citações `[@citekey]`.

## 9. Artigos relacionados

Mostra como seus artigos citam uns aos outros. Clique em **Build citation graph** uma vez para obter os
dados de citação do OpenAlex (cerca de 40 segundos para 56 artigos).

![Painel Related papers com o mapa de citações e as listas](img/en/12-related.png)

1. **Mapa de citações**: o ponto roxo é o artigo aberto. Os círculos sólidos são artigos da sua
   biblioteca; os círculos tracejados são artigos que você ainda não tem. Clique em um círculo tracejado para adicioná-lo.
2. **Listas**: artigos que este cita, artigos que o citam, artigos que compartilham muitas
   referências com ele e artigos que a sua biblioteca cita com frequência, mas não contém.

## 10. Finalizar o manuscrito e exportar para o Word

Todos os comandos estão na paleta de comandos (<kbd>Cmd/Ctrl</kbd>+<kbd>P</kbd>). Digite
"Refwright" para listá-los.

![Paleta de comandos listando os comandos do plugin](img/en/14-command-palette.png)

1. Digite aqui parte do nome de um comando. Os comandos mais usados:

| Command | O que faz |
|---|---|
| Update bibliography in current note | Escreve a seção References do manuscrito |
| Compile manuscript | Cria uma cópia com `[@citekey]` substituído por citações formatadas |
| Export manuscript to Word (.docx) | Compila e depois salva um arquivo Word (requer o [Pandoc](https://pandoc.org)) |
| Find unsupported claims | Lista os parágrafos que fazem uma afirmação sem citação |
| Suggest citations for selection | Sugere artigos para a frase selecionada |

![A cópia compilada do rascunho](img/en/15-compiled.png)

1. **Compile manuscript** deixa o original intacto e abre uma nova nota
   **Draft (compiled)**. As citações ficam formatadas e a lista de referências é anexada,
   pronta para a submissão. Para obter um arquivo Word, execute **Export manuscript to Word (.docx)**.

---

<sub>Capturas de tela: plugin v0.8.7 em um vault de teste com 56 artigos. As respostas do chat são saídas do modelo, sem edição.
Os mantenedores regeneram as capturas com `python scripts/manual/capture.py en`.</sub>
