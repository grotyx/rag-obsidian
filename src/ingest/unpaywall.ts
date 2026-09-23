import { requestUrl } from "obsidian";
import { arr, rec, str } from "../util/json";

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
  // Unpaywall answers 422 ("Please use your own email address") to placeholder addresses, so
  // the old `anonymous@example.com` fallback failed every lookup and the caller reported
  // "No open-access copy found" — wrong, and it hid the one thing the user had to fix.
  const mail = email.trim();
  if (!mail || /@example\.(com|org|net)$/i.test(mail)) {
    throw new Error('Unpaywall needs your contact e-mail — set "Contact e-mail" in the plugin settings.');
  }
  const res = await requestUrl({
    url: `https://api.unpaywall.org/v2/${encodeURIComponent(clean)}?email=${encodeURIComponent(mail)}`,
    throw: false,
  });
  if (res.status >= 400 || !res.json) return null;
  const j = rec(res.json);
  const best = rec(j.best_oa_location);
  // `best_oa_location` often has only a landing page (for PLOS it is just the DOI link) while a
  // repository copy in `oa_locations` carries the actual PDF — scan them all before giving up.
  const locations = [j.best_oa_location, ...arr(j.oa_locations)].filter(Boolean).map(rec);
  const withPdf = locations.find((l) => str(l.url_for_pdf));
  return {
    isOA: !!j.is_oa,
    pdfUrl: str(withPdf?.url_for_pdf) || undefined,
    landingUrl: str(best.url_for_landing_page) || str(best.url) || undefined,
    license: str(best.license) || undefined,
    version: str(best.version) || str(withPdf?.version) || undefined,
  };
}
