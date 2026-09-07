import { App, FuzzySuggestModal, TFolder } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { BackfillScope } from "../data/library";
import { backfillSummaries } from "../commands/backfill";

type Item = { kind: "folder"; path: string } | { kind: "tag"; tag: string };

/** Pick a folder (under the references folder) or a tag to run "Summarize and tag references"
 *  over, instead of the whole library. */
export class BackfillScopeModal extends FuzzySuggestModal<Item> {
  constructor(app: App, private plugin: ScholarRagPlugin) {
    super(app);
    this.setPlaceholder("Pick a folder or tag to fill gaps in…");
  }

  getItems(): Item[] {
    const folders: Item[] = [];
    const walk = (f: TFolder): void => {
      for (const child of f.children) {
        if (child instanceof TFolder) {
          folders.push({ kind: "folder", path: child.path });
          walk(child);
        }
      }
    };
    const root = this.app.vault.getAbstractFileByPath(this.plugin.library.folder());
    if (root instanceof TFolder) walk(root);

    const tagSet = new Set<string>();
    for (const e of this.plugin.library.entries()) {
      const raw = e.item.tags;
      const tags = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? [raw] : [];
      for (const t of tags) tagSet.add(t);
    }
    const tags: Item[] = [...tagSet].sort().map((tag) => ({ kind: "tag", tag }));
    return [...folders, ...tags];
  }

  getItemText(item: Item): string {
    return item.kind === "folder" ? item.path : `#${item.tag}`;
  }

  onChooseItem(item: Item): void {
    const scope: BackfillScope =
      item.kind === "folder" ? { kind: "folder", folder: item.path } : { kind: "tag", tag: item.tag };
    void backfillSummaries(this.plugin, scope);
  }
}
