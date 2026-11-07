/** Pure logic for "Merge duplicate references": pick which note in a duplicate group survives,
 *  merge its frontmatter and body with the others, and never touch the vault or Obsidian API
 *  (kept obsidian-free so it's covered by test/unit.ts, like the rest of src/data). */
import { hasStashedText, stashedText, STASH_MARKER } from "../ingest/pdfStash";
import { extractSummaryBlock, replaceSummaryBlock } from "../cite/bibliography";
import { parseYaml, stringifyYaml } from "obsidian";
import { evidenceSection, Finding, parseFindings } from "./findings";

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

// Never copied from another note: citekey identifies the note itself, `position` is
// metadataCache's own line-range marker on the SOURCE note's frontmatter block (not data), and
// summary_source/summary_model are decided by planMerge together with whether a summary block
// actually moved (see planMerge) — copying them here independently is the bug this fixes.
const NEVER_COPY = new Set([
  "citekey",
  "position",
  "tags",
  "mesh_terms",
  "retracted",
  "cited_by_count",
  "summary_source",
  "summary_model",
]);

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

/** Keeper body plus, for every other note, a `## Merged from <citekey>` section holding whatever
 *  of its `### Notes` / `### Highlights` is non-empty; plus (only when the keeper has none) the
 *  first other note's PDF-text stash, moved in as the keeper's own stash. `summaryDonor`, when
 *  it names one of `others`, moves that note's summary block in too — decided once by
 *  `planMerge` so the body and the frontmatter's summary_source/summary_model can't disagree.
 *  Everything merged-in lands BEFORE an existing keeper stash (never inside it); a moved-in
 *  stash always goes last. */
export function mergeBodies(keeperBody: string, others: OtherBody[], summaryDonor: string | null = null): string {
  const hasKeeperStash = hasStashedText(keeperBody);
  const markerIdx = keeperBody.indexOf(STASH_MARKER);
  let prefix = hasKeeperStash ? keeperBody.slice(0, markerIdx).replace(/\s*$/, "") : keeperBody;
  const suffix = hasKeeperStash ? keeperBody.slice(markerIdx) : "";

  if (summaryDonor) {
    const donor = others.find((o) => o.citekey === summaryDonor);
    const block = donor ? extractSummaryBlock(donor.body) : null;
    if (block) {
      // A fresh note keeps its Summary above `## Notes`; put a moved one there too.
      const notesAt = prefix.search(/(^|\n)## Notes[ \t]*(\n|$)/);
      if (notesAt >= 0) {
        const at = prefix[notesAt] === "\n" ? notesAt + 1 : notesAt;
        prefix = `${prefix.slice(0, at)}${block.replace(/\s*$/, "")}\n\n${prefix.slice(at)}`;
      } else {
        prefix = replaceSummaryBlock(prefix, block.split("\n"));
      }
    }
  }

  prefix = mergeEvidence(prefix, others.map((o) => o.body));

  for (const { citekey, body } of others) {
    const section = mergedFromSection(citekey, body);
    if (section) prefix = `${prefix.replace(/\s*$/, "")}\n\n${section}`;
  }

  let movedStash: string | null = null;
  if (!hasKeeperStash) {
    for (const { body } of others) {
      if (hasStashedText(body)) {
        movedStash = stripTrailingMergedBlocks(stashedText(body));
        break;
      }
    }
  }

  if (movedStash !== null) return `${prefix.replace(/\s*$/, "")}\n\n${STASH_MARKER}\n\n${movedStash}\n`;
  return hasKeeperStash ? `${prefix.replace(/\s*$/, "")}\n\n${suffix}` : prefix;
}

const FINDING_KEYS = ["kind", "outcome", "intervention", "comparator", "predictor", "subgroup", "timepoint", "n", "studies", "effect", "ci", "p", "direction", "heterogeneity"] as const;

function findingKey(f: Finding): string {
  return [...FINDING_KEYS.map((k) => f[k] ?? ""), f.quote].join("\u0001").replace(/\s+/g, " ").toLowerCase();
}

function findingLines(f: Finding): string {
  const fields = FINDING_KEYS.filter((k) => f[k]).map((k) => `[${k}:: ${f[k]}]`).join(" ");
  return `> - ${fields}\n>   "${f.quote}"`;
}

/** Carry the others' `## Evidence (extracted)` findings into `prefix` (the keeper body above its
 *  stash): appended to the keeper's own section, or a new section when it has none. A finding
 *  the keeper (or an earlier loser) already has — same fields and quote after whitespace/case
 *  normalisation — is not added twice. Unknown fields on a loser's finding are not carried (the
 *  parser drops them). */
function mergeEvidence(prefix: string, otherBodies: string[]): string {
  const have = parseFindings(prefix);
  const seen = new Set(have.map(findingKey));
  const added: Finding[] = [];
  for (const body of otherBodies) {
    for (const f of parseFindings(body.split(STASH_MARKER)[0])) {
      const key = findingKey(f);
      if (seen.has(key)) continue;
      seen.add(key);
      added.push(f);
    }
  }
  if (!added.length) return prefix;
  const lines = added.map(findingLines).join("\n");
  const section = evidenceSection(prefix);
  if (!section) {
    const n = added.length;
    return `${prefix.replace(/\s*$/, "")}\n\n## Evidence (extracted)\n\n> [!quote]- ${n} finding${n === 1 ? "" : "s"}\n${lines}\n`;
  }
  const at = prefix.indexOf(section);
  const body = section.replace(/\s*$/, "");
  const tail = section.slice(body.length);
  const total = have.length + added.length;
  const grown = body.replace(/^(> \[!quote\]-? )\d+ findings/m, `$1${total} findings`);
  return prefix.slice(0, at) + `${grown}\n${lines}${tail || "\n"}` + prefix.slice(at + section.length);
}

/** Frontmatter and body of a whole note. `null` when the YAML block does not parse — the
 *  caller must leave such a note alone rather than rewrite it. */
export function splitNote(text: string): { fm: Record<string, unknown>; body: string } | null {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { fm: {}, body: text };
  try {
    const fm: unknown = parseYaml(m[1]);
    if (fm !== null && fm !== undefined && (typeof fm !== "object" || Array.isArray(fm))) return null;
    return { fm: (fm ?? {}) as Record<string, unknown>, body: text.slice(m[0].length) };
  } catch {
    return null;
  }
}

/** Inverse of `splitNote`. */
export function joinNote(fm: Record<string, unknown>, body: string): string {
  return Object.keys(fm).length ? `---\n${stringifyYaml(fm).trimEnd()}\n---\n${body}` : body;
}

/** `## Merged from <citekey>` holding everything of the other note's body that the merge does not
 *  already carry elsewhere: text the user wrote under the H1, `## Notes` / `## Highlights` as
 *  `### Notes` / `### Highlights`, and every other `## X` section as `### X` (an H2 inside Notes
 *  starts its own section and is carried the same way). Left out: the H1 and generated
 *  `> **Summary source**` line, the Summary block, the Evidence section (merged by `mergeEvidence`)
 *  and the full-text stash. Sections this note itself received from an earlier merge ride along
 *  unchanged. "" when nothing is left. */
function mergedFromSection(citekey: string, body: string): string {
  // The stash runs marker -> EOF, except `## Merged from ...` blocks an earlier merge left after it.
  let content = body;
  const at = body.indexOf(STASH_MARKER);
  if (at >= 0) {
    const after = body.slice(at + STASH_MARKER.length);
    const m = after.search(/(^|\n)## Merged from /);
    content = `${body.slice(0, at)}\n${m >= 0 ? after.slice(m).replace(/^\n/, "") : ""}`;
  }
  const heads = [...content.matchAll(/(^|\n)## ([^\n]*)/g)];
  const first = heads.length ? heads[0].index : content.length;
  const pre = content
    .slice(0, first)
    .replace(/^# .*$/m, "")
    .replace(/^> \*\*Summary source\*\*:.*$/m, "")
    .trim();
  let notes = "";
  let highlights = "";
  const extras: string[] = [];
  const earlier: string[] = [];
  heads.forEach((h, n) => {
    const start = (h.index ?? 0) + (h[1] ? 1 : 0);
    const end = n + 1 < heads.length ? (heads[n + 1].index ?? content.length) : content.length;
    const name = h[2].trim();
    const section = content.slice(start, end);
    const inner = section.slice(section.indexOf("\n") + 1).trim();
    if (name === "Notes") notes = inner;
    else if (name === "Highlights") highlights = inner;
    else if (/^(Summary(\s*\([^)]*\))?|요약 \(KR\))$/.test(name) || name === "Evidence (extracted)") return;
    else if (name.startsWith("Merged from ")) earlier.push(section.trim());
    else extras.push(`### ${name}${inner ? `\n\n${inner}` : ""}`);
  });
  const parts: string[] = [];
  if (pre || notes || highlights || extras.length) {
    parts.push(`## Merged from ${citekey}`);
    if (pre) parts.push("", pre);
    if (notes) parts.push("", "### Notes", "", notes);
    if (highlights) parts.push("", "### Highlights", "", highlights);
    for (const e of extras) parts.push("", e);
  }
  for (const e of earlier) parts.push(...(parts.length ? [""] : []), e);
  return parts.length ? `${parts.join("\n")}\n` : "";
}

/** A moved-in stash is `marker → EOF` (cheap: `appendStash` always writes it last) — except an
 *  earlier merge could have left `## Merged from …` sections trailing after it, which are not
 *  full text and must not ride along. */
function stripTrailingMergedBlocks(stash: string): string {
  const idx = stash.search(/(^|\n)## Merged from /);
  return idx < 0 ? stash : stash.slice(0, idx).replace(/\s*$/, "");
}

export interface MergeSourceNote {
  citekey: string;
  fm: Record<string, unknown>;
  body: string;
}

export interface MergePlan {
  fm: Record<string, unknown>;
  body: string;
}

/** The single place that decides a group's merged frontmatter AND body, so they can't disagree
 *  about which loser's summary (if any) the keeper ends up with: pick the summary donor once —
 *  the first `other` with a summary block, only when the keeper has none — then feed that same
 *  decision into both `mergeFrontmatter`'s summary_source/summary_model and `mergeBodies`' text
 *  move. */
export function planMerge(keeper: MergeSourceNote, others: MergeSourceNote[]): MergePlan {
  const summaryDonor = extractSummaryBlock(keeper.body)
    ? null
    : (others.find((o) => extractSummaryBlock(o.body))?.citekey ?? null);

  const fm = mergeFrontmatter(keeper.fm, others.map((o) => o.fm));
  if (summaryDonor) {
    const donor = others.find((o) => o.citekey === summaryDonor)!;
    if (isEmpty(fm.summary_source) && !isEmpty(donor.fm.summary_source)) fm.summary_source = donor.fm.summary_source;
    if (isEmpty(fm.summary_model) && !isEmpty(donor.fm.summary_model)) fm.summary_model = donor.fm.summary_model;
  }

  const body = mergeBodies(keeper.body, others.map((o) => ({ citekey: o.citekey, body: o.body })), summaryDonor);
  return { fm, body };
}

export interface WikilinkRename {
  /** Vault path without the `.md` extension, e.g. `References/smith2020`. */
  path: string;
  keeperBasename: string;
}

// `[[target]]`, `![[target]]`, with an optional `#heading` and/or `|alias` suffix kept verbatim.
const WIKILINK_RE = /(!?\[\[)([^\]|#]+)((?:#[^\]|]*)?(?:\|[^\]]*)?)(\]\])/g;

/** Rewrite wikilinks to a trashed loser onto the keeper's basename, across one note's text.
 *  `renames` carries each loser's full vault path (no `.md`) and bare basename — both are valid
 *  link targets in Obsidian — mapped to exact strings, so `[[smith2020b]]` is an exact-match miss
 *  against `smith2020` and is left alone. The link's `#heading`/`|alias` suffix and a leading `!`
 *  embed marker are preserved verbatim. */
export function renameWikilinks(text: string, renames: WikilinkRename[]): string {
  if (!renames.length) return text;
  const map = new Map<string, string>();
  for (const r of renames) {
    map.set(r.path, r.keeperBasename);
    const base = r.path.split("/").pop();
    if (base) map.set(base, r.keeperBasename);
  }
  return text.replace(WIKILINK_RE, (whole, open: string, target: string, rest: string, close: string) => {
    const keeper = map.get(target.trim());
    return keeper ? `${open}${keeper}${rest}${close}` : whole;
  });
}
