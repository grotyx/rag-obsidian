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
  const j = res.json;
  const best = j.best_oa_location;
  // `best_oa_location` often has only a landing page (for PLOS it is just the DOI link) while a
  // repository copy in `oa_locations` carries the actual PDF — scan them all before giving up.
  const locations = [best, ...(Array.isArray(j.oa_locations) ? j.oa_locations : [])].filter(Boolean);
  const withPdf = locations.find((l: { url_for_pdf?: string }) => l.url_for_pdf);
  return {
    isOA: !!j.is_oa,
    pdfUrl: withPdf?.url_for_pdf || undefined,
    landingUrl: best?.url_for_landing_page || best?.url || undefined,
    license: best?.license || undefined,
    version: best?.version || withPdf?.version || undefined,
  };
}
