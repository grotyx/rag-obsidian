import { App, FuzzySuggestModal, Notice, TFile, normalizePath } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { localDate } from "../data/reference";
import { RobRecord, robMarkdown, toRobRecord } from "../data/rob";
import { hasKq, kqChoices, kqKey } from "../data/screening";

type RobScope = { kind: "included" } | { kind: "all" } | { kind: "kq"; kq: string };

/** Write `Risk of bias <date> - <scope>.md` for the chosen scope and open it. */
export async function buildRobTable(plugin: ScholarRagPlugin, scope: RobScope): Promise<void> {
  const scoped = plugin.library.entries().filter((e) => {
    if (scope.kind === "included") return e.item.include === "include";
    if (scope.kind === "kq") return hasKq(e.item.kq, scope.kq);
    return true;
  });
  const records: RobRecord[] = scoped.map((e) => toRobRecord(e.citekey, e.authors, e.year, e.item));
  const label = scope.kind === "included" ? "included records" : scope.kind === "all" ? "all references" : `key question ${kqKey(scope.kq)}`;
  const date = localDate();
  // One note per scope and day (like the PRISMA note); the same scope again regenerates it.
  const path = normalizePath(`Risk of bias ${date} - ${label.replace(/[\\/:*?"<>|#^[\]]/g, "-")}.md`);
  if (plugin.app.vault.getAbstractFileByPath(path) instanceof TFile) new Notice(`Regenerating ${path} (same scope, same day); edits to it are replaced.`);
  await plugin.writeAndOpen(path, robMarkdown(records, label, date));
}

/** Pick the scope: included records, all references, or one key question in use. */
export class RobScopeModal extends FuzzySuggestModal<RobScope> {
  constructor(app: App, private plugin: ScholarRagPlugin) {
    super(app);
    this.setPlaceholder("Risk-of-bias table for…");
  }

  getItems(): RobScope[] {
    const kqs = kqChoices(this.plugin.library.entries().map((e) => e.item.kq));
    return [{ kind: "included" }, { kind: "all" }, ...kqs.map((kq): RobScope => ({ kind: "kq", kq }))];
  }

  getItemText(s: RobScope): string {
    return s.kind === "included" ? "Included records" : s.kind === "all" ? "All references" : `Key question ${s.kq}`;
  }

  onChooseItem(s: RobScope): void {
    void buildRobTable(this.plugin, s);
  }
}
