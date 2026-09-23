/** Narrowing helpers for values read from untyped JSON — API responses (Crossref, PubMed,
 *  OpenAlex, Unpaywall, LLM providers), frontmatter, and third-party objects typed `any`
 *  (pdfjs, Obsidian's `requestUrl().json`). Each mirrors the ad hoc `typeof`/`Array.isArray`
 *  fallback it replaces, so swapping one in changes no runtime behavior. */

export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
