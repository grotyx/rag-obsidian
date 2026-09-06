import { requestUrl } from "obsidian";
import { normalizeDoi } from "../graph/openalex";
import { CSLItem } from "../types";

const OPENALEX = "https://api.openalex.org";

export interface RetractionResult {
  retracted: boolean;
  source: string;
}

/** Check whether a work is retracted, via OpenAlex `is_retracted` (by DOI, else PMID). */
export async function checkRetraction(item: CSLItem, mailto = ""): Promise<RetractionResult | null> {
  let url: string;
  if (item.DOI) url = `${OPENALEX}/works/https://doi.org/${encodeURIComponent(normalizeDoi(String(item.DOI)))}`;
  else if (item.PMID) url = `${OPENALEX}/works/pmid:${item.PMID}`;
  else return null;
  url += "?select=is_retracted,title" + (mailto ? `&mailto=${encodeURIComponent(mailto)}` : "");
  const res = await requestUrl({ url, throw: false });
  if (res.status >= 400 || !res.json) return null;
  // Publishers retitle withdrawn papers "RETRACTED: …" / "Retracted article: …"; a paper *about*
  // retractions ("Retracted publications in spine surgery") must not match.
  const retracted = !!res.json.is_retracted || /^\s*retracted(\s+article)?:/i.test(String(res.json.title || ""));
  return { retracted, source: "openalex" };
}
