import { normalizeQuote } from "./findings";

/** Where a finding's quote sits in a PDF. Pure: the pages come from `extractPdfPages`. */

/** `normalizeQuote` once per page, so a run over many findings doesn't re-normalize the PDF each time. */
export function normalizePages(pages: string[]): string[] {
  return pages.map(normalizeQuote);
}

/** 1-based page holding `quote` (compared after `normalizeQuote`), or null. A page on its own wins;
 *  failing that, a quote that runs over a page break is reported on the page it starts on. */
export function locateQuote(quote: string, normPages: string[]): number | null {
  const q = normalizeQuote(quote);
  if (!q) return null;
  const at = normPages.findIndex((p) => p.includes(q));
  if (at >= 0) return at + 1;
  for (let i = 0; i + 1 < normPages.length; i++) {
    if (`${normPages[i]} ${normPages[i + 1]}`.includes(q)) return i + 1;
  }
  return null;
}

/** Wikilink that opens `pdfPath` at `page` (Obsidian's `#page=N` subpath). */
export function pageLink(pdfPath: string, page: number, label = `p. ${page}`): string {
  return `[[${pdfPath}#page=${page}|${label}]]`;
}
