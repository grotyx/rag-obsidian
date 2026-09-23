/** Pure logic for "Merge duplicate references": pick which note in a duplicate group survives,
 *  merge its frontmatter and body with the others, and never touch the vault or Obsidian API
 *  (kept obsidian-free so it's covered by test/unit.ts, like the rest of src/data). */
import { hasStashedText, stashedText, STASH_MARKER } from "../ingest/pdfStash";
import { extractSummaryBlock, replaceSummaryBlock } from "../cite/bibliography";

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

/** `## Merged from <citekey>` holding the other note's non-empty `## Notes` / `## Highlights`
 *  as `### Notes` / `### Highlights` subsections; "" when both are empty (nothing to merge in). */
function mergedFromSection(citekey: string, body: string): string {
  const notes = extractSection(body, "## Notes").trim();
  const highlights = extractSection(body, "## Highlights").trim();
  // Sections this loser itself received from an earlier merge ride along unchanged.
  const earlier = [...body.matchAll(/(^|\n)(## Merged from [^\n]*\n[\s\S]*?)(?=\n## |\n# |$)/g)]
    .map((m) => m[2].trim())
    .filter((s) => !s.startsWith(STASH_MARKER));
  if (!notes && !highlights && !earlier.length) return "";
  const parts: string[] = [];
  if (notes || highlights) {
    parts.push(`## Merged from ${citekey}`);
    if (notes) parts.push("", "### Notes", "", notes);
    if (highlights) parts.push("", "### Highlights", "", highlights);
  }
  for (const e of earlier) parts.push(...(parts.length ? [""] : []), e);
  return `${parts.join("\n")}\n`;
}

/** A moved-in stash is `marker → EOF` (cheap: `appendStash` always writes it last) — except an
 *  earlier merge could have left `## Merged from …` sections trailing after it, which are not
 *  full text and must not ride along. */
function stripTrailingMergedBlocks(stash: string): string {
  const idx = stash.search(/(^|\n)## Merged from /);
  return idx < 0 ? stash : stash.slice(0, idx).replace(/\s*$/, "");
}

/** Text under a `## <heading>` line, up to the next `#`/`##` heading or end of body — so a
 *  `### Key points` inside the user's notes stays with them. */
function extractSection(body: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = body.match(new RegExp(`(^|\\n)${escaped}[ \\t]*(\\n|$)`));
  if (!m || m.index === undefined) return "";
  const rest = body.slice(m.index + m[0].length);
  const next = rest.search(/\n#{1,2}[ \t]/);
  return next >= 0 ? rest.slice(0, next) : rest;
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
