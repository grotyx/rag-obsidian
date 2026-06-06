import { App, Modal, Notice, Setting } from "obsidian";
import type ScholarRagPlugin from "../../main";

/** Rename (or delete) a topic tag across every reference note. */
export class TagRenameModal extends Modal {
  private plugin: ScholarRagPlugin;
  private from = "";
  private to = "";

  constructor(app: App, plugin: ScholarRagPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Rename tag across library" });
    contentEl.createEl("p", {
      text: "Replace a topic tag on every reference note. Leave “New tag” empty to remove the tag.",
      cls: "setting-item-description",
    });

    // Suggest existing tags (sorted by frequency).
    const counts = new Map<string, number>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm && Array.isArray(fm.tags)) for (const t of fm.tags) counts.set(t, (counts.get(t) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]);

    let fromInput: HTMLInputElement | undefined;
    new Setting(contentEl).setName("Old tag").addText((t) => {
      fromInput = t.inputEl;
      t.setPlaceholder("discectomy").onChange((v) => (this.from = v.trim()));
    });
    if (top.length) {
      const dl = contentEl.createEl("datalist", { attr: { id: "rag-tag-list" } });
      for (const [tag, c] of top.slice(0, 200)) dl.createEl("option", { value: tag, text: `${tag} (${c})` });
      if (fromInput) fromInput.setAttribute("list", "rag-tag-list");
    }
    new Setting(contentEl)
      .setName("New tag")
      .setDesc("Empty = delete the old tag.")
      .addText((t) => t.setPlaceholder("diskectomy").onChange((v) => (this.to = v.trim())));

    new Setting(contentEl).addButton((b) =>
      b.setButtonText("Apply").setCta().onClick(() => void this.run())
    );
  }

  private async run(): Promise<void> {
    if (!this.from) {
      new Notice("Enter the tag to rename");
      return;
    }
    const n = await this.plugin.renameTag(this.from, this.to);
    new Notice(
      this.to ? `Renamed "${this.from}" → "${this.to}" in ${n} note(s)` : `Removed "${this.from}" from ${n} note(s)`
    );
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
