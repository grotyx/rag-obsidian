import { normalizePath, stringifyYaml } from "obsidian";
import { numLike, rec, str } from "../util/json";

/** One PubMed (or other database) search run a researcher acted on — PRISMA-S asks for the exact
 *  query, the date and the filters so the search can be repeated. */
export interface SearchLogEntry {
  source: string; // "PubMed"
  query: string;
  year_from?: number;
  year_to?: number;
  date: string; // ISO timestamp
  total: number; // matches the database reported
  returnedPmids: string[];
  importedPmids: string[];
}

export const SEARCH_LOG_FOLDER = "Searches";

const pad = (n: number): string => String(n).padStart(2, "0");

/** Filename-safe, whitespace-collapsed, at most `max` chars. */
function safeName(s: string, max: number): string {
  return s
    .replace(/[\\/:*?"<>|#^[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim()
    .replace(/[. ]+$/, "");
}

/** `Searches/2026-11-03 1405 PubMed - <query>.md` plus the note body. Local time, like the dates
 *  `localDate` gives elsewhere. */
export function searchLogNote(e: SearchLogEntry): { path: string; content: string } {
  const d = new Date(e.date);
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
  const name = safeName(e.query, 60) || "search";
  const path = normalizePath(`${SEARCH_LOG_FOLDER}/${stamp} ${safeName(e.source, 30) || "Search"} - ${name}.md`);

  const fm: Record<string, unknown> = { type: "search-log", source: e.source, query: e.query, date: e.date };
  if (e.year_from !== undefined) fm.year_from = e.year_from;
  if (e.year_to !== undefined) fm.year_to = e.year_to;
  fm.total = e.total;
  fm.returned = e.returnedPmids.length;
  fm.imported = e.importedPmids.length;

  const filters =
    e.year_from === undefined && e.year_to === undefined
      ? "none"
      : `publication year ${e.year_from ?? "any"} to ${e.year_to ?? "any"}`;
  const imported = e.importedPmids.length
    ? e.importedPmids.map((p) => `- [PMID ${p}](https://pubmed.ncbi.nlm.nih.gov/${p}/)`).join("\n")
    : "(none)";
  const fence = e.query.includes("```") ? "~~~~" : "```";

  const content = [
    "---",
    stringifyYaml(fm).trimEnd(),
    "---",
    "",
    `# ${e.source} search, ${stamp}`,
    "",
    "## Query",
    "",
    fence,
    e.query,
    fence,
    "",
    `- Date: ${e.date}`,
    `- Filters: ${filters}`,
    `- Matches reported by ${e.source}: ${e.total}`,
    `- Records returned: ${e.returnedPmids.length}`,
    `- Records imported: ${e.importedPmids.length}`,
    "",
    "## Imported",
    "",
    imported,
    "",
    "## Returned PMIDs",
    "",
    e.returnedPmids.join(", ") || "(none)",
    "",
  ].join("\n");
  return { path, content };
}

/** `Searches/x.md` -> `Searches/x 2.md` for n >= 2. */
export function suffixedPath(path: string, n: number): string {
  return n < 2 ? path : path.replace(/\.md$/, ` ${n}.md`);
}

export interface SearchLogSummary {
  source: string;
  date: string;
  query: string;
  year_from?: number;
  year_to?: number;
  total: number;
}

/** A search-log note's frontmatter -> summary, or null when the note is not a search log. */
export function parseSearchLog(fm: unknown): SearchLogSummary | null {
  const r = rec(fm);
  if (r.type !== "search-log") return null;
  return {
    source: str(r.source) || "Unknown",
    date: str(r.date),
    query: str(r.query),
    year_from: numLike(r.year_from),
    year_to: numLike(r.year_to),
    total: numLike(r.total) ?? 0,
  };
}

/** The logs that count toward totals: within a source, a search repeated with the same normalized
 *  query (trimmed, lowercase, whitespace collapsed) and year filters counts once — the most recent
 *  run (ties: the later one in the list). */
export function countedSearchLogs(logs: SearchLogSummary[]): Set<SearchLogSummary> {
  const latest = new Map<string, SearchLogSummary>();
  for (const l of logs) {
    const key = JSON.stringify([l.source, l.query.trim().toLowerCase().replace(/\s+/g, " "), l.year_from ?? null, l.year_to ?? null]);
    const prev = latest.get(key);
    if (!prev || l.date >= prev.date) latest.set(key, l);
  }
  return new Set(latest.values());
}

/** Sum of `total` per source, in first-seen order; a repeated search counts once. */
export function searchLogTotals(logs: SearchLogSummary[]): { source: string; total: number }[] {
  const counted = countedSearchLogs(logs);
  const by = new Map<string, number>();
  for (const l of logs) by.set(l.source, (by.get(l.source) ?? 0) + (counted.has(l) ? l.total : 0));
  return [...by].map(([source, total]) => ({ source, total }));
}
