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
    if (r.status >= 400 || !rJson) return null;
    const w = arr(rec(rJson).results)[0];
    if (w === undefined) return null;
    // Guard against a wrong top hit being persisted: titles must match.
    const want = normalizeTitle(String(item.title));
    const wRec = rec(w);
    const got = normalizeTitle(str(wRec.title) || str(wRec.display_name));
    if (!want || !got || (want !== got && !want.includes(got) && !got.includes(want))) return null;
    return toWork(w);
  } else {
    return null;
  }

  const res = await requestRetry429(withMailto(url, mailto));
  const resJson: unknown = res.json;
  if (res.status >= 400 || !resJson) return null;
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
