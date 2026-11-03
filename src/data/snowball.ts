/** Pure aggregation behind "Snowball from included records": per OpenAlex work, which included
 *  records point to it (backward) and which it points to (forward), ranked for screening. */

/** A work the lookups returned; backward ids arrive without a title. */
export interface SnowballWork {
  id: string; // short OpenAlex id, e.g. W2919115771
  title?: string;
  year?: number;
  doi?: string;
  pmid?: string;
}

/** What the two OpenAlex lookups returned for one included record. */
export interface SnowballRecord {
  citekey: string;
  /** The record's own OpenAlex id (never offered as a candidate). */
  selfId: string;
  /** Works the record references (backward). */
  referenced: string[];
  /** Works that cite the record (forward). */
  citing: SnowballWork[];
}

export interface SnowballCandidate extends SnowballWork {
  /** Citekeys of included records that reference this work. */
  citedBy: string[];
  /** Citekeys of included records this work cites. */
  cites: string[];
}

const links = (c: SnowballCandidate): number => c.citedBy.length + c.cites.length;

/** Candidates ranked by total links, then newest first (unknown year last). `known` says a work is
 *  already in the library; included records themselves are dropped by id. */
export function aggregateSnowball(
  records: SnowballRecord[],
  known: (w: SnowballWork) => boolean
): SnowballCandidate[] {
  const selfIds = new Set(records.map((r) => r.selfId).filter(Boolean));
  const byId = new Map<string, SnowballCandidate>();
  const get = (w: SnowballWork): SnowballCandidate => {
    let c = byId.get(w.id);
    if (!c) byId.set(w.id, (c = { id: w.id, citedBy: [], cites: [] }));
    // forward results carry metadata, backward ones do not: keep whatever is known
    c.title ||= w.title;
    c.year ??= w.year;
    c.doi ||= w.doi;
    c.pmid ||= w.pmid;
    return c;
  };
  const add = (list: string[], key: string): void => void (list.includes(key) || list.push(key));
  for (const r of records) {
    for (const id of r.referenced) if (id && !selfIds.has(id)) add(get({ id }).citedBy, r.citekey);
    for (const w of r.citing) if (w.id && !selfIds.has(w.id)) add(get(w).cites, r.citekey);
  }
  return [...byId.values()]
    .filter((c) => !known(c))
    .sort((a, b) => links(b) - links(a) || (b.year ?? 0) - (a.year ?? 0) || a.id.localeCompare(b.id));
}

export const SNOWBALL_TOP = 200;
/** Most untitled ids looked up while refilling the list. */
export const SNOWBALL_LOOKUP_MAX = 1000;
const BATCH = 50; // OpenAlex title lookups go 50 ids at a time

/** Walk the ranked candidates in batches until `top` are left that are not in the library.
 *  Backward-only works arrive without a title, so a library note with no OpenAlex id is only
 *  recognised after the title lookup; cutting the list first would let those fill the quota.
 *  `limitHit` says the lookup budget ran out before `top` candidates were found. */
export async function pickSnowballCandidates(
  ranked: SnowballCandidate[],
  known: (w: SnowballWork) => boolean,
  fetchTitles: (ids: string[]) => Promise<Map<string, { title: string }>>,
  top = SNOWBALL_TOP,
  maxLookups = SNOWBALL_LOOKUP_MAX
): Promise<{ rows: SnowballCandidate[]; limitHit: boolean }> {
  const rows: SnowballCandidate[] = [];
  let lookups = 0;
  for (let i = 0; i < ranked.length && rows.length < top; i += BATCH) {
    const batch = ranked.slice(i, i + BATCH);
    const untitled = batch.filter((c) => !c.title).map((c) => c.id);
    if (lookups + untitled.length > maxLookups) return { rows, limitHit: true };
    lookups += untitled.length;
    if (untitled.length) {
      const titles = await fetchTitles(untitled).catch(() => new Map<string, { title: string }>());
      for (const c of batch) c.title ||= titles.get(c.id)?.title || undefined;
    }
    for (const c of batch) if (rows.length < top && !known(c)) rows.push(c);
  }
  return { rows, limitHit: false };
}

export interface SnowballMeta {
  scope: string;
  processed: number;
  failures: number;
  date: string; // "YYYY-MM-DD HH:mm"
  /** The title-lookup budget ran out before the list was full. */
  limitHit?: boolean;
}

const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/** The report note: provenance up front, then the ranked table. */
export function snowballMarkdown(meta: SnowballMeta, rows: SnowballCandidate[]): string {
  const head = [
    `# Snowball candidates`,
    ``,
    `- Scope: ${meta.scope}`,
    `- Included records processed: ${meta.processed}`,
    `- Failed or unresolved lookups: ${meta.failures}`,
    `- Source: OpenAlex. Only citations OpenAlex has indexed are listed; forward results are the newest 100 citing works per record.`,
    `- Date: ${meta.date}`,
    ...(meta.limitHit
      ? [`- Limit: ${SNOWBALL_LOOKUP_MAX} title lookups were used before the list filled; lower-ranked candidates were not checked against the library.`]
      : []),
    ``,
    `These are candidates for screening, not for citing directly.`,
    ``,
    `| Links | Title | Year | OpenAlex | Linked included records |`,
    `| ---: | --- | ---: | --- | --- |`,
  ];
  const body = rows.map((c) => {
    const who = [
      ...(c.citedBy.length ? [`cited by: ${c.citedBy.join(", ")}`] : []),
      ...(c.cites.length ? [`cites: ${c.cites.join(", ")}`] : []),
    ].join("; ");
    return `| ${links(c)} | ${cell(c.title || "(title not found)")} | ${c.year ?? ""} | [${c.id}](https://openalex.org/${c.id}) | ${cell(who)} |`;
  });
  return [...head, ...body, ``].join("\n");
}
