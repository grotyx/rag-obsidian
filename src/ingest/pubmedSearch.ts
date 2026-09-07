import { requestUrl } from "obsidian";
import { splitName, parsePubDate } from "./metadata";
import { CSLItem } from "../types";

/** One PubMed search hit: parsed CSL metadata plus identifiers for follow-up fetches. */
export interface PubmedHit {
  pmid: string;
  pmc: string; // "PMC1234567" when the article is in PubMed Central, else ""
  item: CSLItem;
}

export interface PubmedSearchOpts {
  n?: number;
  from?: string; // YYYY
  to?: string; // YYYY
  apiKey?: string;
  email?: string;
}

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

function auth(apiKey?: string, email?: string): string {
  const p: string[] = [];
  if (apiKey) p.push(`api_key=${encodeURIComponent(apiKey)}`);
  if (email) p.push(`email=${encodeURIComponent(email)}`, "tool=rag-obsidian");
  return p.length ? "&" + p.join("&") : "";
}

/** esearch -> PMIDs -> esummary -> parsed CSL metadata (+ PMC id when present). */
export async function searchPubmed(query: string, opts: PubmedSearchOpts = {}): Promise<PubmedHit[]> {
  const n = opts.n ?? 8;
  const a = auth(opts.apiKey, opts.email);

  let url = `${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=${n}` +
    `&term=${encodeURIComponent(query)}${a}`;
  if (opts.from) url += `&mindate=${opts.from}&datetype=pdat`;
  if (opts.to) url += `&maxdate=${opts.to}&datetype=pdat`;

  const sr = await requestUrl({ url });
  const pmids: string[] = sr.json?.esearchresult?.idlist ?? [];
  if (!pmids.length) return [];

  const sum = await requestUrl({
    url: `${EUTILS}/esummary.fcgi?db=pubmed&retmode=json&id=${pmids.join(",")}${a}`,
  });
  const result = sum.json?.result ?? {};
  const uids: string[] = result.uids ?? pmids;

  const hits: PubmedHit[] = [];
  for (const uid of uids) {
    const d = result[uid];
    if (!d || d.error) continue;
    const ids: { idtype: string; value: string }[] = d.articleids ?? [];
    const doi = ids.find((x) => x.idtype === "doi")?.value || "";
    const pmc = ids.find((x) => x.idtype === "pmc")?.value || "";
    const authors = (d.authors ?? [])
      .filter((au: { authtype?: string }) => !au.authtype || au.authtype === "Author")
      .map((au: { name: string }) => splitName(au.name));
    const item: CSLItem = {
      type: "article-journal",
      title: (d.title || "").replace(/\s+/g, " ").trim(),
      author: authors,
      "container-title": d.fulljournalname || d.source || "",
      "container-title-short": d.source || undefined,
      volume: d.volume || undefined,
      issue: d.issue || undefined,
      page: d.pages || undefined,
      DOI: doi || undefined,
      PMID: uid,
      issued: parsePubDate(d.pubdate),
    };
    hits.push({ pmid: uid, pmc, item });
  }
  return hits;
}

export interface PubmedRecord {
  abstract: string; // <AbstractText> sections joined (labels kept)
  descriptors: string[]; // assigned NLM MeSH headings (empty when not yet indexed — keeps the LLM MeSH fallback alive)
  keywords: string[]; // author-supplied keywords
  pmc: string; // "PMC…" when a full text exists, else "" — the note only stores the PMID
}

/** One efetch per PMID: abstract, MeSH descriptors and author keywords all come from the same XML. */
export async function fetchPubmedRecord(pmid: string, apiKey?: string, email?: string): Promise<PubmedRecord> {
  const a = auth(apiKey, email);
  try {
    const res = await requestUrl({
      url: `${EUTILS}/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=xml${a}`,
    });
    const doc = new DOMParser().parseFromString(res.text, "text/xml");
    const texts = (sel: string) =>
      Array.from(doc.querySelectorAll(sel))
        .map((n) => (n.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean);
    const abstract = Array.from(doc.querySelectorAll("AbstractText"))
      .map((n) => {
        const label = n.getAttribute("Label");
        const t = (n.textContent || "").replace(/\s+/g, " ").trim();
        return t && label ? `${label}: ${t}` : t;
      })
      .filter(Boolean)
      .join("\n\n");
    const pmc =
      Array.from(doc.querySelectorAll("ArticleId"))
        .find((n) => n.getAttribute("IdType") === "pmc")
        ?.textContent?.trim() || "";
    return {
      abstract,
      descriptors: texts("MeshHeading > DescriptorName"),
      keywords: texts("KeywordList > Keyword"),
      pmc,
    };
  } catch {
    return { abstract: "", descriptors: [], keywords: [], pmc: "" };
  }
}

async function meshLookup(term: string, a: string): Promise<string | null> {
  // Exact MeSH-heading match ONLY. A free-text fallback snaps ambiguous fragments to the
  // wrong descriptor (e.g. "percutaneous" → "Percutaneous Coronary Intervention"), so when a
  // term isn't a real heading we keep it verbatim instead of guessing.
  const sr = await requestUrl({
    url: `${EUTILS}/esearch.fcgi?db=mesh&retmode=json&term=${encodeURIComponent(`${term}[MeSH Terms]`)}${a}`,
  });
  const id = sr.json?.esearchresult?.idlist?.[0];
  if (!id) return null;
  const su = await requestUrl({ url: `${EUTILS}/esummary.fcgi?db=mesh&id=${id}&retmode=json${a}` });
  return su.json?.result?.[id]?.ds_meshterms?.[0] || null;
}

/** Snap LLM-suggested terms to official NLM MeSH Descriptor names; keep non-MeSH terms as-is. */
export async function canonicalizeMeshTerms(terms: string[], apiKey?: string, email?: string): Promise<string[]> {
  const a = auth(apiKey, email);
  const out: string[] = [];
  for (const raw of terms) {
    const term = raw.trim();
    if (!term) continue;
    try {
      out.push((await meshLookup(term, a)) || term);
    } catch {
      out.push(term);
    }
  }
  return out;
}

/** efetch a PubMed Central full-text body (open-access articles only). */
export async function fetchPmcFullText(pmc: string, apiKey?: string, email?: string): Promise<string> {
  const a = auth(apiKey, email);
  const numeric = String(pmc).replace(/^PMC/i, "");
  try {
    const res = await requestUrl({
      url: `${EUTILS}/efetch.fcgi?db=pmc&id=${numeric}&retmode=xml${a}`,
    });
    const doc = new DOMParser().parseFromString(res.text, "text/xml");
    doc.querySelectorAll("ref-list, table-wrap, fig").forEach((n) => n.remove());
    const body = doc.querySelector("body");
    const text = (body?.textContent || "").replace(/\s+/g, " ").trim();
    return text.length > 400 ? text : ""; // PMC sometimes returns only a stub record
  } catch {
    return "";
  }
}
