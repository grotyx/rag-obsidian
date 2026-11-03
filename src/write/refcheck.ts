import type { CSLItem } from "../types";
import { str } from "../util/json";
import { hasStashedText } from "../ingest/pdfStash";

export const PROBLEM_RETRACTED = "retracted";
export const PROBLEM_UNCHECKED = "not checked for retraction (run \"Check retraction status for all references\")";
export const PROBLEM_PREPRINT = "preprint: check whether a peer-reviewed version has been published";
export const PROBLEM_THIN = "thin evidence: no summary or full text in the note, so the claim rests on the abstract at most";

const PREPRINT_VENUE = /medrxiv|biorxiv|arxiv|research\s*square|ssrn|preprints\.org/i;

/** 0 = most severe. Table sections of the report follow this order. */
export function problemSeverity(p: string): 0 | 1 | 2 {
  if (p === PROBLEM_RETRACTED) return 0;
  if (p === PROBLEM_UNCHECKED || p === PROBLEM_THIN) return 2;
  return 1;
}

const SEVERITY_HEADINGS = ["Retracted", "Needs attention", "Low severity"];

function hasSummary(body: string): boolean {
  return /^##\s+(Summary\b|요약)/im.test(body);
}

export interface RefRow {
  key: string;
  problems: string[];
}

/** Human-readable problems with one cited reference. `item` null = the citekey is not in the library.
 *  `body` (the note text) enables the thin-evidence check; omit it to skip that check. */
export function referenceProblems(item: CSLItem | null, fm: Record<string, unknown>, body?: string): string[] {
  if (!item) return ["not in the library"];
  const out: string[] = [];
  if (fm.retracted === true || fm.retracted === "true") out.push(PROBLEM_RETRACTED);
  else if (fm.retracted === undefined || fm.retracted === null) out.push(PROBLEM_UNCHECKED);
  if (!item.DOI && !item.PMID) out.push("no DOI or PMID");
  const venue = `${str(item["container-title"])} ${str(item.publisher)}`;
  if (item.type === "article" || item.type === "post" || PREPRINT_VENUE.test(venue)) out.push(PROBLEM_PREPRINT);
  if (!item.title) out.push("missing title");
  if (!item.author?.length) out.push("missing authors");
  if (!item.issued?.["date-parts"]?.[0]?.[0] && !item.issued?.raw) out.push("missing year");
  if (item.type === "article-journal") {
    if (!item["container-title"]) out.push("missing journal");
    const gaps = [!item.volume && "volume", !item.page && "pages"].filter(Boolean);
    if (gaps.length) out.push(`incomplete: ${gaps.join(", ")}`);
  }
  if (body !== undefined && !hasSummary(body) && !hasStashedText(body)) out.push(PROBLEM_THIN);
  return out;
}

/** Markdown report for the "check references" command: a count line, then one table per severity. */
export function refcheckReport(noteName: string, rows: RefRow[], notes: string[] = []): string {
  const bad = rows.filter((r) => r.problems.length);
  const lines = [`# Reference check: ${noteName}`, "", `${rows.length} cited, ${bad.length} with problems.`, ""];
  if (bad.length) {
    const counts = [0, 1, 2].map((sev) => rows.filter((r) => r.problems.some((p) => problemSeverity(p) === sev)).length);
    lines.push(`By severity: ${counts.map((n, i) => `${n} ${SEVERITY_HEADINGS[i].toLowerCase()}`).join(", ")}.`, "");
    for (const sev of [0, 1, 2]) {
      const group = bad.map((r) => ({ key: r.key, ps: r.problems.filter((p) => problemSeverity(p) === sev) })).filter((g) => g.ps.length);
      if (!group.length) continue;
      lines.push(`## ${SEVERITY_HEADINGS[sev]}`, "", "| Citekey | Problems |", "| --- | --- |");
      for (const g of group) lines.push("| `" + g.key + "` | " + g.ps.join("; ") + " |");
      lines.push("");
    }
  } else lines.push(`All ${rows.length} references look complete.`);
  if (notes.length) lines.push(...notes.map((n) => `- ${n}`));
  return lines.join("\n") + "\n";
}
