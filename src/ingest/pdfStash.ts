/** The one writer of the extracted-PDF-text stash: the `## Full text (extracted)` section the
 *  indexer chunks along with the abstract and the note body. PDF import, "Index linked PDFs"
 *  and the OA download all append through here so the marker and the cap stay in one place. */

export const STASH_MARKER = "## Full text (extracted)";

/** Roughly a book chapter — the same ceiling `extractPdfText` stops reading at. */
export const STASH_MAX_CHARS = 200000;

export function hasStashedText(body: string): boolean {
  return body.includes(STASH_MARKER);
}

/** Append `text` under the marker. Idempotent: a body that already carries the section comes
 *  back untouched, so re-running a command never duplicates the full text. */
export function appendStash(body: string, text: string, maxChars: number = STASH_MAX_CHARS): string {
  if (hasStashedText(body)) return body;
  const clean = text.trim();
  if (!clean) return body;
  const cut = clean.length > maxChars;
  const kept = cut ? `${clean.slice(0, maxChars).trimEnd()}\n\n…[truncated]` : clean;
  return `${body.replace(/\s*$/, "")}\n\n${STASH_MARKER}\n\n${kept}\n`;
}

/** `pdf:` frontmatter → a linkpath for `metadataCache.getFirstLinkpathDest`.
 *  `[[folder/a.pdf|alias]]` → `folder/a.pdf`, `[[a.pdf#page=3]]` → `a.pdf`; anything that is
 *  not a .pdf → null. */
export function resolvePdfLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const wiki = value.trim().match(/^\[\[([\s\S]+)\]\]$/);
  const path = (wiki ? wiki[1] : value).split("|")[0].split("#")[0].trim();
  return path && /\.pdf$/i.test(path) ? path : null;
}
