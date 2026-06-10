import { requestUrl } from "obsidian";
import { CSLItem } from "../types";

export type SourceId =
  | { kind: "doi"; value: string }
  | { kind: "pmid"; value: string }
  | { kind: "arxiv"; value: string }
  | { kind: "unknown"; value: string };

/** Strip trailing sentence punctuation from a matched DOI (reference-list pastes like
 * "10.1038/xxx."), but keep a trailing ')' that balances an unmatched '(' (legacy SICI DOIs). */
export function cleanDoi(doi: string): string {
  let d = doi.replace(/[.,;:)\]]+$/, "");
  const open = (d.match(/\(/g) || []).length;
  const close = (d.match(/\)/g) || []).length;
  if (open > close && doi[d.length] === ")") d += ")";
  return d;
}

/** Detect identifier type from a raw string (DOI, PMID, arXiv ID, or URL). */
export function detectId(raw: string): SourceId {
  const s = raw.trim();

  // arXiv (explicit prefix or arxiv.org URL)
  if (/^arxiv:/i.test(s) || /arxiv\.org\/(abs|pdf)\//i.test(s)) {
    const m = s.match(/(\d{4}\.\d{4,5})(v\d+)?/);
    if (m) return { kind: "arxiv", value: m[1] };
  }
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(s)) {
    return { kind: "arxiv", value: s.replace(/v\d+$/, "") };
  }

  // DOI (also matches DOIs embedded in URLs)
  const doi = s.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  if (doi) return { kind: "doi", value: cleanDoi(doi[0]) };

  // PMID
  if (/^pmid:?\s*\d+$/i.test(s)) return { kind: "pmid", value: s.replace(/\D/g, "") };
  if (/^\d{1,9}$/.test(s)) return { kind: "pmid", value: s };

  return { kind: "unknown", value: s };
}

export async function fetchMetadata(id: SourceId, pubmedApiKey = ""): Promise<CSLItem> {
  switch (id.kind) {
    case "doi":
      return fetchCrossref(id.value);
    case "pmid":
      return fetchPubMed(id.value, pubmedApiKey);
    case "arxiv":
      return fetchArxiv(id.value);
    default:
      throw new Error(`Unrecognized identifier: ${id.value}`);
  }
}

function stripTags(s: string | undefined): string {
  return s ? s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
}

function clean(item: CSLItem): CSLItem {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as CSLItem;
}

const CROSSREF_TYPE: Record<string, string> = {
  "journal-article": "article-journal",
  "proceedings-article": "paper-conference",
  "book": "book",
  "book-chapter": "chapter",
  "posted-content": "article",
  "dissertation": "thesis",
  "report": "report",
  "dataset": "dataset",
};

async function fetchCrossref(doi: string): Promise<CSLItem> {
  const res = await requestUrl({
    url: `https://api.crossref.org/works/${encodeURIComponent(doi)}`,
    headers: { Accept: "application/json" },
  });
  const m = res.json?.message;
  if (!m) throw new Error("Crossref returned no data");
  const item: CSLItem = {
    type: CROSSREF_TYPE[m.type as string] || "article-journal",
    title: Array.isArray(m.title) ? m.title[0] : m.title,
    author: (m.author || []).map((a: Record<string, string>) => ({
      family: a.family,
      given: a.given,
      literal: a.name,
    })),
    "container-title": Array.isArray(m["container-title"])
      ? m["container-title"][0]
      : m["container-title"],
    "container-title-short": Array.isArray(m["short-container-title"])
      ? m["short-container-title"][0]
      : m["short-container-title"],
    volume: m.volume,
    issue: m.issue,
    page: m.page,
    DOI: m.DOI,
    URL: m.URL,
    publisher: m.publisher,
    issued: m.issued?.["date-parts"] ? { "date-parts": m.issued["date-parts"] } : undefined,
    abstract: stripTags(m.abstract),
  };
  return clean(item);
}

async function fetchPubMed(pmid: string, apiKey: string): Promise<CSLItem> {
  const key = apiKey ? `&api_key=${apiKey}` : "";
  const sum = await requestUrl({
    url: `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json${key}`,
  });
  const r = sum.json?.result?.[pmid];
  if (!r || r.error) throw new Error(`PubMed returned no data for ${pmid}`);

  const authors = (r.authors || [])
    .filter((a: { authtype?: string }) => !a.authtype || a.authtype === "Author")
    .map((a: { name: string }) => splitName(a.name));

  let doi = "";
  for (const aid of r.articleids || []) {
    if (aid.idtype === "doi") doi = aid.value;
  }

  const item: CSLItem = {
    type: "article-journal",
    title: stripTags(r.title),
    author: authors,
    "container-title": r.fulljournalname || r.source,
    "container-title-short": r.source || undefined,
    volume: r.volume,
    issue: r.issue,
    page: r.pages,
    PMID: pmid,
    DOI: doi || undefined,
    issued: parsePubDate(r.pubdate),
  };

  // abstract via efetch (best-effort) — retmode=xml so we get the real abstract,
  // not the full formatted citation (journal/authors/affiliations/DOI footer)
  try {
    const ab = await requestUrl({
      url: `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=xml${key}`,
    });
    let abstract = ab.text ? extractAbstractXml(ab.text) : "";
    if (!abstract) {
      // fall back to the plain-text fetch (formatted citation; better than nothing)
      const txt = await requestUrl({
        url: `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=text${key}`,
      });
      abstract = (txt.text || "").replace(/\s+/g, " ").trim();
    }
    if (abstract) item.abstract = abstract.slice(0, 5000);
  } catch {
    /* abstract is optional */
  }

  return clean(item);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Pull the abstract out of a PubMed efetch XML response: concatenate all
 * <AbstractText> sections, prefixing "LABEL: " when a Label attribute exists. */
function extractAbstractXml(xml: string): string {
  const parts: string[] = [];
  const re = /<AbstractText([^>]*)>([\s\S]*?)<\/AbstractText>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const label = m[1].match(/\bLabel="([^"]*)"/i)?.[1];
    const text = decodeEntities(stripTags(m[2]));
    if (!text) continue;
    parts.push(label ? `${label}: ${text}` : text);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function splitName(name: string): { family?: string; given?: string } {
  const parts = (name || "").trim().split(/\s+/);
  if (parts.length < 2) return { family: name };
  const given = parts.pop() as string;
  return { family: parts.join(" "), given };
}

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

function parsePubDate(pubdate: string | undefined): { "date-parts": number[][] } | undefined {
  if (!pubdate) return undefined;
  const m = pubdate.match(/(\d{4})(?:\s+(\w{3}))?/);
  if (!m) return undefined;
  const year = parseInt(m[1], 10);
  const mo = m[2] ? MONTHS[m[2]] : undefined;
  return { "date-parts": [mo ? [year, mo] : [year]] };
}

async function fetchArxiv(arxivId: string): Promise<CSLItem> {
  const res = await requestUrl({
    url: `https://export.arxiv.org/api/query?id_list=${arxivId}`,
  });
  const xml = new DOMParser().parseFromString(res.text, "text/xml");
  const entry = xml.querySelector("entry");
  if (!entry) throw new Error("arXiv returned no data");

  const text = (sel: string) => entry.querySelector(sel)?.textContent?.trim() || "";
  const title = text("title").replace(/\s+/g, " ");
  const summary = text("summary").replace(/\s+/g, " ");
  const published = text("published");
  const year = published ? parseInt(published.slice(0, 4), 10) : undefined;
  const authors = Array.from(entry.querySelectorAll("author > name")).map((n) =>
    splitName(n.textContent || "")
  );

  let doi = "";
  const doiEls = entry.getElementsByTagName("arxiv:doi");
  if (doiEls.length) doi = doiEls[0].textContent?.trim() || "";

  const item: CSLItem = {
    type: "article",
    title,
    author: authors,
    abstract: summary,
    URL: `https://arxiv.org/abs/${arxivId}`,
    "container-title": "arXiv",
    number: arxivId,
    DOI: doi || undefined,
    issued: year ? { "date-parts": [[year]] } : undefined,
    keyword: ["preprint", "arxiv"],
  };
  return clean(item);
}
