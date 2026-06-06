import { ItemView, WorkspaceLeaf, Notice, TFile, normalizePath } from "obsidian";
import type ScholarRagPlugin from "../../main";

export const VIEW_TYPE_RELATED = "rag-obsidian-related";

export class RelatedView extends ItemView {
  private plugin: ScholarRagPlugin;
  private bodyEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: ScholarRagPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_RELATED;
  }
  getDisplayText(): string {
    return "RAG Obsidian related";
  }
  getIcon(): string {
    return "git-fork";
  }

  async onOpen(): Promise<void> {
    const c = this.contentEl;
    c.empty();
    c.addClass("rag-obsidian-related");

    const header = c.createDiv({ cls: "srag-header" });
    const build = header.createEl("button", { text: "Build citation graph" });
    build.onclick = () => void this.build();

    this.bodyEl = c.createDiv({ cls: "srag-related-body" });
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refresh()));
    this.refresh();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private activeCitekey(): string | null {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) return null;
    const prefix = normalizePath(this.plugin.settings.referencesFolder) + "/";
    if (!file.path.startsWith(prefix)) return null;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return fm?.citekey ? String(fm.citekey) : null;
  }

  private titleOf(citekey: string): string {
    const item = this.plugin.library.getItem(citekey);
    return item?.title ? String(item.title) : citekey;
  }

  private async build(): Promise<void> {
    const notice = new Notice("Building citation graph…", 0);
    try {
      const n = await this.plugin.citationGraph.build((d, t) =>
        notice.setMessage(`OpenAlex ${d}/${t}…`)
      );
      notice.hide();
      new Notice(`Citation graph: ${n} papers linked`);
    } catch (e) {
      notice.hide();
      new Notice(`Graph build failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.refresh();
  }

  private section(title: string, count: number): HTMLElement {
    const sec = this.bodyEl.createDiv({ cls: "srag-rel-section" });
    sec.createEl("div", { cls: "srag-rel-head", text: `${title} (${count})` });
    return sec;
  }

  private citekeyRow(parent: HTMLElement, citekey: string, suffix = ""): void {
    const row = parent.createDiv({ cls: "srag-rel-row" });
    row.createSpan({ cls: "srag-rel-title", text: this.titleOf(citekey) + suffix });
    row.onclick = () => void this.openCitekey(citekey);
  }

  private refresh(): void {
    if (!this.bodyEl) return;
    this.bodyEl.empty();
    const graph = this.plugin.citationGraph;

    this.bodyEl.createEl("div", {
      cls: "srag-count",
      text: graph.size ? `Graph: ${graph.size} papers` : "Graph not built — click above.",
    });

    const ck = this.activeCitekey();
    if (!ck) {
      this.bodyEl.createEl("div", { cls: "srag-count", text: "Open a reference note to see related papers." });
      return;
    }
    if (!graph.has(ck)) {
      this.bodyEl.createEl("div", {
        cls: "srag-count",
        text: "This note isn't in the citation graph yet (rebuild after adding it).",
      });
    }

    const refs = graph.referencesInLibrary(ck);
    const citedBy = graph.citedByInLibrary(ck);
    const coupled = graph.coupled(ck);

    const s1 = this.section("References in your library", refs.length);
    refs.forEach((c) => this.citekeyRow(s1, c));

    const s2 = this.section("Cited by (in your library)", citedBy.length);
    citedBy.forEach((c) => this.citekeyRow(s2, c));

    const s3 = this.section("Related by shared references", coupled.length);
    coupled.slice(0, 10).forEach((c) => this.citekeyRow(s3, c.citekey, `  · ${c.shared} shared`));

    // Missing frequently-cited (async)
    const s4 = this.section("Frequently cited by your library, but missing", 0);
    void graph.missingFrequent().then((missing) => {
      s4.querySelector(".srag-rel-head")?.setText(`Frequently cited by your library, but missing (${missing.length})`);
      for (const m of missing) {
        const row = s4.createDiv({ cls: "srag-rel-row" });
        row.createSpan({ cls: "srag-rel-title", text: m.title });
        row.createSpan({ cls: "srag-rel-badge", text: `  ×${m.count}` });
        row.onclick = () => window.open(`https://openalex.org/${m.openalexId}`, "_blank");
      }
    });
  }

  private async openCitekey(citekey: string): Promise<void> {
    const path = normalizePath(`${this.plugin.settings.referencesFolder}/${citekey}.md`);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
    else new Notice(`Note not found: ${citekey}`);
  }
}
