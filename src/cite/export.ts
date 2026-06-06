import { CSLItem, CSLName } from "../types";

export type ExportFormat = "bibtex" | "ris" | "csl-json";

export interface ExportRef {
  citekey: string;
  item: CSLItem;
}

function year(item: CSLItem): string {
  const dp = item.issued?.["date-parts"]?.[0];
  return dp && dp[0] ? String(dp[0]) : "";
}
function nameFL(n: CSLName): string {
  return n.literal ?? `${n.family ?? ""}${n.given ? ", " + n.given : ""}`;
}

const CSL_TO_BIB: Record<string, string> = {
  "article-journal": "article",
  "paper-conference": "inproceedings",
  book: "book",
  chapter: "incollection",
  thesis: "phdthesis",
  report: "techreport",
};

function bibtexOf(ref: ExportRef): string {
  const it = ref.item;
  const type = CSL_TO_BIB[it.type] || "article";
  const f: [string, string][] = [];
  if (it.title) f.push(["title", `{${it.title}}`]);
  if (it.author?.length) f.push(["author", `{${it.author.map(nameFL).join(" and ")}}`]);
  if (year(it)) f.push(["year", year(it)]);
  if (it["container-title"]) f.push(["journal", `{${it["container-title"]}}`]);
  if (it.volume) f.push(["volume", `{${it.volume}}`]);
  if (it.issue) f.push(["number", `{${it.issue}}`]);
  if (it.page) f.push(["pages", `{${it.page.replace(/-/g, "--")}}`]);
  if (it.DOI) f.push(["doi", `{${it.DOI}}`]);
  if (it.URL) f.push(["url", `{${it.URL}}`]);
  if (it.publisher) f.push(["publisher", `{${it.publisher}}`]);
  if (it.abstract) f.push(["abstract", `{${it.abstract}}`]);
  if (it.keyword?.length) f.push(["keywords", `{${it.keyword.join(", ")}}`]);
  const body = f.map(([k, v]) => `  ${k} = ${v}`).join(",\n");
  return `@${type}{${ref.citekey},\n${body}\n}`;
}

const CSL_TO_RIS: Record<string, string> = {
  "article-journal": "JOUR",
  "paper-conference": "CONF",
  book: "BOOK",
  chapter: "CHAP",
  thesis: "THES",
  report: "RPRT",
};

function risOf(ref: ExportRef): string {
  const it = ref.item;
  const lines: string[] = [`TY  - ${CSL_TO_RIS[it.type] || "JOUR"}`];
  for (const a of it.author || []) lines.push(`AU  - ${nameFL(a)}`);
  if (it.title) lines.push(`TI  - ${it.title}`);
  if (year(it)) lines.push(`PY  - ${year(it)}`);
  if (it["container-title"]) lines.push(`JO  - ${it["container-title"]}`);
  if (it.volume) lines.push(`VL  - ${it.volume}`);
  if (it.issue) lines.push(`IS  - ${it.issue}`);
  if (it.page) {
    const [sp, ep] = it.page.split(/[-–]/);
    if (sp) lines.push(`SP  - ${sp.trim()}`);
    if (ep) lines.push(`EP  - ${ep.trim()}`);
  }
  if (it.DOI) lines.push(`DO  - ${it.DOI}`);
  if (it.URL) lines.push(`UR  - ${it.URL}`);
  if (it.abstract) lines.push(`AB  - ${it.abstract}`);
  for (const k of it.keyword || []) lines.push(`KW  - ${k}`);
  lines.push("ER  - ", "");
  return lines.join("\n");
}

/** Serialize library references to a chosen bibliographic format. */
export function exportRefs(refs: ExportRef[], format: ExportFormat): string {
  if (format === "csl-json") {
    return JSON.stringify(
      refs.map((r) => ({ id: r.citekey, ...r.item })),
      null,
      2
    );
  }
  const sep = format === "bibtex" ? "\n\n" : "\n";
  const fn = format === "bibtex" ? bibtexOf : risOf;
  return refs.map(fn).join(sep) + "\n";
}
