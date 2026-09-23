/** Text filter + sort for the Library pane, pulled out of LibraryView.ts so it's testable
 *  without a vault (see data/pdfMatch.ts for the same pattern). Obsidian-free — only a
 *  type-only import of RefEntry. */
import type { RefEntry } from "../data/library";

export type SortKey = "year-desc" | "year-asc" | "title-asc" | "author-asc" | "cited-desc" | "added-desc";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "year-desc", label: "Newest year" },
  { key: "year-asc", label: "Oldest year" },
  { key: "title-asc", label: "Title A–Z" },
  { key: "author-asc", label: "First author A–Z" },
  { key: "cited-desc", label: "Most cited" },
  { key: "added-desc", label: "Recently added" },
];

export interface QuickFilters {
  hasPdf?: boolean;
  noPdf?: boolean;
  unread?: boolean;
  retracted?: boolean;
}

export interface FilterOptions {
  text: string;
  sort: SortKey;
  chips: QuickFilters;
}

function isEmpty(v: string | number | undefined): boolean {
  return v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));
}

/** null when both values are present and the caller should compare them directly; otherwise
 *  the verdict that puts whichever side is missing last, for either sort direction. */
function missingLast(a: string | number | undefined, b: string | number | undefined): number | null {
  const aMissing = isEmpty(a);
  const bMissing = isEmpty(b);
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return null;
}

const SORTERS: Record<SortKey, (a: RefEntry, b: RefEntry) => number> = {
  "year-desc": (a, b) => missingLast(a.year, b.year) ?? b.year.localeCompare(a.year),
  "year-asc": (a, b) => missingLast(a.year, b.year) ?? a.year.localeCompare(b.year),
  "title-asc": (a, b) => missingLast(a.title, b.title) ?? a.title.localeCompare(b.title),
  "author-asc": (a, b) => missingLast(a.authors, b.authors) ?? a.authors.localeCompare(b.authors),
  "cited-desc": (a, b) => missingLast(a.citedBy, b.citedBy) ?? b.citedBy! - a.citedBy!,
  "added-desc": (a, b) => missingLast(a.added, b.added) ?? b.added!.localeCompare(a.added!),
};

/** Text filter (title/authors/year/citekey/journal, case-insensitive) → quick-filter chips
 *  (AND'd together) → sort. Pure, so LibraryView just calls this on every keystroke/toggle. */
export function filterAndSort(entries: RefEntry[], opts: FilterOptions): RefEntry[] {
  const text = opts.text.trim().toLowerCase();
  const { chips } = opts;
  const out = entries.filter((e) => {
    if (text) {
      const hay = `${e.title} ${e.authors} ${e.year} ${e.citekey} ${e.journal ?? ""}`.toLowerCase();
      if (!hay.includes(text)) return false;
    }
    if (chips.hasPdf && !e.hasPdf) return false;
    if (chips.noPdf && e.hasPdf) return false;
    if (chips.unread && e.status && e.status.toLowerCase() !== "unread") return false;
    if (chips.retracted && !e.retracted) return false;
    return true;
  });
  return out.sort(SORTERS[opts.sort]);
}
