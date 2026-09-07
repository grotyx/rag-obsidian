import { Plugin, WorkspaceLeaf, TFile, TAbstractFile, Notice, SecretStorage } from "obsidian";
import { ScholarRagSettings, DEFAULT_SETTINGS, SECRET_FIELDS, SecretField } from "./src/types";
import { ScholarRagSettingTab } from "./src/settings";
import { Library } from "./src/data/library";
import { IndexManager } from "./src/index/manager";
import { AddReferenceModal } from "./src/ui/AddReferenceModal";
import { PubmedSearchModal } from "./src/ui/PubmedSearchModal";
import { LibraryView, VIEW_TYPE_LIBRARY } from "./src/ui/LibraryView";
import { SearchView, VIEW_TYPE_SEARCH } from "./src/ui/SearchView";
import { ChatView, VIEW_TYPE_CHAT } from "./src/ui/ChatView";
import { RelatedView, VIEW_TYPE_RELATED } from "./src/ui/RelatedView";
import { CitationGraph } from "./src/graph/citations";
import { ImportPdfModal } from "./src/ui/ImportPdfModal";
import { CitationSuggest } from "./src/cite/suggest";
import {
  extractCitekeys,
  inTextLabel,
  citePattern,
  keysInCite,
  resolveCluster,
  decodeEntities,
} from "./src/cite/bibliography";
import { CiteEngine } from "./src/cite/csl";
import { ImportModal } from "./src/ui/ImportModal";
import { TagRenameModal } from "./src/ui/TagRenameModal";
import { normalizePath } from "obsidian";
import * as libraryCmd from "./src/commands/library";
import * as writingCmd from "./src/commands/writing";
import * as oaCmd from "./src/commands/openaccess";
import { backfillSummaries } from "./src/commands/backfill";
import { resummarizeActive, resummarizeOutdated } from "./src/commands/summaries";

export default class ScholarRagPlugin extends Plugin {
  settings!: ScholarRagSettings;
  library!: Library;
  indexManager!: IndexManager;
  citationGraph!: CitationGraph;
  citeEngine!: CiteEngine;

  async onload(): Promise<void> {
    await this.loadSettings();
    const pluginDir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
    this.library = new Library(this.app, this.settings);
    this.indexManager = new IndexManager(this.app, this.library, this.settings, pluginDir);
    this.citationGraph = new CitationGraph(this.app, this.library, this.settings, pluginDir);
    this.citeEngine = new CiteEngine(this.app, pluginDir);

    this.registerView(VIEW_TYPE_LIBRARY, (leaf) => new LibraryView(leaf, this));
    this.registerView(VIEW_TYPE_SEARCH, (leaf) => new SearchView(leaf, this));
    this.registerView(VIEW_TYPE_CHAT, (leaf) => new ChatView(leaf, this));
    this.registerView(VIEW_TYPE_RELATED, (leaf) => new RelatedView(leaf, this));

    this.addRibbonIcon("book-open", "RAG Obsidian: Open library", () => {
      void this.activateView(VIEW_TYPE_LIBRARY);
    });
    this.addRibbonIcon("messages-square", "RAG Obsidian: Chat with library", () => {
      void this.activateView(VIEW_TYPE_CHAT);
    });
    this.addRibbonIcon("search", "RAG Obsidian: Search PubMed", () => {
      new PubmedSearchModal(this.app, this).open();
    });

    this.addCommand({
      id: "add-reference",
      name: "Add reference by DOI / PMID / arXiv",
      callback: () => new AddReferenceModal(this.app, this).open(),
    });
    this.addCommand({
      id: "search-pubmed",
      name: "Search PubMed and add references",
      callback: () => new PubmedSearchModal(this.app, this).open(),
    });
    this.addCommand({
      id: "open-library",
      name: "Open library",
      callback: () => void this.activateView(VIEW_TYPE_LIBRARY),
    });
    this.addCommand({
      id: "search",
      name: "Search library (semantic)",
      callback: () => void this.activateView(VIEW_TYPE_SEARCH),
    });
    this.addCommand({
      id: "rebuild-index",
      name: "Rebuild search index",
      callback: () => void this.rebuildIndex(),
    });
    this.addCommand({
      id: "chat",
      name: "Chat with library",
      callback: () => void this.activateView(VIEW_TYPE_CHAT),
    });
    this.addCommand({
      id: "import-pdf",
      name: "Import PDF into library",
      callback: () => new ImportPdfModal(this.app, this).open(),
    });
    this.addCommand({
      id: "related",
      name: "Show related papers (citation graph)",
      callback: () => void this.activateView(VIEW_TYPE_RELATED),
    });
    this.addCommand({
      id: "update-bibliography",
      name: "Update bibliography in current note",
      callback: () => void writingCmd.updateBibliography(this),
    });
    this.addCommand({
      id: "import-references",
      name: "Import references (BibTeX / RIS / CSL-JSON)",
      callback: () => new ImportModal(this.app, this).open(),
    });
    this.addCommand({
      id: "export-bibtex",
      name: "Export library → BibTeX",
      callback: () => void libraryCmd.exportLibrary(this, "bibtex"),
    });
    this.addCommand({
      id: "export-ris",
      name: "Export library → RIS",
      callback: () => void libraryCmd.exportLibrary(this, "ris"),
    });
    this.addCommand({
      id: "export-csl-json",
      name: "Export library → CSL-JSON",
      callback: () => void libraryCmd.exportLibrary(this, "csl-json"),
    });
    this.addCommand({
      id: "backfill-citation-counts",
      name: "Backfill citation counts (OpenAlex)",
      callback: () => void libraryCmd.backfillCitationCounts(this),
    });
    this.addCommand({
      id: "find-open-access",
      name: "Find open-access PDF for this reference (Unpaywall)",
      callback: () => void oaCmd.findOpenAccessForActive(this),
    });
    this.addCommand({
      id: "compile-manuscript",
      name: "Compile manuscript (resolve [@citekey] + references)",
      callback: () => void writingCmd.compileManuscript(this),
    });
    for (const s of ["unread", "reading", "read"] as const) {
      this.addCommand({
        id: `mark-${s}`,
        name: `Mark reference as ${s}`,
        callback: () => void libraryCmd.setStatus(this, s),
      });
    }
    this.addCommand({
      id: "library-dashboard",
      name: "Open library dashboard",
      callback: () => void libraryCmd.buildDashboard(this),
    });
    this.addCommand({
      id: "find-duplicates",
      name: "Find duplicate references",
      callback: () => void libraryCmd.findDuplicates(this),
    });
    this.addCommand({
      id: "open-reference-online",
      name: "Open this reference online (DOI / PubMed / OA)",
      callback: () => this.openReferenceOnline(),
    });
    this.addCommand({
      id: "copy-citation",
      name: "Copy formatted citation for this reference",
      callback: () => void writingCmd.copyCitation(this),
    });
    this.addCommand({
      id: "check-retraction",
      name: "Check retraction status (OpenAlex)",
      callback: () => void oaCmd.checkRetractionForActive(this),
    });
    this.addCommand({
      id: "download-oa-pdf",
      name: "Download open-access PDF into the vault",
      callback: () => void oaCmd.downloadOaPdf(this),
    });
    this.addCommand({
      id: "suggest-related",
      name: "Suggest related papers (OpenAlex)",
      callback: () => void libraryCmd.suggestRelated(this),
    });
    this.addCommand({
      id: "annotated-bibliography",
      name: "Export annotated bibliography",
      callback: () => void writingCmd.annotatedBibliography(this),
    });
    this.addCommand({
      id: "rename-tag",
      name: "Rename a tag across the library",
      callback: () => new TagRenameModal(this.app, this).open(),
    });
    this.addCommand({
      id: "extract-highlights",
      name: "Extract PDF highlights into this note",
      callback: () => void oaCmd.extractHighlights(this),
    });
    this.addCommand({
      id: "reading-queue",
      name: "Open reading queue (unread / reading)",
      callback: () => void libraryCmd.readingQueue(this),
    });
    this.addCommand({
      id: "export-citation-network",
      name: "Export citation network (Mermaid)",
      callback: () => void libraryCmd.exportCitationNetwork(this),
    });
    this.addCommand({
      id: "backfill-summaries",
      name: "Summarize and tag references (fill gaps)",
      callback: () => void backfillSummaries(this),
    });
    this.addCommand({
      id: "resummarize-active",
      name: "Re-summarize this reference",
      callback: () => void resummarizeActive(this),
    });
    this.addCommand({
      id: "resummarize-outdated",
      name: "Re-summarize references made by an older model",
      callback: () => void resummarizeOutdated(this),
    });
    this.addCommand({
      id: "enrich-metadata",
      name: "Enrich library metadata (fill gaps)",
      callback: () => void libraryCmd.enrichMetadata(this),
    });

    // Phase 5: @-autocomplete for citekeys.
    this.registerEditorSuggest(new CitationSuggest(this));

    // Phase 5: render [@citekey] inline in reading view — per the selected CSL style
    // (numeric / author-date) when one is set, else a lightweight (Author, Year).
    this.registerMarkdownPostProcessor((el, ctx) => {
      if (!this.settings.renderCitations) return;
      return this.renderCitations(el, ctx.sourcePath);
    });

    this.addSettingTab(new ScholarRagSettingTab(this.app, this));

    // Restore persisted indexes once the vault metadata is ready.
    this.app.workspace.onLayoutReady(() => {
      void this.indexManager.restore();
      void this.citationGraph.restore();
    });

    // Incremental index maintenance.
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (file instanceof TFile) this.indexManager.enqueue(file);
        if (file.path.startsWith(this.library.folder() + "/")) this.citeCache.clear(); // reference data changed
        else this.citeCache.delete(file.path); // citation numbering in this note may have shifted
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file: TAbstractFile) => {
        void this.indexManager.removeFile(file.path);
        this.citeCache.delete(file.path);
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        void this.indexManager.removeFile(oldPath);
        this.citeCache.delete(oldPath); // labels were cached under the old path
        if (file instanceof TFile) this.indexManager.enqueue(file);
      })
    );
  }

  /** Obsidian's OS-keychain secret store (1.11.4+), or null on older apps (minAppVersion is 1.5.0). */
  private secretStore(): SecretStorage | null {
    return (this.app.secretStorage as SecretStorage | undefined) ?? null;
  }

  /** secretStorage id for a settings field — lowercase alphanumeric + dashes, as the API requires. */
  private secretId(field: SecretField): string {
    return `${this.manifest.id}-${field.toLowerCase()}`;
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // 1024 was the default through 0.4.1 and is below the current slider floor. Reasoning models
    // spend that entire budget on thinking and return an empty answer, so lift the stored value
    // for anyone who never moved the slider (a deliberate setting is any other number).
    if (this.settings.llmMaxTokens === 1024) this.settings.llmMaxTokens = DEFAULT_SETTINGS.llmMaxTokens;
    const store = this.secretStore();
    if (!store) return;
    let migrated = false;
    for (const field of SECRET_FIELDS) {
      const stored = store.getSecret(this.secretId(field));
      if (stored && !this.settings[field]) {
        // Empty string means "never set / blanked" — don't let it shadow a key in data.json.
        this.settings[field] = stored;
      } else if (this.settings[field]) {
        // Plaintext key in data.json: first run (migrate) — or, after migration, one pasted or
        // synced in from another device, which is newer than the keychain copy. Adopt it.
        try {
          store.setSecret(this.secretId(field), this.settings[field]);
          migrated = true;
        } catch (e) {
          console.warn(`${this.manifest.id}: secretStorage write failed for ${field}; key stays in data.json`, e);
        }
      }
    }
    if (migrated) await this.saveSettings(); // re-persist data.json with the keys blanked
  }

  async saveSettings(): Promise<void> {
    const store = this.secretStore();
    if (store) {
      // Keys live in the OS keychain; data.json gets a copy with the secret fields blanked.
      // (In-memory settings keep the keys — providers read them directly.)
      const data: ScholarRagSettings = { ...this.settings };
      for (const field of SECRET_FIELDS) {
        try {
          store.setSecret(this.secretId(field), this.settings[field]);
          data[field] = ""; // only blank in data.json once the keychain write succeeded
        } catch (e) {
          console.warn(`${this.manifest.id}: secretStorage write failed for ${field}; keeping key in data.json`, e);
        }
      }
      await this.saveData(data);
    } else {
      await this.saveData(this.settings);
    }
    this.citeCache.clear(); // style may have changed
  }

  /** Full index rebuild with a progress notice (command palette + SearchView button). */
  async rebuildIndex(): Promise<void> {
    const notice = new Notice("Building index…", 0);
    try {
      const n = await this.indexManager.rebuild((done, total) =>
        notice.setMessage(`Embedding ${done}/${total} chunks…`)
      );
      new Notice(`Index built: ${n} chunks`);
    } catch (e) {
      console.error("[RAG Obsidian] rebuild failed", e);
      new Notice(`Rebuild failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      notice.hide();
    }
  }

  // Per-file [@citekey] → in-text label map (CSL). The in-flight promise is cached so
  // concurrent post-processor blocks share one engine build; a failed render is evicted.
  private citeCache = new Map<string, Promise<Record<string, string>>>();

  /** Citation style for a note: its `csl` / `citation-style` frontmatter, else the global setting. */
  styleForNote(file: TFile | null): string {
    if (file) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const s = fm?.csl ?? fm?.["citation-style"];
      if (typeof s === "string" && s.trim()) return s.trim();
    }
    return this.settings.cslStyleId;
  }

  /** Whole-note CSL in-text labels for a file (numbered styles need document order). */
  citeMapFor(sourcePath: string): Promise<Record<string, string>> {
    let p = this.citeCache.get(sourcePath);
    if (!p) {
      p = this.computeCiteMap(sourcePath);
      this.citeCache.set(sourcePath, p);
      p.catch(() => this.citeCache.delete(sourcePath));
    }
    return p.catch(() => ({}));
  }

  private async computeCiteMap(sourcePath: string): Promise<Record<string, string>> {
    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(file instanceof TFile)) return {};
    const styleId = this.styleForNote(file);
    if (!styleId) return {};
    const keys = extractCitekeys(await this.app.vault.cachedRead(file));
    if (!keys.length) return {};
    return (await this.citeEngine.renderNote(styleId, keys, (k) => this.library.getItem(k))).inText;
  }

  /** Replace [@citekey] text nodes with clickable, styled in-text labels in reading view. */
  async renderCitations(root: HTMLElement, sourcePath?: string): Promise<void> {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const targets: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !node.nodeValue.includes("@")) continue;
      if (node.parentElement?.closest("code, pre")) continue; // extractCitekeys skips code too
      targets.push(node as Text);
    }
    if (!targets.length) return;
    const cslMap = sourcePath ? await this.citeMapFor(sourcePath) : null;
    // One library scan for the whole block — getItem() walks every markdown file, so calling it
    // per citekey turned a 40-citation note into 40 full-vault scans per render.
    const byKey = new Map(this.library.entries().map((e) => [e.citekey, e.item]));
    for (const text of targets) {
      const value = text.nodeValue ?? "";
      const frag = document.createDocumentFragment();
      let last = 0;
      let touched = false;
      const re = citePattern();
      let m: RegExpExecArray | null;
      while ((m = re.exec(value)) !== null) {
        const keys = keysInCite(m[1]);
        const resolved = resolveCluster(keys, (k) => {
          const item = byKey.get(k) ?? null;
          const label = (cslMap && cslMap[k]) || null;
          return item || label ? { key: k, item, label } : null;
        });
        if (!resolved) continue; // unknown key, or not a citation (an e-mail in brackets)
        if (m.index > last) frag.appendChild(document.createTextNode(value.slice(last, m.index)));
        resolved.forEach(({ key: k, item, label }, i) => {
          if (i) frag.appendChild(document.createTextNode("; "));
          const span = document.createElement("span");
          span.className = "srag-cite";
          if (label) setCiteLabel(span, label);
          else span.textContent = item ? inTextLabel(item) : `[@${k}]`;
          if (item) span.onclick = () => void this.openCitekey(k);
          frag.appendChild(span);
        });
        last = m.index + m[0].length;
        touched = true;
      }
      if (!touched) continue;
      if (last < value.length) frag.appendChild(document.createTextNode(value.slice(last)));
      text.replaceWith(frag);
    }
  }

  private async openCitekey(citekey: string): Promise<void> {
    const file = this.library.getFile(citekey);
    if (file) await this.app.workspace.getLeaf(false).openFile(file);
  }

  /** Write `content` to `path` (create or overwrite) and open it. vault.create/modify register
   *  the file synchronously — adapter.write + getAbstractFileByPath can race the vault index
   *  and return null for a just-created file, silently skipping the open. */
  async writeAndOpen(rawPath: string, content: string): Promise<void> {
    // Basenames are built from citekeys / titles: strip the characters Obsidian rejects in
    // file names (and `[]#^|` that would break the link to the new note).
    const slash = rawPath.lastIndexOf("/");
    const base = rawPath.slice(slash + 1).replace(/[\\/:*?"<>|#^[\]]+/g, "-").replace(/^\.+/, "");
    const path = normalizePath(rawPath.slice(0, slash + 1) + (base || "untitled.md"));
    const existing = this.app.vault.getAbstractFileByPath(path);
    let file: TFile;
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
      file = existing;
    } else {
      file = await this.app.vault.create(path, content);
    }
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  /** The active note if it is a reference note (has a `citekey`), else null (with a notice). */
  activeRef(): { file: TFile; fm: Record<string, unknown> } | null {
    const file = this.app.workspace.getActiveFile();
    const fm = file ? (this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown>) : undefined;
    if (!file || !fm || !fm.citekey) {
      new Notice("Open a reference note");
      return null;
    }
    return { file, fm };
  }

  /** Open a URL externally — http(s) only, so frontmatter can't smuggle javascript:/file: schemes. */
  private safeOpenExternal(url: string): void {
    if (!/^https?:\/\//i.test(url)) {
      new Notice("Blocked non-http(s) URL");
      return;
    }
    if (typeof window !== "undefined" && window.open) window.open(url, "_blank");
    else new Notice(url); // no window.open (e.g. mobile) — show the URL
  }

  openReferenceOnline(): void {
    const r = this.activeRef();
    if (!r) return;
    const fm = r.fm;
    const url = fm.DOI
      ? `https://doi.org/${fm.DOI}`
      : fm.PMID
      ? `https://pubmed.ncbi.nlm.nih.gov/${fm.PMID}/`
      : fm.oa_url
      ? String(fm.oa_url)
      : fm.URL
      ? String(fm.URL)
      : "";
    if (!url) {
      new Notice("No DOI / PMID / URL on this note");
      return;
    }
    this.safeOpenExternal(url);
  }

  async activateView(type: string): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(type)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type, active: true });
    }
    workspace.revealLeaf(leaf);
  }
}

/** Render a citeproc in-text label (e.g. `<sup>1</sup>`, `[1]`, `(Park et al., 2022)`) into a span. */
function setCiteLabel(span: HTMLElement, html: string): void {
  const sup = html.match(/^\s*<sup>([\s\S]*?)<\/sup>\s*$/i);
  if (sup) {
    const s = document.createElement("sup");
    s.textContent = decodeEntities(sup[1].replace(/<[^>]+>/g, ""));
    span.appendChild(s);
    return;
  }
  span.textContent = decodeEntities(html.replace(/<[^>]+>/g, ""));
}
