import { Library } from "../data/library";
import { formatCitation } from "./format";
import { CiteStyle, CSLItem } from "../types";

const CITE_RE = /\[@([^\]]+)\]/g; // [@key]  or  [@a; @b]

/** Pull unique citekeys (in first-seen order) out of `[@citekey]` Pandoc citations. */
export function extractCitekeys(text: string): string[] {
  const keys: string[] = [];
  let m: RegExpExecArray | null;
  CITE_RE.lastIndex = 0;
  while ((m = CITE_RE.exec(text)) !== null) {
    for (const part of m[1].split(";")) {
      const k = part.trim().replace(/^@/, "").trim();
      if (k && !keys.includes(k)) keys.push(k);
    }
  }
  return keys;
}

/** Build a Markdown bibliography (sorted) for the given citekeys. */
export function buildBibliography(citekeys: string[], library: Library, style: CiteStyle): string {
  const formatted = citekeys
    .map((ck) => library.getItem(ck))
    .filter((it): it is CSLItem => !!it)
    .map((it) => formatCitation(it, style));
  formatted.sort((a, b) => a.localeCompare(b));
  return formatted.map((e) => `- ${e}`).join("\n");
}

/** Compact in-text label `(Author, Year)` for inline rendering. */
export function inTextLabel(item: CSLItem): string {
  const fam = item.author?.[0]?.family || item.author?.[0]?.literal || "?";
  const dp = item.issued?.["date-parts"]?.[0];
  const yr = dp && dp[0] ? dp[0] : "n.d.";
  return `(${fam}, ${yr})`;
}
