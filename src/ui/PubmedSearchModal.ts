import { App, Modal, Notice, Setting, TextComponent } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { CSLItem } from "../types";
import { BuildNoteOpts, keywordsToTags } from "../data/reference";
import { LLMClient } from "../llm/client";
import { summarizeSource } from "../ingest/summarize";
import {
  searchPubmed,
  fetchAbstractText,
  fetchPmcFullText,
  fetchMeshTerms,
  canonicalizeMeshTerms,
  PubmedHit,
} from "../ingest/pubmedSearch";

export class PubmedSearchModal extends Modal {
  private plugin: ScholarRagPlugin;
  private query = "";
  private maxResults = 8;
  private summarize = true;
  private rows: { hit: PubmedHit; checkbox: HTMLInputElement }[] = [];
  private resultsEl!: HTMLDivElement;
  private footerEl!: HTMLDivElement;

  constructor(app: App, plugin: ScholarRagPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Search PubMed" });
    contentEl.createEl("p", {
      text: "Search PubMed by keyword, then add selected papers as reference notes — optionally auto-summarized by your chat LLM (open-access papers use the full text).",
      cls: "setting-item-description",
    });

    let queryComp: TextComponent | undefined;
    new Setting(contentEl).setName("Query").addText((t) => {
      queryComp = t;
      t.setPlaceholder("biportal endoscopic discectomy outcomes");
      t.onChange((v) => (this.query = v));
      t.inputEl.style.width = "100%";
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void this.runSearch();
      });
    });

    new Setting(contentEl).setName("Max results").addText((t) => {
      t.setValue(String(this.maxResults));
      t.onChange((v) => (this.maxResults = Math.max(1, Math.min(50, parseInt(v, 10) || 8))));
      t.inputEl.type = "number";
      t.inputEl.style.width = "5em";
    });

    new Setting(contentEl)
      .setName("Summarize with LLM")
      .setDesc("Use the configured chat model to write a section summary into each note.")
      .addToggle((tg) => tg.setValue(this.summarize).onChange((v) => (this.summarize = v)));

    new Setting(contentEl).addButton((b) =>
      b.setButtonText("Search").setCta().onClick(() => void this.runSearch())
    );

    this.resultsEl = contentEl.createDiv({ cls: "rag-pubmed-results" });
    this.footerEl = contentEl.createDiv();

    window.setTimeout(() => queryComp?.inputEl.focus(), 0);
  }

  private async runSearch(): Promise<void> {
    const q = this.query.trim();
    if (!q) {
      new Notice("Enter a search query");
      return;
    }
    this.resultsEl.empty();
    this.footerEl.empty();
    this.rows = [];
    const loading = this.resultsEl.createEl("p", { text: `Searching PubMed for "${q}"…` });
    try {
      const hits = await searchPubmed(q, {
        n: this.maxResults,
        apiKey: this.plugin.settings.pubmedApiKey,
        email: this.plugin.settings.openalexMailto,
      });
      loading.remove();
      if (!hits.length) {
        this.resultsEl.createEl("p", { text: "No results." });
        return;
      }
      this.renderResults(hits);
    } catch (e) {
      loading.remove();
      console.error("[RAG Obsidian] PubMed search failed", e);
      this.resultsEl.createEl("p", {
        text: `Search failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  private renderResults(hits: PubmedHit[]): void {
    for (const hit of hits) {
      const { item } = hit;
      const row = this.resultsEl.createDiv({ cls: "rag-pubmed-row" });
      row.style.display = "flex";
      row.style.gap = "0.5em";
      row.style.alignItems = "flex-start";
      row.style.padding = "0.3em 0";
      row.style.borderBottom = "1px solid var(--background-modifier-border)";

      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = true;
      this.rows.push({ hit, checkbox: cb });

      const meta = row.createDiv();
      meta.createEl("div", { text: item.title || "(untitled)", cls: "rag-pubmed-title" });
      const year = item.issued?.["date-parts"]?.[0]?.[0] ?? "n.d.";
      const authors = (item.author?.[0]?.family || "") + (item.author && item.author.length > 1 ? " et al." : "");
      const sub = meta.createEl("div", { cls: "setting-item-description" });
      sub.setText(`${authors} · ${item["container-title"] || ""} · ${year}`);
      if (hit.pmc) {
        const badge = sub.createSpan({ text: "  Open Access" });
        badge.style.color = "var(--text-success)";
        badge.style.fontWeight = "600";
      }
    }

    const sel = this.footerEl.createDiv();
    new Setting(sel)
      .addExtraButton((b) =>
        b.setIcon("check-square").setTooltip("Select all").onClick(() => {
          for (const r of this.rows) r.checkbox.checked = true;
        })
      )
      .addExtraButton((b) =>
        b.setIcon("square").setTooltip("Deselect all").onClick(() => {
          for (const r of this.rows) r.checkbox.checked = false;
        })
      )
      .addButton((b) =>
        b.setButtonText("Add selected").setCta().onClick(() => void this.addSelected())
      );
  }

  private async addSelected(): Promise<void> {
    const chosen = this.rows.filter((r) => r.checkbox.checked).map((r) => r.hit);
    if (!chosen.length) {
      new Notice("Select at least one paper");
      return;
    }
    const apiKey = this.plugin.settings.pubmedApiKey;
    const email = this.plugin.settings.openalexMailto;
    const llm = new LLMClient(this.plugin.settings);

    const notice = new Notice(`Adding 0/${chosen.length}…`, 0);
    let added = 0;
    let skipped = 0;
    let lastFile = null as import("obsidian").TFile | null;

    for (const hit of chosen) {
      const item: CSLItem = { ...hit.item };
      try {
        if (this.plugin.library.findDuplicate(item)) {
          skipped++;
          notice.setMessage(`Adding ${added + skipped}/${chosen.length}… (skipping duplicates)`);
          continue;
        }
        const abstract = await fetchAbstractText(hit.pmid, apiKey, email);
        if (abstract) item.abstract = abstract.replace(/\s+/g, " ").trim().slice(0, 6000);

        const opts: BuildNoteOpts = {};

        // Real PubMed MeSH first (authoritative); LLM-generated MeSH fills the gap below.
        const { descriptors, keywords } = await fetchMeshTerms(hit.pmid, apiKey, email);

        if (this.summarize) {
          let src = abstract;
          let label = "PubMed abstract (not open access — full text not retrieved)";
          let tag = "pubmed-abstract";
          if (hit.pmc) {
            const full = await fetchPmcFullText(hit.pmc, apiKey, email);
            if (full) {
              src = full;
              label = `PMC full text (${hit.pmc}) — summarized from the complete article body`;
              tag = "pmc-fulltext";
            }
          }
          if (src) {
            try {
              opts.summary = await summarizeSource(llm, item, src, label);
              opts.summarySource = tag;
              opts.summarySourceLabel = label;
            } catch (e) {
              new Notice(`Summary failed for PMID ${hit.pmid}; adding without summary.`);
              console.error("[RAG Obsidian] summarize failed", e);
            }
          }
        }

        // Tags: real MeSH descriptors when the article is indexed; otherwise snap the LLM's
        // terms to official MeSH headings (db=mesh). Author keywords are always added on top.
        let tagTerms: string[];
        if (descriptors.length) {
          tagTerms = [...descriptors, ...keywords];
        } else {
          const llmMesh = (opts.summary?.mesh || "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
          const canon = llmMesh.length ? await canonicalizeMeshTerms(llmMesh, apiKey, email) : [];
          tagTerms = [...canon, ...keywords];
        }
        const tags = keywordsToTags(tagTerms);
        if (tags.length) opts.tags = tags;

        lastFile = await this.plugin.library.createReference(item, opts);
        added++;
        notice.setMessage(`Adding ${added}/${chosen.length}…`);
      } catch (e) {
        console.error("[RAG Obsidian] add failed", hit.pmid, e);
        new Notice(`Failed PMID ${hit.pmid}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    notice.hide();
    new Notice(`Added ${added} reference${added === 1 ? "" : "s"}${skipped ? `, skipped ${skipped} duplicate(s)` : ""}.`);
    this.close();
    if (lastFile) await this.app.workspace.getLeaf(true).openFile(lastFile);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
