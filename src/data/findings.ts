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

const OPTIONAL = ["intervention", "comparator", "predictor", "subgroup", "timepoint", "n", "studies", "effect", "ci", "p", "direction", "heterogeneity"] as const;

export function parseFindings(markdown: string): Finding[] {
  const section = evidenceSection(markdown);
  if (!section) return [];
  const out: Finding[] = [];
  let fields: Map<string, string> | null = null;
  const flush = (quote: string) => {
    const kind = fields?.get("kind");
    const outcome = fields?.get("outcome");
    if (fields && quote && outcome && (kind === "comparative" || kind === "prognostic")) {
      const f: Finding = { kind, outcome, quote };
      for (const k of OPTIONAL) { const v = fields.get(k); if (v) f[k] = v; }
      out.push(f);
    }
    fields = null;
  };
  for (const raw of section.split(/\r?\n/)) {
    const line = raw.replace(/^>\s?/, "");
    // `- [k:: v]` list lines (first format) or bare `[k:: v]` lines inside a ```text fence (current:
    // Obsidian keeps metadata for every list item, ~0.8 GB of heap across 140k findings).
    if (/^(- )?\[[A-Za-z_]+::/.test(line)) {
      fields = new Map();
      for (const m of line.matchAll(/\[([A-Za-z_]+)::\s*([^\]]*)\]/g)) fields.set(m[1].toLowerCase(), m[2].trim());
    } else if (fields) {
      const q = /^\s+"(.*)"\s*$/.exec(line);
      if (q) flush(q[1].trim());
    }
  }
  return out;
}

/** One line for reranking / lexical scoring. */
export function findingText(f: Finding): string {
  const who = f.intervention ? `${f.intervention}${f.comparator ? ` vs ${f.comparator}` : ""}` : f.predictor ?? "";
  return [f.outcome, who, f.timepoint, f.effect, f.p ? `p ${f.p}` : "", f.quote].filter(Boolean).join("; ");
}
