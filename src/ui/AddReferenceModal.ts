import { App, ButtonComponent, Modal, Notice, Setting, TextComponent } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { detectId, fetchMetadata } from "../ingest/metadata";
import { resolveWork } from "../graph/openalex";
import { CSLItem } from "../types";

export class AddReferenceModal extends Modal {
  private plugin: ScholarRagPlugin;
  private input = "";
  private busy = false;
  private fetchBtn?: ButtonComponent;
  // Bare-digit input is ambiguous ("2024" is a valid PMID) — fetched item awaiting
  // a second click to confirm, with a preview line shown in the modal.
  private pendingItem: CSLItem | null = null;
  private previewEl?: HTMLElement;

  constructor(app: App, plugin: ScholarRagPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Add reference" });
    contentEl.createEl("p", {
      text: "Paste a DOI, PubMed ID (PMID), or arXiv ID / URL — or type a paper title to search.",
      cls: "setting-item-description",
    });

    let textComp: TextComponent | undefined;
    new Setting(contentEl).setName("Identifier").addText((t) => {
      textComp = t;
      t.setPlaceholder("10.1038/nature14539  ·  26017442  ·  2005.11401");
      t.onChange((v) => {
        this.input = v;
        this.clearPending();
      });
      t.inputEl.style.width = "100%";
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void this.submit();
      });
    });

    new Setting(contentEl).addButton((b) => {
      this.fetchBtn = b;
      b.setButtonText("Fetch & add").setCta().onClick(() => void this.submit());
    });

    window.setTimeout(() => textComp?.inputEl.focus(), 0);
  }

  /** Reset the bare-PMID confirm state (input changed or item was added). */
  private clearPending(): void {
    if (!this.pendingItem) return;
    this.pendingItem = null;
    this.previewEl?.remove();
    this.previewEl = undefined;
    this.fetchBtn?.setButtonText("Fetch & add");
  }

  /** Show the fetched item in the modal and arm the button for a confirming second click. */
  private showPreview(item: CSLItem): void {
    this.pendingItem = item;
    const first = item.author?.[0];
    const who = first ? String(first.family || first.literal || "") : "";
    const year = item.issued?.["date-parts"]?.[0]?.[0];
    const line = [item.title || "(untitled)", [who, year].filter(Boolean).join(", ")]
      .filter(Boolean)
      .join(" — ");
    this.previewEl?.remove();
    this.previewEl = this.contentEl.createEl("p", {
      text: `Found: ${line}`,
      cls: "setting-item-description",
    });
    this.fetchBtn?.setButtonText("Add this paper?");
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    if (this.pendingItem) {
      await this.confirmAdd(this.pendingItem);
      return;
    }
    const raw = this.input.trim();
    if (!raw) {
      new Notice("Enter an identifier");
      return;
    }
    this.busy = true;
    this.fetchBtn?.setDisabled(true).setButtonText("Adding…");
    const id = detectId(raw);
    // Bare digits ("2024") are treated as a PMID by detectId and can silently fetch an
    // unrelated paper — require an explicit confirm unless the user typed "pmid:…".
    const needsConfirm = id.kind === "pmid" && /^\d+$/.test(raw);
    const notice = new Notice(
      id.kind === "unknown" ? `Searching "${raw}"…` : `Fetching ${id.kind.toUpperCase()} ${id.value}…`,
      0
    );
    try {
      let item: CSLItem;
      if (id.kind === "unknown") {
        // Treat free text as a title search (OpenAlex → DOI/PMID → rich metadata).
        const w = await resolveWork({ type: "article-journal", title: raw }, this.plugin.settings.openalexMailto);
        if (!w) {
          notice.hide();
          new Notice("No match — paste a DOI / PMID / arXiv ID, or refine the title");
          return;
        }
        const sub = detectId(w.doi || w.pmid || "");
        item = sub.kind === "unknown"
          ? { type: "article-journal", title: w.title, openalex_id: w.openalexId }
          : await fetchMetadata(sub, this.plugin.settings.pubmedApiKey);
      } else {
        item = await fetchMetadata(id, this.plugin.settings.pubmedApiKey);
      }
      const dup = this.plugin.library.findDuplicate(item);
      if (dup) {
        notice.hide();
        new Notice(`Already in library: ${dup}`);
        this.close();
        const existing = this.plugin.library.getFile(dup);
        if (existing) await this.app.workspace.getLeaf(true).openFile(existing);
        return;
      }
      if (needsConfirm) {
        notice.hide();
        this.showPreview(item);
        return;
      }
      const file = await this.plugin.library.createReference(item);
      notice.hide();
      new Notice(`Added: ${item.title ?? file.basename}`);
      this.close();
      await this.app.workspace.getLeaf(true).openFile(file);
    } catch (e) {
      notice.hide();
      console.error("[RAG Obsidian] fetch failed", e);
      new Notice(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.busy = false;
      this.fetchBtn
        ?.setDisabled(false)
        .setButtonText(this.pendingItem ? "Add this paper?" : "Fetch & add");
    }
  }

  /** Second click on a bare-PMID preview: actually create the note. */
  private async confirmAdd(item: CSLItem): Promise<void> {
    this.busy = true;
    this.fetchBtn?.setDisabled(true).setButtonText("Adding…");
    try {
      const file = await this.plugin.library.createReference(item);
      this.clearPending();
      new Notice(`Added: ${item.title ?? file.basename}`);
      this.close();
      await this.app.workspace.getLeaf(true).openFile(file);
    } catch (e) {
      console.error("[RAG Obsidian] add failed", e);
      new Notice(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.busy = false;
      this.fetchBtn
        ?.setDisabled(false)
        .setButtonText(this.pendingItem ? "Add this paper?" : "Fetch & add");
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
