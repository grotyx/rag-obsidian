import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { duplicateGroups } from "../data/library";
import { pickKeeper, MergeNote } from "../data/merge";
import { mergeDuplicateGroups, MergeGroupPlan } from "../commands/merge";

interface UiEntry {
  file: TFile;
  citekey: string;
  year: string;
  journal: string;
  hasSummary: boolean;
  hasPdf: boolean;
  mtime: number;
}

interface UiGroup {
  title: string;
  entries: UiEntry[];
  keeperIdx: number;
  merge: boolean;
}

/** "Merge duplicate references…" — review each `duplicateGroups` cluster, pick which note
 *  survives (preselected via `pickKeeper`), and merge the checked groups. */
export class MergeDuplicatesModal extends Modal {
  private groups: UiGroup[] = [];
  private mergeBtn: HTMLButtonElement | null = null;

  constructor(app: App, private plugin: ScholarRagPlugin) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.createEl("h2", { text: "Merge duplicate references" });
    void this.load();
  }

  private async load(): Promise<void> {
    const raw = duplicateGroups(this.plugin.library.entries());
    if (!raw.length) {
      this.contentEl.createEl("p", { text: "No duplicate groups found." });
      return;
    }
    this.groups = await Promise.all(
      raw.map(async (g) => {
        const entries: UiEntry[] = g.map((e) => ({
          file: e.file,
          citekey: e.citekey,
          year: e.year,
          journal: typeof e.item["container-title"] === "string" ? e.item["container-title"] : "",
          hasSummary: !!(e.item as Record<string, unknown>).summary_source,
          hasPdf: !!(e.item as Record<string, unknown>).pdf,
          mtime: e.file.stat.mtime,
        }));
        const notes: MergeNote[] = await Promise.all(
          g.map(async (e, i) => ({
            citekey: e.citekey,
            fm: e.item,
            bodyLength: (await this.app.vault.cachedRead(entries[i].file)).length,
          }))
        );
        return { title: g[0].title, entries, keeperIdx: pickKeeper(notes), merge: true };
      })
    );
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    // Keep the h2; drop everything rendered by a previous call.
    contentEl.querySelectorAll(".srag-merge-group, .srag-merge-footer").forEach((el) => el.remove());

    for (const group of this.groups) {
      const box = contentEl.createDiv({ cls: "srag-merge-group" });
      const header = new Setting(box).setName(group.title || "(untitled)");
      header.addToggle((t) =>
        t.setValue(group.merge).onChange((v) => (group.merge = v))
      );
      const list = box.createDiv();
      const radioName = `srag-keeper-${this.groups.indexOf(group)}`;
      group.entries.forEach((e, i) => {
        const row = list.createDiv({ cls: "setting-item-description" });
        const radio = row.createEl("input", { type: "radio", attr: { name: radioName } });
        radio.checked = i === group.keeperIdx;
        radio.onchange = () => (group.keeperIdx = i);
        row.appendText(
          ` ${e.citekey} · ${e.year || "n.d."} · ${e.journal || "—"}` +
            `${e.hasSummary ? " · summary" : ""}${e.hasPdf ? " · pdf" : ""}`
        );
      });
    }

    const footer = contentEl.createDiv({ cls: "srag-merge-footer" });
    new Setting(footer).addButton((b) => {
      this.mergeBtn = b.buttonEl;
      b.setButtonText(`Merge ${this.groups.length} group(s)`)
        .setCta()
        .onClick(() => void this.run());
    });
  }

  private async run(): Promise<void> {
    const checked = this.groups.filter((g) => g.merge);
    if (!checked.length) {
      new Notice("No groups checked");
      return;
    }
    if (this.mergeBtn) this.mergeBtn.setAttr("disabled", "true");
    const plans: MergeGroupPlan[] = checked.map((g) => {
      const keeper = g.entries[g.keeperIdx];
      const losers = g.entries.filter((_, i) => i !== g.keeperIdx);
      const expectedMtimes = new Map(g.entries.map((e) => [e.file.path, e.mtime]));
      return { keeperFile: keeper.file, loserFiles: losers.map((l) => l.file), expectedMtimes };
    });
    const result = await mergeDuplicateGroups(this.plugin, plans);
    const skippedNotice = result.skipped ? ` · ${result.skipped} group(s) skipped (changed since opening)` : "";
    new Notice(
      `Merged ${result.groupsMerged} group(s) · ${result.notesTrashed} note(s) trashed · ` +
        `citations rewritten in ${result.notesRewritten} note(s)${skippedNotice}`
    );
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
