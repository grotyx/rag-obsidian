/** Match a PDF file (from a folder of arbitrary-named downloads) to a library reference, without
 *  touching the vault or the network. Pure logic so it is cheap to unit-test.
 *
 *  `head` must already be sliced to the PDF's opening text (~4000 chars) by the caller — a
 *  reference list further into the paper names *other* papers' titles/DOIs, and matching against
 *  the whole document produced a real false positive. The slice is re-enforced here too, so a
 *  caller that forgets still gets the safe behavior. */

export interface PdfCandidate {
  citekey: string;
  DOI?: string;
  PMID?: string;
  title?: string;
  year?: number;
}

export type PdfMatch = { citekey: string; by: "name" | "doi" | "pmid" | "title" };

const HEAD_CHARS = 4000;

/** Same normalization as `data/library.ts`'s `normDoi`, kept local so this module stays
 *  obsidian-free: lowercase, strip a doi.org URL / "doi:" prefix, and trailing punctuation a
 *  paste from a reference list tends to carry. */
function normDoi(d: string | undefined): string {
  return (d || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "")
    .replace(/[.,;:)\]]+$/, "");
}

function normTitle(t: string | undefined): string {
  return (t || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const DOI_RE = /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;
const PMID_RE = /PMID:?\s*(\d{6,9})/i;

export function matchPdf(fileBase: string, head: string | null, candidates: PdfCandidate[]): PdfMatch | null {
  const sliced = head == null ? null : head.slice(0, HEAD_CHARS);

  // 1. Filename equals a citekey.
  const nameHit = candidates.find((c) => c.citekey.toLowerCase() === fileBase.toLowerCase());
  if (nameHit) return { citekey: nameHit.citekey, by: "name" };

  if (!sliced) return null;

  // 2. DOI in the head text.
  const doiFound = normDoi(sliced.match(DOI_RE)?.[0]);
  if (doiFound) {
    const doiHit = candidates.find((c) => c.DOI && normDoi(c.DOI) === doiFound);
    if (doiHit) return { citekey: doiHit.citekey, by: "doi" };
  }

  // 3. PMID in the head text.
  const pmidFound = sliced.match(PMID_RE)?.[1];
  if (pmidFound) {
    const pmidHit = candidates.find((c) => c.PMID && c.PMID === pmidFound);
    if (pmidHit) return { citekey: pmidHit.citekey, by: "pmid" };
  }

  // 4. Title contained in the head text, with the year as a tiebreaker guard. Ambiguous (more
  //    than one candidate matches) → null rather than guessing.
  const normHead = normTitle(sliced);
  const titleHits = candidates.filter((c) => {
    const t = normTitle(c.title);
    if (t.length < 25 || !normHead.includes(t)) return false;
    return c.year == null || new RegExp(`\\b${c.year}\\b`).test(sliced);
  });
  if (titleHits.length === 1) return { citekey: titleHits[0].citekey, by: "title" };

  return null;
}
