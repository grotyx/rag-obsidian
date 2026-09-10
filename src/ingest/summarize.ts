import { CSLItem, SummarySections } from "../types";
import { LLMClient } from "../llm/client";

const LANG_NAME: Record<string, string> = { en: "English", ko: "Korean" };

/** Delimiter format (not JSON): JSON string-escaping mangles multibyte non-Latin text when the
 *  model emits stray/invalid \u escapes. Plain ===MARKERS=== are language-safe.
 *
 *  `language` is "en" | "ko" | "en+ko" (legacy default, both blocks) | any free-text language
 *  name. Only "en+ko" emits the extra ===KR=== block; every other mode writes the structured
 *  BACKGROUND/METHODS/RESULTS/CONCLUSIONS sections directly in the target language. MeSH headings
 *  stay in English (NLM's canonical vocabulary) regardless of summary language. */
export function buildSysPrompt(language: string): string {
  const wantsBoth = language === "en+ko";
  const structuredLang = wantsBoth ? "English" : LANG_NAME[language] || language || "English";
  const langLine =
    wantsBoth || language === "en" || !language
      ? ""
      : `- Write the BACKGROUND/METHODS/RESULTS/CONCLUSIONS sections in ${structuredLang}, not English.\n`;
  const krRules = wantsBoth
    ? "- Korean summary must stay concise (4-7 sentences) and cover the main findings in sentence form.\n"
    : "";
  const krMarker = wantsBoth
    ? "===KR===\n<Concise Korean summary in sentence form>\n"
    : "";
  return `You are a meticulous biomedical research summarizer for a citation manager.
Given a paper's source text (abstract, or full text when available), produce a faithful, detailed summary.
Rules:
- Do NOT invent facts. Use only what the source states.
- Preserve ALL quantitative results: sample sizes, p-values, confidence intervals, means, SDs, ranges, percentages, follow-up durations.
- Write in complete sentences, never bullet fragments or single keywords.
- The ${structuredLang} sections must be THOROUGH and detailed: do not omit secondary outcomes, subgroup or per-timepoint results, comparator arms, effect sizes, adverse events, or the authors' stated limitations. When the full text is available, draw specifics from it (design details, inclusion/exclusion criteria, surgical/technical steps, statistical methods). Length is not constrained — prioritize completeness over brevity for the ${structuredLang} sections.
${krRules}${langLine}Output EXACTLY this layout with these markers, nothing before or after. Put the prose on the lines under each marker:
===BACKGROUND===
<Background / Objective, full sentences>
===METHODS===
<Study design, population, interventions, outcome measures, statistics>
===RESULTS===
<All key numeric results in sentences>
===CONCLUSIONS===
<Authors' conclusions plus any noted limitations>
${krMarker}===MESH===
<5-10 indexing terms for this paper, comma-separated. Use official NLM MeSH Descriptor headings where one applies (e.g. "Diskectomy", "Lumbar Vertebrae", "Intervertebral Disc Displacement", "Endoscopy"); otherwise a precise topical noun phrase. Terms only, no explanations.>`;
}

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

/** Summarize a paper's source text via the configured LLM, in the given summary language
 *  ("en" | "ko" | "en+ko" | free-text language name — see `buildSysPrompt`). */
export async function summarizeSource(
  llm: LLMClient,
  item: CSLItem,
  sourceText: string,
  sourceLabel: string,
  language = "en+ko"
): Promise<SummarySections> {
  const year = item.issued?.["date-parts"]?.[0]?.[0] ?? "n.d.";
  const header =
    `Title: ${item.title}\nJournal: ${item["container-title"] || ""} (${year})\n` +
    `Source type: ${sourceLabel}\n\n`;
  const user = header + sourceText.slice(0, 120000);
  const reply = await llm.chat([{ role: "user", content: user }], buildSysPrompt(language), {
    reasoningEffort: "high",
    // The paper is in front of the model and the section headings are fixed: this is structured
    // extraction, not deliberation, so OpenRouter's thinking pass is skipped (see llm/client.ts).
    noReasoning: true,
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
  return llm.chat(
    [{ role: "user", content: user }],
    `You assign MeSH headings. Reply with ${wanted} official NLM MeSH headings for this article, ` +
      "ONE PER LINE, nothing else. Keep NLM's inverted form exactly as published " +
      '("Decompression, Surgical" — the comma is part of the heading).',
    // Same reason summarizeSource asks for 8192: a reasoning model spends the budget on thinking
    // first, and a reply that never reaches the text block comes back empty.
    { maxTokens: 4096, noReasoning: true }
  );
}

/** Split a MeSH reply into candidate headings.
 *
 *  One per line, because NLM publishes inverted names that contain commas ("Decompression,
 *  Surgical", "Diabetes Mellitus, Type 2") — splitting on commas turns one real heading into two
 *  fragments, and "Surgical" happens to be a heading of its own, so the damage is silent.
 *  No prose filtering here: every candidate is checked against the MeSH database, and anything
 *  the database does not recognise is dropped rather than guessed at. */
export function parseMeshList(reply: string): string[] {
  const marked = reply.match(/===MESH===([\s\S]*?)(?:===MESH===|$)/i);
  return (marked ? marked[1] : reply)
    .split(/[\n;]+/)
    .flatMap((line) => {
      const prose = line.match(/^\s*(?:here (?:are|is)|the following).*?mesh.*?:\s*(.+)$/i);
      return prose ? prose[1].split(",") : [line];
    })
    .map((line) =>
      line
        // list markers only: "- ", "* ", "1. ", "2) " — never a leading digit of a real heading
        // such as "5-Methylcytosine" or "3T3 Cells"
        .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
        .replace(/[.?!]+$/, "")
        .trim()
    )
    // Generous: a model that ignores "one per line" sends the whole list as one line, and the
    // MeSH database — not a length heuristic — decides what is a heading (see canonicalizeMeshTerms).
    .filter((t) => t.length > 2 && t.length <= 300);
}
