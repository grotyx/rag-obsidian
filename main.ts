import { Plugin, WorkspaceLeaf, TFile, TAbstractFile, Notice } from "obsidian";
import { ScholarRagSettings, DEFAULT_SETTINGS } from "./src/types";
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
import { extractCitekeys, buildBibliography, inTextLabel } from "./src/cite/bibliography";
import { CiteEngine } from "./src/cite/csl";
import { ImportModal } from "./src/ui/ImportModal";
import { exportRefs, ExportFormat, ExportRef } from "./src/cite/export";
import { resolveWork, relatedWorks } from "./src/graph/openalex";
import { TagRenameModal } from "./src/ui/TagRenameModal";
import { extractPdfHighlights } from "./src/ingest/pdf";
import { detectId, fetchMetadata } from "./src/ingest/metadata";
import { findOpenAccess } from "./src/ingest/unpaywall";
import { checkRetraction } from "./src/ingest/retraction";
import { formatCitation } from "./src/cite/format";
import { normalizePath, requestUrl } from "obsidian";
import { OntologyManager } from "./src/ontology/manager";

export default class ScholarRagPlugin extends Plugin {
  settings!: ScholarRagSettings;
  library!: Library;
  indexManager!: IndexManager;
  citationGraph!: CitationGraph;
  ontologyManager!: OntologyManager;
  citeEngine!: CiteEngine;

  async onload(): Promise<void> {
    await this.loadSettings();
    const pluginDir = this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`;
    this.library = new Library(this.app, this.settings);
    this.indexManager = new IndexManager(this.app, this.library, this.settings, pluginDir);
    this.citationGraph = new CitationGraph(this.app, this.library, this.settings, pluginDir);
    this.ontologyManager = new OntologyManager(this.app, this.library, this.settings);
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
      callback: () => void this.activateView(VIEW_TYPE_SEARCH),
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
      callback: () => void this.updateBibliography(),
    });
    this.addCommand({
      id: "tag-concepts",
      name: "Tag note with ontology concepts",
      callback: () => void this.ontologyManager.tagActiveNote(),
    });
    this.addCommand({
      id: "import-references",
      name: "Import references (BibTeX / RIS / CSL-JSON)",
      callback: () => new ImportModal(this.app, this).open(),
    });
    this.addCommand({
      id: "export-bibtex",
      name: "Export library → BibTeX",
      callback: () => void this.exportLibrary("bibtex"),
    });
    this.addCommand({
      id: "export-ris",
      name: "Export library → RIS",
      callback: () => void this.exportLibrary("ris"),
    });
    this.addCommand({
      id: "export-csl-json",
      name: "Export library → CSL-JSON",
      callback: () => void this.exportLibrary("csl-json"),
    });
    this.addCommand({
      id: "backfill-citation-counts",
      name: "Backfill citation counts (OpenAlex)",
      callback: () => void this.backfillCitationCounts(),
    });
    this.addCommand({
      id: "find-open-access",
      name: "Find open-access PDF for this reference (Unpaywall)",
      callback: () => void this.findOpenAccessForActive(),
    });
    this.addCommand({
      id: "compile-manuscript",
      name: "Compile manuscript (resolve [@citekey] + references)",
      callback: () => void this.compileManuscript(),
    });
    for (const s of ["unread", "reading", "read"] as const) {
      this.addCommand({
        id: `mark-${s}`,
        name: `Mark reference as ${s}`,
        callback: () => void this.setStatus(s),
      });
    }
    this.addCommand({
      id: "library-dashboard",
      name: "Open library dashboard",
      callback: () => void this.buildDashboard(),
    });
    this.addCommand({
      id: "find-duplicates",
      name: "Find duplicate references",
      callback: () => void this.findDuplicates(),
    });
    this.addCommand({
      id: "open-reference-online",
      name: "Open this reference online (DOI / PubMed / OA)",
      callback: () => this.openReferenceOnline(),
    });
    this.addCommand({
      id: "copy-citation",
      name: "Copy formatted citation for this reference",
      callback: () => void this.copyCitation(),
    });
    this.addCommand({
      id: "check-retraction",
      name: "Check retraction status (Crossref)",
      callback: () => void this.checkRetractionForActive(),
    });
    this.addCommand({
      id: "download-oa-pdf",
      name: "Download open-access PDF into the vault",
      callback: () => void this.downloadOaPdf(),
    });
    this.addCommand({
      id: "suggest-related",
      name: "Suggest related papers (OpenAlex)",
      callback: () => void this.suggestRelated(),
    });
    this.addCommand({
      id: "annotated-bibliography",
      name: "Export annotated bibliography",
      callback: () => void this.annotatedBibliography(),
    });
    this.addCommand({
      id: "rename-tag",
      name: "Rename a tag across the library",
      callback: () => new TagRenameModal(this.app, this).open(),
    });
    this.addCommand({
      id: "extract-highlights",
      name: "Extract PDF highlights into this note",
      callback: () => void this.extractHighlights(),
    });
    this.addCommand({
      id: "reading-queue",
      name: "Open reading queue (unread / reading)",
      callback: () => void this.readingQueue(),
    });
    this.addCommand({
      id: "export-citation-network",
      name: "Export citation network (Mermaid)",
      callback: () => void this.exportCitationNetwork(),
    });
    this.addCommand({
      id: "enrich-metadata",
      name: "Enrich library metadata (fill gaps)",
      callback: () => void this.enrichMetadata(),
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
        this.citeCache.clear(); // citation numbering may have shifted
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file: TAbstractFile) => {
        void this.indexManager.removeFile(file.path);
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        void this.indexManager.removeFile(oldPath);
        if (file instanceof TFile) this.indexManager.enqueue(file);
      })
    );
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.citeCache.clear(); // style may have changed
    if (this.library) this.library.settings = this.settings;
    if (this.indexManager) this.indexManager.settings = this.settings;
    if (this.citationGraph) this.citationGraph.settings = this.settings;
    if (this.ontologyManager) this.ontologyManager.settings = this.settings;
  }

  /** Scan the active note for [@citekey] and insert/refresh a "## References" section. */
  async updateBibliography(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active note");
      return;
    }
    const content = await this.app.vault.read(file);
    const keys = extractCitekeys(content);
    if (keys.length === 0) {
      new Notice("No [@citekey] citations found in this note");
      return;
    }
    const styleId = this.styleForNote(file);
    let bib: string;
    if (styleId) {
      try {
        const { bibliography } = await this.citeEngine.renderNote(
          styleId,
          keys,
          (k) => this.library.getItem(k)
        );
        bib = bibliography.join("\n\n");
      } catch (e) {
        new Notice(
          `Citation style "${styleId}" failed; using ${this.settings.citeStyle}. ${
            e instanceof Error ? e.message : ""
          }`
        );
        bib = buildBibliography(keys, this.library, this.settings.citeStyle);
      }
    } else {
      bib = buildBibliography(keys, this.library, this.settings.citeStyle);
    }
    const section = `## References\n\n${bib}\n`;
    const { base, tail } = splitAtReferences(content);
    await this.app.vault.modify(file, `${base}\n\n${section}${tail}`);
    new Notice(`Bibliography updated: ${keys.length} reference(s)`);
  }

  // Per-file [@citekey] → in-text label map (CSL), cached; cleared on edit / settings change.
  private citeCache = new Map<string, Record<string, string>>();

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
  private async citeMapFor(sourcePath: string): Promise<Record<string, string>> {
    const cached = this.citeCache.get(sourcePath);
    if (cached) return cached;
    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(file instanceof TFile)) return {};
    const styleId = this.styleForNote(file);
    let map: Record<string, string> = {};
    if (styleId) {
      const keys = extractCitekeys(await this.app.vault.cachedRead(file));
      if (keys.length) {
        try {
          map = (await this.citeEngine.renderNote(styleId, keys, (k) => this.library.getItem(k))).inText;
        } catch {
          map = {};
        }
      }
    }
    this.citeCache.set(sourcePath, map);
    return map;
  }

  /** Replace [@citekey] text nodes with clickable, styled in-text labels in reading view. */
  private async renderCitations(root: HTMLElement, sourcePath?: string): Promise<void> {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const targets: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.includes("[@")) targets.push(node as Text);
    }
    if (!targets.length) return;
    const cslMap = sourcePath ? await this.citeMapFor(sourcePath) : null;
    for (const text of targets) {
      const value = text.nodeValue ?? "";
      if (!/\[@[^\]]+\]/.test(value)) continue;
      const frag = document.createDocumentFragment();
      let last = 0;
      const re = /\[@([^\]]+)\]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(value)) !== null) {
        if (m.index > last) frag.appendChild(document.createTextNode(value.slice(last, m.index)));
        const first = m[1].split(";")[0].trim().replace(/^@/, "");
        const item = this.library.getItem(first);
        const span = document.createElement("span");
        span.className = "srag-cite";
        if (cslMap && cslMap[first]) setCiteLabel(span, cslMap[first]);
        else span.textContent = item ? inTextLabel(item) : m[0];
        if (item) span.onclick = () => void this.openCitekey(first);
        frag.appendChild(span);
        last = m.index + m[0].length;
      }
      if (last < value.length) frag.appendChild(document.createTextNode(value.slice(last)));
      text.replaceWith(frag);
    }
  }

  private async openCitekey(citekey: string): Promise<void> {
    const file = this.library.getFile(citekey);
    if (file) await this.app.workspace.getLeaf(false).openFile(file);
  }

  /** Write the whole library to a bibliographic file at the vault root and open it. */
  async exportLibrary(format: ExportFormat): Promise<void> {
    const refs: ExportRef[] = [];
    for (const e of this.library.list()) {
      const item = this.library.getItem(e.citekey);
      if (item) refs.push({ citekey: e.citekey, item });
    }
    if (!refs.length) {
      new Notice("Library is empty");
      return;
    }
    const ext = format === "bibtex" ? "bib" : format === "ris" ? "ris" : "json";
    const path = normalizePath(`library.${ext}`);
    await this.app.vault.adapter.write(path, exportRefs(refs, format));
    new Notice(`Exported ${refs.length} references → ${path}`);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) await this.app.workspace.getLeaf(true).openFile(f);
  }

  /** Resolve each reference on OpenAlex and write `cited_by_count` (+ `openalex_id`). */
  async backfillCitationCounts(): Promise<void> {
    const entries = this.library.list();
    const notice = new Notice(`Citation counts 0/${entries.length}…`, 0);
    let done = 0;
    let updated = 0;
    try {
      for (const e of entries) {
        const item = this.library.getItem(e.citekey);
        const file = this.library.getFile(e.citekey);
        if (item && file) {
          const w = await resolveWork(item, this.settings.openalexMailto);
          if (w) {
            await this.app.fileManager.processFrontMatter(file, (fm) => {
              fm.cited_by_count = w.citedByCount;
              if (!fm.openalex_id) fm.openalex_id = w.openalexId;
            });
            updated++;
          }
        }
        done++;
        notice.setMessage(`Citation counts ${done}/${entries.length}…`);
      }
      new Notice(`Updated citation counts for ${updated} reference(s).`);
    } catch (e) {
      new Notice(`Citation count backfill failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      notice.hide();
    }
  }

  /** Look up an open-access PDF for the active reference note (Unpaywall) and store it. */
  async findOpenAccessForActive(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    const fm = file ? this.app.metadataCache.getFileCache(file)?.frontmatter : null;
    const doi = fm?.DOI;
    if (!file || !doi) {
      new Notice("Open a reference note that has a DOI");
      return;
    }
    const oa = await findOpenAccess(String(doi), this.settings.openalexMailto);
    if (!oa || !oa.isOA) {
      new Notice("No open-access copy found");
      return;
    }
    const url = oa.pdfUrl || oa.landingUrl || "";
    await this.app.fileManager.processFrontMatter(file, (f) => {
      f.oa_url = url;
      if (oa.version) f.oa_version = oa.version;
    });
    new Notice(`Open access (${oa.version || "OA"}): ${url}`);
  }

  /** Produce a sibling "(compiled)" note: [@citekey] resolved to in-text labels + a References list. */
  async compileManuscript(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active note");
      return;
    }
    const content = await this.app.vault.read(file);
    const keys = extractCitekeys(content);
    if (!keys.length) {
      new Notice("No [@citekey] citations in this note");
      return;
    }
    const styleId = this.styleForNote(file);
    let body = content;
    let refsBlock = "";
    const replaceKey = (raw: string, render: (k: string) => string | null): string =>
      raw.replace(/\[@([^\]]+)\]/g, (mm, g) => {
        const k = String(g).split(";")[0].trim().replace(/^@/, "");
        return render(k) ?? mm;
      });
    if (styleId) {
      try {
        const { bibliography, inText } = await this.citeEngine.renderNote(
          styleId,
          keys,
          (k) => this.library.getItem(k)
        );
        body = replaceKey(content, (k) => (inText[k] ? plainText(inText[k]) : null));
        refsBlock = bibliography.join("\n\n");
      } catch (e) {
        new Notice(`Style "${styleId}" failed; using lightweight. ${e instanceof Error ? e.message : ""}`);
      }
    }
    if (!refsBlock) {
      body = replaceKey(content, (k) => {
        const it = this.library.getItem(k);
        return it ? inTextLabel(it) : null;
      });
      refsBlock = buildBibliography(keys, this.library, this.settings.citeStyle);
    }
    const { base, tail } = splitAtReferences(body);
    const out = `${base}\n\n## References\n\n${refsBlock}\n${tail}`;
    const outPath = normalizePath(file.path.replace(/\.md$/i, "") + " (compiled).md");
    await this.app.vault.adapter.write(outPath, out);
    new Notice(`Compiled → ${outPath}`);
    const f = this.app.vault.getAbstractFileByPath(outPath);
    if (f instanceof TFile) await this.app.workspace.getLeaf(true).openFile(f);
  }

  /** The active note if it is a reference note (has a `citekey`), else null (with a notice). */
  private activeRef(): { file: TFile; fm: Record<string, unknown> } | null {
    const file = this.app.workspace.getActiveFile();
    const fm = file ? (this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown>) : undefined;
    if (!file || !fm || !fm.citekey) {
      new Notice("Open a reference note");
      return null;
    }
    return { file, fm };
  }

  async setStatus(status: "unread" | "reading" | "read"): Promise<void> {
    const r = this.activeRef();
    if (!r) return;
    await this.app.fileManager.processFrontMatter(r.file, (fm) => (fm.status = status));
    new Notice(`${r.fm.citekey} → ${status}`);
  }

  /** Write a Dataview-powered dashboard note (live, sortable). Falls back to a static table. */
  async buildDashboard(): Promise<void> {
    const folder = this.settings.referencesFolder || "References";
    const hasDataview = !!(this.app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins
      ?.enabledPlugins?.has?.("dataview");
    let out: string;
    if (hasDataview) {
      // Plain DQL (not dataviewjs) so it renders WITHOUT Dataview's "Enable JavaScript
      // Queries" toggle. The note link already encodes year + author + journal.
      out =
        `# Library Dashboard\n\n` +
        "```dataview\n" +
        "TABLE WITHOUT ID\n" +
        "  file.link AS Reference,\n" +
        "  status AS Status,\n" +
        "  cited_by_count AS Cited,\n" +
        "  tags AS Tags\n" +
        `FROM "${folder}"\n` +
        "WHERE citekey\n" +
        "SORT cited_by_count DESC\n" +
        "```\n\n" +
        '> Edit the query to filter (e.g. add `WHERE status = "reading"`) or change `SORT`.\n';
    } else {
      const rows = this.library.entries();
      const header = "| Year | Authors | Title | Status | Cited | Tags |\n|---|---|---|---|---|---|";
      const body = rows
        .map((r) => {
          const it = r.item as Record<string, unknown>;
          const tags = Array.isArray(it.tags) ? (it.tags as string[]).slice(0, 4).join(", ") : "";
          const link = `[[${r.file.basename}\\|${r.title.replace(/\|/g, "/")}]]`;
          return `| ${r.year} | ${r.authors} | ${link} | ${it.status ?? ""} | ${it.cited_by_count ?? ""} | ${tags} |`;
        })
        .join("\n");
      out = `# Library Dashboard\n\n${rows.length} references. (Install Dataview for a live, sortable table.)\n\n${header}\n${body}\n`;
    }
    const path = normalizePath("Library Dashboard.md");
    await this.app.vault.adapter.write(path, out);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) await this.app.workspace.getLeaf(true).openFile(f);
  }

  /** Group library notes by DOI / PMID / normalized title and report duplicate clusters. */
  async findDuplicates(): Promise<void> {
    const groups = new Map<string, string[]>();
    for (const e of this.library.entries()) {
      const it = e.item;
      const sig =
        (it.DOI && `doi:${String(it.DOI).toLowerCase()}`) ||
        (it.PMID && `pmid:${it.PMID}`) ||
        `title:${String(it.title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
      (groups.get(sig) ?? groups.set(sig, []).get(sig)!).push(e.file.basename);
    }
    const dups = [...groups.values()].filter((g) => g.length > 1);
    if (!dups.length) {
      new Notice("No duplicates found");
      return;
    }
    const report =
      `# Duplicate references\n\n${dups.length} group(s):\n\n` +
      dups.map((g) => "- " + g.map((name) => `[[${name}]]`).join(" · ")).join("\n") +
      "\n";
    const path = normalizePath("Duplicate references.md");
    await this.app.vault.adapter.write(path, report);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) await this.app.workspace.getLeaf(true).openFile(f);
    new Notice(`${dups.length} duplicate group(s) — see "Duplicate references.md"`);
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
    if (typeof window !== "undefined" && window.open) window.open(url, "_blank");
    else new Notice(url); // no window.open (e.g. mobile) — show the URL
  }

  async copyCitation(): Promise<void> {
    const r = this.activeRef();
    if (!r) return;
    const key = String(r.fm.citekey);
    const styleId = this.styleForNote(r.file);
    let text = "";
    if (styleId) {
      try {
        const { bibliography } = await this.citeEngine.renderNote(styleId, [key], (k) => this.library.getItem(k));
        text = bibliography[0] || "";
      } catch {
        /* fall back below */
      }
    }
    if (!text) {
      const it = this.library.getItem(key);
      if (it) text = formatCitation(it, this.settings.citeStyle);
    }
    if (!text) {
      new Notice("Could not format citation");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      new Notice("Citation copied to clipboard");
    } catch {
      new Notice(text); // clipboard unavailable (e.g. mobile) — show it instead
    }
  }

  async checkRetractionForActive(): Promise<void> {
    const r = this.activeRef();
    if (!r) return;
    const item = this.library.getItem(String(r.fm.citekey));
    if (!item || (!item.DOI && !item.PMID)) {
      new Notice("Need a DOI or PMID to check");
      return;
    }
    const res = await checkRetraction(item, this.settings.openalexMailto);
    if (!res) {
      new Notice("Retraction lookup failed");
      return;
    }
    await this.app.fileManager.processFrontMatter(r.file, (fm) => (fm.retracted = res.retracted));
    new Notice(res.retracted ? "⚠ RETRACTED — flagged in frontmatter" : "No retraction found");
  }

  async downloadOaPdf(): Promise<void> {
    const r = this.activeRef();
    if (!r) return;
    let url = r.fm.oa_url ? String(r.fm.oa_url) : "";
    if (!url && r.fm.DOI) {
      const oa = await findOpenAccess(String(r.fm.DOI), this.settings.openalexMailto);
      url = oa?.pdfUrl || "";
    }
    if (!url) {
      new Notice("No open-access PDF found (try 'Find open-access PDF' first)");
      return;
    }
    const notice = new Notice("Downloading PDF…", 0);
    const res = await requestUrl({ url, throw: false });
    notice.hide();
    if (res.status >= 400 || !res.arrayBuffer) {
      new Notice(`Download failed (${res.status})`);
      return;
    }
    const dir = normalizePath("PDFs");
    if (!this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir).catch(() => {});
    const path = normalizePath(`PDFs/${r.fm.citekey}.pdf`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await this.app.vault.modifyBinary(existing, res.arrayBuffer);
    else await this.app.vault.createBinary(path, res.arrayBuffer);
    await this.app.fileManager.processFrontMatter(r.file, (fm) => (fm.pdf = `[[${r.fm.citekey}.pdf]]`));
    new Notice(`Saved PDFs/${r.fm.citekey}.pdf`);
  }

  /** List OpenAlex "related_works" for the active reference, flagging ones already in the library. */
  async suggestRelated(): Promise<void> {
    const r = this.activeRef();
    if (!r) return;
    const item = this.library.getItem(String(r.fm.citekey));
    if (!item) return;
    const notice = new Notice("Finding related papers…", 0);
    let rel: Awaited<ReturnType<typeof relatedWorks>>;
    try {
      rel = await relatedWorks(item, this.settings.openalexMailto);
    } catch (e) {
      new Notice(`Related-papers lookup failed: ${e instanceof Error ? e.message : e}`);
      return;
    } finally {
      notice.hide();
    }
    if (!rel.length) {
      new Notice("No related works found on OpenAlex");
      return;
    }
    const lines = rel
      .sort((a, b) => b.citedByCount - a.citedByCount)
      .map((w) => {
        const have = w.title && this.library.findDuplicate({ type: "article-journal", title: w.title });
        return `- ${w.title || w.id} — _${w.citedByCount} citations_ · [OpenAlex](https://openalex.org/${w.id})${have ? `  ✓ already in library (${have})` : ""}`;
      });
    const out = `# Related to ${r.fm.citekey}\n\n${rel.length} related works (OpenAlex), most-cited first:\n\n${lines.join("\n")}\n`;
    const path = normalizePath(`Related to ${r.fm.citekey}.md`);
    await this.app.vault.adapter.write(path, out);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) await this.app.workspace.getLeaf(true).openFile(f);
  }

  /** Export a styled citation + its summary for each reference (active note's citations, else whole library). */
  async annotatedBibliography(): Promise<void> {
    const active = this.app.workspace.getActiveFile();
    let keys: string[] = [];
    if (active) keys = extractCitekeys(await this.app.vault.cachedRead(active));
    const wholeLib = keys.length === 0;
    if (wholeLib) keys = this.library.list().map((e) => e.citekey);
    if (!keys.length) {
      new Notice("No references found");
      return;
    }
    const styleId = active ? this.styleForNote(active) : this.settings.cslStyleId;
    const notice = new Notice(`Building annotated bibliography (${keys.length})…`, 0);
    const blocks: string[] = [];
    for (const k of keys) {
      const item = this.library.getItem(k);
      if (!item) continue;
      let cite = "";
      if (styleId) {
        try {
          cite = (await this.citeEngine.renderNote(styleId, [k], (x) => this.library.getItem(x))).bibliography[0] || "";
        } catch {
          /* fall back */
        }
      }
      if (!cite) cite = formatCitation(item, this.settings.citeStyle);
      const file = this.library.getFile(k);
      const summary = file ? extractSummary(await this.app.vault.cachedRead(file)) : "";
      blocks.push(`### ${cite}\n\n${summary || "_(no summary)_"}\n`);
    }
    notice.hide();
    const title = wholeLib ? "Annotated bibliography (library)" : `Annotated bibliography — ${active?.basename}`;
    const path = normalizePath(`${title}.md`);
    await this.app.vault.adapter.write(path, `# ${title}\n\n${blocks.join("\n")}`);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) await this.app.workspace.getLeaf(true).openFile(f);
  }

  /** Read this reference's PDF annotations and write them into its ## Highlights section. */
  async extractHighlights(): Promise<void> {
    const r = this.activeRef();
    if (!r) return;
    const key = String(r.fm.citekey);
    let pdf: TFile | null = null;
    const linked = typeof r.fm.pdf === "string" ? String(r.fm.pdf).replace(/^\[\[|\]\]$/g, "") : "";
    if (linked) pdf = this.app.metadataCache.getFirstLinkpathDest(linked, r.file.path);
    if (!pdf) {
      const guess = this.app.vault.getAbstractFileByPath(normalizePath(`PDFs/${key}.pdf`));
      if (guess instanceof TFile) pdf = guess;
    }
    if (!pdf) {
      new Notice("No PDF linked (download one first, or set `pdf:` in frontmatter)");
      return;
    }
    const notice = new Notice("Reading PDF annotations…", 0);
    let highlights;
    try {
      highlights = await extractPdfHighlights(await this.app.vault.readBinary(pdf));
    } catch (e) {
      notice.hide();
      new Notice(`Failed to read PDF: ${e instanceof Error ? e.message : e}`);
      return;
    }
    notice.hide();
    if (!highlights.length) {
      new Notice("No highlights/notes found in the PDF");
      return;
    }
    const block = highlights
      .map((h) => `- ${h.text}${h.type === "note" ? " _(note)_" : ""} _(p.${h.page})_`)
      .join("\n");
    const content = await this.app.vault.read(r.file);
    const re = /(##\s+Highlights\s*\n)[\s\S]*?(?=\n##\s|$)/i;
    // Function replacement: `block` may contain `$` (e.g. "$5"), which a string
    // replacement would mis-read as a backreference.
    const next = re.test(content)
      ? content.replace(re, (_m, h1) => `${h1}\n${block}\n`)
      : `${content.replace(/\s*$/, "")}\n\n## Highlights\n\n${block}\n`;
    await this.app.vault.modify(r.file, next);
    new Notice(`Extracted ${highlights.length} highlight(s)/note(s)`);
  }

  /** Open a note listing references still to read (status reading first, then unread), by citations. */
  async readingQueue(): Promise<void> {
    const rows = this.library
      .entries()
      .filter((r) => r.item.status === "reading" || r.item.status === "unread" || !r.item.status);
    const rank = (s: unknown) => (s === "reading" ? 0 : 1);
    rows.sort(
      (a, b) =>
        rank(a.item.status) - rank(b.item.status) ||
        Number(b.item.cited_by_count ?? 0) - Number(a.item.cited_by_count ?? 0)
    );
    const body = rows
      .map(
        (r) =>
          `- [[${r.file.basename}]] — ${r.authors} ${r.year} · _${r.item.status ?? "unread"}_${
            r.item.cited_by_count != null ? ` · ${r.item.cited_by_count} cites` : ""
          }`
      )
      .join("\n");
    const out = `# Reading queue\n\n${rows.length} to read:\n\n${body || "_(all caught up)_"}\n`;
    const path = normalizePath("Reading queue.md");
    await this.app.vault.adapter.write(path, out);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) await this.app.workspace.getLeaf(true).openFile(f);
  }

  /** Export the in-library citation graph as a Mermaid diagram note. */
  async exportCitationNetwork(): Promise<void> {
    const cks = this.library.list().map((e) => e.citekey);
    const edges: [string, string][] = [];
    for (const ck of cks) for (const ref of this.citationGraph.referencesInLibrary(ck)) edges.push([ck, ref]);
    if (!edges.length) {
      new Notice('No edges — run "Build citation graph" first');
      return;
    }
    const id = (k: string) => k.replace(/[^A-Za-z0-9]/g, "_");
    const seen = new Set<string>(edges.flat());
    const labels = [...seen].map((k) => `  ${id(k)}["${k}"]`).join("\n");
    const lines = edges.map(([a, b]) => `  ${id(a)} --> ${id(b)}`).join("\n");
    const out = `# Citation network\n\n${seen.size} papers, ${edges.length} citation edges.\n\n\`\`\`mermaid\ngraph LR\n${labels}\n${lines}\n\`\`\`\n`;
    const path = normalizePath("Citation network.md");
    await this.app.vault.adapter.write(path, out);
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) await this.app.workspace.getLeaf(true).openFile(f);
  }

  /** Re-fetch metadata for notes missing abstract / journal / authors and fill the gaps. */
  async enrichMetadata(): Promise<void> {
    const entries = this.library.entries();
    const notice = new Notice(`Enriching 0/${entries.length}…`, 0);
    let done = 0;
    let filled = 0;
    for (const e of entries) {
      const item = e.item;
      const file = e.file;
      done++;
      notice.setMessage(`Enriching ${done}/${entries.length}…`);
      const needs = !item.abstract || !item["container-title"] || !item.author || !item.author.length;
      const idStr = item.DOI || (item.PMID ? `pmid:${item.PMID}` : "");
      if (!needs || !idStr) continue;
      try {
        const fresh = await fetchMetadata(detectId(idStr), this.settings.pubmedApiKey);
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          if (!fm.abstract && fresh.abstract) fm.abstract = fresh.abstract;
          if (!fm["container-title"] && fresh["container-title"]) fm["container-title"] = fresh["container-title"];
          if ((!fm.author || (Array.isArray(fm.author) && !fm.author.length)) && fresh.author) fm.author = fresh.author;
          if (!fm.volume && fresh.volume) fm.volume = fresh.volume;
          if (!fm.issue && fresh.issue) fm.issue = fresh.issue;
          if (!fm.page && fresh.page) fm.page = fresh.page;
          if (!fm.DOI && fresh.DOI) fm.DOI = fresh.DOI;
        });
        filled++;
      } catch {
        /* skip on fetch error */
      }
    }
    notice.hide();
    new Notice(`Enriched ${filled} reference(s).`);
  }

  /** Rename (or delete, if newTag is empty) a tag across every reference note. */
  async renameTag(oldTag: string, newTag: string): Promise<number> {
    let n = 0;
    for (const { file } of this.library.entries()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || !Array.isArray(fm.tags) || !fm.tags.includes(oldTag)) continue;
      await this.app.fileManager.processFrontMatter(file, (f) => {
        const t = new Set<string>(((f.tags as string[]) || []).filter(Boolean));
        t.delete(oldTag);
        if (newTag) t.add(newTag);
        f.tags = [...t];
      });
      n++;
    }
    return n;
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

/** Split a note around its "## References" section: `base` is everything before the heading
 *  (trailing whitespace trimmed), `tail` is any later same-or-higher-level section
 *  (e.g. "## Appendix") to reattach after the freshly built bibliography. */
function splitAtReferences(content: string): { base: string; tail: string } {
  const m = content.match(/\n##\s+References\s*\n/i);
  if (!m || m.index === undefined) return { base: content.replace(/\s+$/, ""), tail: "" };
  const rest = content.slice(m.index + m[0].length);
  const next = rest.search(/\n#{1,2} /);
  return {
    base: content.slice(0, m.index).replace(/\s+$/, ""),
    tail: next >= 0 ? rest.slice(next) : "",
  };
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

/** citeproc in-text HTML → plain text (for the compiled manuscript). */
function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ""));
}

/** Pull the EN summary (else KR) section body out of a reference note. */
function extractSummary(content: string): string {
  const en = content.match(/##\s+Summary \(EN\)\s*\n([\s\S]*?)(?=\n##\s|$)/i);
  if (en && en[1].trim()) return en[1].trim();
  const kr = content.match(/##\s+요약 \(KR\)\s*\n([\s\S]*?)(?=\n##\s|$)/);
  return kr ? kr[1].trim() : "";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, n) => safeCodePoint(parseInt(n, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeCodePoint(n: number): string {
  try {
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  } catch {
    return "";
  }
}
