<p align="center">
  <img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/assets/logo.svg" width="128" alt="Refwright logo">
</p>

<h1 align="center">Refwright</h1>

<p align="center"><i>旧称「Academic Paper Citation Manager」— プラグイン本体もIDも設定も変わりません。</i></p>

<p align="center">Markdownノートが、そのまま<b>文献ライブラリ</b>になります。<br>PubMedを検索し、AIで要約し、あらゆるジャーナルスタイルで引用する — Obsidianの中で動くZotero / EndNoteの代替です。</p>

<p align="center">
  <a href="https://community.obsidian.md/plugins/academic-paper-citation-manager"><img alt="Obsidian downloads" src="https://img.shields.io/badge/dynamic/json?logo=obsidian&color=7c3aed&label=downloads&query=%24%5B%22academic-paper-citation-manager%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json"></a>
  <a href="https://github.com/grotyx/rag-obsidian/releases/latest"><img alt="version" src="https://img.shields.io/badge/version-0.8.7-8b5cf6"></a>
  <a href="https://obsidian.md"><img alt="Obsidian" src="https://img.shields.io/badge/Obsidian-1.11.4%2B-a78bfa"></a>
  <a href="https://github.com/grotyx/rag-obsidian/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-green"></a>
</p>

<p align="center"><a href="#-インストール">インストール</a> · <a href="https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/ja.md">ユーザーガイド</a> · <a href="#-機能">機能</a> · <a href="https://github.com/grotyx/rag-obsidian/blob/main/docs/MCP.md">Claude Code / Codex</a> · <a href="#manuwright">manuwright</a> · <a href="https://github.com/grotyx/rag-obsidian/blob/main/CHANGELOG.md">Changelog</a></p>

<p align="center"><a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <a href="README.zh.md">中文</a> · <b>日本語</b> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.pt.md">Português</a></p>

<table>
  <tr>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/ja/03-pubmed-search.png" alt="PubMedから論文を追加"><br><b>PubMedから論文を追加</b></td>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/ja/07-cite-suggest.png" alt="@で引用"><br><b>@で引用</b></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/ja/10-chat.png" alt="ライブラリとチャット"><br><b>ライブラリとチャット</b></td>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/ja/12-related.png" alt="引用マップ"><br><b>引用マップ</b></td>
  </tr>
</table>

すべての文献は、[CSL-JSON](https://citationstyles.org/) frontmatterを持つ素のMarkdown（`.md`）ノートです。
そのためライブラリは持ち運びやすく、将来も読め、あなた自身のものであり続けます。外部アプリもアカウントもバックエンドも不要で、必要なのはVaultだけです。

---

## 📖 ユーザーガイド

論文の追加からWord原稿の書き出しまで、スクリーンショット付きで順に説明するガイドです。
[English](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/en.md) · [한국어](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/ko.md) · [中文](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/zh.md) · **[日本語](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/ja.md)** · [Español](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/es.md) · [Deutsch](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/de.md) · [Français](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/fr.md) · [Português](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/pt.md)

[![ObsidianでのCitationと自動生成された参考文献リスト](https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/ja/08-bibliography.png)](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/ja.md)

---

## ✨ 機能

**📥 集める**
- Obsidianの中で**キーワードからPubMedを検索** → 論文を選ぶ → ノート化。
- **DOI / PMID / arXiv**、または**論文タイトル**（自動照会）で追加。
- 既存ライブラリの**インポート** — **BibTeX · RIS · PubMed `.nbib` · CSL-JSON**、または
  起動中の**Zotero 7**から直接（ライブラリ全体、または1コレクション）。

**🧠 要約する（AI）**
- LLMが各ノートに**セクションごとの要約**（Background / Methods / Results /
  Conclusions）を書き込みます。*Summary language*（Settings → Chat）で、英語、韓国語、
  両方（既定。英語＋簡潔な韓国語要約）、または名前で指定した任意の言語を選べます。
- オープンアクセスの論文（PubMed Central）は**全文**を、それ以外は抄録を使います。

**🏷️ 整理する**
- すべてのノートに**MeSHトピック用語**を自動でタグ付け → Obsidianの**グラフビュー**で
  論文が主題ごとにまとまります。
- **引用グラフ**（OpenAlex）：ライブラリ内の参考文献／被引用に加え、*「よく引用されているのに
  手元にない」*論文を推薦します。Relatedペインに**マップ**として描画され（実線のノードは
  手元にあるノート、破線は手元にない論文で、破線のノードをクリックすると追加できます）、
  ペインのボタンから一度構築すれば、後から追加した文献は自動でグラフに加わります。
- 閲覧状況、**ダッシュボード**、被引用数。**Libraryペイン**では年、タイトル、
  著者、被引用数、追加日で並べ替えられ、クイックフィルター（PDFあり／なし／未読／撤回）も使えます。
- **重複**：検出してから**統合**できます。1つのノートを残し、不足項目を他のノートで補い、
  `[@old]` 引用はVault全体で書き換えられます。
- ノート単体またはライブラリ全体の**撤回チェック**（OpenAlex）と、レポートノートの作成。
- **システマティックレビュー**：**スクリーニングペイン**（include / exclude / maybe、キークエスチョン、
  エビデンスレベル、研究デザイン、除外理由、キーボードショートカット）と、全文献またはタグ単位の
  **PRISMA 2020フローダイアグラム**。
- **PDF**：PDFのない文献すべてについてオープンアクセス版をダウンロード（Unpaywall）、または手元の
  **PDFフォルダをリンク**します（ファイル名、DOI、PMID、タイトルで照合）。

**✍️ 引用して書く**
- `@` を入力 → オートコンプリートで `[@citekey]` を挿入。
- **「Update bibliography」**は、実際の**ジャーナルスタイル**（citeproc-js / CSL）で
  `## References` リストを作成します。本文中の引用マークも合わせて描画されます（`[1]`、上付き、または著者–年）。
- ノートのfrontmatterの `csl:` による**原稿ごとのスタイル指定**、または**Choose citation style…** で
  約10,000のジャーナルスタイルをジャーナル名から検索。
- **Live Preview**では入力中に引用が描画され、**ホバー**すると論文が表示されます。
- 投稿前に**Check references in this manuscript**：ライブラリにない、撤回済み、DOIなし、
  メタデータ不完全といった問題を検出します。
- **Compile manuscript** → 引用を解決したクリーンなコピーを作成 → **`.docx`** に書き出し。

**🔎 検索とチャット**
- ハイブリッド**セマンティック検索**（BM25＋ベクトル）と、**引用に基づくチャット**。回答は
  ライブラリの内容だけから作られ、`[n]` 形式で出典を示します。
- **実測された検索精度**（0.8.1）：ホスト型の**クロスエンコーダーによるリランカー**（1回の検索あたり約$0.0002）、**クエリ拡張**
  （独自の検索語彙＋MeSHエントリー用語）、韓国語（または英語以外）の質問の**自動翻訳**。
  16,578本の論文に対する96問の臨床ベンチマークで、nDCG@10は英語の質問で
  0.53から0.81へ、韓国語の質問で0.18から0.83へ向上しました。
- Claude Code / Codex向けの**所見レベル検索**（MCP `search_findings`）：ノートの `## Evidence (extracted)` セクションから、
  効果量、CI、p値、原文のままの引用といった個々の結果を検索します。
- **検索ペインと、チャットペインの両方にフィルター** — 発行**年の範囲**、**著者**
  （姓）、**タグ**で絞り込めます。タグ欄に入力すると（ライブラリ内のタグから
  オートコンプリート）、Enterでチップとして追加され、複数追加した場合はすべてを持つ論文のみが対象です。
  フィルターは設定ではなくペインごとの状態です。チャットペインでは回答の根拠にできる
  論文の範囲が絞られ、回答の出典リストには何で絞り込んだかが表示されます。
- **MCP経由のClaude Code / Codex（デスクトップ）：** 外部AIがライブライブラリを検索し、
  論文を探して追加・要約し、Markdownノートを安全に作成／編集／移動／ゴミ箱へ移動し、
  引用付きの原稿をコンパイルできます。要約の文章はClaude/Codexが書き、MCP経由ではこのプラグインの
  チャット・要約・リランキング用LLMは呼ばれません。Claude Code、Codex、OpenCode、
  Antigravity向けのセットアップボタンがあり、ノート編集用の7つのツールはオフにできます。
- **LLMにAPIキーは不要（デスクトップ）：** チャットと要約は、ログイン済みの
  **Codex CLI**または**OpenCode CLI**経由で実行できます。検索用のembeddingには引き続きOpenRouter/OpenAI
  またはローカルのOllamaが必要です。

---

## 📦 インストール

> **Obsidianコミュニティディレクトリで公開中：**
> [community.obsidian.md/plugins/academic-paper-citation-manager](https://community.obsidian.md/plugins/academic-paper-citation-manager)
> バージョン0.6.0でプラグインIDが変わりました。0.5.xのままの方は、一度だけ
> [移行ガイド](docs/MIGRATION-0.6.md)に従ってください。

### Option A — コミュニティプラグイン（推奨）

1. Obsidian → **Settings → Community plugins** → 制限モード（Restricted mode）がオンならオフにします。
2. **Browse** → **Refwright** を検索 → **Install** → **Enable**。

更新は他のプラグインと同様にObsidianが行います（**Settings → Community plugins → Check for updates**）。
デスクトップ専用です（Obsidian 1.11.4以降）。

以前に**BRAT**経由でインストールしましたか？ プラグインIDとフォルダは同じなので、設定とインデックスはそのまま使えます。
BRATの一覧からプラグインを削除し、以後はコミュニティプラグインから更新してください。

<details>
<summary><b>Option B — リリースをダウンロード（手動）</b></summary>

[最新リリース](https://github.com/grotyx/rag-obsidian/releases/latest)から、
`main.js`、`manifest.json`、`styles.css` を次のフォルダにダウンロードします。

```text
<your vault>/.obsidian/plugins/academic-paper-citation-manager/
```

（フォルダがなければ作成します。）その後Obsidianを再読み込みし、**Settings → Community plugins** でプラグインを有効化します。更新するには、3つのファイルをもう一度ダウンロードします。


</details>

<details>
<summary><b>Option C — 自分でビルドする</b></summary>

[Node.js 18+](https://nodejs.org)と[git](https://git-scm.com)が必要です。

```bash
git clone https://github.com/grotyx/rag-obsidian.git
cd rag-obsidian
npm install

cp .env.example .env        # Windows: copy .env.example .env
# edit .env → set VAULT_PLUGIN_DIR to <your vault>/.obsidian/plugins/academic-paper-citation-manager

npm run deploy              # builds + copies the plugin into your vault
```

その後Obsidianで **Settings → Community plugins → プラグインを有効化** → 再読み込み（`Ctrl/Cmd-R`）します。


</details>

<details>
<summary><b>Option D — クラウド同期されたVault（2台目ではビルド不要）</b></summary>

VaultをOneDrive / iCloud / Dropbox / Obsidian Syncに置いている場合、ビルド済みのプラグインは
Vaultの**中**（`<vault>/.obsidian/plugins/academic-paper-citation-manager/`）に入って一緒に移動します。別のマシンでは、
同期されたVaultを開いてプラグインを有効化するだけです。Nodeもビルドも不要です。


</details>

---

## 🚀 クイックスタート（5分）

1. Obsidianを**再読み込み**（`Ctrl/Cmd-R`）し、プラグインが有効になっていることを確認します。
2. **AIプロバイダを設定** — Settings → プラグインのタブ → 後述の**Providers**を参照。
3. **論文を追加** — リボンの**🔍 Search PubMed**で、トピックを入力し、結果を選んで **Add**。
   それぞれが `References/` 内のノートになり、AI要約とトピックタグが付きます。
4. **書いて引用** — 任意のノートで `@` を入力し、文献を選ぶと `[@citekey]` になります。
5. **参考文献リスト** — `Ctrl/Cmd-P` → **Update bibliography** → 選んだジャーナルスタイルで
   `## References` リストが作られます。

> 引用ワークフローに**embeddingは不要**です。セマンティック検索とチャットは任意で、
> 一度だけ **Rebuild search index** が必要です。

### Claude CodeまたはCodexに接続する

Obsidian Desktopで **Settings → Refwright → External AI (MCP)** を開き、
アクセスを有効にして、生成されたClaude Codeのコマンド、またはCodexの設定をコピーします。ツールの使用中は、この
Vaultを開いたままにしてください。ツール一覧、安全な編集ワークフロー、プロンプト例、セキュリティモデル、
トラブルシューティングは、[MCPガイド（完全版）](docs/MCP.md)を参照してください。

MCPは推論と文章作成をClaude CodeまたはCodexに任せます。**Chat with library**、
論文の要約、LLMリランカーは呼び出されません。設定済みのembeddingプロバイダが使われうるのは、
ライブラリ検索とインデックス再構築だけです。

論文を完全にインポートするには、クライアントに論文の追加と要約を依頼します。クライアントは
`add_reference` → `get_reference_source` → `save_reference_summary` の順に進みます。PMC全文が優先され、
なければ抄録が使われ、現在のノートのハッシュにより、同時に行われた編集の上書きが防がれます。

---

<a id="manuwright"></a>

## 🖋️ manuwrightで論文を書く

[**manuwright**](https://github.com/grotyx/Academic_writing_c_claudecode)は同じ作者による姉妹プロジェクトで、AIエージェント（Claude Code、Codex、Antigravity、opencode、Muse）向けの
医学論文ワークフローです。エージェントに、書く前に計画を立てさせ、登録された出典だけを引用させ、
すべての数値を結果ファイルから取らせ、投稿前に検証ゲートを通過させます。このプラグインのMCPサーバーを
文献ライブラリとして利用します。

- **ライブラリはすべてのエージェントと共有されます。** `manuwright obsidian connect` は、インストール済みの各エージェントに
  このプラグインのMCPサーバー（`rag-obsidian`）を登録するので、どのエージェントも執筆中に
  あなたの論文を検索できます。`manuwright obsidian install` は、プラグインをVaultにインストールし、
  MCPアクセスを有効にすることもできます。
- **Obsidianが論文を見つけ、manuwrightが引用してよいものを決めます。** `manuwright evidence
  import-obsidian <citekey>` は、文献ノートを論文の `knowledge/evidence.md` にコピーします。
  CSLフィールドが引用になり、プラグインのAI要約が要約フィールドを埋め、
  citekeyが `[EVID:citekey]` のIDになります。インポートされたエントリーは、全文を読むまでは
  *abstract-only* として扱われます。

```sh
uv tool install git+https://github.com/grotyx/Academic_writing_c_claudecode
manuwright obsidian status          # vaults with this plugin, and which agents are connected
manuwright obsidian connect         # add the rag-obsidian MCP server to your agents
manuwright evidence import-obsidian lv2024efficacy
```

<p align="center"><img src="https://raw.githubusercontent.com/grotyx/Academic_writing_c_claudecode/main/docs/images/manual/43_obsidian_import_evidence.png" width="720" alt="manuwrightがObsidianライブラリの文献をevidence.mdにインポートしているところ"></p>

manuwrightは任意です。プラグイン単体でも動き、manuwrightもObsidianなしで動きます。
エージェントがライブラリを使う間は、MCPアクセスを有効にしたままObsidianを開いておいてください。
[manuwrightマニュアル](https://github.com/grotyx/Academic_writing_c_claudecode/blob/main/docs/manual.md#3b-your-obsidian-library-optional-recommended)を参照してください。

---

## ⚙️ プロバイダ

差し替え可能で、Obsidian Desktop上ではすべてObsidianの `requestUrl` を通して通信します。

**初期状態では、チャットもembeddingもOpenRouterを指すOpenAI互換プロバイダに設定されています。**
そのため、キー1つでチャット、論文要約、embeddingのすべてをまかなえ、ローカルに何かをインストールする必要はありません。
キーを貼り付ければ完了で、それ以外はすべて任意です。

- **LLM**（チャット＋要約）：OpenAI / 互換（既定） · Anthropic · Ollama（ローカル） ·
  **Codex CLI** · **OpenCode CLI**。*Chat model* は任意で、**Chat with library** に限って既定のモデルを上書きします。
  要約とPDFメタデータ抽出は安価な既定のモデルのままなので、チャットにはより強力なモデルを使う価値があります。
- **Embeddings**（検索＋チャット）：OpenAI / 互換（既定） · Ollama（ローカル）。
- **APIキー不要：Codex CLI / OpenCode CLI**（デスクトップ）。すでにCodex（ChatGPTログイン）
  やOpenCodeを使っているなら、LLMプロバイダとして選べます。チャット、要約、リランクの呼び出しはすべて
  あなた自身のログインでそのCLIを通して実行され、プラグインはキーを保存しません。*Default model* を空にすると
  CLI自身の既定が使われ、指定する場合は名前を入力します（`gpt-5.1-codex`、OpenCodeなら `provider/model`）。CLI
  は通常のインストール先フォルダから探され、見つからなければ *CLI executable* を設定します。**Test** で確認できます。呼び出しは
  空の一時フォルダから、CLIのユーザー設定を読み込まずに実行され（そうしないと呼び出しのたびにMCPサーバーと
  フックが起動してしまいます）、1回あたり約4〜7秒で、バッチでは3つずつ並行して実行されます。
  embeddingには引き続きOpenRouter/OpenAIまたはOllamaが必要です。
- **インデックスの保存場所**：*Keep the search index outside the vault*（デスクトップ）をオンにすると、
  コンピューターのアプリデータフォルダに保存されるため、同期されたVaultで変更のたびに再アップロードされることがありません。
  その場合、インデックスは各デバイスで個別に構築されます。
- **検索**：*Results (top-k)* は、回答を組み立てる際に使う文章（パッセージ）の数です（既定は20。1つの文献につき
  最大3つまでなので、長い論文1本が枠を独占することはありません）。*Rerank chat results with
  the LLM* は既定でオフです。オンにすると、チャットは2倍の数のパッセージを取得し、
  まずモデルに関連度順に並べさせます。質問ごとにリクエストが1回増えます。

> OpenRouterのモデルIDにはベンダーのプレフィックス（`openai/…`、`deepseek/…`）が付きます。ベースURLを
> `https://api.openai.com/v1` にして使うことも可能で、その場合はモデルIDからプレフィックスを外してください。

**OpenRouterを使う場合は、**チャットとembeddingの両方に**OpenAI**プロバイダを選びます。キー1つ、
ベースURL1つで、数百のモデルが使えます。

| Setting | Value |
|---|---|
| Chat / Embedding provider | `OpenAI` |
| OpenAI base URL (shared) | `https://openrouter.ai/api/v1` |
| Chat model | any OpenRouter id, e.g. `deepseek/deepseek-v4-flash` |
| Embedding model | `openai/text-embedding-3-small` |
| API key (OpenRouter or OpenAI) | your OpenRouter key ([openrouter.ai/keys](https://openrouter.ai/keys)) |

**Google Geminiを使う場合は、****OpenAI**プロバイダを選び、Googleのエンドポイントを指定します。

| Setting | Value |
|---|---|
| Chat provider | `OpenAI` |
| Chat model | `gemini-3.5-flash` |
| Embedding provider | `OpenAI` |
| Embedding model | `gemini-embedding-001` |
| OpenAI base URL (shared) | `https://generativelanguage.googleapis.com/v1beta/openai` |
| API key (OpenRouter or OpenAI) | your Gemini key ([Google AI Studio](https://aistudio.google.com/apikey)) |

---

## ✍️ 論文を書く（ZoteroもWordプラグインも不要）

```text
Obsidian:  write Manuscript.md  →  type @ to cite  →  set the journal: csl: springer-basic-brackets
           Ctrl/Cmd-P → "Compile manuscript"        →  Manuscript (compiled).md
           Ctrl/Cmd-P → "Export manuscript to Word (.docx)"  →  Manuscript.docx (needs Pandoc)
```

- **Compile manuscript** は、すべての `[@citekey]` をスタイル適用済みの本文中の引用マークに解決し、
  `## References` リストを末尾に付けます。Pandocや投稿にそのまま使える状態です。
- **Export manuscript to Word (.docx)** は同じ方法でコンパイルし、同梱の
  アカデミックテンプレート（Times New Roman 12 pt、ダブルスペース、黒字）でPandocを実行します。Pandocは通常のインストール先
  フォルダから探されます。別の場所にある場合は、Settings → Writing でパスを指定してください。
  （ターミナルから同じことを行う `scripts/to-docx.cjs` も引き続き使えます。）

---

## 🎨 引用スタイル

参考文献リストと本文中の引用マークは、CSL-JSONに対して**citeproc-js**で生成されます。Zoteroが使っているのと
同じエンジンです。

- **全体設定：** Settings → *Bibliography style (CSL)*。オフラインで使える同梱スタイルは **Spine · The Spine
  Journal · European Spine Journal · AMA · APA** です。または任意のスタイルID（例：`nature`、
  `the-lancet`）を入力すると、[CSLリポジトリ](https://github.com/citation-style-language/styles)
  から取得されてキャッシュされます。
- **原稿ごと：** ノートのfrontmatterに `csl:` を追加します。全体設定より優先されます。

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

## 🧰 コマンド

| Group | Commands |
|---|---|
| **Add** | Search PubMed · Add by DOI / PMID / arXiv / title · Import (BibTeX / RIS / nbib / CSL-JSON / Zotero) · Import PDF |
| **Read** | Mark unread / reading / read · Reading queue · Find open-access PDF · Download open-access PDF · Download open-access PDF files for references without one · Link PDF files in a folder to references · Extract PDF highlights · Index linked PDF files · Index this note's PDF · Open reference online |
| **Organize** | Summarize and tag references (fill gaps) · Summarize and tag this reference · Summarize and tag references in a folder or tag… · Re-summarize this reference · Re-summarize references made by an older model · Open screening pane · Create PRISMA flow diagram · Library dashboard · Find duplicates · Merge duplicates… · Backfill citation counts · Check retraction (this note / all) · Rename tag · Enrich metadata · Suggest related papers · Export citation network |
| **Write** | `@` autocomplete · Suggest citations for selection · Find unsupported claims · Update bibliography · Choose citation style… · Check references in this manuscript · Compile manuscript · Export manuscript to Word (.docx) · Copy citation · Export annotated bibliography · Save latest chat answer as note |
| **Search** | Search library (semantic) · Chat with library · Show related papers · Build citation graph · Rebuild search index |
| **Export** | Library → BibTeX / RIS / CSL-JSON |

---

## 🛠️ 開発者向け

```bash
npm run dev        # esbuild watch → main.js
npm run deploy     # build + copy into the vault (VAULT_PLUGIN_DIR in .env)
npm run build      # tsc + esbuild production
npm test           # live integration suite + MCP contract/security checks
```

ヘルパースクリプト（ターミナルから実行、Obsidian不要）— パスは `.env` から取得されます。

```bash
node scripts/to-docx.cjs "Manuscript (compiled).md"                  # compiled md → styled .docx
```

外部AIのセットアップは[`docs/MCP.md`](./docs/MCP.md)、0.5.xからの移行は
[`docs/MIGRATION-0.6.md`](./docs/MIGRATION-0.6.md)、モジュール構成は
[`CLAUDE.md`](./CLAUDE.md)を参照してください。

---

## ⚠️ 注意事項と制限

- コミュニティ版のプラグインIDは `academic-paper-citation-manager` です。MCPの接続名は
  `rag-obsidian` のままで、この2つの識別子は互いに独立しています。
- ファイル名は**読みやすい形**（`2022-SpineJ-ParkSM-Biportal.md`）で、frontmatterの短い `citekey:` が
  `[@cite]` に使うハンドルです。
- `.docx` の書き出しには**Pandoc**が必要です。PDFハイライトの抽出には、注釈付きのPDFが必要です。
- 任意で使えるライブMCPブリッジがNode APIを使うため、このリリースは**デスクトップ専用**です。MCPを使う間は
  Obsidian Desktopと対象のVaultを開いたままにしてください。
- ObsidianのPropertiesパネルは、入れ子構造のCSL frontmatterに警告を出すことがありますが、データは正常です。
- 設定で**Contact e-mail**を入力してください。OpenAlex、Unpaywall、PubMedがすべてこれを使い、
  オープンアクセスPDFの検索はメールアドレスなしでは動作しません。
- APIキーはOSのキーチェーン（ObsidianのsecretStorage）に保存され、`data.json` では空欄になります。
  同期されたVaultでは、デバイスごとに一度キーを入力してください。
- ソースからのビルド／デプロイには、`styles/` 内のCSLスタイルが含まれます（CC BY-SA 3.0。
  `styles/README.md` を参照）。コミュニティ版では、選択したCSLスタイル／ロケールが3つのリリースファイルに
  含まれていない場合、取得してキャッシュします。プラグインのコードはMITライセンスです。
- 0.6.0以降、モバイルへのインストールはサポートされていません。[docs/MOBILE.md](docs/MOBILE.md)を参照してください。

## 🔒 ネットワークとプライバシー

- 文献の照会／検索では、必要に応じて識別子やクエリがCrossref、NCBI PubMed/PMC、OpenAlex、
  Unpaywall、arXivに送信されます。CSLスタイル／ロケールは公式のCSL
  GitHubリポジトリからダウンロードされることがあります。PDF.jsはプラグインに同梱されており、CDNから実行コードが読み込まれることはありません。
  ネットワークリクエストには、接続先サービスのプライバシーポリシーが適用されます。
- AI機能は、選択したソーステキストとプロンプトを、設定したプロバイダに送信します。対象は
  OpenAI互換のエンドポイント（OpenRouterやGeminiを含む）、Anthropic、またはOllamaです。APIキーは、
  利用可能な場合はObsidianのSecretStorageに保存され、古いバージョンのObsidianではプラグインの
  `data.json` にフォールバックします。このプラグインにテレメトリ、広告、アカウントサービス、ホスト型バックエンドはありません。
- *Rerank results with a cross-encoder* がオン（既定）のとき、検索クエリと取得したパッセージは
  OpenRouterのrerankエンドポイントに送信されます。*Translate non-English searches* がオン
  （既定）のとき、英語以外のクエリは翻訳のためにチャットモデルへ送信されます。*Build MeSH synonym list
  for search* は、ライブラリでよく使われる主題タグをNCBI E-utilitiesに送信します。
- MCPは認証付きの `127.0.0.1` でのみ待ち受けます。生成されたブリッジをプラグインの隣に、また
  短時間だけ有効な検出ファイルをオペレーティングシステムの一時ディレクトリ（Vaultの外）に書き込みます。どちらも
  接続情報を含みますが、ノートの内容やプロバイダのAPIキーは含みません。MCPツールがVaultのMarkdownを
  読み書きできるのは、MCPアクセスを有効にした場合だけです。[MCPのセキュリティ
  モデル](docs/MCP.md#editing-and-deletion-safeguards)を参照してください。
- **ローカルプログラム（デスクトップ、オプトイン）。** 2つの機能は、コンピューターにすでにインストールされているプログラムを、
  使用したときにのみ実行します。**Codex CLI / OpenCode CLI** のLLMプロバイダ（プロンプト
  とソーステキストはそのCLIに渡され、CLIがあなたのログインで自らのプロバイダに送信します。
  プラグインはキーを保存せず、CLIのユーザー設定も読み込みません）と、**Export manuscript to Word**
  （コンパイル済みの原稿に対してPandocをローカルで実行）です。プラグインがどちらのプログラムも
  ダウンロードしたりインストールしたりすることはありません。
- **Vault外のファイル（デスクトップ、オプトイン）。** "Keep the search index outside the vault"
  をオンにすると、インデックスはオペレーティングシステムのアプリデータフォルダ
  （`~/Library/Application Support`、`%LOCALAPPDATA%`、または `~/.local/share` の、
  `academic-paper-citation-manager/` 配下）に書き込まれます（0.8.1まではキャッシュフォルダでしたが、クリーナーアプリに消されるためです）。
  CLIとPandocの呼び出しは一時フォルダを使い、呼び出しのたびに削除されます。

## 👤 著者

**Professor Sang-Min Park, M.D., Ph.D.**
Department of Orthopaedic Surgery, Seoul National University Bundang Hospital,
Seoul National University College of Medicine
🌐 [sangmin.me](https://sangmin.me/)

## 📄 ライセンス

MIT（プラグインのコード）。同梱のPDF.jsはApache-2.0ライセンスの全文と改変の告知を `main.js` 内に保持しています。CSL
スタイル／ロケールはCC BY-SA 3.0ライセンスのままです（[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)を参照）。
