import { requestUrl } from "obsidian";
import { keywordsToTags } from "../data/reference";
import { splitName, parsePubDate } from "./metadata";
import { CSLItem } from "../types";
import { ncbiGate } from "./ncbi";
import { parseMeshList } from "./summarize";
import { str, rec, arr } from "../util/json";

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

/** esearch -> PMIDs -> esummary -> parsed CSL metadata (+ PMC id when present), alongside
 *  esearch's total match count so a caller can tell a capped page from the whole result set. */
export async function searchPubmedPage(query: string, opts: PubmedSearchOpts = {}): Promise<{ hits: PubmedHit[]; total: number }> {
  const n = opts.n ?? 8;
  const a = auth(opts.apiKey, opts.email);

  let url = `${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=${n}` +
    `&term=${encodeURIComponent(query)}${a}`;
  if (opts.from) url += `&mindate=${opts.from}&datetype=pdat`;
  if (opts.to) url += `&maxdate=${opts.to}&datetype=pdat`;

  await ncbiGate(!!opts.apiKey);
  const sr = await requestUrl({ url });
  const srJson: unknown = sr.json;
  const esearchresult = rec(srJson).esearchresult;
  const pmids = arr(rec(esearchresult).idlist).map((v) => str(v));
  const total = Number(str(rec(esearchresult).count)) || 0;
  if (!pmids.length) return { hits: [], total };

  await ncbiGate(!!opts.apiKey);
  const sum = await requestUrl({
    url: `${EUTILS}/esummary.fcgi?db=pubmed&retmode=json&id=${pmids.join(",")}${a}`,
  });
  const sumJson: unknown = sum.json;
  const result = rec(rec(sumJson).result);
  const uidsField = result.uids;
  const uids = uidsField === undefined || uidsField === null ? pmids : arr(uidsField).map((v) => str(v));

  const hits: PubmedHit[] = [];
  for (const uid of uids) {
    const dRaw = result[uid];
    if (dRaw === undefined || dRaw === null) continue;
    const d = rec(dRaw);
    if (d.error) continue;
    const ids = arr(d.articleids).map((x) => rec(x));
    const doi = str(ids.find((x) => x.idtype === "doi")?.value);
    const pmc = str(ids.find((x) => x.idtype === "pmc")?.value);
    const authors = arr(d.authors)
      .filter((au) => {
        const a2 = rec(au);
        return !a2.authtype || a2.authtype === "Author";
      })
      .map((au) => splitName(str(rec(au).name)));
    const item: CSLItem = {
      type: "article-journal",
      title: str(d.title).replace(/\s+/g, " ").trim(),
      author: authors,
      "container-title": str(d.fulljournalname) || str(d.source) || "",
      "container-title-short": str(d.source) || undefined,
      volume: str(d.volume) || undefined,
      issue: str(d.issue) || undefined,
      page: str(d.pages) || undefined,
      DOI: doi || undefined,
      PMID: uid,
      issued: parsePubDate(typeof d.pubdate === "string" ? d.pubdate : undefined),
    };
    hits.push({ pmid: uid, pmc, item });
  }
  return { hits, total };
}

/** Thin wrapper over `searchPubmedPage` for callers that only need the hits (the PubMed search
 *  modal, tests) — kept so the total-count plumbing doesn't ripple past the MCP tool that needs it. */
export async function searchPubmed(query: string, opts: PubmedSearchOpts = {}): Promise<PubmedHit[]> {
  return (await searchPubmedPage(query, opts)).hits;
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
    await ncbiGate(!!apiKey);
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
    // Scoped to the article's own id list, a direct child of PubmedData — efetch's XML also
    // carries each *cited reference*'s ArticleIdList inside PubmedData > ReferenceList > Reference,
    // and an unscoped `querySelectorAll("ArticleId")` picks up the first pmc id anywhere in
    // document order, including a reference's. An article with no PMC of its own but whose
    // first-listed reference happens to have one would silently return that reference's full
    // text as if it were the article's — confirmed live (PMID 39261320, no PMC, first reference
    // with one is PMC9002063 — a different paper entirely — and that's exactly what came back).
    const pmc =
      Array.from(doc.querySelectorAll("PubmedData > ArticleIdList > ArticleId"))
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

async function meshLookup(term: string, a: string, hasKey: boolean): Promise<string | null> {
  // Exact MeSH-heading match ONLY. A free-text fallback snaps ambiguous fragments to the
  // wrong descriptor (e.g. "percutaneous" → "Percutaneous Coronary Intervention"), so when a
  // term isn't a real heading we keep it verbatim instead of guessing.
  await ncbiGate(hasKey);
  const sr = await requestUrl({
    url: `${EUTILS}/esearch.fcgi?db=mesh&retmode=json&term=${encodeURIComponent(`${term}[MeSH Terms]`)}${a}`,
  });
  // A 429 must surface as an error, not as "no such heading": the caller only caches verdicts.
  if (sr.status >= 400) throw new Error(`MeSH lookup failed (HTTP ${sr.status})`);
  const srJson: unknown = sr.json;
  const id = str(arr(rec(rec(srJson).esearchresult).idlist)[0]);
  if (!id) return null;
  await ncbiGate(hasKey);
  const su = await requestUrl({ url: `${EUTILS}/esummary.fcgi?db=mesh&id=${id}&retmode=json${a}` });
  if (su.status >= 400) throw new Error(`MeSH lookup failed (HTTP ${su.status})`);
  const suJson: unknown = su.json;
  const entry = rec(rec(rec(suJson).result)[id]);
  return str(arr(entry.ds_meshterms)[0]) || null;
}

/** Snap LLM-suggested terms to official NLM MeSH Descriptor names; keep non-MeSH terms as-is. */
/** Headings repeat constantly across a batch — the same "Lumbar Vertebrae" for every paper in a
 *  spine search — and each miss costs two gated round-trips, so remember what NLM answered. */
const meshCache = new Map<string, string | null>();

async function canonicalizeMeshTerms(
  terms: string[],
  apiKey?: string,
  email?: string,
  opts: { dropUnmatched?: boolean; splitFallback?: boolean; unverified?: string[] } = {}
): Promise<string[]> {
  const a = auth(apiKey, email);
  const hasKey = !!apiKey;
  // null = NLM answered "not a heading"; undefined = we could not ask (429, offline). Only a
  // real verdict is cached — a transient failure must not strip tags for the rest of the session.
  const lookup = async (term: string): Promise<string | null | undefined> => {
    const key = term.toLowerCase();
    const cached = meshCache.get(key);
    if (cached !== undefined) return cached;
    try {
      const hit = await meshLookup(term, a, hasKey);
      meshCache.set(key, hit);
      return hit;
    } catch {
      return undefined;
    }
  };

  const out: string[] = [];
  for (const raw of terms) {
    const term = raw.trim();
    if (!term) continue;
    const hit = await lookup(term);
    if (hit) {
      out.push(hit);
      continue;
    }
    if (hit === undefined) {
      // Unverifiable, not unknown: keep the term whole as a tag rather than drop it, and report
      // it so the caller never records it as a canonical heading. Not splitting keeps an inverted
      // heading ("Decompression, Surgical") intact for the verified split on a later run.
      out.push(term);
      opts.unverified?.push(term);
      continue;
    }
    // The line was not a heading on its own. It may still be a comma-separated list from a model
    // that ignored "one per line" — but it may equally be an inverted heading the database simply
    // does not carry, so let the database decide each piece rather than assuming either shape.
    if (opts.splitFallback && term.includes(",")) {
      let matched = false;
      for (const piece of term.split(",").map((p) => p.trim())) {
        if (!piece) continue;
        const pieceHit = await lookup(piece);
        if (pieceHit) {
          out.push(pieceHit);
          matched = true;
        }
      }
      if (matched) continue;
    }
    // Model-suggested terms are dropped when the database does not know them; PubMed's own
    // descriptors are never routed through here, so nothing authoritative is lost.
    if (!opts.dropUnmatched) out.push(term);
  }
  return out;
}

/** efetch a PubMed Central full-text body (open-access articles only). */
export async function fetchPmcFullText(pmc: string, apiKey?: string, email?: string): Promise<string> {
  const a = auth(apiKey, email);
  const numeric = String(pmc).replace(/^PMC/i, "");
  try {
    await ncbiGate(!!apiKey);
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

/** A note should carry enough topic tags for the graph view to cluster it. PubMed's own MeSH
 *  is authoritative but thin (or absent) on recent papers, so the summary's MeSH suggestions
 *  top it up — snapped to official NLM headings first, never invented. */
export const MIN_TAGS = 5;

/** Build a note's tags: real MeSH headings first, topped up from the summary's MeSH line when
 *  PubMed has fewer than `MIN_TAGS`, with author keywords appended last. */
export async function buildTags(opts: {
  descriptors: string[];
  keywords: string[];
  meshFromSummary?: string;
  apiKey?: string;
  email?: string;
}): Promise<string[]> {
  return (await buildTagsWithMesh(opts)).tags;
}

/** Same as `buildTags`, but also hands back the canonical headings that survived the tag pass —
 *  the note stores them (`mesh_terms`) so a later backfill need not re-ask the model for them. */
export async function buildTagsWithMesh(opts: {
  descriptors: string[];
  keywords: string[];
  meshFromSummary?: string;
  apiKey?: string;
  email?: string;
}): Promise<{ tags: string[]; mesh: string[] }> {
  // Count what actually lands on the note: keywordsToTags drops blanket headings such as
  // "Humans", so five descriptors can still leave four tags.
  const tags = keywordsToTags([...opts.descriptors, ...opts.keywords]);
  if (tags.length >= MIN_TAGS || !opts.meshFromSummary) return { tags, mesh: [] };

  // Parse here, not at the call site, so every caller is covered — and verify each candidate
  // against the MeSH database rather than pattern-matching prose: a heading the database does
  // not recognise is dropped, so a chatty reply cannot reach the note's frontmatter.
  const suggested = parseMeshList(opts.meshFromSummary);
  if (!suggested.length) return { tags, mesh: [] };
  const unverified: string[] = [];
  const canon = await canonicalizeMeshTerms(suggested, opts.apiKey, opts.email, {
    dropUnmatched: true,
    splitFallback: true,
    unverified,
  });
  const all = keywordsToTags([...opts.descriptors, ...canon, ...opts.keywords]);
  // Only the headings that actually reached the note: a blanket term such as "Humans" is
  // dropped by keywordsToTags, and storing it would re-suggest a tag that never lands. A term
  // NLM could not be asked about stays a tag but is not a heading — `mesh_terms` is what the
  // fill-gaps command trusts without re-checking.
  const mesh = canon.filter((m) => {
    if (unverified.includes(m)) return false;
    const [slug] = keywordsToTags([m]);
    return !!slug && all.includes(slug);
  });
  return { tags: all, mesh };
}
