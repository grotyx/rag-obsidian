import { CSLItem, CSLName, CiteStyle } from "../types";

/** Lightweight CSL-JSON → formatted reference. A few common styles; full CSL
 *  (citeproc-js, 10k+ styles) arrives in the bibliography-generation phase. */

function year(item: CSLItem): string {
  const dp = item.issued?.["date-parts"]?.[0];
  return dp && dp[0] ? String(dp[0]) : "n.d.";
}

function initialsDotted(given?: string): string {
  if (!given) return "";
  return given
    .split(/\s+/)
    .map((g) => (g[0] ? g[0].toUpperCase() + "." : ""))
    .join(" ");
}

function initialsPlain(given?: string): string {
  if (!given) return "";
  return given
    .split(/\s+/)
    .map((g) => g[0]?.toUpperCase() ?? "")
    .join("");
}

function apaAuthors(names?: CSLName[]): string {
  if (!names || !names.length) return "";
  const fmt = (n: CSLName) =>
    n.literal ?? `${n.family ?? ""}${n.given ? ", " + initialsDotted(n.given) : ""}`;
  if (names.length === 1) return fmt(names[0]);
  if (names.length <= 20) {
    return names.slice(0, -1).map(fmt).join(", ") + ", & " + fmt(names[names.length - 1]);
  }
  return names.slice(0, 19).map(fmt).join(", ") + ", … " + fmt(names[names.length - 1]);
}

function vancouverAuthors(names?: CSLName[]): string {
  if (!names || !names.length) return "";
  const fmt = (n: CSLName) => n.literal ?? `${n.family ?? ""} ${initialsPlain(n.given)}`.trim();
  const list = names.slice(0, 6).map(fmt);
  return list.join(", ") + (names.length > 6 ? ", et al" : "");
}

function tidy(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;])/g, "$1")
    .replace(/\.{2,}/g, ".") // titles ending in '.' + style '.' → single
    .trim();
}

export function formatCitation(item: CSLItem, style: CiteStyle = "apa"): string {
  const title = item.title ?? "";
  const journal = item["container-title"] ?? "";
  const vol = item.volume ?? "";
  const iss = item.issue ? `(${item.issue})` : "";
  const pg = item.page ? `, ${item.page}` : "";
  const doi = item.DOI ? ` https://doi.org/${item.DOI}` : "";

  if (style === "vancouver") {
    const a = vancouverAuthors(item.author);
    const lead = a ? `${a}. ` : ""; // no authors → title leads the entry
    return tidy(`${lead}${title}. ${journal}. ${year(item)};${vol}${iss}${pg}.${doi}`);
  }
  if (style === "plain") {
    const a = apaAuthors(item.author);
    const lead = a ? `${a} (${year(item)}). ${title}` : `${title} (${year(item)})`;
    return tidy(`${lead}. ${journal}.`);
  }
  // APA
  const a = apaAuthors(item.author);
  const lead = a ? `${a} (${year(item)}). ${title}` : `${title} (${year(item)})`;
  const volPart = vol ? `, ${vol}${iss}` : "";
  return tidy(`${lead}. ${journal}${volPart}${pg}.${doi}`);
}
