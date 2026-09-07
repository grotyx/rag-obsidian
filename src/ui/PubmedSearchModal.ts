import { App, Modal, Notice, Setting, TextComponent } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { CSLItem } from "../types";
import { BuildNoteOpts } from "../data/reference";
import { LLMClient } from "../llm/client";
import { mapPool, POOL_WIDTH } from "../util/pool";
import { summarizeSource } from "../ingest/summarize";
import {
  searchPubmed,
  fetchPubmedRecord,
  fetchPmcFullText,
  buildTags,
  PubmedHit,
} from "../ingest/pubmedSearch";

export class PubmedSearchModal extends Modal {
  private plugin: ScholarRagPlugin;
  private query = "";
  private maxResults = 20;
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
      t.onChange((v) => (this.maxResults = Math.max(1, Math.min(50, parseInt(v, 10) || 20))));
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

    // Duplicates first and in order: findDuplicate reads a session registry that only the
    // creates below write to, so it has to see them one at a time.
    const fresh = chosen.filter((hit) => !this.plugin.library.findDuplicate(hit.item));
    const skipped = chosen.length - fresh.length;
    if (!fresh.length) {
      new Notice(`All ${skipped} selected paper(s) are already in the library.`);
      return;
    }

    const notice = new Notice(`Fetching 0/${fresh.length}…`, 0);
    let done = 0;
    let added = 0;
    let lastFile = null as import("obsidian").TFile | null;

    // The slow half — one PubMed record, maybe a PMC full text, and the summary — runs several
    // papers at a time. The vault writes afterwards stay sequential.
    const prepared = await mapPool(fresh, POOL_WIDTH, async (hit) => {
      const item: CSLItem = { ...hit.item };
      const opts: BuildNoteOpts = {};
      try {
        const { abstract, descriptors, keywords } = await fetchPubmedRecord(hit.pmid, apiKey, email);
        if (abstract) item.abstract = abstract.replace(/\s+/g, " ").trim().slice(0, 6000);

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

        const tags = await buildTags({
          descriptors,
          keywords,
          meshFromSummary: opts.summary?.mesh,
          apiKey,
          email,
        });
        if (tags.length) opts.tags = tags;
        return { hit, item, opts, error: null as unknown };
      } catch (e) {
        return { hit, item, opts, error: e };
      } finally {
        notice.setMessage(`Fetching ${++done}/${fresh.length}…`);
      }
    });

    for (const p of prepared) {
      if (p.error) {
        console.error("[RAG Obsidian] add failed", p.hit.pmid, p.error);
        new Notice(`Failed PMID ${p.hit.pmid}: ${p.error instanceof Error ? p.error.message : String(p.error)}`);
        continue;
      }
      // Re-check: two selected hits can be the same work under different PMIDs.
      if (this.plugin.library.findDuplicate(p.item)) continue;
      lastFile = await this.plugin.library.createReference(p.item, p.opts);
      added++;
      notice.setMessage(`Writing ${added}/${prepared.length}…`);
    }

    notice.hide();
    const dupes = chosen.length - added;
    new Notice(`Added ${added} reference${added === 1 ? "" : "s"}${dupes ? `, skipped ${dupes}` : ""}.`);
    this.close();
    if (lastFile) await this.app.workspace.getLeaf(true).openFile(lastFile);
  }
}
