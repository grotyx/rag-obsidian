<p align="center">
  <img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/assets/logo.svg" width="128" alt="Refwright logo">
</p>

<h1 align="center">Refwright</h1>

<p align="center"><i>原名 “Academic Paper Citation Manager”——同一个插件，id 与设置均不变。</i></p>

<p align="center">你的 Markdown 笔记<b>就是</b>文献库。<br>检索 PubMed、获取 AI 摘要、按任意期刊格式引用——Obsidian 内的 Zotero / EndNote 替代方案。</p>

<p align="center">
  <a href="https://community.obsidian.md/plugins/academic-paper-citation-manager"><img alt="Obsidian downloads" src="https://img.shields.io/badge/dynamic/json?logo=obsidian&color=7c3aed&label=downloads&query=%24%5B%22academic-paper-citation-manager%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json"></a>
  <a href="https://github.com/grotyx/rag-obsidian/releases/latest"><img alt="version" src="https://img.shields.io/badge/version-0.8.7-8b5cf6"></a>
  <a href="https://obsidian.md"><img alt="Obsidian" src="https://img.shields.io/badge/Obsidian-1.11.4%2B-a78bfa"></a>
  <a href="https://github.com/grotyx/rag-obsidian/blob/main/LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-green"></a>
</p>

<p align="center"><a href="#-安装">安装</a> · <a href="https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/zh.md">用户指南</a> · <a href="#-功能">功能</a> · <a href="https://github.com/grotyx/rag-obsidian/blob/main/docs/MCP.md">Claude Code / Codex</a> · <a href="#manuwright">manuwright</a> · <a href="https://github.com/grotyx/rag-obsidian/blob/main/CHANGELOG.md">更新日志</a></p>

<p align="center"><a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <b>中文</b> · <a href="README.ja.md">日本語</a> · <a href="README.es.md">Español</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.pt.md">Português</a></p>

<table>
  <tr>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/zh/03-pubmed-search.png" alt="从 PubMed 添加论文"><br><b>从 PubMed 添加论文</b></td>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/zh/07-cite-suggest.png" alt="用 @ 插入引用"><br><b>用 @ 插入引用</b></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/zh/10-chat.png" alt="与文献库对话"><br><b>与文献库对话</b></td>
    <td width="50%" align="center"><img src="https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/zh/12-related.png" alt="引用图谱"><br><b>引用图谱</b></td>
  </tr>
</table>

每条文献都是一个普通的 `.md` 笔记，带有 [CSL-JSON](https://citationstyles.org/)
frontmatter，因此你的文献库可移植、经得起时间考验，并且完全属于你自己。无需外部应用，
无需账号，没有后端——只有你的 vault。

---

## 📖 用户指南

附截图的分步指南，从添加论文到导出 Word 原稿：
[English](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/en.md) · [한국어](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/ko.md) · **[中文](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/zh.md)** · [日本語](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/ja.md) · [Español](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/es.md) · [Deutsch](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/de.md) · [Français](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/fr.md) · [Português](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/pt.md)

[![Obsidian 中的引用与自动生成的参考文献列表](https://raw.githubusercontent.com/grotyx/rag-obsidian/main/docs/manual/img/zh/08-bibliography.png)](https://github.com/grotyx/rag-obsidian/blob/main/docs/manual/zh.md)

---

## ✨ 功能

**📥 收集**
- 在 Obsidian 内**按关键词检索 PubMed** → 勾选论文 → 生成笔记。
- 通过 **DOI / PMID / arXiv** 添加，或按**论文标题**添加（自动查找）。
- **导入**现有文献库——**BibTeX · RIS · PubMed `.nbib` · CSL-JSON**，或直接
  从正在运行的 **Zotero 7** 导入（整个文献库或某一个分类）。

**🧠 摘要（AI）**
- 由 LLM 将**分节摘要**（Background / Methods / Results /
  Conclusions）写入每个笔记。*Summary language*（Settings → Chat）可选择英文、韩文、
  两者兼有（默认，英文 + 简明韩文摘要），或按名称指定任何其他语言。
- 开放获取论文使用**全文**（PubMed Central），其余使用摘要。

**🏷️ 整理**
- 为每个笔记自动添加 **MeSH 主题词**标签 → Obsidian 的**关系图谱**会按主题
  对论文聚类。
- **引用图谱**（OpenAlex）：文献库内的参考文献 / 被引情况，以及 *“高频被引但缺失”* 的推荐——
  在 Related 面板中绘制为**图谱**（实心节点是你已有的
  笔记，虚线节点是你没有的论文；点击虚线节点即可添加）。从面板按钮构建一次
  即可，之后新增的文献会自动加入。
- 阅读状态、**仪表盘**、被引次数。**Library 面板**可按年份、标题、
  作者、被引次数或添加日期排序，并带有快速筛选（有 PDF / 无 PDF / 未读 / 已撤稿）。
- **重复项**：查找后可**合并**——保留一个笔记，缺失内容从其他笔记补全，
  全库中的 `[@old]` 引用同步改写。
- **撤稿检查**，针对单个笔记或整个文献库（OpenAlex），并生成报告笔记。
- **系统综述**：**筛选面板**（include / exclude / maybe、关键问题、证据
  等级、研究设计、排除原因、键盘快捷键），以及针对全部
  文献或某个标签的 **PRISMA 2020 流程图**。
- **PDF**：为每篇没有 PDF 的文献下载开放获取版本（Unpaywall），或
  **关联已有 PDF 的文件夹**——按文件名、DOI、PMID 或标题匹配。

**✍️ 引用与写作**
- 输入 `@` → 自动补全并插入 `[@citekey]`。
- **“Update bibliography”** 以真正的**期刊格式**生成 `## References` 列表
  （citeproc-js / CSL）；正文中的引用标记同步渲染（`[1]`、上标或作者–年份）。
- 通过笔记 frontmatter 中的 `csl:` 设置**每篇原稿的格式**——或使用 **Choose citation style…**，
  按期刊名称在约 10,000 种期刊格式中搜索。
- 引用在 **Live Preview** 中随输入实时渲染；**悬停**即可查看对应论文。
- 投稿前**检查原稿中的参考文献**（Check references in this manuscript）：库中缺失、
  已撤稿、无 DOI 或元数据不完整。
- **Compile manuscript** → 得到已解析引用的干净副本 → 导出为 **`.docx`**。

**🔎 检索与对话**
- 混合**语义检索**（BM25 + 向量）与**基于引用的对话**，仅依据你的文献库
  作答，并附 `[n]` 来源。
- **可量化的检索效果**（0.8.1）：托管的**交叉编码器重排序**（每次检索约 $0.0002）、**查询扩展**
  （你自己的检索词表 + MeSH 入口词），以及对韩文（或任何
  非英文）问题的**自动翻译**。在涵盖 16,578 篇论文的 96 题临床基准上，英文问题的 nDCG@10 由
  0.53 升至 0.81，韩文问题由 0.18 升至 0.83。
- 面向 Claude Code / Codex 的**发现级检索**（MCP `search_findings`）：逐条结果——
  效应量、CI、p 值及原文引文——取自笔记的 `## Evidence (extracted)` 部分。
- **检索面板*和*对话面板均带筛选器**——按发表**年份范围**、**作者**
  （姓氏）和**标签**缩小范围：在标签框中输入（会根据文献库中已有的标签自动补全），
  按 Enter 添加为标签芯片；添加多个后，论文必须同时带有这些标签。
  筛选器属于面板而不属于设置；在对话面板中，它们限定回答可以引用哪些
  论文，回答的来源列表会注明缩小的范围。
- **通过 MCP 使用 Claude Code / Codex（桌面端）：**让外部 AI 检索实时文献库，
  查找、添加并摘要论文，安全地创建 / 编辑 / 移动 / 删除 Markdown 笔记，并编译
  带引用的原稿。摘要文字由 Claude/Codex 撰写；MCP 路径绝不会调用本插件的
  对话、摘要或重排序 LLM。提供 Claude Code、Codex、OpenCode 和
  Antigravity 的设置按钮；七个笔记编辑工具可以关闭。
- **LLM 无需 API 密钥（桌面端）：**对话与摘要可通过你已登录的 **Codex CLI** 或
  **OpenCode CLI** 运行。检索 embedding 仍需 OpenRouter/OpenAI
  或本地 Ollama。

---

## 📦 安装

> **已上架 Obsidian 社区插件目录：**
> [community.obsidian.md/plugins/academic-paper-citation-manager](https://community.obsidian.md/plugins/academic-paper-citation-manager)。
> 0.6.0 版本更改了插件 id；仍在使用 0.5.x 的用户请按
> [迁移指南](docs/MIGRATION-0.6.md) 操作一次。

### 方案 A — 社区插件（推荐）

1. Obsidian → **Settings → Community plugins** → 若处于 Restricted mode，请将其关闭。
2. **Browse** → 搜索 **Refwright** → **Install** → **Enable**。

Obsidian 会像更新其他插件一样更新它（**Settings → Community plugins → Check for updates**）。
仅限桌面端（Obsidian 1.11.4+）。

之前通过 **BRAT** 安装？插件 id 和文件夹不变，因此你的设置和
索引都会保留：从 BRAT 列表中移除该插件，之后通过社区插件继续更新即可。

<details>
<summary><b>方案 B — 下载发行版（手动）</b></summary>

从[最新发行版](https://github.com/grotyx/rag-obsidian/releases/latest)下载
`main.js`、`manifest.json` 和 `styles.css`，放入

```text
<your vault>/.obsidian/plugins/academic-paper-citation-manager/
```

（若文件夹不存在请先创建），然后重新加载 Obsidian，并在
**Settings → Community plugins** 中启用插件。更新时需要再次下载这三个文件。


</details>

<details>
<summary><b>方案 C — 自行构建</b></summary>

需要 [Node.js 18+](https://nodejs.org) 和 [git](https://git-scm.com)。

```bash
git clone https://github.com/grotyx/rag-obsidian.git
cd rag-obsidian
npm install

cp .env.example .env        # Windows: copy .env.example .env
# edit .env → set VAULT_PLUGIN_DIR to <your vault>/.obsidian/plugins/academic-paper-citation-manager

npm run deploy              # builds + copies the plugin into your vault
```

然后在 Obsidian 中：**Settings → Community plugins → 启用该插件** → 重新加载（`Ctrl/Cmd-R`）。


</details>

<details>
<summary><b>方案 D — 云同步的 vault（第二台电脑无需构建）</b></summary>

如果你的 vault 位于 OneDrive / iCloud / Dropbox / Obsidian Sync 中，构建好的插件会随 vault
**一同**同步（`<vault>/.obsidian/plugins/academic-paper-citation-manager/`）。在另一台电脑上只需
打开已同步的 vault 并启用插件——无需 Node，无需构建。


</details>

---

## 🚀 快速开始（5 分钟）

1. **重新加载** Obsidian（`Ctrl/Cmd-R`），确认插件已启用。
2. **设置 AI 提供商**——Settings → 该插件的标签页 → 参见下文 **Providers**。
3. **添加论文**——功能区 **🔍 Search PubMed**，输入主题，勾选结果 → **Add**。
   每篇都会在 `References/` 中生成一个笔记，附带 AI 摘要和主题标签。
4. **写作与引用**——在任意笔记中输入 `@` 并选择文献 → `[@citekey]`。
5. **参考文献列表**——`Ctrl/Cmd-P` → **Update bibliography** → 按你选定的期刊格式
   生成 `## References` 列表。

> 引用工作流**无需 embedding**。语义检索与对话为可选功能，
> 需要一次性的 **Rebuild search index**。

### 连接 Claude Code 或 Codex

在 Obsidian 桌面端，打开 **Settings → Refwright → External AI (MCP)**，
启用访问，然后复制生成的 Claude Code 命令或 Codex 配置。使用这些工具期间请保持该
vault 处于打开状态。工具列表、安全编辑工作流、示例提示词、安全模型和故障排除，
请参见[完整的 MCP 指南](docs/MCP.md)。

MCP 将推理和文字撰写交给 Claude Code 或 Codex。它不会调用 **Chat with library**、
论文摘要或 LLM 重排序；只有文献库检索 / 索引重建可能使用已配置的
embedding 提供商。

如需完整导入，请让客户端添加并摘要论文。它会依次执行
`add_reference` → `get_reference_source` → `save_reference_summary`：优先使用 PMC 全文，
否则退回到摘要，并通过当前笔记哈希防止覆盖并发的编辑。

---

<a id="manuwright"></a>

## 🖋️ 用 manuwright 撰写论文

[**manuwright**](https://github.com/grotyx/Academic_writing_c_claudecode) 是同一作者的配套项目：一个面向 AI 智能体（Claude Code、Codex、Antigravity、opencode、Muse）的医学原稿
工作流。它让智能体先规划再写作，只引用已登记的来源，所有数字均取自你的结果文件，
并在投稿前通过验证关卡。它将本插件的 MCP 服务器用作
参考文献库：

- **文献库与所有智能体共享。** `manuwright obsidian connect` 会向每个已安装的智能体注册本
  插件的 MCP 服务器（`rag-obsidian`），因此它们在起草时都能检索你的
  论文。`manuwright obsidian install` 还可以把插件安装进某个 vault，
  并为你开启 MCP 访问。
- **Obsidian 负责找论文；manuwright 决定什么可以引用。** `manuwright evidence
  import-obsidian <citekey>` 会把一条参考文献笔记复制到论文的 `knowledge/evidence.md`：
  CSL 字段成为引用信息，插件的 AI 摘要填入摘要字段，
  citekey 成为 `[EVID:citekey]` id。导入的条目在你读过全文之前，
  一律标记为*仅摘要*。

```sh
uv tool install git+https://github.com/grotyx/Academic_writing_c_claudecode
manuwright obsidian status          # vaults with this plugin, and which agents are connected
manuwright obsidian connect         # add the rag-obsidian MCP server to your agents
manuwright evidence import-obsidian lv2024efficacy
```

<p align="center"><img src="https://raw.githubusercontent.com/grotyx/Academic_writing_c_claudecode/main/docs/images/manual/43_obsidian_import_evidence.png" width="720" alt="manuwright 将 Obsidian 文献库中的一条参考文献导入 evidence.md"></p>

manuwright 是可选的：插件可独立使用，manuwright 也可在没有 Obsidian 的情况下使用。
智能体使用文献库期间，请保持 Obsidian 打开且已启用 MCP 访问。参见
[manuwright 手册](https://github.com/grotyx/Academic_writing_c_claudecode/blob/main/docs/manual.md#3b-your-obsidian-library-optional-recommended)。

---

## ⚙️ Providers

可插拔，在 Obsidian 桌面端均通过 Obsidian 的 `requestUrl` 调用：

**开箱即用时，两者都设为指向 OpenRouter 的 OpenAI 兼容提供商**，因此
一个密钥即可覆盖对话、论文摘要和 embedding，本地无需安装任何东西。
粘贴密钥即可完成；其余均为可选项。

- **LLM**（对话 + 摘要）：OpenAI / 兼容接口（默认）· Anthropic · Ollama（本地）·
  **Codex CLI** · **OpenCode CLI**。*Chat model* 为可选项，仅对 **Chat with library** 覆盖默认模型——
  这里值得用更强的模型，因为摘要和 PDF 元数据提取仍使用
  更便宜的默认模型。
- **Embeddings**（检索 + 对话）：OpenAI / 兼容接口（默认）· Ollama（本地）。
- **无需 API 密钥：Codex CLI / OpenCode CLI**（桌面端）。如果你已在使用 Codex（ChatGPT 登录）
  或 OpenCode，可将其选为 LLM 提供商：每一次对话、摘要和重排序调用都通过
  该 CLI 以你自己的登录身份运行，插件不保存任何密钥。*Default model* 留空则使用
  CLI 自带的默认模型，或指定一个（`gpt-5.1-codex`；OpenCode 使用 `provider/model`）。插件会在常见安装
  文件夹中查找该 CLI，也可设置 *CLI executable*；**Test** 用于检查。调用在
  一个空的临时文件夹中运行，并跳过该 CLI 的用户配置（否则它的 MCP 服务器和 hook
  会在每次调用时启动），每次约 4–7 秒，批量处理时并行三个。
  Embeddings 仍需 OpenRouter/OpenAI 或 Ollama。
- **Index location**：*Keep the search index outside the vault*（桌面端）会把索引存放在
  电脑的应用数据文件夹中，这样同步的 vault 不会在每次变更后重新上传；
  每台设备会各自构建索引。
- **Retrieval**：*Results (top-k)* 是用于生成回答的段落数量（默认 20；每条
  文献最多三段，避免一篇长文占满所有名额）。*Rerank chat results with
  the LLM* 默认关闭——开启后，对话会检索两倍数量的段落，并先让
  模型按相关性排序，每个问题多一次请求。

> OpenRouter 的模型 id 带有厂商前缀（`openai/…`、`deepseek/…`）。将 base URL
> 改为 `https://api.openai.com/v1` 同样可行——此时请去掉模型 id 的前缀。

**使用 OpenRouter？**对话和 embedding 都选 **OpenAI** 提供商——一个密钥、
一个 base URL、数百个模型：

| Setting | Value |
|---|---|
| Chat / Embedding provider | `OpenAI` |
| OpenAI base URL (shared) | `https://openrouter.ai/api/v1` |
| Chat model | 任意 OpenRouter id，例如 `deepseek/deepseek-v4-flash` |
| Embedding model | `openai/text-embedding-3-small` |
| API key (OpenRouter or OpenAI) | 你的 OpenRouter 密钥（[openrouter.ai/keys](https://openrouter.ai/keys)） |

**使用 Google Gemini？**选择 **OpenAI** 提供商，并指向 Google 的端点：

| Setting | Value |
|---|---|
| Chat provider | `OpenAI` |
| Chat model | `gemini-3.5-flash` |
| Embedding provider | `OpenAI` |
| Embedding model | `gemini-embedding-001` |
| OpenAI base URL (shared) | `https://generativelanguage.googleapis.com/v1beta/openai` |
| API key (OpenRouter or OpenAI) | 你的 Gemini 密钥（[Google AI Studio](https://aistudio.google.com/apikey)） |

---

## ✍️ 撰写论文（无需 Zotero / Word 插件）

```text
Obsidian:  write Manuscript.md  →  type @ to cite  →  set the journal: csl: springer-basic-brackets
           Ctrl/Cmd-P → "Compile manuscript"        →  Manuscript (compiled).md
           Ctrl/Cmd-P → "Export manuscript to Word (.docx)"  →  Manuscript.docx (needs Pandoc)
```

- **Compile manuscript** 会把每个 `[@citekey]` 解析为对应格式的正文引用标记，并附上
  `## References` 列表——可直接用于 Pandoc / 投稿。
- **Export manuscript to Word (.docx)** 以同样方式编译，并使用内置的
  学术模板运行 Pandoc：Times New Roman 12 pt、双倍行距、黑色字体。插件会在常见的
  安装文件夹中查找 Pandoc；若安装在别处，请在 Settings → Writing 中设置其路径。
  （`scripts/to-docx.cjs` 仍可在终端中完成同样的操作。）

---

## 🎨 引用格式

参考文献列表和正文引用标记基于你的 CSL-JSON，使用 **citeproc-js** 生成——与
Zotero 使用的是同一引擎。

- **全局：**Settings → *Bibliography style (CSL)*。离线内置：**Spine · The Spine
  Journal · European Spine Journal · AMA · APA**。也可输入任意格式 id（如 `nature`、
  `the-lancet`）——会从 [CSL 仓库](https://github.com/citation-style-language/styles)
  获取并缓存。
- **按原稿：**在笔记的 frontmatter 中添加 `csl:`——它会覆盖全局格式。

```yaml
---
csl: springer-basic-brackets
---
```

| 期刊 | `csl:` 值 |
|---|---|
| Spine | `spine` |
| The Spine Journal | `elsevier-vancouver` |
| European Spine Journal | `springer-basic-brackets` |
| Global Spine Journal | `american-medical-association` |
| 其他 | CSL 格式仓库中的任意 id |

---

## 🧰 命令

| 分组 | 命令 |
|---|---|
| **Add** | Search PubMed · Add by DOI / PMID / arXiv / title · Import (BibTeX / RIS / nbib / CSL-JSON / Zotero) · Import PDF |
| **Read** | Mark unread / reading / read · Reading queue · Find open-access PDF · Download open-access PDF · Download open-access PDF files for references without one · Link PDF files in a folder to references · Extract PDF highlights · Index linked PDF files · Index this note's PDF · Open reference online |
| **Organize** | Summarize and tag references (fill gaps) · Summarize and tag this reference · Summarize and tag references in a folder or tag… · Re-summarize this reference · Re-summarize references made by an older model · Open screening pane · Create PRISMA flow diagram · Library dashboard · Find duplicates · Merge duplicates… · Backfill citation counts · Check retraction (this note / all) · Rename tag · Enrich metadata · Suggest related papers · Export citation network |
| **Write** | `@` autocomplete · Suggest citations for selection · Find unsupported claims · Update bibliography · Choose citation style… · Check references in this manuscript · Compile manuscript · Export manuscript to Word (.docx) · Copy citation · Export annotated bibliography · Save latest chat answer as note |
| **Search** | Search library (semantic) · Chat with library · Show related papers · Build citation graph · Rebuild search index |
| **Export** | Library → BibTeX / RIS / CSL-JSON |

---

## 🛠️ 开发者

```bash
npm run dev        # esbuild watch → main.js
npm run deploy     # build + copy into the vault (VAULT_PLUGIN_DIR in .env)
npm run build      # tsc + esbuild production
npm test           # live integration suite + MCP contract/security checks
```

辅助脚本（终端中运行，无需 Obsidian）——路径取自 `.env`：

```bash
node scripts/to-docx.cjs "Manuscript (compiled).md"                  # compiled md → styled .docx
```

外部 AI 的设置请参见 [`docs/MCP.md`](./docs/MCP.md)，0.5.x 迁移请参见
[`docs/MIGRATION-0.6.md`](./docs/MIGRATION-0.6.md)，模块图请参见
[`CLAUDE.md`](./CLAUDE.md)。

---

## ⚠️ 注意事项与限制

- 符合社区要求的插件 id 为 `academic-paper-citation-manager`。MCP 连接
  名称仍为 `rag-obsidian`；两者互相独立。
- 文件名**可读**（`2022-SpineJ-ParkSM-Biportal.md`）；frontmatter 中简短的 `citekey:`
  才是 `[@cite]` 的引用句柄。
- `.docx` 导出需要 **Pandoc**；提取 PDF 高亮需要带批注的 PDF。
- 本版本**仅限桌面端**，因为可选的实时 MCP 桥接使用了 Node API。使用 MCP 期间，请保持
  Obsidian 桌面端和目标 vault 处于打开状态。
- Obsidian 的 Properties 面板可能会对嵌套的 CSL frontmatter 给出警告——数据本身是有效的。
- 请在设置中填写 **Contact e-mail**：OpenAlex、Unpaywall 和 PubMed 都会使用它，
  没有它，开放获取 PDF 的查找无法工作。
- API 密钥保存在操作系统密钥链中（Obsidian 的 secretStorage），并在 `data.json` 中留空；在
  同步的 vault 上，每台设备需各输入一次密钥。
- 源码构建 / 部署包含 `styles/` 下的 CSL 格式（CC BY-SA 3.0；参见
  `styles/README.md`）。社区安装版在三个发行文件中没有所选 CSL 格式 / 语言环境时，
  会获取并缓存它。插件代码采用 MIT 许可。
- 自 0.6.0 起不支持移动端安装；参见 [docs/MOBILE.md](docs/MOBILE.md)。

## 🔒 网络与隐私

- 文献查找 / 检索会按需将标识符或查询发送至 Crossref、NCBI PubMed/PMC、OpenAlex、
  Unpaywall 和 arXiv。CSL 格式 / 语言环境文件可能从官方 CSL
  GitHub 仓库下载。PDF.js 已随插件打包；不会从 CDN 加载任何可执行代码。
  网络请求受所访问服务的隐私政策约束。
- AI 功能会将所选来源文本和提示词发送给你配置的提供商：
  OpenAI 兼容端点（包括 OpenRouter 或 Gemini）、Anthropic 或 Ollama。API 密钥在可用时
  存储于 Obsidian SecretStorage；较旧的 Obsidian 版本则退回到插件的
  `data.json`。插件没有遥测、广告、账号服务或托管后端。
- 开启 *Rerank results with a cross-encoder*（默认）时，检索查询和检索到的
  段落会发送到 OpenRouter 的重排序端点。开启 *Translate non-English searches*
  （默认）时，非英文查询会发送到你的对话模型进行翻译。*Build MeSH synonym list
  for search* 会将你文献库中常见的主题标签发送到 NCBI E-utilities。
- MCP 仅监听经过认证的 `127.0.0.1`。它会在插件旁生成一个桥接文件，并在操作系统临时目录（vault 之外）
  写入一个短期有效的发现文件；两者只包含连接数据，绝不包含笔记内容或提供商 API 密钥。仅当你启用 MCP 访问时，MCP 工具才能
  读取和修改 vault 中的 Markdown。参见 [MCP 安全
  模型](docs/MCP.md#editing-and-deletion-safeguards)。
- **本地程序（桌面端，需主动开启）。**有两项功能会运行你电脑上已安装的程序，且仅在你使用时才运行：
  **Codex CLI / OpenCode CLI** LLM 提供商（提示词
  和来源文本会发送给该 CLI，由它以你的登录身份发送给其自己的提供商；
  插件不保存任何密钥，并跳过该 CLI 的用户配置）以及 **Export manuscript to Word**
  （在本地对编译后的原稿运行 Pandoc）。插件绝不会下载或安装
  这两个程序。
- **vault 之外的文件（桌面端，需主动开启）。**开启 “Keep the search index outside the vault”
  后，索引会写入操作系统的应用数据文件夹
  （`~/Library/Application Support`、`%LOCALAPPDATA%` 或 `~/.local/share`，位于
  `academic-paper-citation-manager/` 下；直到 0.8.1 为止它位于缓存文件夹，而清理工具会清空该文件夹）。
  CLI 和 Pandoc 调用使用临时文件夹，每次调用后即删除。

## 👤 作者

**Sang-Min Park 教授（M.D., Ph.D.）**
首尔大学盆唐医院骨科，
首尔大学医学院
🌐 [sangmin.me](https://sangmin.me/)

## 📄 许可证

MIT（插件代码）。内置的 PDF.js 在 `main.js` 中保留其完整的 Apache-2.0 许可证和修改声明；CSL
格式 / 语言环境文件保留其 CC BY-SA 3.0 许可证（参见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)）。
