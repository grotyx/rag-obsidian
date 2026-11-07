import { CSLItem, CSLName } from "../types";
import { rec } from "../util/json";
import { splitName } from "./metadata";

/** Parse a Zotero/EndNote/Mendeley export (CSL-JSON, BibTeX, or RIS) into CSL items. */
export function parseLibrary(text: string): CSLItem[] {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      return parseCslJson(t);
    } catch {
      return []; // malformed JSON → caller shows "could not parse"
    }
  }
  if (/^PMID-\s/m.test(t) || (/^(TI|FAU|AB)\s*-\s/m.test(t) && !/^TY\s+-/m.test(t)))
    return parseNbib(t); // PubMed .nbib / MEDLINE
  if (/^TY\s+-\s+/m.test(t)) return parseRis(t);
  if (/@\w+\s*\{/.test(t)) return parseBibtex(t);
  // last resort: try JSON
  try {
    return parseCslJson(t);
  } catch {
    return [];
  }
}

// ---------- CSL-JSON ----------
export function parseCslJson(text: string): CSLItem[] {
  const data: unknown = JSON.parse(text);
  const list = Array.isArray(data) ? data : [data];
  return list.map((raw) => {
    const it = { ...rec(raw) } as CSLItem;
    delete (it as Record<string, unknown>).id; // citekey is regenerated
    if (!it.type) it.type = "article-journal";
    return it;
  });
}

// ---------- BibTeX ----------
const BIB_TYPE: Record<string, string> = {
  article: "article-journal",
  inproceedings: "paper-conference",
  conference: "paper-conference",
  book: "book",
  inbook: "chapter",
  incollection: "chapter",
  phdthesis: "thesis",
  mastersthesis: "thesis",
  techreport: "report",
  misc: "article",
};

const BIB_SKIP = new Set(["string", "comment", "preamble", "set"]);

function parseBibtex(text: string): CSLItem[] {
  const items: CSLItem[] = [];
  const re = /@(\w+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const kind = m[1].toLowerCase();
    // Find the matching close brace (fields may contain nested braces).
    let i = re.lastIndex;
    let depth = 1;
    while (i < text.length && depth > 0) {
      const c = text[i++];
      if (c === "{") depth++;
      else if (c === "}") depth--;
    }
    re.lastIndex = i;
    if (BIB_SKIP.has(kind)) continue;
    const inner = text.slice(m.index + m[0].length, i - 1);
    const comma = inner.indexOf(",");
    if (comma < 0) continue;
    const fields = parseBibFields(inner.slice(comma + 1));
    const type = BIB_TYPE[kind] || "article-journal";
    const it: CSLItem = { type, title: prose(fields.title) };
    if (fields.author) it.author = splitAnd(fields.author.replace(/^[{"]|[}"]$/g, "")).map(parseBibName);
    const year = (fields.year || fields.date || "").match(/\d{4}/);
    if (year) it.issued = { "date-parts": [[parseInt(year[0], 10)]] };
    if (fields.journal || fields.journaltitle || fields.booktitle)
      it["container-title"] = prose(fields.journal || fields.journaltitle || fields.booktitle);
    if (fields.volume) it.volume = stripBraces(fields.volume);
    if (fields.number || fields.issue) it.issue = stripBraces(fields.number || fields.issue);
    if (fields.pages) it.page = stripBraces(fields.pages).replace(/--/g, "-");
    if (fields.doi) it.DOI = bareDoi(stripBraces(fields.doi));
    if (fields.url) it.URL = stripBraces(fields.url);
    if (fields.publisher) it.publisher = prose(fields.publisher);
    if (fields.abstract) it.abstract = prose(fields.abstract);
    if (fields.keywords) it.keyword = stripBraces(fields.keywords).split(/[;,]/).map((s) => s.trim()).filter(Boolean);
    items.push(it);
  }
  return items;
}

function parseBibFields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)\s*=\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    let i = re.lastIndex;
    let value = "";
    if (body[i] === "{") {
      // brace-delimited value with arbitrary nesting depth
      let depth = 0;
      const start = i;
      for (; i < body.length; i++) {
        if (body[i] === "{") depth++;
        else if (body[i] === "}" && --depth === 0) {
          i++;
          break;
        }
      }
      value = body.slice(start, i);
    } else if (body[i] === '"') {
      const end = body.indexOf('"', i + 1);
      i = end < 0 ? body.length : end + 1;
      value = body.slice(re.lastIndex, i);
    } else {
      while (i < body.length && body[i] !== "," && body[i] !== "\n") i++;
      value = body.slice(re.lastIndex, i);
    }
    out[m[1].toLowerCase()] = value.trim();
    re.lastIndex = i;
  }
  return out;
}

/** "https://dx.doi.org/10.x", "http(s)://doi.org/10.x" and "doi:10.x" → "10.x". */
function bareDoi(s: string): string {
  return s.trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, "");
}

const TEX_ACCENT: Record<string, string> = {
  '"': "̈", "'": "́", "`": "̀", "^": "̂", "~": "̃", c: "̧", v: "̌",
};

/** Common LaTeX accents and escapes → Unicode: {\"u} → ü, {\'\i} → í, \c{c} → ç, \& → &. */
function texDecode(s: string): string {
  const letter = (l: string) => (l === "\\i" ? "i" : l === "\\j" ? "j" : l);
  return s
    .replace(/\\(["'`^~])\s*(?:\{\s*(\\[ij]|[A-Za-z])\s*\}|(\\[ij]|[A-Za-z]))/g, (_, a: string, l1?: string, l2?: string) =>
      (letter(l1 || l2 || "") + TEX_ACCENT[a]).normalize("NFC")
    )
    .replace(/\\([cv])(?:\s*\{\s*([A-Za-z])\s*\}|\s+([A-Za-z]))/g, (_, a: string, l1?: string, l2?: string) =>
      ((l1 || l2 || "") + TEX_ACCENT[a]).normalize("NFC")
    )
    .replace(/\\([ij])(?![A-Za-z])/g, "$1")
    .replace(/\\([&%$#_])/g, "$1");
}

function stripBraces(s?: string): string {
  if (!s) return "";
  return texDecode(s.replace(/^[{"]+|[}"]+$/g, "")).replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

/** stripBraces for running text: `--` / `---` become en / em dashes (pages and ids keep `--`). */
function prose(s?: string): string {
  return stripBraces(s).replace(/---/g, "—").replace(/--/g, "–");
}

/** Split a BibTeX author list on " and " at brace depth 0, so {Food and Drug Administration} stays one. */
function splitAnd(s: string): string[] {
  const out: string[] = [];
  const sep = /^\s+and\s+/i;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}") depth--;
    else if (depth === 0) {
      const hit = s.slice(i).match(sep);
      if (hit) {
        out.push(s.slice(start, i));
        i += hit[0].length - 1;
        start = i + 1;
      }
    }
  }
  out.push(s.slice(start));
  return out.filter((a) => a.trim());
}

function parseBibName(raw: string): CSLName {
  const braced = raw.trim().match(/^\{([^{}]*)\}$/); // a whole-name brace group is a corporate author
  if (braced && !braced[1].includes(",")) return { literal: braced[1].trim() };
  const s = stripBraces(raw);
  if (s.includes(",")) {
    const [family, given] = s.split(",");
    return { family: family.trim(), given: given.trim() };
  }
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { family: parts[0] };
  const family = parts.pop() as string;
  return { family, given: parts.join(" ") };
}

// ---------- RIS ----------
const RIS_TYPE: Record<string, string> = {
  JOUR: "article-journal",
  CONF: "paper-conference",
  BOOK: "book",
  CHAP: "chapter",
  THES: "thesis",
  RPRT: "report",
};

function parseRis(text: string): CSLItem[] {
  const items: CSLItem[] = [];
  let cur: Record<string, string[]> = {};
  const push = () => {
    if (Object.keys(cur).length) items.push(risToItem(cur));
    cur = {};
  };
  let last = "";
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9]{2})\s+-\s?(.*)$/);
    if (!m) {
      // continuation of the previous value (wrapped abstract / title), as parseNbib does
      const more = line.trim();
      if (more && last && cur[last]) cur[last][cur[last].length - 1] += " " + more;
      continue;
    }
    const [, tag, val] = m;
    if (tag === "ER") {
      push();
      last = "";
      continue;
    }
    (cur[tag] = cur[tag] || []).push(val.trim());
    last = tag;
  }
  push();
  return items;
}

// ---------- NBIB / MEDLINE (PubMed "Send to → Citation manager") ----------
function parseNbib(text: string): CSLItem[] {
  const records: { tag: string; value: string }[][] = [];
  let cur: { tag: string; value: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") {
      if (cur.length) records.push(cur);
      cur = [];
      continue;
    }
    if (/^\s/.test(line) && cur.length) {
      cur[cur.length - 1].value += " " + line.trim(); // continuation line
      continue;
    }
    const m = line.match(/^([A-Z]{2,4})\s*-\s?(.*)$/);
    if (m) cur.push({ tag: m[1].trim(), value: m[2].trim() });
    else if (cur.length) cur[cur.length - 1].value += " " + line.trim();
  }
  if (cur.length) records.push(cur);
  return records.map(nbibToItem).filter((it) => it.title || it.author?.length);
}

function nbibToItem(rec: { tag: string; value: string }[]): CSLItem {
  const by: Record<string, string[]> = {};
  for (const { tag, value } of rec) (by[tag] = by[tag] || []).push(value);
  const first = (t: string) => (by[t] && by[t][0]) || "";

  const it: CSLItem = { type: "article-journal", title: (by.TI || []).join(" ").trim() };
  const authors = by.FAU ? by.FAU.map(parseBibName) : (by.AU || []).map(splitName); // AU is "Family Initials"
  if (authors.length) it.author = authors;
  const year = first("DP").match(/\d{4}/);
  if (year) it.issued = { "date-parts": [[parseInt(year[0], 10)]] };
  if (by.JT || by.TA) it["container-title"] = first("JT") || first("TA");
  if (by.TA) it["container-title-short"] = first("TA");
  if (first("VI")) it.volume = first("VI");
  if (first("IP")) it.issue = first("IP");
  if (first("PG")) it.page = first("PG");
  if (first("PMID")) it.PMID = first("PMID");
  if (by.AB) it.abstract = by.AB.join(" ");
  // DOI lives in AID/LID as "10.xxxx/yyy [doi]"
  for (const v of [...(by.AID || []), ...(by.LID || [])]) {
    const m = v.match(/(10\.\S+?)\s*\[doi\]/i);
    if (m) {
      it.DOI = m[1];
      break;
    }
  }
  const kw = [...(by.OT || []), ...(by.MH || []).map((m) => m.replace(/\*/g, "").split("/")[0].trim())];
  if (kw.length) it.keyword = [...new Set(kw)];
  return it;
}

function risToItem(r: Record<string, string[]>): CSLItem {
  const first = (k: string) => (r[k] && r[k][0]) || "";
  const it: CSLItem = {
    type: RIS_TYPE[first("TY")] || "article-journal",
    title: first("TI") || first("T1") || "",
  };
  const authors = [...(r.AU || []), ...(r.A1 || [])].map(parseBibName);
  if (authors.length) it.author = authors;
  const year = (first("PY") || first("Y1") || first("DA")).match(/\d{4}/);
  if (year) it.issued = { "date-parts": [[parseInt(year[0], 10)]] };
  const journal = first("JO") || first("JF") || first("T2") || first("J2");
  if (journal) it["container-title"] = journal;
  if (first("VL")) it.volume = first("VL");
  if (first("IS")) it.issue = first("IS");
  const sp = first("SP");
  const ep = first("EP");
  if (sp) it.page = ep ? `${sp}-${ep}` : sp;
  if (first("DO")) it.DOI = bareDoi(first("DO"));
  if (first("UR")) it.URL = first("UR");
  if (first("AB") || first("N2")) it.abstract = first("AB") || first("N2");
  const kw = r.KW || [];
  if (kw.length) it.keyword = kw;
  return it;
}
