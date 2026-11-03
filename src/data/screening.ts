import { keywordsToTags } from "./reference";
import { text } from "../util/json";

/** Screening decision values (stored in the `include` frontmatter field). */
export const INCLUDE_VALUES = ["include", "exclude", "pending"] as const;
export type IncludeValue = (typeof INCLUDE_VALUES)[number];

/** Evidence levels (stored in the `level` frontmatter field). */
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

/** Canonical key-question id: `"03"` and `3` both become `"3"`; free text is only trimmed. */
export const kqKey = (v: unknown): string => {
  const s = String(v).trim();
  return /^\d+$/.test(s) ? String(Number(s)) : s;
};

/** True when the raw frontmatter `kq` list holds `kq` (compared by `kqKey`). */
export const hasKq = (raw: unknown, kq: unknown): boolean => Array.isArray(raw) && raw.some((k) => kqKey(k) === kqKey(kq));

/** One choice per distinct key question across several raw `kq` lists: the first spelling seen, sorted. */
export function kqChoices(lists: unknown[]): string[] {
  const byKey = new Map<string, string>();
  for (const raw of lists) if (Array.isArray(raw)) for (const k of raw) if (!byKey.has(kqKey(k))) byKey.set(kqKey(k), String(k).trim());
  return [...byKey.values()].sort();
}

/** Risk-of-bias tools (stored in `rob_tool`). */
export const ROB_TOOLS = ["RoB 2", "ROBINS-I", "QUADAS-2", "NOS", "AMSTAR 2", "other"] as const;

/** Overall risk-of-bias judgements (stored in `rob_overall`); each tool uses its own subset. */
export const ROB_OVERALL = ["low", "some concerns", "moderate", "serious", "critical", "high", "unclear"] as const;

export interface ScreeningFields {
  kq?: string[];
  include?: IncludeValue;
  level?: Level;
  design?: string;
  screening_note?: string;
  /** Guideline the record was screened for (e.g. "BE"); empty string clears it. */
  guideline?: string;
  /** Free-text id grouping several reports of one study (protocol, primary report, follow-up,
   *  correction); empty string clears it. Notes are never merged. */
  study_id?: string;
  /** Risk-of-bias assessment: tool and overall judgement (enums above), free-text note. For all
   *  three an empty string clears the field, like `guideline`. */
  rob_tool?: string;
  rob_overall?: string;
  rob_note?: string;
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
    guideline: string | null;
    study_id: string | null;
    rob_tool: string | null;
    rob_overall: string | null;
    rob_note: string | null;
  };
}

/** Validate + apply screening fields onto a note's frontmatter object (mutated in place — the
 *  same shape Obsidian's `processFrontMatter` callback receives). Results live only in their own
 *  fields, never in tags; setting a field also drops the legacy mirrored tag (`kq-*`, `include` /
 *  `exclude` / `pending`, `level-*`, `design-*`) older versions wrote, so notes clean up as they are
 *  re-screened. Shared by the MCP `set_reference_fields` tool and the screening pane. Throws (writing nothing) when `include` is
 *  being set to "include" with no key question attached — the same rule external screening
 *  tooling has always required an include decision to carry. */
export function applyScreening(fm: Record<string, unknown>, fields: ScreeningFields): ScreeningResult {
  let tags: string[] = Array.isArray(fm.tags) ? fm.tags.map(String) : typeof fm.tags === "string" ? [fm.tags] : [];
  const dropLegacy = (match: (t: string) => boolean) => {
    tags = tags.filter((t) => !match(t));
  };
  const addTag = (t: string) => {
    if (!tags.includes(t)) tags.push(t);
  };

  // The rule holds for the final state, so clearing the KQs of an included record is rejected too.
  // Checked only when this patch touches include or kq: a legacy record already included without
  // a KQ can still get its level or note edited.
  const finalInclude = fields.include !== undefined ? fields.include : fm.include;
  const finalKq = fields.kq !== undefined ? fields.kq : Array.isArray(fm.kq) ? fm.kq.map(String) : [];
  const touched = fields.include !== undefined || fields.kq !== undefined;
  if (touched && finalInclude === "include" && finalKq.length === 0) {
    throw new Error("INVALID_ARGUMENT: include requires at least one kq");
  }
  if (fields.design !== undefined && (typeof fields.design !== "string" || !fields.design.trim())) {
    throw new Error("INVALID_ARGUMENT: design must be a non-empty string");
  }
  for (const [name, allowed] of [["rob_tool", ROB_TOOLS], ["rob_overall", ROB_OVERALL]] as const) {
    const v = fields[name];
    if (v !== undefined && v !== "" && !(allowed as readonly unknown[]).includes(v)) {
      throw new Error(`INVALID_ARGUMENT: ${name} must be one of ${allowed.join(", ")} (or empty to clear)`);
    }
  }
  if (fields.rob_note !== undefined && typeof fields.rob_note !== "string") {
    throw new Error("INVALID_ARGUMENT: rob_note must be a string");
  }
  if (fields.study_id !== undefined && typeof fields.study_id !== "string") {
    throw new Error("INVALID_ARGUMENT: study_id must be a string");
  }

  if (fields.kq !== undefined) {
    fm.kq = fields.kq;
    dropLegacy((t) => t.startsWith("kq-"));
  }
  if (fields.include !== undefined) {
    fm.include = fields.include;
    dropLegacy((t) => (INCLUDE_VALUES as readonly string[]).includes(t));
  }
  if (fields.level !== undefined) {
    fm.level = fields.level;
    dropLegacy((t) => t.startsWith("level-"));
  }
  if (fields.design !== undefined) {
    fm.design = fields.design;
    dropLegacy((t) => t.startsWith("design-"));
  }
  if (fields.screening_note !== undefined) fm.screening_note = fields.screening_note;
  if (fields.guideline !== undefined) {
    const g = fields.guideline.trim();
    if (g) fm.guideline = g;
    else delete fm.guideline;
  }
  if (fields.study_id !== undefined) {
    const s = fields.study_id.trim();
    if (s) fm.study_id = s;
    else delete fm.study_id;
  }
  for (const name of ["rob_tool", "rob_overall", "rob_note"] as const) {
    const v = fields[name]?.trim();
    if (v === undefined) continue;
    if (v) fm[name] = v;
    else delete fm[name];
  }
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
      include: text(fm.include) || null,
      level: typeof fm.level === "string" ? fm.level : null,
      design: typeof fm.design === "string" ? fm.design : null,
      screening_note: text(fm.screening_note) || null,
      guideline: text(fm.guideline) || null,
      study_id: text(fm.study_id).trim() || null,
      rob_tool: text(fm.rob_tool) || null,
      rob_overall: text(fm.rob_overall) || null,
      rob_note: text(fm.rob_note) || null,
    },
  };
}

/** Pane-only rule (not enforced by `applyScreening`/the MCP tool): an exclude decision must carry
 *  a reason, quick-picked from `EXCLUDE_REASONS` or typed by hand. */
export function excludeNeedsReason(note: string): boolean {
  return !note.trim();
}
