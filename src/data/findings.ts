import { STASH_MARKER } from "../ingest/pdfStash";

/** Parser for the `## Evidence (extracted)` note section (written by rag_research). Pure. */
export interface Finding {
  kind: "comparative" | "prognostic";
  outcome: string;
  intervention?: string;
  comparator?: string;
  predictor?: string;
  subgroup?: string;
  timepoint?: string;
  n?: string;
  studies?: string;
  effect?: string;
  ci?: string;
  p?: string;
  direction?: string;
  heterogeneity?: string;
  /** PDF page the quote was located on / local date it was checked ("Verify findings in this note"). */
  page?: string;
  verified?: string;
  quote: string;
}

export const EVIDENCE_HEADING = /^##[ \t]+Evidence \(extracted\)[ \t]*$/m;

/** The section's text (heading through the line before the next `## ` heading or EOF), or null. */
export function evidenceSection(markdown: string): string | null {
  const m = EVIDENCE_HEADING.exec(markdown);
  if (!m) return null;
  const rest = markdown.slice(m.index + m[0].length);
  const next = /^##[ \t]/m.exec(rest);
  return markdown.slice(m.index, m.index + m[0].length + (next ? next.index : rest.length));
}

const OPTIONAL = ["intervention", "comparator", "predictor", "subgroup", "timepoint", "n", "studies", "effect", "ci", "p", "direction", "heterogeneity", "page", "verified"] as const;

export function parseFindings(markdown: string): Finding[] {
  return scanFindings(markdown).map((s) => s.finding);
}

/** Findings with the 0-based line (in `markdown.split("\n")`) of each one's `[k:: v]` field line. */
function scanFindings(markdown: string): { finding: Finding; line: number }[] {
  const section = evidenceSection(markdown);
  const head = EVIDENCE_HEADING.exec(markdown);
  if (!section || !head) return [];
  const startLine = markdown.slice(0, head.index).split("\n").length - 1;
  const out: { finding: Finding; line: number }[] = [];
  let fieldsLine = 0;
  let fields: Map<string, string> | null = null;
  const flush = (quote: string) => {
    const kind = fields?.get("kind");
    const outcome = fields?.get("outcome");
    if (fields && quote && outcome && (kind === "comparative" || kind === "prognostic")) {
      const f: Finding = { kind, outcome, quote };
      for (const k of OPTIONAL) { const v = fields.get(k); if (v) f[k] = v; }
      out.push({ finding: f, line: fieldsLine });
    }
    fields = null;
  };
  for (const [i, raw] of section.split(/\r?\n/).entries()) {
    const line = raw.replace(/^>\s?/, "");
    // `- [k:: v]` list lines (first format) or bare `[k:: v]` lines inside a ```text fence (current:
    // Obsidian keeps metadata for every list item, ~0.8 GB of heap across 140k findings).
    if (/^(- )?\[[A-Za-z_]+::/.test(line)) {
      fields = new Map();
      fieldsLine = startLine + i;
      // A value may hold balanced `[..]` spans (a CI "[0.1, 0.5]"); failing that, a lone `[` ("Score on
      // [0, 1)") — then the field ends at the `]` that is followed by the next field or the line end.
      for (const m of line.matchAll(/\[([A-Za-z_]+)::\s*(?:((?:[^[\]]|\[[^\]]*\])*)\]|(.*?)\](?=\s*(?:\[[A-Za-z_]+::|$)))/g)) {
        fields.set(m[1].toLowerCase(), (m[2] ?? m[3]).trim());
      }
    } else if (fields) {
      const q = /^\s+"(.*)"\s*$/.exec(line);
      if (q) flush(q[1].trim());
    }
  }
  return out;
}

/** True when the quote reports *another* study's result ("Ghogawala et al. demonstrated…", "[7]",
 *  "previous studies reported") — typical of introductions, discussions and reviews. Such numbers
 *  should be cited to the original study, so search_findings flags and demotes them. */
export function isRestated(quote: string): boolean {
  return (
    /\bet al\b/i.test(quote) ||
    /\[\d+(?:\s*[,–-]\s*\d+)*\]/.test(quote) ||
    /\b(?:previous|prior|earlier|other)\s+(?:studies|study|reports?|trials?|authors)\b/i.test(quote) ||
    /\(\s*[A-Z][A-Za-z-]+(?:\s+(?:and|&)\s+[A-Z][A-Za-z-]+)?,?\s+(?:19|20)\d{2}\s*\)/.test(quote)
  );
}

/** One line for reranking / lexical scoring. */
export function findingText(f: Finding): string {
  const who = f.intervention ? `${f.intervention}${f.comparator ? ` vs ${f.comparator}` : ""}` : f.predictor ?? "";
  return [f.outcome, who, f.timepoint, f.effect, f.p ? `p ${f.p}` : "", f.quote].filter(Boolean).join("; ");
}

export const FINDING_KEYS = ["kind", "outcome", "intervention", "comparator", "predictor", "subgroup", "timepoint", "n", "studies", "effect", "ci", "p", "direction", "heterogeneity", "page", "verified"] as const;

/** Identity of a finding for de-duplication: all fields + quote, whitespace- and case-insensitive. */
export function findingKey(f: Finding): string {
  // page / verified describe the check, not the finding: a verified copy is still the same finding.
  return [...FINDING_KEYS.filter((k) => k !== "page" && k !== "verified").map((k) => f[k] ?? ""), f.quote].join("\u0001").replace(/\s+/g, " ").toLowerCase();
}

/** One finding as callout lines: `> - [k:: v] ...` then the quote (`bare`: inside a ```text fence). */
export function findingLines(f: Finding, bare = false): string {
  const fields = FINDING_KEYS.filter((k) => f[k]).map((k) => `[${k}:: ${f[k]}]`).join(" ");
  return `> ${bare ? "" : "- "}${fields}\n>   "${f.quote}"`;
}

/** Set (or add) `[k:: v]` fields on `target`'s field line, leaving every other byte of the note
 *  alone. `target` is found by `findingKey`; null when the note no longer holds it. Values must not contain `]`. */
export function setFindingFields(note: string, target: Finding, fields: Record<string, string>): string | null {
  const key = findingKey(target);
  const hit = scanFindings(note).find((s) => findingKey(s.finding) === key);
  if (!hit) return null;
  const lines = note.split("\n");
  let l = lines[hit.line];
  for (const [k, v] of Object.entries(fields)) {
    const re = new RegExp(`\\[${k}::[^\\]]*\\]`);
    l = re.test(l) ? l.replace(re, () => `[${k}:: ${v}]`) : l.replace(/\s*$/, (tail) => ` [${k}:: ${v}]${tail}`);
  }
  lines[hit.line] = l;
  return lines.join("\n");
}

/** Add `incoming` findings to the Evidence section of `prefix` (the note above its stash): appended
 *  to the existing section (title recounted), or a new section at the end. Findings already there
 *  (or repeated in `incoming`) are skipped. `added` is how many were written. */
export function addFindings(prefix: string, incoming: Finding[]): { text: string; added: number } {
  const have = parseFindings(prefix);
  const seen = new Set(have.map(findingKey));
  const added: Finding[] = [];
  for (const f of incoming) {
    const key = findingKey(f);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(f);
  }
  if (!added.length) return { text: prefix, added: 0 };
  const section = evidenceSection(prefix);
  if (!section) {
    const n = added.length;
    return { text: `${prefix.replace(/\s*$/, "")}\n\n## Evidence (extracted)\n\n> [!quote]- ${n} finding${n === 1 ? "" : "s"}\n${added.map((f) => findingLines(f)).join("\n")}\n`, added: n };
  }
  const at = prefix.indexOf(section);
  const body = section.replace(/\s*$/, "");
  const tail = section.slice(body.length);
  const total = have.length + added.length;
  const retitled = body.replace(/^(> \[!quote\]-? )\d+ findings?/m, `$1${total} finding${total === 1 ? "" : "s"}`);
  // A section written inside a ```text fence (bare `[k:: v]` lines) grows inside that fence.
  const fenceEnd = /\n>[ \t]*```[ \t]*$/.exec(retitled);
  const grown =
    fenceEnd && /^>[ \t]*```text/m.test(retitled)
      ? `${retitled.slice(0, fenceEnd.index)}\n${added.map((f) => findingLines(f, true)).join("\n")}${retitled.slice(fenceEnd.index)}`
      : `${retitled}\n${added.map((f) => findingLines(f)).join("\n")}`;
  return { text: prefix.slice(0, at) + `${grown}${tail || "\n"}` + prefix.slice(at + section.length), added: added.length };
}

/** `addFindings` on a whole note — or, with `replace`, after dropping the existing section. The
 *  Evidence section lives above the `## Full text (extracted)` stash, which is left untouched. */
export function saveFindings(note: string, incoming: Finding[], replace: boolean): { text: string; added: number; total: number } {
  const cut = note.indexOf(STASH_MARKER);
  let prefix = cut < 0 ? note : note.slice(0, cut);
  const suffix = cut < 0 ? "" : note.slice(cut);
  const old = replace ? evidenceSection(prefix) : null;
  if (old) {
    const at = prefix.indexOf(old);
    prefix = prefix.slice(0, at) + prefix.slice(at + old.length);
  }
  const r = addFindings(prefix, incoming);
  return { text: suffix ? `${r.text.replace(/\s*$/, "")}\n\n${suffix}` : r.text, added: r.added, total: parseFindings(r.text).length };
}

/** Comparison form for the verbatim-quote guard: curly quotes / dashes folded, whitespace collapsed, lower case. */
export function normalizeQuote(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−­]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True when `quote` occurs in `source` after `normalizeQuote` on both. */
export function quoteInSource(quote: string, source: string): boolean {
  const q = normalizeQuote(quote);
  return q.length > 0 && normalizeQuote(source).includes(q);
}

/** Validate `save_reference_findings` input into Findings (whitespace collapsed, empty optional
 *  values dropped); throws `INVALID_ARGUMENT: …` for unknown keys, a bad `kind`, a missing outcome
 *  or quote, or a value the parser would not read back unchanged. */
export function parseFindingInput(raw: unknown): Finding[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error("INVALID_ARGUMENT: findings must be a non-empty array");
  const allowed = new Set<string>([...FINDING_KEYS, "quote"]);
  return raw.map((r: unknown, i) => {
    const at = `findings[${i}]`;
    if (typeof r !== "object" || r === null || Array.isArray(r)) throw new Error(`INVALID_ARGUMENT: ${at} must be an object`);
    const o = r as Record<string, unknown>;
    const unknown = Object.keys(o).filter((k) => !allowed.has(k));
    if (unknown.length) throw new Error(`INVALID_ARGUMENT: ${at} has unknown field${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")}; allowed: ${[...allowed].join(", ")}`);
    const vals: Record<string, string> = {};
    for (const k of allowed) {
      const v = o[k];
      if (v === undefined || v === null) continue;
      if (typeof v !== "string" && typeof v !== "number") throw new Error(`INVALID_ARGUMENT: ${at}.${k} must be a string`);
      const t = String(v).replace(/\s+/g, " ").trim();
      if (t) vals[k] = t;
    }
    if (vals.kind !== "comparative" && vals.kind !== "prognostic") throw new Error(`INVALID_ARGUMENT: ${at}.kind must be "comparative" or "prognostic"`);
    if (!vals.outcome) throw new Error(`INVALID_ARGUMENT: ${at}.outcome is required`);
    if (!vals.quote) throw new Error(`INVALID_ARGUMENT: ${at}.quote is required`);
    const f = vals as unknown as Finding;
    // The write format must read back unchanged (a lone "]" in a value would not).
    const back = parseFindings(`## Evidence (extracted)\n\n${findingLines(f)}\n`);
    if (back.length !== 1 || findingKey(back[0]) !== findingKey(f)) {
      throw new Error(`INVALID_ARGUMENT: ${at} has a value the note format cannot hold (unbalanced "[" or "]")`);
    }
    return f;
  });
}
