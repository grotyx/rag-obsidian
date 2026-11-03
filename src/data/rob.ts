import { text } from "../util/json";
import { ROB_OVERALL } from "./screening";

/** The slice of a reference the risk-of-bias table needs (pure; `commands/rob.ts` gathers it). */
export interface RobRecord {
  citekey: string;
  /** Formatted authors ("Kim et al."), as `Library.entries()` gives them. */
  authors: string;
  year: string;
  include: string | null;
  rob_tool: string | null;
  rob_overall: string | null;
  rob_note: string | null;
  /** Groups the reports of one study; the tables get a Study column when any record has one. */
  study_id?: string | null;
}

/** Project a reference's frontmatter onto `RobRecord`; unquoted YAML numbers (`study_id: 2019001`) count as text. */
export function toRobRecord(citekey: string, authors: string, year: string, item: Record<string, unknown>): RobRecord {
  const t = (v: unknown): string | null => text(v).trim() || null;
  return {
    citekey, authors, year,
    include: t(item.include),
    rob_tool: t(item.rob_tool),
    rob_overall: t(item.rob_overall),
    rob_note: t(item.rob_note),
    study_id: t(item.study_id),
  };
}

const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim() || "—";
const byKey = (a: RobRecord, b: RobRecord): number => (a.citekey < b.citekey ? -1 : a.citekey > b.citekey ? 1 : 0);

/** Markdown for "Risk-of-bias summary table": one table per `rob_tool` (records assessed with a
 *  judgement or a tool), a count per judgement, and the included records with no judgement yet.
 *  `label` names the scope. */
export function robMarkdown(records: RobRecord[], label: string, date: string): string {
  const assessed = records.filter((r) => r.rob_tool || r.rob_overall).sort(byKey);
  const missing = records.filter((r) => r.include === "include" && !r.rob_overall).sort(byKey);

  const out = [`# Risk of bias (${label})`, "", `Generated ${date}. ${assessed.length} assessed of ${records.length} records in scope.`, ""];

  const withStudy = assessed.some((r) => r.study_id);
  const tools = [...new Set(assessed.map((r) => r.rob_tool ?? ""))].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  for (const tool of tools) {
    out.push(`## ${tool || "Tool not set"}`, "", `| Reference | Study |${withStudy ? " Study ID |" : ""} Overall | Note |`, `|---|---|${withStudy ? "---|" : ""}---|---|`);
    for (const r of assessed.filter((x) => (x.rob_tool ?? "") === tool)) {
      const study = [r.authors, r.year].filter(Boolean).join(" ");
      out.push(`| [@${r.citekey}] | ${cell(study)} |${withStudy ? ` ${cell(r.study_id ?? "")} |` : ""} ${cell(r.rob_overall ?? "")} | ${cell(r.rob_note ?? "")} |`);
    }
    out.push("");
  }
  if (!tools.length) out.push("No risk-of-bias assessments yet.", "");

  out.push("## Judgements", "", "| Overall | Records |", "|---|---|");
  const known: readonly string[] = ROB_OVERALL;
  for (const j of [...ROB_OVERALL, ...new Set(assessed.map((r) => r.rob_overall ?? "").filter((j) => j && !known.includes(j)))]) {
    const n = assessed.filter((r) => r.rob_overall === j).length;
    if (n) out.push(`| ${j} | ${n} |`);
  }
  const unset = assessed.filter((r) => !r.rob_overall).length;
  if (unset) out.push(`| (not set) | ${unset} |`);
  out.push("", `## Included records without an assessment (${missing.length})`, "");
  for (const r of missing) out.push(`- [@${r.citekey}]${r.rob_tool ? ` (tool: ${r.rob_tool})` : ""}`);
  if (!missing.length) out.push("None.");
  out.push("");
  return out.join("\n");
}
