import { detectId } from "../ingest/metadata";

/** `?id=` of an `obsidian://refwright-add` link → a clean identifier for the Add modal, or null.
 *  Any web page can fire this link, so the value is capped, stripped of control characters and
 *  must be a recognised DOI / PMID / arXiv / OpenAlex id (a URL carrying one is reduced to it). */
export function captureId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!s || s.length > 300) return null;
  const id = detectId(s);
  switch (id.kind) {
    case "doi": return id.value;
    case "pmid": return `pmid:${id.value}`;
    case "arxiv": return `arxiv:${id.value}`;
    case "openalex": return id.value;
    default: return null;
  }
}

export const MAX_PDF_BYTES = 200 * 1024 * 1024;

/** `PDFs/<name>.pdf`, then `PDFs/<name> 1.pdf`, … — the first path `exists` says is free. */
export function uniquePath(dir: string, base: string, ext: string, exists: (p: string) => boolean): string {
  let p = `${dir}/${base}.${ext}`;
  for (let n = 1; exists(p); n++) p = `${dir}/${base} ${n}.${ext}`;
  return p;
}
