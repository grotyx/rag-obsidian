import { ItemView, WorkspaceLeaf, Notice, TFile, normalizePath } from "obsidian";
import type ScholarRagPlugin from "../../main";
import type { CoupledPaper, MissingPaper } from "../graph/citations";
import { layoutGraph, topByDegree, LayoutEdge, LayoutNode } from "../graph/layout";
import { AddReferenceModal } from "./AddReferenceModal";

export const VIEW_TYPE_RELATED = "rag-obsidian-related";

/** Drawn map: viewBox units (the SVG scales to the pane width) and the node cap. */
const MAP_W = 320;
const MAP_H = 260;
const MAP_MAX = 40;

type NodeKind = "active" | "ref" | "cited" | "coupled" | "missing";

export class RelatedView extends ItemView {
  private plugin: ScholarRagPlugin;
  private bodyEl!: HTMLElement;
  private gen = 0;

  constructor(leaf: WorkspaceLeaf, plugin: ScholarRagPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_RELATED;
  }
  getDisplayText(): string {
    return "Related papers";
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
    // The graph also grows on its own when a reference note is added — redraw then too.
    this.register(this.plugin.citationGraph.onChange(() => this.refresh()));
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

  /** citekey → title, rebuilt once per refresh: `getItem` is a full-vault scan and the pane
   *  asks for up to ~100 titles per note switch. */
  private titles = new Map<string, string>();

  private titleOf(citekey: string): string {
    return this.titles.get(citekey) ?? citekey;
  }

  private refreshTitles(): void {
    this.titles.clear();
    for (const e of this.plugin.library.entries()) {
      const ck = e.item.citekey;
      if (typeof ck === "string" && ck) this.titles.set(ck, e.item.title ? String(e.item.title) : ck);
    }
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
    sec.createDiv({ cls: "srag-rel-head", text: `${title} (${count})` });
    return sec;
  }

  private citekeyRow(parent: HTMLElement, citekey: string, suffix = ""): void {
    const row = parent.createDiv({ cls: "srag-rel-row" });
    row.createSpan({ cls: "srag-rel-title", text: this.titleOf(citekey) + suffix });
    row.onclick = () => void this.openCitekey(citekey);
  }

  private refresh(): void {
    if (!this.bodyEl) return;
    const gen = ++this.gen;
    this.bodyEl.empty();
    this.refreshTitles();
    const graph = this.plugin.citationGraph;

    this.bodyEl.createDiv({
      cls: "srag-count",
      text: graph.size ? `Graph: ${graph.size} papers` : "Graph not built — click above.",
    });

    const ck = this.activeCitekey();
    if (!ck) {
      this.bodyEl.createDiv({ cls: "srag-count", text: "Open a reference note to see related papers." });
      return;
    }
    if (!graph.has(ck)) {
      this.bodyEl.createDiv({
        cls: "srag-count",
        text: "This note isn't in the citation graph yet (rebuild after adding it).",
      });
    }

    const refs = graph.referencesInLibrary(ck);
    const citedBy = graph.citedByInLibrary(ck);
    const coupled = graph.coupled(ck);

    // Map first, lists below (the lists stay the accessible fallback). The map also wants the
    // async "missing" set, so reserve its slot now and fill it when that resolves.
    const mapEl = this.bodyEl.createDiv({ cls: "srag-map-wrap" });

    const s1 = this.section("References in your library", refs.length);
    refs.forEach((c) => this.citekeyRow(s1, c));

    const s2 = this.section("Cited by (in your library)", citedBy.length);
    citedBy.forEach((c) => this.citekeyRow(s2, c));

    const s3 = this.section("Related by shared references", coupled.length);
    coupled.slice(0, 10).forEach((c) => this.citekeyRow(s3, c.citekey, `  · ${c.shared} shared`));

    // Missing frequently-cited (async)
    const s4 = this.section("Frequently cited by your library, but missing", 0);
    // The local neighbourhood needs no network: draw it now, add the dashed "missing" nodes
    // when OpenAlex answers, and keep the local map if it never does.
    this.renderMap(mapEl, ck, refs, citedBy, coupled, []);
    void graph.missingFrequent().then((missing) => {
      if (gen !== this.gen) return;
      this.renderMap(mapEl, ck, refs, citedBy, coupled, missing);
      s4.querySelector(".srag-rel-head")?.setText(`Frequently cited by your library, but missing (${missing.length})`);
      for (const m of missing) {
        const row = s4.createDiv({ cls: "srag-rel-row" });
        row.createSpan({ cls: "srag-rel-title", text: m.title });
        row.createSpan({ cls: "srag-rel-badge", text: `  ×${m.count}` });
        row.onclick = () => this.plugin.safeOpenExternal(`https://openalex.org/${m.openalexId}`);
      }
    }).catch(() => {
      if (gen !== this.gen) return;
      s4.querySelector(".srag-rel-head")?.setText("Frequently cited by your library, but missing (OpenAlex unreachable)");
    });
  }

  /** Draw the neighbourhood of `ck` as an SVG force layout. Solid nodes are library notes
   *  (click → open); dashed nodes are works you don't have (click → Add reference, prefilled). */
  private renderMap(
    host: HTMLElement,
    ck: string,
    refs: string[],
    citedBy: string[],
    coupled: CoupledPaper[],
    missing: MissingPaper[]
  ): void {
    host.empty();
    const meta = new Map<string, { kind: NodeKind; label: string; open: () => void }>();
    const nodes: LayoutNode[] = [{ id: ck, pinned: true }];
    const edges: LayoutEdge[] = [];
    const couplingEdges = new Set<string>();
    const edgeKey = (a: string, b: string) => `${a} ${b}`;

    meta.set(ck, { kind: "active", label: this.titleOf(ck), open: () => void this.openCitekey(ck) });
    const addNote = (key: string, kind: NodeKind): boolean => {
      if (meta.has(key)) return false;
      meta.set(key, { kind, label: this.titleOf(key), open: () => void this.openCitekey(key) });
      nodes.push({ id: key });
      return true;
    };

    for (const r of refs) {
      addNote(r, "ref");
      edges.push({ source: ck, target: r });
    }
    for (const c of citedBy) {
      addNote(c, "cited");
      edges.push({ source: c, target: ck });
    }
    for (const c of coupled.slice(0, 10)) {
      // Coupling is only worth drawing for a paper not already tied in by a citation edge.
      if (!addNote(c.citekey, "coupled")) continue;
      edges.push({ source: ck, target: c.citekey });
      couplingEdges.add(edgeKey(ck, c.citekey));
    }
    // "Missing" is a library-wide list; only the works this paper actually cites belong here,
    // otherwise the edge would claim a citation that doesn't exist.
    const citedIds = new Set(this.plugin.citationGraph.refIds(ck));
    for (const m of missing) {
      if (!citedIds.has(m.openalexId) || meta.has(m.openalexId)) continue;
      meta.set(m.openalexId, {
        kind: "missing",
        label: m.title,
        open: () => new AddReferenceModal(this.app, this.plugin, m.openalexId).open(),
      });
      nodes.push({ id: m.openalexId });
      edges.push({ source: ck, target: m.openalexId });
    }

    if (nodes.length < 2) return; // nothing to draw — the lists say so already

    const kept = topByDegree(nodes, edges, MAP_MAX);
    const keptIds = new Set(kept.map((n) => n.id));
    const keptEdges = edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target));
    const pos = layoutGraph(kept, keptEdges, { width: MAP_W, height: MAP_H });

    // aria-hidden: the lists below carry the same papers and the same actions in reachable
    // markup, so the drawing would only duplicate them for a screen reader.
    const svg = host.createSvg("svg", {
      cls: "srag-map",
      attr: { viewBox: `0 0 ${MAP_W} ${MAP_H}`, width: "100%", "aria-hidden": "true" },
    });
    const markerId = `srag-arrow-${this.gen}`;
    const marker = svg.createSvg("defs").createSvg("marker", {
      attr: {
        id: markerId,
        viewBox: "0 0 8 8",
        refX: 7,
        refY: 4,
        markerWidth: 5,
        markerHeight: 5,
        orient: "auto",
      },
    });
    marker.createSvg("path", { cls: "srag-map-arrow", attr: { d: "M0,0 L8,4 L0,8 z" } });

    for (const e of keptEdges) {
      const a = pos.get(e.source);
      const b = pos.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const gap = 9; // stop short of the node circles so the arrowhead sits outside
      const coupling = couplingEdges.has(edgeKey(e.source, e.target));
      const cls = ["srag-map-edge"];
      if (coupling) cls.push("srag-map-edge-coupled");
      if (meta.get(e.target)?.kind === "missing") cls.push("srag-map-edge-missing");
      const line = svg.createSvg("line", {
        cls,
        attr: {
          x1: (a.x + (dx / d) * gap).toFixed(1),
          y1: (a.y + (dy / d) * gap).toFixed(1),
          x2: (b.x - (dx / d) * gap).toFixed(1),
          y2: (b.y - (dy / d) * gap).toFixed(1),
        },
      });
      if (!coupling) line.setAttribute("marker-end", `url(#${markerId})`);
    }

    for (const n of kept) {
      const p = pos.get(n.id);
      const m = meta.get(n.id);
      if (!p || !m) continue;
      const g = svg.createSvg("g", {
        cls: ["srag-map-node", `srag-map-${m.kind}`], // createSvg adds tokens one by one: no spaces
        attr: { transform: `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})` },
      });
      g.createSvg("title").textContent = m.label;
      g.createSvg("circle", { attr: { r: m.kind === "active" ? 8 : 6 } });
      const label = g.createSvg("text", { attr: { y: 16, "text-anchor": "middle" } });
      label.textContent = m.label.length > 18 ? m.label.slice(0, 17) + "…" : m.label;
      g.addEventListener("click", () => m.open());
    }

    const hidden = nodes.length - kept.length;
    host.createEl("div", {
      cls: "srag-count",
      text: hidden > 0
        ? `Showing the ${kept.length} best-connected papers · +${hidden} more in the lists below`
        : "Solid = in your library · dashed = not yet added (click to add)",
    });
  }

  private async openCitekey(citekey: string): Promise<void> {
    const file = this.plugin.library.getFile(citekey); // note filename ≠ citekey
    if (file) await this.app.workspace.getLeaf(false).openFile(file);
    else new Notice(`Note not found: ${citekey}`);
  }
}
