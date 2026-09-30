import type { CSLItem } from "../types";

export interface RefRow {
  key: string;
  problems: string[];
}

/** Human-readable problems with one cited reference. `item` null = the citekey is not in the library. */
export function referenceProblems(item: CSLItem | null, fm: Record<string, unknown>): string[] {
  if (!item) return ["not in the library"];
  const out: string[] = [];
  if (fm.retracted === true || fm.retracted === "true") out.push("retracted");
  if (!item.DOI && !item.PMID) out.push("no DOI or PMID");
  if (!item.title) out.push("missing title");
  if (!item.author?.length) out.push("missing authors");
  if (!item.issued?.["date-parts"]?.[0]?.[0] && !item.issued?.raw) out.push("missing year");
  if (item.type === "article-journal") {
    if (!item["container-title"]) out.push("missing journal");
    const gaps = [!item.volume && "volume", !item.page && "pages"].filter(Boolean);
    if (gaps.length) out.push(`incomplete: ${gaps.join(", ")}`);
  }
  return out;
}

/** Markdown report for the "check references" command. */
export function refcheckReport(noteName: string, rows: RefRow[], notes: string[] = []): string {
  const bad = rows.filter((r) => r.problems.length);
  const lines = [`# Reference check: ${noteName}`, "", `${rows.length} cited, ${bad.length} with problems.`, ""];
  if (bad.length) {
    lines.push("| Citekey | Problems |", "| --- | --- |");
    for (const r of bad) lines.push("| `" + r.key + "` | " + r.problems.join("; ") + " |");
  } else lines.push(`All ${rows.length} references look complete.`);
  if (notes.length) lines.push("", ...notes.map((n) => `- ${n}`));
  return lines.join("\n") + "\n";
}
