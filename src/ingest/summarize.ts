import { CSLItem, SummarySections } from "../types";
import { LLMClient } from "../llm/client";

// Delimiter format (not JSON): JSON string-escaping mangles multibyte Korean when the
// model emits stray/invalid \u escapes. Plain ===MARKERS=== are language-safe.
const SYS_PROMPT = `You are a meticulous biomedical research summarizer for a citation manager.
Given a paper's source text (abstract, or full text when available), produce a faithful, detailed summary.
Rules:
- Do NOT invent facts. Use only what the source states.
- Preserve ALL quantitative results: sample sizes, p-values, confidence intervals, means, SDs, ranges, percentages, follow-up durations.
- Write in complete sentences, never bullet fragments or single keywords.
- The English sections must be THOROUGH and detailed: do not omit secondary outcomes, subgroup or per-timepoint results, comparator arms, effect sizes, adverse events, or the authors' stated limitations. When the full text is available, draw specifics from it (design details, inclusion/exclusion criteria, surgical/technical steps, statistical methods). Length is not constrained — prioritize completeness over brevity for the English sections.
- Korean summary must stay concise (4-7 sentences) and cover the main findings in sentence form.
Output EXACTLY this layout with these six markers, nothing before or after. Put the prose on the lines under each marker:
===BACKGROUND===
<Background / Objective, full sentences>
===METHODS===
<Study design, population, interventions, outcome measures, statistics>
===RESULTS===
<All key numeric results in sentences>
===CONCLUSIONS===
<Authors' conclusions plus any noted limitations>
===KR===
<Concise Korean summary in sentence form>
===MESH===
<5-10 indexing terms for this paper, comma-separated. Use official NLM MeSH Descriptor headings where one applies (e.g. "Diskectomy", "Lumbar Vertebrae", "Intervertebral Disc Displacement", "Endoscopy"); otherwise a precise topical noun phrase. Terms only, no explanations.>`;

const KEY_MAP: Record<string, keyof SummarySections> = {
  BACKGROUND: "background",
  METHODS: "methods",
  RESULTS: "results",
  CONCLUSIONS: "conclusions",
  KR: "kr",
  MESH: "mesh",
};

export function parseSections(text: string): SummarySections {
  const re = /===\s*(BACKGROUND|METHODS|RESULTS|CONCLUSIONS|KR|MESH)\s*===/gi;
  const marks: { key: keyof SummarySections; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    marks.push({ key: KEY_MAP[m[1].toUpperCase()], start: m.index, end: re.lastIndex });
  }
  const out: SummarySections = {};
  for (let i = 0; i < marks.length; i++) {
    const next = i + 1 < marks.length ? marks[i + 1].start : text.length;
    const body = text.slice(marks[i].end, next).trim();
    if (body) out[marks[i].key] = body;
  }
  return out;
}

/** Summarize a paper's source text into section-wise EN + concise KR via the configured LLM. */
export async function summarizeSource(
  llm: LLMClient,
  item: CSLItem,
  sourceText: string,
  sourceLabel: string
): Promise<SummarySections> {
  const year = item.issued?.["date-parts"]?.[0]?.[0] ?? "n.d.";
  const header =
    `Title: ${item.title}\nJournal: ${item["container-title"] || ""} (${year})\n` +
    `Source type: ${sourceLabel}\n\n`;
  const user = header + sourceText.slice(0, 120000);
  const reply = await llm.chat([{ role: "user", content: user }], SYS_PROMPT, {
    reasoningEffort: "high",
    // 8192: the smallest ceiling among current Anthropic models, and 8x the old 1024 default —
    // enough for EN sections + KR + MESH plus a reasoning model's thinking budget.
    maxTokens: 8192,
  });
  const out = parseSections(reply);
  if (!out.background && !out.results && !out.kr) {
    throw new Error("LLM did not return a parseable summary");
  }
  return out;
}

/** Ask only for MeSH headings — used when a note already has its summary but too few tags,
 *  so there is no MeSH line left to reuse (the summary body never stored one). Short prompt,
 *  short answer: this is a fraction of the cost of re-summarizing the paper. */
export async function suggestMeshTerms(
  llm: LLMClient,
  item: CSLItem,
  sourceText: string,
  wanted = 8
): Promise<string> {
  const year = item.issued?.["date-parts"]?.[0]?.[0] ?? "n.d.";
  const user =
    `Title: ${item.title}\nJournal: ${item["container-title"] || ""} (${year})\n\n` +
    sourceText.slice(0, 12000);
  const reply = await llm.chat(
    [{ role: "user", content: user }],
    `You assign MeSH headings. Reply with ${wanted} official NLM MeSH headings for this article ` +
      "between ===MESH=== markers, comma-separated, nothing else.\n\n===MESH===\nHeading, Heading\n===MESH===",
    // Same reason summarizeSource asks for 8192: a reasoning model spends the budget on thinking
    // first, and a reply that never reaches the text block comes back empty.
    { maxTokens: 4096 }
  );
  return parseMeshLine(reply);
}

/** Pull the heading list out of a reply, tolerating a model that adds a sentence around it.
 *  Unmatched terms survive canonicalisation verbatim, so prose here becomes a junk tag. */
export function parseMeshLine(reply: string): string {
  const marked = reply.match(/===MESH===([\s\S]*?)(?:===MESH===|$)/i);
  const body = (marked ? marked[1] : reply).replace(/^[\s\S]*?:\s*/, "").trim();
  const terms = body
    .split(/[,;\n]+/)
    .map((t) => t.replace(/^[-*\d.\s]+/, "").trim())
    // A MeSH heading is short and has no sentence punctuation; anything else is commentary.
    .filter((t) => t.length > 2 && t.length <= 60 && !/[.?!:]$/.test(t) && t.split(/\s+/).length <= 6);
  return terms.join(", ");
}

