import { requestUrl } from "obsidian";
import { normalizeDoi, shortId } from "../graph/openalex";
import { CSLItem } from "../types";
import { rec, str } from "../util/json";

const OPENALEX = "https://api.openalex.org";

export interface RetractionResult {
  retracted: boolean;
  source: string;
}

/** Check whether a work is retracted, via OpenAlex `is_retracted` (by OpenAlex id, else DOI,
 *  else PMID — same priority as `graph/openalex.ts` resolveWork). */
export async function checkRetraction(item: CSLItem, mailto = ""): Promise<RetractionResult | null> {
  const oaId = typeof item.openalex_id === "string" ? shortId(item.openalex_id) : "";
  let url: string;
  if (oaId) url = `${OPENALEX}/works/${oaId}`;
  else if (item.DOI) url = `${OPENALEX}/works/https://doi.org/${encodeURIComponent(normalizeDoi(String(item.DOI)))}`;
  else if (item.PMID) url = `${OPENALEX}/works/pmid:${item.PMID}`;
  else return null;
  url += "?select=is_retracted,title" + (mailto ? `&mailto=${encodeURIComponent(mailto)}` : "");
  const res = await requestUrl({ url, throw: false });
  if (res.status >= 400 || !res.json) return null;
  const j = rec(res.json);
  // Publishers retitle withdrawn papers "RETRACTED: …" / "Retracted article: …"; a paper *about*
  // retractions ("Retracted publications in spine surgery") must not match.
  const retracted = !!j.is_retracted || /^\s*retracted(\s+article)?:/i.test(str(j.title));
  return { retracted, source: "openalex" };
}
