import { CSLItem, CSLName } from "../types";
import { cslFields } from "./csl";

export type ExportFormat = "bibtex" | "ris" | "csl-json";

export interface ExportRef {
  citekey: string;
  item: CSLItem;
}

function year(item: CSLItem): string {
  const dp = item.issued?.["date-parts"]?.[0];
  return dp && dp[0] ? String(dp[0]) : "";
}
/** `keyword` is an array in CSL-JSON but plain frontmatter often holds one string. */
function keywordsOf(item: CSLItem): string[] {
  const k: unknown = item.keyword;
  const parts: unknown[] = Array.isArray(k) ? k : typeof k === "string" ? k.split(/[;,]/) : [];
  return parts.map((x) => (typeof x === "string" || typeof x === "number" ? String(x).trim() : "")).filter(Boolean);
}

/** Escape a value for a BibTeX `{…}` field: `& % $ # _` get a backslash, and a brace without
 *  a partner is escaped too (a stray one would swallow the rest of the entry). Balanced
 *  braces are kept — authors use them to protect capitals. */
function bibEscape(v: unknown, verbatim = false): string {
  // doi / url are read verbatim by biblatex: a backslash would corrupt them, so only braces are fixed
  const s = verbatim ? String(v) : String(v).replace(/(?<!\\)([&%$#_])/g, "\\$1");
  const keep = new Set<number>();
  const open: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{") open.push(i);
    else if (s[i] === "}") {
      const o = open.pop();
      if (o !== undefined) {
        keep.add(o);
        keep.add(i);
      }
    }
  }
  return s.split("").map((c, i) => ((c === "{" || c === "}") && !keep.has(i) ? `\\${c}` : c)).join("");
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
  const braced = (k: string, v: unknown, verbatim = false) => f.push([k, `{${bibEscape(v, verbatim)}}`]);
  if (it.title) braced("title", it.title);
  if (it.author?.length) braced("author", it.author.map(nameFL).join(" and "));
  if (year(it)) f.push(["year", year(it)]);
  if (it["container-title"]) braced("journal", it["container-title"]);
  if (it.volume) braced("volume", it.volume);
  if (it.issue) braced("number", it.issue);
  if (it.page) braced("pages", String(it.page).replace(/-/g, "--")); // YAML `page: 155` is a number
  if (it.DOI) braced("doi", it.DOI, true);
  if (it.URL) braced("url", it.URL, true);
  if (it.publisher) braced("publisher", it.publisher);
  if (it.abstract) braced("abstract", it.abstract);
  const kw = keywordsOf(it);
  if (kw.length) braced("keywords", kw.join(", "));
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
    const [sp, ep] = String(it.page).split(/[-–]/);
    if (sp) lines.push(`SP  - ${sp.trim()}`);
    if (ep) lines.push(`EP  - ${ep.trim()}`);
  }
  if (it.DOI) lines.push(`DO  - ${it.DOI}`);
  if (it.URL) lines.push(`UR  - ${it.URL}`);
  if (it.abstract) lines.push(`AB  - ${it.abstract}`);
  for (const k of keywordsOf(it)) lines.push(`KW  - ${k}`);
  lines.push("ER  - ", "");
  return lines.join("\n");
}

/** Serialize library references to a chosen bibliographic format. */
export function exportRefs(refs: ExportRef[], format: ExportFormat): string {
  if (format === "csl-json") {
    return JSON.stringify(
      refs.map((r) => ({ id: r.citekey, ...cslFields(r.item) })), // plugin keys (status: "unread") would print in Pandoc
      null,
      2
    );
  }
  const sep = format === "bibtex" ? "\n\n" : "\n";
  const fn = format === "bibtex" ? bibtexOf : risOf;
  return refs.map(fn).join(sep) + "\n";
}
