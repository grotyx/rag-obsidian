import { requestUrl } from "obsidian";

export interface OAResult {
  isOA: boolean;
  pdfUrl?: string;
  landingUrl?: string;
  license?: string;
  version?: string; // publishedVersion / acceptedVersion / submittedVersion
}

/** Look up an open-access copy of a DOI via Unpaywall (requires a contact email). */
export async function findOpenAccess(doi: string, email: string): Promise<OAResult | null> {
  const clean = doi.replace(/^https?:\/\/doi\.org\//, "").trim();
  if (!clean) return null;
  const mail = email || "anonymous@example.com";
  const res = await requestUrl({
    url: `https://api.unpaywall.org/v2/${encodeURIComponent(clean)}?email=${encodeURIComponent(mail)}`,
    throw: false,
  });
  if (res.status >= 400 || !res.json) return null;
  const j = res.json;
  const best = j.best_oa_location;
  return {
    isOA: !!j.is_oa,
    pdfUrl: best?.url_for_pdf || undefined,
    landingUrl: best?.url_for_landing_page || best?.url || undefined,
    license: best?.license || undefined,
    version: best?.version || undefined,
  };
}
