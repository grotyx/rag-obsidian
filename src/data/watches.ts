import type { CSLItem, Watch } from "../types";
import { arr, rec } from "../util/json";

export const WATCH_FOLDER = "Watches";

/** One new paper a watch found. */
export interface WatchRecord {
  title: string;
  author?: string; // first author's family name
  year?: number;
  journal?: string;
  pmid?: string;
  doi?: string;
}

/** What one watch returned in a check; `error` set means the check failed (lastChecked stays). */
export interface WatchResult {
  watch: Pick<Watch, "kind" | "label" | "lastChecked">;
  records: WatchRecord[];
  error?: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A stored `lastChecked` is hand-editable data.json: only a real-looking date reaches a URL. */
export const isWatchDate = (d: unknown): d is string => typeof d === "string" && DATE.test(d);

export function newWatchId(now = Date.now(), rnd = Math.random()): string {
  return now.toString(36) + rnd.toString(36).slice(2, 6);
}

/** The settings list as stored: a hand-edited data.json may hold anything. */
export function validWatches(v: unknown): Watch[] {
  return arr(v).filter((x): x is Watch => {
    const w = rec(x);
    return typeof w.id === "string" && typeof w.label === "string" && (w.kind === "pubmed" || w.kind === "cites") && isWatchDate(w.lastChecked);
  });
}

/** CSL item (PubMed hit) → digest record. */
export function recordFromItem(item: CSLItem): WatchRecord {
  return {
    title: item.title || "(untitled)",
    author: item.author?.[0]?.family || undefined,
    year: item.issued?.["date-parts"]?.[0]?.[0],
    journal: item["container-title"] || undefined,
    pmid: item.PMID ? String(item.PMID) : undefined,
    doi: item.DOI ? String(item.DOI) : undefined,
  };
}

/** Drop what the library already has (`known`) and repeats inside the list (same PMID / DOI / title). */
export function newRecords(records: WatchRecord[], known: (r: WatchRecord) => boolean): WatchRecord[] {
  const seen = new Set<string>();
  return records.filter((r) => {
    const keys = [r.pmid && `pmid:${r.pmid}`, r.doi && `doi:${r.doi.toLowerCase()}`, `t:${r.title.toLowerCase()}`].filter((k): k is string => !!k);
    if (keys.some((k) => seen.has(k)) || known(r)) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  });
}

/** `(` and `)` end a Markdown link early and DOIs may contain them. */
const mdUrl = (u: string): string => u.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20");

/** The link the "Add" handler reads: PMID wins over DOI. Null when the record has neither. */
export function addLink(r: WatchRecord): string | null {
  const id = r.pmid || r.doi;
  return id ? mdUrl(`obsidian://refwright-add?id=${encodeURIComponent(id)}`) : null;
}

function recordLine(r: WatchRecord): string {
  const meta = [r.author, r.year, r.journal].filter((x) => x !== undefined && x !== "").join(", ");
  const add = addLink(r);
  const links = [
    r.pmid && `[PMID ${r.pmid}](https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(r.pmid)}/)`,
    r.doi && `[DOI](${mdUrl(`https://doi.org/${r.doi}`)})`,
    add && `[Add](${add})`,
  ].filter(Boolean);
  return `- **${r.title.replace(/\s+/g, " ")}**${meta ? ` — ${meta}` : ""}${links.length ? ` · ${links.join(" · ")}` : ""}`;
}

/** One `##` section per watch: its new records, "nothing new", or the failure. */
export function watchSection(r: WatchResult): string {
  const head = `## ${r.watch.label} (${r.watch.kind === "pubmed" ? "PubMed" : "citing"}, since ${r.watch.lastChecked})`;
  if (r.error !== undefined) return `${head}\n\nCheck failed: ${r.error}. It will be retried next time.\n`;
  if (!r.records.length) return `${head}\n\nNothing new.\n`;
  return `${head}\n\n${r.records.map(recordLine).join("\n")}\n`;
}

/** The two lookups a check needs; the command wires the real PubMed / OpenAlex clients. */
export interface WatchDeps {
  pubmed(query: string, since: string, until: string): Promise<CSLItem[]>;
  citing(openalexId: string, since: string): Promise<WatchRecord[]>;
}

/** Run one watch. Never throws: a failure comes back as `error` so the others still run. */
export async function runWatch(w: Watch, today: string, deps: WatchDeps): Promise<WatchResult> {
  const watch = { kind: w.kind, label: w.label, lastChecked: w.lastChecked };
  try {
    if (w.kind === "pubmed") {
      if (!w.query?.trim()) throw new Error("the watch has no query");
      return { watch, records: (await deps.pubmed(w.query, w.lastChecked, today)).map(recordFromItem) };
    }
    if (!w.openalexId) throw new Error("the watch has no OpenAlex id");
    return { watch, records: await deps.citing(w.openalexId, w.lastChecked) };
  } catch (e) {
    return { watch, records: [], error: e instanceof Error ? e.message : String(e) };
  }
}

/** `Watches/Digest <date>.md` content: a new note, or `existing` with the new sections appended
 *  (a second check on the same day). */
export function digestNote(existing: string | null, date: string, results: WatchResult[]): string {
  const body = results.map(watchSection).join("\n");
  if (existing !== null) return `${existing.trimEnd()}\n\n${body}`;
  return `---\ntype: watch-digest\ndate: ${date}\n---\n\n# Literature watches ${date}\n\nRecords already in the library are left out. A paper found before may reappear on the day after the last check; add it, or ignore it.\n\n${body}`;
}
