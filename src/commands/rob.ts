import { App, FuzzySuggestModal, normalizePath } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { localDate } from "../data/reference";
import { RobRecord, robMarkdown } from "../data/rob";

type RobScope = { kind: "included" } | { kind: "all" } | { kind: "kq"; kq: string };

const kqKey = (v: unknown): string => {
  const s = String(v).trim();
  return /^\d+$/.test(s) ? String(Number(s)) : s;
};

const kqsOf = (raw: unknown): string[] => (Array.isArray(raw) ? raw.map(String) : []);

const optStr = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Write `Risk of bias <date>.md` for the chosen scope and open it. */
export async function buildRobTable(plugin: ScholarRagPlugin, scope: RobScope): Promise<void> {
  const scoped = plugin.library.entries().filter((e) => {
    if (scope.kind === "included") return e.item.include === "include";
    if (scope.kind === "kq") return kqsOf(e.item.kq).some((k) => kqKey(k) === kqKey(scope.kq));
    return true;
  });
  const records: RobRecord[] = scoped.map((e) => ({
    citekey: e.citekey,
    authors: e.authors,
    year: e.year,
    include: optStr(e.item.include),
    rob_tool: optStr(e.item.rob_tool),
    rob_overall: optStr(e.item.rob_overall),
    rob_note: optStr(e.item.rob_note),
  }));
  const label = scope.kind === "included" ? "included records" : scope.kind === "all" ? "all references" : `key question ${scope.kq}`;
  const date = localDate();
  await plugin.writeAndOpen(normalizePath(`Risk of bias ${date}.md`), robMarkdown(records, label, date));
}

/** Pick the scope: included records, all references, or one key question in use. */
export class RobScopeModal extends FuzzySuggestModal<RobScope> {
  constructor(app: App, private plugin: ScholarRagPlugin) {
    super(app);
    this.setPlaceholder("Risk-of-bias table for…");
  }

  getItems(): RobScope[] {
    const kqs = new Set<string>();
    for (const e of this.plugin.library.entries()) for (const k of kqsOf(e.item.kq)) kqs.add(k);
    return [
      { kind: "included" },
      { kind: "all" },
      ...[...kqs].sort().map((kq): RobScope => ({ kind: "kq", kq })),
    ];
  }

  getItemText(s: RobScope): string {
    return s.kind === "included" ? "Included records" : s.kind === "all" ? "All references" : `Key question ${s.kq}`;
  }

  onChooseItem(s: RobScope): void {
    void buildRobTable(this.plugin, s);
  }
}
