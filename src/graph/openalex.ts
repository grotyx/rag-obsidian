import { requestUrl } from "obsidian";
import { CSLItem } from "../types";
import { str, num, rec, arr } from "../util/json";

const BASE = "https://api.openalex.org";

export interface OAWork {
  openalexId: string; // short, e.g. W2919115771
  doi?: string;
  pmid?: string;
  title: string;
  citedByCount: number;
  referencedWorks: string[]; // short ids
}

export function shortId(url?: string): string {
  return url ? url.replace(/^https?:\/\/openalex\.org\//, "") : "";
}

function withMailto(url: string, mailto: string): string {
  if (!mailto) return url;
  return url + (url.includes("?") ? "&" : "?") + "mailto=" + encodeURIComponent(mailto);
}

/** Strip doi.org/doi: prefixes so the bare DOI can be safely encoded into a URL path. */
export function normalizeDoi(doi: string): string {
  return doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:/i, "");
}

/** Commas and pipes are OpenAlex filter syntax — replace them before embedding a title. */
function sanitizeFilterValue(value: string): string {
  return value.replace(/[,|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Do two titles name the same paper? Exact after normalizing, or one contains the other and the
 *  shorter is at least 90% of the longer ("X: a trial" must not match "X: a trial protocol"). */
export function titlesMatch(a: string, b: string): boolean {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return long.includes(short) && short.length >= 0.9 * long.length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** requestUrl with a single retry after ~1s on 429 (rate limit). */
async function requestRetry429(url: string) {
  let res = await requestUrl({ url, throw: false });
  if (res.status === 429) {
    await sleep(1000);
    res = await requestUrl({ url, throw: false });
  }
  return res;
}

function toWork(w: unknown): OAWork {
  const rw = rec(w);
  const ids = rec(rw.ids);
  return {
    openalexId: shortId(str(rw.id)),
    doi: ids.doi ? str(ids.doi).replace(/^https?:\/\/doi\.org\//, "") : undefined,
    pmid: ids.pmid ? str(ids.pmid).replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//, "") : undefined,
    title: str(rw.title) || str(rw.display_name) || "",
    citedByCount: num(rw.cited_by_count) || 0,
    referencedWorks: arr(rw.referenced_works).map((v) => shortId(str(v))),
  };
}

/** Resolve an OpenAlex work for a CSL item (openalex_id → DOI → PMID → title search). */
export async function resolveWork(item: CSLItem, mailto = ""): Promise<OAWork | null> {
  const oaId = typeof item.openalex_id === "string" ? shortId(item.openalex_id) : "";
  let url: string;
  if (oaId) url = `${BASE}/works/${oaId}`;
  else if (item.DOI) url = `${BASE}/works/https://doi.org/${encodeURIComponent(normalizeDoi(String(item.DOI)))}`;
  else if (item.PMID) url = `${BASE}/works/pmid:${item.PMID}`;
  else if (item.title) {
    const r = await requestRetry429(
      withMailto(
        `${BASE}/works?filter=title.search:${encodeURIComponent(sanitizeFilterValue(String(item.title)))}&per-page=1`,
        mailto
      )
    );
    const rJson: unknown = r.json;
    if (r.status >= 400) throw new Error(`OpenAlex returned ${r.status}`);
    const w = arr(rec(rJson).results)[0];
    if (w === undefined) return null;
    // Guard against a wrong top hit being persisted: titles must match.
    const wRec = rec(w);
    if (!titlesMatch(String(item.title), str(wRec.title) || str(wRec.display_name))) return null;
    return toWork(w);
  } else {
    return null;
  }

  const res = await requestRetry429(withMailto(url, mailto));
  const resJson: unknown = res.json;
  if (res.status === 404) return null;
  if (res.status >= 400) throw new Error(`OpenAlex returned ${res.status}`);
  if (!resJson) return null;
  return toWork(resJson);
}

/** OpenAlex "related_works" for an item → [{id, title, citedByCount}] (best-effort). */
export async function relatedWorks(
  item: CSLItem,
  mailto = ""
): Promise<{ id: string; title: string; citedByCount: number }[]> {
  let url: string;
  const oaId = typeof item.openalex_id === "string" ? shortId(item.openalex_id) : "";
  if (oaId) url = `${BASE}/works/${oaId}`;
  else if (item.DOI) url = `${BASE}/works/https://doi.org/${encodeURIComponent(normalizeDoi(String(item.DOI)))}`;
  else if (item.PMID) url = `${BASE}/works/pmid:${item.PMID}`;
  else return [];
  url += "?select=related_works";
  const res = await requestUrl({ url: withMailto(url, mailto), throw: false });
  const resJson: unknown = res.json;
  const ids = arr(rec(resJson).related_works).map((v) => shortId(str(v)));
  if (!ids.length) return [];
  const titles = await fetchTitles(ids, mailto);
  return ids.map((id) => ({ id, title: titles.get(id)?.title || "", citedByCount: titles.get(id)?.citedByCount || 0 }));
}

/** Fetch titles (and cited-by counts) for a set of OpenAlex ids, batched. */
export async function fetchTitles(
  ids: string[],
  mailto = ""
): Promise<Map<string, { title: string; citedByCount: number }>> {
  const out = new Map<string, { title: string; citedByCount: number }>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const r = await requestUrl({
      url: withMailto(
        `${BASE}/works?filter=openalex_id:${batch.join("|")}&select=id,title,cited_by_count&per-page=50`,
        mailto
      ),
      throw: false,
    });
    const rJson: unknown = r.json;
    for (const w of arr(rec(rJson).results)) {
      const wRec = rec(w);
      out.set(shortId(str(wRec.id)), { title: str(wRec.title), citedByCount: num(wRec.cited_by_count) || 0 });
    }
  }
  return out;
}

/** A later paper that cites a given work, as OpenAlex reports it. */
export interface CitingWork {
  openalexId: string;
  title: string;
  year?: number;
  journal?: string;
  doi?: string;
  pmid?: string;
  /** OpenAlex `is_retracted`. */
  retracted: boolean;
  /** OpenAlex work type — "erratum" / "retraction" flag correction notices. */
  type: string;
  citedByCount: number;
}

/** One `/works?filter=cites:` page → total match count + works (pure; tested offline). */
export function parseCitingPage(json: unknown): { total: number; works: CitingWork[] } {
  const j = rec(json);
  const works = arr(j.results).map((w) => {
    const r = rec(w);
    const base = toWork(w);
    const year = num(r.publication_year);
    const journal = str(rec(rec(r.primary_location).source).display_name);
    return {
      openalexId: base.openalexId,
      title: base.title,
      year: year || undefined,
      journal: journal || undefined,
      doi: base.doi,
      pmid: base.pmid,
      retracted: r.is_retracted === true,
      type: str(r.type),
      citedByCount: base.citedByCount,
    };
  });
  return { total: num(rec(j.meta).count) || works.length, works };
}

/** Papers citing `item`, newest first (OpenAlex `cites:` filter). Only citations OpenAlex has
 *  indexed — a recent paper's references can take weeks to appear. `null` when the work itself
 *  isn't found on OpenAlex. */
export async function citingWorks(
  item: CSLItem,
  opts: { mailto?: string; limit?: number; fromYear?: number } = {}
): Promise<{ work: OAWork; total: number; works: CitingWork[] } | null> {
  const work = await resolveWork(item, opts.mailto ?? "");
  if (!work?.openalexId) return null;
  const filter = `cites:${work.openalexId}` + (opts.fromYear ? `,from_publication_date:${opts.fromYear}-01-01` : "");
  const select = "id,ids,title,display_name,publication_year,primary_location,is_retracted,type,cited_by_count";
  const res = await requestRetry429(
    withMailto(
      `${BASE}/works?filter=${filter}&sort=publication_date:desc&per-page=${opts.limit ?? 25}&select=${select}`,
      opts.mailto ?? ""
    )
  );
  if (res.status >= 400) throw new Error(`OpenAlex returned ${res.status}`);
  return { work, ...parseCitingPage(res.json) };
}
