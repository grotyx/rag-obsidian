import { App, FuzzySuggestModal } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { BackfillScope } from "../data/library";
import { buildPrismaDiagram } from "../commands/prisma";

type Item = { kind: "all" } | { kind: "tag"; tag: string };

/** Pick "all references" or a tag to build a PRISMA 2020 flow diagram over. */
export class PrismaScopeModal extends FuzzySuggestModal<Item> {
  constructor(app: App, private plugin: ScholarRagPlugin) {
    super(app);
    this.setPlaceholder("PRISMA flow for all references, or a tag…");
  }

  getItems(): Item[] {
    const tagSet = new Set<string>();
    for (const e of this.plugin.library.entries()) {
      const raw = e.item.tags;
      const tags = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? [raw] : [];
      for (const t of tags) tagSet.add(t);
    }
    return [{ kind: "all" }, ...[...tagSet].sort().map((tag): Item => ({ kind: "tag", tag }))];
  }

  getItemText(item: Item): string {
    return item.kind === "all" ? "All references" : `#${item.tag}`;
  }

  onChooseItem(item: Item): void {
    const scope: BackfillScope = item.kind === "all" ? { kind: "all" } : { kind: "tag", tag: item.tag };
    void buildPrismaDiagram(this.plugin, scope);
  }
}
