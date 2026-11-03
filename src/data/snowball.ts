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

export interface SnowballMeta {
  scope: string;
  processed: number;
  failures: number;
  date: string; // "YYYY-MM-DD HH:mm"
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
