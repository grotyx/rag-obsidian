import { keywordsToTags, tagSlug } from "./reference";

/** Screening decision values (mirrored 1:1 into a tag of the same name). */
export const INCLUDE_VALUES = ["include", "exclude", "pending"] as const;
export type IncludeValue = (typeof INCLUDE_VALUES)[number];

/** Evidence levels (mirrored into `level-<n>`). */
export const LEVELS = ["1", "2", "3", "4", "5"] as const;
export type Level = (typeof LEVELS)[number];

/** The owner's key-question ids, "01".."13" — used by the screening pane's KQ chips. A KQ can
 *  also be free text (slugified), which `set_reference_fields` has always accepted; this list is
 *  only the pane's fixed chip set. */
export const KQ_COUNT = 13;
export const KQ_IDS: readonly string[] = Array.from({ length: KQ_COUNT }, (_, i) => String(i + 1).padStart(2, "0"));

/** Study designs offered by the screening pane's `<select>`. `set_reference_fields`/`applyScreening`
 *  still accept any non-empty free text (unchanged behavior) — this list is only the UI's choices. */
export const DESIGNS = [
  "RCT",
  "Systematic review",
  "Meta-analysis",
  "Cohort study",
  "Case-control study",
  "Case series",
  "Case report",
  "Cross-sectional study",
  "Narrative review",
  "Guideline",
  "Other",
] as const;

/** Quick-pick exclusion reasons: fill the screening pane's note field (editable after) and are
 *  the prefixes `prismaCounts` groups excluded records' `screening_note` by. */
export const EXCLUDE_REASONS = [
  "Wrong population",
  "Wrong intervention",
  "Wrong outcome",
  "Wrong design",
  "Not biportal / different technique",
  "Duplicate",
  "Not English",
  "Other",
] as const;

export interface ScreeningFields {
  kq?: string[];
  include?: IncludeValue;
  level?: Level;
  design?: string;
  screening_note?: string;
  add_tags?: string[];
  remove_tags?: string[];
}

export interface ScreeningResult {
  tags: string[];
  fields: {
    kq: string[];
    include: string | null;
    level: string | null;
    design: string | null;
    screening_note: string | null;
  };
}

/** Validate + apply screening fields onto a note's frontmatter object (mutated in place — the
 *  same shape Obsidian's `processFrontMatter` callback receives) and mirror them into `fm.tags`.
 *  Shared by the MCP `set_reference_fields` tool and the screening pane so the two can never
 *  disagree about which tags a decision produces. Throws (writing nothing) when `include` is
 *  being set to "include" with no key question attached — the same rule external screening
 *  tooling has always required an include decision to carry. */
export function applyScreening(fm: Record<string, unknown>, fields: ScreeningFields): ScreeningResult {
  let tags: string[] = Array.isArray(fm.tags) ? fm.tags.map(String) : typeof fm.tags === "string" ? [fm.tags] : [];
  const dropPrefixed = (prefix: string) => {
    tags = tags.filter((t) => !t.startsWith(prefix));
  };
  const addTag = (t: string) => {
    if (!tags.includes(t)) tags.push(t);
  };

  if (fields.include === "include") {
    const finalKq = fields.kq !== undefined ? fields.kq : Array.isArray(fm.kq) ? fm.kq.map(String) : [];
    if (finalKq.length === 0) throw new Error("INVALID_ARGUMENT: include requires at least one kq");
  }
  if (fields.design !== undefined && (typeof fields.design !== "string" || !fields.design.trim())) {
    throw new Error("INVALID_ARGUMENT: design must be a non-empty string");
  }

  if (fields.kq !== undefined) {
    fm.kq = fields.kq;
    dropPrefixed("kq-");
    for (const k of fields.kq) addTag(/^\d+$/.test(k) ? `kq-${k.padStart(2, "0")}` : `kq-${tagSlug(k)}`);
  }
  if (fields.include !== undefined) {
    fm.include = fields.include;
    tags = tags.filter((t) => t !== "include" && t !== "exclude" && t !== "pending");
    addTag(fields.include);
  }
  if (fields.level !== undefined) {
    fm.level = fields.level;
    dropPrefixed("level-");
    addTag(`level-${fields.level}`);
  }
  if (fields.design !== undefined) {
    fm.design = fields.design;
    dropPrefixed("design-");
    addTag(`design-${tagSlug(fields.design)}`);
  }
  if (fields.screening_note !== undefined) fm.screening_note = fields.screening_note;
  if (fields.add_tags) for (const t of keywordsToTags(fields.add_tags)) addTag(t);
  if (fields.remove_tags) {
    const drop = new Set(keywordsToTags(fields.remove_tags));
    tags = tags.filter((t) => !drop.has(t));
  }

  fm.tags = tags;
  return {
    tags,
    fields: {
      kq: Array.isArray(fm.kq) ? (fm.kq as unknown[]).map(String) : [],
      include: typeof fm.include === "string" ? fm.include : null,
      level: typeof fm.level === "string" ? fm.level : null,
      design: typeof fm.design === "string" ? fm.design : null,
      screening_note: typeof fm.screening_note === "string" ? fm.screening_note : null,
    },
  };
}

/** Pane-only rule (not enforced by `applyScreening`/the MCP tool): an exclude decision must carry
 *  a reason, quick-picked from `EXCLUDE_REASONS` or typed by hand. */
export function excludeNeedsReason(note: string): boolean {
  return !note.trim();
}
