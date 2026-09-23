/** Pure logic for "Merge duplicate references": pick which note in a duplicate group survives,
 *  merge its frontmatter and body with the others, and never touch the vault or Obsidian API
 *  (kept obsidian-free so it's covered by test/unit.ts, like the rest of src/data). */
import { hasStashedText, stashedText, STASH_MARKER } from "../ingest/pdfStash";

export interface MergeNote {
  citekey: string;
  fm: Record<string, unknown>;
  bodyLength: number;
}

function strVal(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function fieldCount(fm: Record<string, unknown>): number {
  return Object.values(fm).filter((v) => !isEmpty(v)).length;
}

/** Deterministic tie-break: most non-empty fields, then has a summary, then longer body,
 *  then earliest `added`, then citekey order. */
function compare(a: MergeNote, b: MergeNote): number {
  const byFields = fieldCount(b.fm) - fieldCount(a.fm);
  if (byFields) return byFields;
  const aHasSummary = isEmpty(a.fm.summary_source) ? 0 : 1;
  const bHasSummary = isEmpty(b.fm.summary_source) ? 0 : 1;
  if (aHasSummary !== bHasSummary) return bHasSummary - aHasSummary;
  if (a.bodyLength !== b.bodyLength) return b.bodyLength - a.bodyLength;
  const aAdded = strVal(a.fm.added);
  const bAdded = strVal(b.fm.added);
  if (aAdded !== bAdded) {
    if (!aAdded) return 1;
    if (!bAdded) return -1;
    return aAdded < bAdded ? -1 : 1;
  }
  return a.citekey < b.citekey ? -1 : a.citekey > b.citekey ? 1 : 0;
}

/** Index of the note to keep. */
export function pickKeeper(group: MergeNote[]): number {
  let best = 0;
  for (let i = 1; i < group.length; i++) if (compare(group[i], group[best]) < 0) best = i;
  return best;
}

function toArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string" && v.trim()) return [v];
  return [];
}

/** Union of string-array frontmatter fields (tags, mesh_terms), keeper's order first. */
function unionArr(keeperVal: unknown, otherVals: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of [keeperVal, ...otherVals]) {
    for (const t of toArr(v)) {
      if (!seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
  }
  return out;
}

function numVal(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

// Never copied from another note: citekey identifies the note itself, and `position` is
// metadataCache's own line-range marker on the SOURCE note's frontmatter block, not data.
const NEVER_COPY = new Set(["citekey", "position", "tags", "mesh_terms", "retracted", "cited_by_count"]);

/** Keeper's values win; any key missing/empty on the keeper is filled from `others` in order. */
export function mergeFrontmatter(
  keeper: Record<string, unknown>,
  others: Record<string, unknown>[]
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...keeper };
  for (const other of others) {
    for (const [k, v] of Object.entries(other)) {
      if (NEVER_COPY.has(k) || isEmpty(v) || !isEmpty(out[k])) continue;
      out[k] = v;
    }
  }
  const tags = unionArr(keeper.tags, others.map((o) => o.tags));
  if (tags.length) out.tags = tags;
  const mesh = unionArr(keeper.mesh_terms, others.map((o) => o.mesh_terms));
  if (mesh.length) out.mesh_terms = mesh;

  if ([keeper, ...others].some((fm) => fm.retracted === true)) out.retracted = true;

  const counts = [keeper.cited_by_count, ...others.map((o) => o.cited_by_count)]
    .map(numVal)
    .filter((n): n is number => n !== null);
  if (counts.length) out.cited_by_count = Math.max(...counts);

  return out;
}

export interface OtherBody {
  citekey: string;
  body: string;
}

/** Keeper body unchanged, plus a `## Merged from <citekey>` section per other note that has a
 *  non-empty `## Notes` section, plus the first other note's PDF-text stash moved in as the
 *  keeper's own stash when the keeper has none. Never touches the Summary block. */
export function mergeBodies(keeperBody: string, others: OtherBody[]): string {
  let out = keeperBody;
  const keeperHasStash = hasStashedText(keeperBody);
  let movedStash: string | null = null;
  for (const { citekey, body } of others) {
    const notes = extractSection(body, "## Notes").trim();
    if (notes) out = `${out.replace(/\s*$/, "")}\n\n## Merged from ${citekey}\n\n${notes}\n`;
    if (!keeperHasStash && movedStash === null && hasStashedText(body)) movedStash = stashedText(body);
  }
  if (movedStash !== null) out = `${out.replace(/\s*$/, "")}\n\n${STASH_MARKER}\n\n${movedStash}\n`;
  return out;
}

/** Text under a `## <heading>` line, up to the next heading (any level) or end of body.
 *  Mirrors the boundary rule `splitAtReferences`/`replaceSummaryBlock` use in cite/bibliography.ts. */
function extractSection(body: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = body.match(new RegExp(`(^|\\n)${escaped}[ \\t]*(\\n|$)`));
  if (!m || m.index === undefined) return "";
  const rest = body.slice(m.index + m[0].length);
  const next = rest.search(/\n#{1,6}[ \t]/);
  return next >= 0 ? rest.slice(0, next) : rest;
}
