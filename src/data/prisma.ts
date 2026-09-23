import { EXCLUDE_REASONS } from "./screening";

/** The one slice of a reference an in-scope PRISMA count needs — the caller (the command layer,
 *  which has vault access) projects `library.entries()` down to this before calling `prismaCounts`. */
export interface PrismaRecord {
  citekey: string;
  include?: string | null;
  screening_note?: string | null;
}

export interface PrismaCounts {
  recordsIdentified: number;
  duplicatesRemoved: number;
  recordsScreened: number;
  excludedAtScreening: number;
  awaitingDecision: number;
  reportsSoughtForRetrieval: number;
  reportsNotRetrieved: number;
  reportsAssessed: number;
  studiesIncluded: number;
  exclusionReasons: { reason: string; count: number }[];
}

/** Count a PRISMA 2020 flow from a scope's records, a duplicate-group list (citekeys, as
 *  `duplicateGroups` from data/library.ts returns them, restricted to this scope), and a
 *  full-text lookup. Duplicates are every record beyond the first (input order) present in each
 *  group — the rest of the counts (excluded/included/awaiting) are over the deduplicated set, so
 *  a paper counted twice by having two notes doesn't also inflate the screening buckets. */
export function prismaCounts(
  records: PrismaRecord[],
  dupGroups: string[][],
  hasFullText: (r: PrismaRecord) => boolean
): PrismaCounts {
  const inScope = new Set(records.map((r) => r.citekey));
  const extraDupes = new Set<string>();
  for (const group of dupGroups) {
    const present = group.filter((k) => inScope.has(k));
    for (const k of present.slice(1)) extraDupes.add(k);
  }
  const primary = records.filter((r) => !extraDupes.has(r.citekey));
  const duplicatesRemoved = records.length - primary.length;

  const excluded = primary.filter((r) => r.include === "exclude");
  const included = primary.filter((r) => r.include === "include");
  const awaiting = primary.filter((r) => r.include !== "exclude" && r.include !== "include");
  const includedWithFullText = included.filter((r) => hasFullText(r));

  const reasonCounts = new Map<string, number>();
  for (const r of excluded) {
    const note = (r.screening_note || "").trim();
    const reason = EXCLUDE_REASONS.find((x) => x !== "Other" && note.startsWith(x)) || "Other";
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
  }
  const exclusionReasons = [...reasonCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  return {
    recordsIdentified: records.length,
    duplicatesRemoved,
    recordsScreened: primary.length,
    excludedAtScreening: excluded.length,
    awaitingDecision: awaiting.length,
    reportsSoughtForRetrieval: included.length,
    reportsNotRetrieved: included.length - includedWithFullText.length,
    reportsAssessed: includedWithFullText.length,
    studiesIncluded: included.length,
    exclusionReasons,
  };
}

/** A PRISMA 2020-style flow diagram (Mermaid `flowchart TD`, identification/screening/included
 *  blocks with exclusions off to the side) plus a plain table of the same numbers, so the counts
 *  survive an export that drops the diagram. */
export function prismaMarkdown(counts: PrismaCounts, scopeLabel: string, date: string): string {
  const c = counts;
  const reasonLines = c.exclusionReasons.length
    ? c.exclusionReasons.map((r) => `| ${r.reason} | ${r.count} |`).join("\n")
    : "| (none) | 0 |";

  const diagram = [
    "```mermaid",
    "flowchart TD",
    "    subgraph ID[Identification]",
    `    A["Records identified<br/>n = ${c.recordsIdentified}"]`,
    "    end",
    "    subgraph SCR[Screening]",
    `    B["Records after duplicates removed<br/>n = ${c.recordsScreened}"]`,
    `    C["Records screened<br/>n = ${c.recordsScreened}"]`,
    `    D["Records excluded<br/>n = ${c.excludedAtScreening}"]`,
    `    W["Awaiting decision<br/>n = ${c.awaitingDecision}"]`,
    `    E["Reports sought for retrieval<br/>n = ${c.reportsSoughtForRetrieval}"]`,
    `    F["Reports not retrieved<br/>(included on the abstract)<br/>n = ${c.reportsNotRetrieved}"]`,
    `    G["Reports assessed for eligibility<br/>n = ${c.reportsAssessed}"]`,
    "    end",
    "    subgraph INC[Included]",
    `    H["Studies included in review<br/>n = ${c.studiesIncluded}<br/>full text ${c.reportsAssessed} · abstract only ${c.reportsNotRetrieved}"]`,
    "    end",
    "    A --> B --> C",
    "    C --> D",
    "    C --> W",
    "    C --> E --> F",
    "    E --> G --> H",
    ...(c.reportsNotRetrieved ? ["    F -.-> H"] : []),
    "```",
  ].join("\n");

  const table = [
    "| Metric | Count |",
    "|---|---|",
    `| Records identified | ${c.recordsIdentified} |`,
    `| Duplicates removed | ${c.duplicatesRemoved} |`,
    `| Records screened | ${c.recordsScreened} |`,
    `| Excluded at screening | ${c.excludedAtScreening} |`,
    `| Awaiting decision | ${c.awaitingDecision} |`,
    `| Reports sought for retrieval | ${c.reportsSoughtForRetrieval} |`,
    `| Reports not retrieved | ${c.reportsNotRetrieved} |`,
    `| Reports assessed for eligibility | ${c.reportsAssessed} |`,
    `| Studies included in review | ${c.studiesIncluded} |`,
  ].join("\n");

  return [
    `# PRISMA flow (${scopeLabel})`,
    "",
    `Generated ${date}. Scope: ${scopeLabel}.`,
    "",
    diagram,
    "",
    "## Counts",
    "",
    table,
    "",
    "## Exclusion reasons",
    "",
    "| Reason | Count |",
    "|---|---|",
    reasonLines,
    "",
  ].join("\n");
}
