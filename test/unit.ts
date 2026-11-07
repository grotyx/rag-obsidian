/**
 * Offline unit tests for the pure functions in src/ingest/* and src/data/*.
 *
 * These cover what test/integration.ts and test/mcp.ts do not: deterministic,
 * network-free assertions over parsing, normalization, and note-building logic.
 * Nothing here touches the network, the vault, or Ollama.
 *
 * Run: esbuild bundles this with `obsidian` aliased to ./obsidian-shim.ts.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import nodeFs from "node:fs";
import nodeOs from "node:os";
import nodePath from "node:path";
import { VectorStore } from "../src/index/store";
import { TextIndex, tokenize } from "../src/index/textIndex";
import { create, insertMultiple, search, MODE_HYBRID_SEARCH, AnyOrama, SearchParams } from "@orama/orama";

import { parseLibrary } from "../src/ingest/import";
import { parseCollections, parseCslPage } from "../src/ingest/zotero";
import "./dom-shim"; // globalThis.DOMParser for fetchPubmedRecord's XML path
import { cleanDoi, detectId, splitName, parsePubDate, esummaryToItem, extractAbstractXml, fetchMetadata } from "../src/ingest/metadata";
import { ncbiGapMs, ncbiGate, resetNcbiGate } from "../src/ingest/ncbi";
import { findIdentifier, titleInHead, isPdfMagic, extractPdfHighlights, setPdfjsLoader } from "../src/ingest/pdf";
import { hasStashedText, appendStash, resolvePdfLink, stashedText, STASH_MARKER, STASH_MAX_CHARS } from "../src/ingest/pdfStash";
import { buildSysPrompt, parseSections, parseMeshList } from "../src/ingest/summarize";
import { buildTags, MIN_TAGS, fetchPubmedRecord } from "../src/ingest/pubmedSearch";
import { findOpenAccess } from "../src/ingest/unpaywall";
import { checkRetraction } from "../src/ingest/retraction";
import { CitationGraph } from "../src/graph/citations";
import { itemMemo } from "../src/cite/itemMemo";
import { inTextLabel } from "../src/cite/bibliography";
import { parseCitingPage, titlesMatch, resolveWork } from "../src/graph/openalex";
import { rerankHttpReason, mmr, parseRerankResponse, canHostedRerank } from "../src/index/rerank";
import { requestWithRetry } from "../src/llm/client";
import { mergeDuplicateGroups } from "../src/commands/merge";
import { isStaleSummary, staleModelGroups } from "../src/commands/summaries";
import { TFile, parseYaml } from "obsidian";
import {
  buildCliArgs,
  cliCandidates,
  cliBinaryAllowed,
  cliInsideVault,
  runCli,
  setCliVaultRoot,
  buildCliEnv,
  parseOpencodeOutput,
  promptFromMessages,
  shouldUseShell,
  spawnInvocation,
  winQuote,
} from "../src/llm/cli";
import { windowsCliShimChecks } from "./windows";
import { cacheRoot, legacyCacheRoot, NodeFileIO } from "../src/index/localFiles";
import { pandocCandidates, pandocSuperscripts } from "../src/write/pandoc";
import { stripFrontmatter, chunkReference, yearFromIssued } from "../src/index/chunker";
import { parseFindings, findingText, isRestated, Finding } from "../src/data/findings";
import { evidenceCsv, collectEvidenceRows } from "../src/commands/evidenceExport";
import { referenceProblems, refcheckReport, problemSeverity, PROBLEM_UNCHECKED, PROBLEM_THIN, PROBLEM_PREPRINT } from "../src/write/refcheck";
import { parseStyleIndex } from "../src/cite/styleIndex";
import {
  duplicateGroups,
  inScope,
  matchKeys,
  normDoi,
  normTitle,
  RefEntry,
  Library,
} from "../src/data/library";
import { OllamaProvider } from "../src/index/providers/ollama";
import { ScholarRagSettingTab } from "../src/settings";
import { filterAndSort } from "../src/ui/libraryFilter";
import { matchPdf, PdfCandidate } from "../src/data/pdfMatch";
import {
  pickKeeper,
  mergeFrontmatter,
  mergeBodies,
  planMerge,
  renameWikilinks,
  splitNote,
  MergeNote,
  MergeSourceNote,
} from "../src/data/merge";
import {
  extractSummaryBlock,
  renameCiteKeys,
  replaceCitations,
  extractCitekeys,
  anchorsToCitekeys,
  splitAtReferences,
  replaceSummaryBlock,
  parseCiteItems,
} from "../src/cite/bibliography";
import { CiteEngine, PLUGIN_FIELDS } from "../src/cite/csl";
import { exportRefs } from "../src/cite/export";
import { renderCompiledManuscript } from "../src/write/manuscript";
import { paragraphsOf } from "../src/write/evidence";
import { readFileSync } from "node:fs";
import { isForeignQuery, buildExpander, expandedTerm, parseVocabulary } from "../src/index/expand";
import { citeTooltip } from "../src/cite/format";
import { citeClusters } from "../src/cite/clusters";
import { isNumberArray, numLike, text } from "../src/util/json";
import {
  getYear,
  firstAuthorFamily,
  slug,
  firstTitleWord,
  generateCitekey,
  journalAbbr,
  authorTag,
  generateFilename,
  tagSlug,
  keywordsToTags,
  summaryBlock,
  buildNote,
  localDate,
} from "../src/data/reference";
import { DEFAULT_SETTINGS, effective } from "../src/types";
import { applyScreening, hasKq, kqChoices, kqKey } from "../src/data/screening";
import { robMarkdown, RobRecord, toRobRecord } from "../src/data/rob";
import { prismaCounts, prismaMarkdown, PrismaRecord, toPrismaRecord } from "../src/data/prisma";
import { aggregateSnowball, pickSnowballCandidates, snowballMarkdown, SnowballRecord, SnowballWork } from "../src/data/snowball";
import { searchLogNote, suffixedPath, parseSearchLog, searchLogTotals, countedSearchLogs } from "../src/data/searchLog";

let passed = 0;
function check(cond: boolean, label: string): void {
  assert.ok(cond, label);
  passed++;
}

async function main(): Promise<void> {
// ---------- commands/summaries.ts: isStaleSummary ----------
{
  const M = "deepseek/deepseek-v4-flash-0731";
  const st = (summary_source: string | undefined, summary_model?: string) => isStaleSummary({ summary_source, summary_model }, M);
  check(st("pubmed-abstract", "deepseek/old-model"), "stale: plugin abstract summary from another model");
  check(st("pmc-fulltext"), "stale: no summary_model recorded (predates the field)");
  check(!st("pubmed-abstract", M), "stale: current model is not stale");
  check(!st("pdf-fulltext", "deepseek/old-model"), "stale: pdf-fulltext summaries are never redone from the abstract");
  check(!st("stored-abstract", "x"), "stale: MCP-only source is skipped");
  check(!st(undefined, "x"), "stale: no summary at all is not stale");
  // Which model to redo is the user's pick, so every other model is a candidate group.
  const ents = [
    { item: { summary_source: "pubmed-abstract", summary_model: "opencode-go/muse" } },
    { item: { summary_source: "pmc-fulltext", summary_model: "opencode-go/muse" } },
    { item: { summary_source: "pubmed-abstract", summary_model: "codex:gpt-6-luna" } },
    { item: { summary_source: "pdf-fulltext", summary_model: "codex:gpt-6-luna" } },
    { item: { summary_source: "pubmed-abstract", summary_model: M } },
    { item: { summary_source: "pmc-fulltext" } },
  ];
  const g = staleModelGroups(ents, M);
  check(
    g.map((x) => `${x.model}:${x.entries.length}`).join(",") === "opencode-go/muse:2,codex:gpt-6-luna:1,:1",
    `staleModelGroups: grouped per model, most first, pdf-fulltext and the current model left out (${g.map((x) => `${x.model}:${x.entries.length}`).join(",")})`
  );
}

// ---------- write/refcheck.ts + cite/styleIndex.ts ----------
{
  const good = { type: "article-journal", title: "T", author: [{ family: "A" }], issued: { "date-parts": [[2020]] },
    "container-title": "J", volume: "1", page: "1-2", DOI: "10.1/x" };
  const OK = { retracted: false };
  check(referenceProblems(good, OK).length === 0, "refcheck: complete reference has no problems");
  check(referenceProblems(null, {})[0] === "not in the library", "refcheck: missing item");
  check(referenceProblems({ ...good, DOI: undefined }, OK).includes("no DOI or PMID"), "refcheck: no DOI");
  check(referenceProblems({ ...good, DOI: undefined, PMID: "1" }, OK).length === 0, "refcheck: PMID suffices");
  check(referenceProblems({ ...good, title: undefined }, OK).includes("missing title"), "refcheck: title");
  check(referenceProblems({ ...good, author: [] }, OK).includes("missing authors"), "refcheck: authors");
  check(referenceProblems({ ...good, issued: undefined }, OK).includes("missing year"), "refcheck: year");
  check(referenceProblems({ ...good, "container-title": undefined }, OK).includes("missing journal"), "refcheck: journal");
  check(referenceProblems({ ...good, volume: undefined, page: undefined }, OK).includes("incomplete: volume, pages"), "refcheck: volume/pages");
  check(referenceProblems({ ...good, type: "book", volume: undefined, "container-title": undefined }, OK).length === 0, "refcheck: volume only for journal articles");
  const rep = refcheckReport("ms", [{ key: "a", problems: [] }, { key: "b", problems: ["no DOI or PMID"] }], ["note x"]);
  check(rep.includes("2 cited, 1 with problems") && rep.includes("| `b` | no DOI or PMID |") && !rep.includes("`a`") && rep.includes("- note x"), "refcheckReport: table of problem rows only");
  const BODY = "## Summary\n\ntext\n";
  const none = (it: typeof good, fm: Record<string, unknown> = OK, body?: string) => referenceProblems(it, fm, body);
  check(referenceProblems(good, { retracted: true }).includes("retracted") && referenceProblems(good, { retracted: "true" }).includes("retracted"), "refcheck: retracted flag");
  check(problemSeverity("retracted") === 0 && problemSeverity("no DOI or PMID") === 1 && problemSeverity(PROBLEM_UNCHECKED) === 2 && problemSeverity(PROBLEM_THIN) === 2, "refcheck: severities");
  check(referenceProblems(good, { retracted: true }).every((p) => p !== PROBLEM_UNCHECKED), "refcheck: retracted is not 'unchecked'");
  check(none(good).length === 0 && !none(good).includes(PROBLEM_UNCHECKED), "refcheck: retracted:false counts as checked");
  check(referenceProblems(good, {}).includes(PROBLEM_UNCHECKED) && referenceProblems(good, { retracted: null }).includes(PROBLEM_UNCHECKED), "refcheck: no retracted field -> unchecked, names the command");
  check(PROBLEM_UNCHECKED.includes("Check retraction status for all references"), "refcheck: unchecked message names the command");
  for (const ct of ["medRxiv", "bioRxiv", "arXiv", "Research Square", "SSRN Electronic Journal", "Preprints.org"]) check(none({ ...good, "container-title": ct }).includes(PROBLEM_PREPRINT), `refcheck: preprint by container ${ct}`);
  check(none({ ...good, publisher: "Cold Spring Harbor: bioRxiv" }).includes(PROBLEM_PREPRINT), "refcheck: preprint by publisher");
  check(!none({ ...good, type: "article" }).includes(PROBLEM_PREPRINT) && !none({ ...good, type: "post" }).includes(PROBLEM_PREPRINT), "refcheck: CSL type alone (a BibTeX @misc) is not a preprint");
  check(none({ ...good, type: "article", "container-title": "medRxiv" }).includes(PROBLEM_PREPRINT), "refcheck: medRxiv article is a preprint");
  check(none({ ...good, type: "article", "container-title": "arXiv", URL: "https://arxiv.org/abs/2401.00001", keyword: ["preprint", "arxiv"] }).includes(PROBLEM_PREPRINT), "refcheck: arXiv item is a preprint");
  check(none({ ...good, type: "article", "container-title": undefined, publisher: "Cold Spring Harbor Laboratory", DOI: "10.1101/2024.01.02.123456" }).includes(PROBLEM_PREPRINT), "refcheck: Crossref bioRxiv/medRxiv posted-content by DOI");
  check(!none({ ...good, DOI: "10.1101/gr.123456.120" }).includes(PROBLEM_PREPRINT), "refcheck: a 10.1101 journal DOI is not a preprint");
  check(none({ ...good, type: "article", genre: "Preprint" }).includes(PROBLEM_PREPRINT), "refcheck: genre preprint");
  check(none({ ...good, URL: "https://www.medrxiv.org/content/10.1101/x" }).includes(PROBLEM_PREPRINT), "refcheck: preprint-server URL");
  check(!none(good).includes(PROBLEM_PREPRINT), "refcheck: journal article is not a preprint");
  check(!none(good, OK, BODY).includes(PROBLEM_THIN) && !none(good, OK, "## 요약 (KR)\nx").includes(PROBLEM_THIN), "refcheck: summary block is enough");
  check(!none(good, OK, "abstract\n\n## Full text (extracted)\n\nlong").includes(PROBLEM_THIN), "refcheck: stashed text is enough");
  check(none(good, OK, "abstract only\n").includes(PROBLEM_THIN), "refcheck: thin evidence");
  check(!none(good).includes(PROBLEM_THIN), "refcheck: thin evidence skipped without a body");
  const sev = refcheckReport("ms", [
    { key: "r", problems: [PROBLEM_UNCHECKED, "retracted"] },
    { key: "m", problems: ["no DOI or PMID"] },
    { key: "l", problems: [PROBLEM_THIN] },
  ]);
  check(sev.includes("By severity: 1 retracted, 1 needs attention, 2 low severity.") && sev.indexOf("## Retracted") < sev.indexOf("## Needs attention") && sev.indexOf("## Needs attention") < sev.indexOf("## Low severity"), "refcheckReport: count line and severity order");
  check(sev.includes("| `r` | retracted |") && sev.includes("| `r` | " + PROBLEM_UNCHECKED + " |"), "refcheckReport: a key's problems split by severity");
  check(refcheckReport("ms", [{ key: "a", problems: [] }]).includes("All 1 references look complete."), "refcheckReport: all complete");

  const idx = parseStyleIndex([
    { title: "Spine", titleShort: "Spine", name: "spine", dependent: 0, categories: { format: "numeric", fields: [] } },
    { title: "Nature", titleShort: "Nat", name: "nature", categories: { format: "numeric" } },
    { title: "", name: "bad" }, "junk", { title: "No id" },
  ]);
  check(idx.length === 2 && idx[0].short === undefined && idx[1].short === "Nat" && idx[1].format === "numeric", "parseStyleIndex: reduces, drops bad rows and redundant short titles");
  check(parseStyleIndex({}).length === 0 && parseStyleIndex(null).length === 0, "parseStyleIndex: non-array → []");
}

// ---------- ingest/import.ts: parseLibrary ----------
{
  check(JSON.stringify(parseLibrary("")) === "[]", "parseLibrary: empty string → []");
  check(JSON.stringify(parseLibrary("   \n ")) === "[]", "parseLibrary: whitespace → []");
  check(JSON.stringify(parseLibrary("{not json")) === "[]", "parseLibrary: malformed JSON → []");

  const csl = parseLibrary(JSON.stringify([
    { id: "old-key", type: "article-journal", title: "Deep Learning", author: [{ family: "LeCun" }] },
  ]));
  check(csl.length === 1 && csl[0].title === "Deep Learning", "parseLibrary: CSL-JSON array");
  check(!("id" in (csl[0] as Record<string, unknown>)), "parseLibrary: CSL-JSON drops id (citekey regenerated)");

  const single = parseLibrary(JSON.stringify({ title: "No Type" }));
  check(single.length === 1 && single[0].type === "article-journal", "parseLibrary: single object defaults type");

  const bib = parseLibrary(`@article{lecun2015,
  title={Deep learning},
  author={LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},
  journal={Nature},
  year={2015},
  volume={521},
  pages={436--444},
  doi={10.1038/nature14539}
}`);
  check(bib.length === 1, "parseLibrary: BibTeX parses one entry");
  check(bib[0].title === "Deep learning", "parseLibrary: BibTeX title");
  check(bib[0].author?.length === 3 && bib[0].author?.[0].family === "LeCun", "parseLibrary: BibTeX authors (Last, First)");
  check(bib[0].issued?.["date-parts"]?.[0]?.[0] === 2015, "parseLibrary: BibTeX year → issued");
  check(bib[0].DOI === "10.1038/nature14539", "parseLibrary: BibTeX DOI");
  check(bib[0].page === "436-444", "parseLibrary: BibTeX -- → - in pages");

  const skip = parseLibrary(`@string{jmlr = {J. Mach. Learn. Res.}}\n@misc{x, title={T}, year={2020}}`);
  check(skip.length === 1 && skip[0].title === "T", "parseLibrary: BibTeX skips @string");

  const ris = parseLibrary(`TY  - JOUR
TI  - Attention is all you need
AU  - Vaswani, Ashish
JO  - NeurIPS
VL  - 30
PY  - 2017
DO  - 10.48550/arXiv.1706.03762
ER  -
`);
  check(ris.length === 1 && ris[0].type === "article-journal", "parseLibrary: RIS JOUR type");
  check(ris[0].title === "Attention is all you need", "parseLibrary: RIS title");
  check(ris[0].author?.[0].family === "Vaswani", "parseLibrary: RIS author");

  const nbib = parseLibrary(`PMID- 12345678
TI  - Lumbar disk herniation surgery
FAU - Park, Sang-Min
DP  - 2020 Mar 15
JT  - Spine
AB  - An abstract here.
AID - 10.1000/xyz123 [doi]
`);
  check(nbib.length === 1 && nbib[0].PMID === "12345678", "parseLibrary: NBIB PMID");
  check(nbib[0].DOI === "10.1000/xyz123", "parseLibrary: NBIB DOI from AID");
  check(nbib[0].issued?.["date-parts"]?.[0]?.[0] === 2020, "parseLibrary: NBIB year");

  // nbib without FAU: AU is "Family Initials", not a "Given Family" name
  const au = parseLibrary(`PMID- 1\nTI  - T\nAU  - Smith JA\nAU  - van der Berg KL\n`);
  check(
    au[0].author?.[0].family === "Smith" && au[0].author?.[0].given === "JA" && au[0].author?.[1].family === "van der Berg",
    `parseLibrary: NBIB AU is Family Initials (${JSON.stringify(au[0].author)})`
  );

  // RIS: wrapped lines continue the previous value
  const risWrap = parseLibrary(`TY  - JOUR\nTI  - A long title that\n  wraps here\nAB  - First line of the abstract\nsecond line.\nDO  - https://dx.doi.org/10.1000/abc\nER  -\n`);
  check(risWrap[0].title === "A long title that wraps here", `parseLibrary: RIS title continuation (${risWrap[0].title})`);
  check(risWrap[0].abstract === "First line of the abstract second line.", "parseLibrary: RIS abstract continuation");
  check(risWrap[0].DOI === "10.1000/abc", "parseLibrary: RIS strips dx.doi.org prefix");
  check(parseLibrary(`TY  - JOUR\nTI  - T\nDO  - doi:10.1000/q\nER  -\n`)[0].DOI === "10.1000/q", "parseLibrary: RIS strips doi: prefix");

  // BibTeX: LaTeX accents, escapes, dashes, brace-aware author split, DOI prefixes
  const tex = parseLibrary(`@article{k,
  title = {M{\\"u}ller, Garc{\\'\\i}a and Fran\\c{c}ois: caf{\\'e} \\& co \\% 50--60 and 1---2 \\v{S}koda \\\`a \\^o \\~n},
  author = {M{\\"u}ller, Hans and {Food and Drug Administration} and Garc{\\'{\\i}}a, Jos{\\'e}},
  doi = {https://dx.doi.org/10.1000/tex},
  pages = {10--20},
  year = {2020}
}`);
  check(
    tex[0].title === "Müller, García and François: café & co % 50–60 and 1—2 Škoda à ô ñ",
    `parseLibrary: BibTeX accents/escapes/dashes (${tex[0].title})`
  );
  check(tex[0].author?.length === 3, `parseLibrary: BibTeX authors split at brace depth 0 (${tex[0].author?.length})`);
  check(tex[0].author?.[0].family === "Müller", "parseLibrary: BibTeX author accent decoded");
  check(tex[0].author?.[1].literal === "Food and Drug Administration", "parseLibrary: braced 'and' stays one corporate author");
  check(tex[0].author?.[2].family === "García" && tex[0].author?.[2].given === "José", "parseLibrary: BibTeX {\\'{\\i}} → í");
  check(tex[0].DOI === "10.1000/tex", "parseLibrary: BibTeX strips dx.doi.org prefix");
  check(tex[0].page === "10-20", "parseLibrary: BibTeX pages keep a plain hyphen");
  for (const [raw, want] of [["http://doi.org/10.1/a", "10.1/a"], ["https://doi.org/10.1/a", "10.1/a"], ["doi:10.1/a", "10.1/a"]]) {
    check(parseLibrary(`@article{k, title={T}, doi={${raw}}}`)[0].DOI === want, `parseLibrary: BibTeX DOI prefix ${raw}`);
  }
}

// ---------- ingest/metadata.ts: Crossref title cleanup, OtherAbstract ----------
{
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ message: { title: ["Effects of <i>Bacillus subtilis</i>\n   on gut\nflora"], type: "journal-article", DOI: "10.1101/522219" } }),
        { status: 200 }
      )) as typeof fetch;
    const it = await fetchMetadata({ kind: "doi", value: "10.1101/522219" });
    check(it.title === "Effects of Bacillus subtilis on gut flora", `fetchMetadata: Crossref title stripped of markup/newlines (${it.title})`);
  } finally {
    globalThis.fetch = realFetch;
  }

  const xml =
    `<PubmedArticle><Abstract><AbstractText Label="BACKGROUND">English bg.</AbstractText><AbstractText>English rest.</AbstractText></Abstract>` +
    `<OtherAbstract Type="Publisher" Language="spa"><AbstractText>Resumen en espanol.</AbstractText></OtherAbstract></PubmedArticle>`;
  check(extractAbstractXml(xml) === "BACKGROUND: English bg. English rest.", `extractAbstractXml: OtherAbstract excluded (${extractAbstractXml(xml)})`);

  try {
    globalThis.fetch = (async () => new Response(xml, { status: 200 })) as typeof fetch;
    resetNcbiGate();
    const r = await fetchPubmedRecord("42841137");
    check(!r.abstract.includes("Resumen") && r.abstract.includes("English rest."), `fetchPubmedRecord: OtherAbstract excluded (${r.abstract})`);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---------- ingest/metadata.ts ----------
{
  check(cleanDoi("10.1038/xxx.") === "10.1038/xxx", "cleanDoi: strips trailing period");
  check(cleanDoi("10.1038/xxx,") === "10.1038/xxx", "cleanDoi: strips trailing comma");

  check(detectId("10.1038/nature14539").kind === "doi", "detectId: bare DOI");
  const doiUrl = detectId("https://doi.org/10.1038/nature14539.");
  check(doiUrl.kind === "doi" && doiUrl.value === "10.1038/nature14539", "detectId: DOI URL with trailing period");
  check(detectId("PMID: 12345678").value === "12345678", "detectId: PMID prefix");
  check(detectId("12345678").kind === "pmid", "detectId: bare digits → pmid");
  const pmUrl = detectId("https://pubmed.ncbi.nlm.nih.gov/12345678/");
  check(pmUrl.kind === "pmid" && pmUrl.value === "12345678", "detectId: PubMed URL");
  const arx = detectId("arXiv:2101.12345v2");
  check(arx.kind === "arxiv" && arx.value === "2101.12345", "detectId: arXiv strips version");
  check(detectId("2101.12345").kind === "arxiv", "detectId: bare arXiv id");
  const oa = detectId("https://openalex.org/works/W12345");
  check(oa.kind === "openalex" && oa.value === "W12345", "detectId: OpenAlex URL");
  check(detectId("W12345").kind === "openalex", "detectId: bare OpenAlex id");
  check(detectId("not an identifier at all!!!").kind === "unknown", "detectId: unknown");

  const page = parseCitingPage({
    meta: { count: 412 },
    results: [
      {
        id: "https://openalex.org/W9", title: "Later trial", publication_year: 2026, is_retracted: true, type: "article",
        ids: { doi: "https://doi.org/10.1/x", pmid: "https://pubmed.ncbi.nlm.nih.gov/42" },
        primary_location: { source: { display_name: "Spine" } }, cited_by_count: 3,
      },
      { id: "https://openalex.org/W8", display_name: "Correction", type: "erratum", primary_location: null },
    ],
  });
  check(page.total === 412 && page.works.length === 2, "parseCitingPage: total from meta.count");
  const [w9, w8] = page.works;
  check(w9.openalexId === "W9" && w9.doi === "10.1/x" && w9.pmid === "42" && w9.year === 2026 && w9.journal === "Spine" && w9.retracted, "parseCitingPage: ids, year, journal, retracted");
  check(w8.title === "Correction" && w8.type === "erratum" && !w8.retracted && w8.journal === undefined && w8.year === undefined, "parseCitingPage: display_name fallback, missing source");
  check(parseCitingPage({ results: [] }).total === 0, "parseCitingPage: empty page");

  check(JSON.stringify(splitName("Park Sang-Min")) === JSON.stringify({ family: "Park", given: "Sang-Min" }), "splitName: family initials");
  check(JSON.stringify(splitName("Plato")) === JSON.stringify({ family: "Plato" }), "splitName: single token");

  check(parsePubDate("2020 Mar 15")?.["date-parts"]?.[0]?.join(",") === "2020,3,15", "parsePubDate: full date");
  check(parsePubDate("2020 Mar")?.["date-parts"]?.[0]?.join(",") === "2020,3", "parsePubDate: year+month");
  check(parsePubDate("2020")?.["date-parts"]?.[0]?.join(",") === "2020", "parsePubDate: year only");
  check(parsePubDate(undefined) === undefined, "parsePubDate: undefined → undefined");
  check(parsePubDate("") === undefined, "parsePubDate: empty → undefined");

  // esummaryToItem: shared esummary → CSLItem mapping (fetchPubMed + searchPubmedPage)
  const record = {
    title: "Effects of <i>Lumbar</i> Fusion",
    authors: [
      { name: "Park SM", authtype: "Author" },
      { name: "CTG Investigators", authtype: "CollectiveName" },
    ],
    fulljournalname: "Spine Journal",
    source: "Spine J",
    volume: "",
    issue: "4",
    pages: "100-110",
    pubdate: "2021 Jun",
    articleids: [
      { idtype: "doi", value: "10.1000/first-doi" },
      { idtype: "pmc", value: "PMC1234567" },
      { idtype: "doi", value: "10.1000/second-doi" },
    ],
  };
  const parsed = esummaryToItem("99999999", record);
  check(parsed !== null, "esummaryToItem: parses a record");
  check(parsed?.item.title === "Effects of Lumbar Fusion", "esummaryToItem: strips tags + collapses whitespace in title");
  check(
    parsed?.item.author?.length === 1 && parsed?.item.author?.[0].family === "Park" && parsed?.item.author?.[0].given === "SM",
    "esummaryToItem: drops non-Author authtype (collective name)"
  );
  check(parsed?.item.DOI === "10.1000/first-doi", "esummaryToItem: DOI articleid takes the first match");
  check(parsed?.pmc === "PMC1234567" && parsed?.item.PMCID === "PMC1234567", "esummaryToItem: PMCID set on the item and returned alongside");
  check(parsed?.item.volume === undefined, "esummaryToItem: empty-string volume → undefined");
  check(parsed?.item.issue === "4" && parsed?.item.page === "100-110", "esummaryToItem: issue/page pass through");
  check(parsed?.item.issued?.["date-parts"]?.[0]?.join(",") === "2021,6", "esummaryToItem: issued parsed from pubdate");
  check(parsed?.item.PMID === "99999999", "esummaryToItem: PMID set to the uid argument");

  // stripTags used to be `<[^>]+>`, which matched from the first "<" to the next ">" regardless
  // of what was between them — a literal comparator pair like "<65 and >80" ate everything in
  // the middle. The real tag-matching regex must leave a bare "<"/">" alone.
  const comparators = esummaryToItem("2", { title: "Outcomes in patients aged <65 and >80 years", articleids: [] });
  check(
    comparators?.item.title === "Outcomes in patients aged <65 and >80 years",
    `esummaryToItem: a literal comparator pair survives title cleanup, not just a real tag: "${comparators?.item.title}"`
  );
  // Entity-escaped markup decodes first and is then stripped like real markup.
  const escaped = esummaryToItem("3", { title: "Effect of &lt;i&gt;X&lt;/i&gt; on outcomes &amp; survival", articleids: [] });
  check(
    escaped?.item.title === "Effect of X on outcomes & survival",
    `esummaryToItem: entity-escaped text decodes (not left as "&lt;"/"&amp;"): "${escaped?.item.title}"`
  );

  const numericVolume = esummaryToItem("1", { title: "T", volume: 42, articleids: [] });
  check(numericVolume?.item.volume === "42", "esummaryToItem: numeric volume stringified (unquoted YAML/JSON)");

  check(esummaryToItem("1", { error: "cannot get document summary" }) === null, "esummaryToItem: error record → null");
  check(esummaryToItem("1", undefined) === null, "esummaryToItem: missing record → null");
}

// ---------- ingest/ncbi.ts ----------
{
  check(ncbiGapMs(true) === 110, "ncbiGapMs: keyed tier");
  check(ncbiGapMs(false) === 350, "ncbiGapMs: keyless tier");
  resetNcbiGate();
  const t0 = Date.now();
  await ncbiGate(false);
  await ncbiGate(false);
  const elapsed = Date.now() - t0;
  check(elapsed >= 300, `ncbiGate: second keyless call waits out the gap (waited ${elapsed}ms)`);
  resetNcbiGate();
}

// ---------- ingest/pdf.ts: findIdentifier ----------
{
  const doi = findIdentifier("Some paper text\nDOI: 10.1038/nature14539.\nMore text");
  check(doi?.kind === "doi" && doi?.value === "10.1038/nature14539", "findIdentifier: DOI in head");
  const arx = findIdentifier("arXiv:2101.12345 [cs.CL] 12 Jan 2021");
  check(arx?.kind === "arxiv" && arx?.value === "2101.12345", "findIdentifier: arXiv in head");
  check(findIdentifier("no identifiers here, just prose") === null, "findIdentifier: null when absent");
  check(findIdentifier("x".repeat(7000) + " 10.1038/nature14539") === null, "findIdentifier: ignores DOI past head window");
}

// ---------- ingest/pdf.ts: isPdfMagic ----------
{
  const pdfBytes = new TextEncoder().encode("%PDF-1.7\n...rest of file...").buffer;
  check(isPdfMagic(pdfBytes), "isPdfMagic: true on a real %PDF- header");
  const htmlBytes = new TextEncoder().encode("<!DOCTYPE html><html>landing page</html>").buffer;
  check(!isPdfMagic(htmlBytes), "isPdfMagic: false on an HTML landing page");
  check(!isPdfMagic(new ArrayBuffer(0)), "isPdfMagic: false on an empty buffer");
}

// ---------- ingest/pdf.ts: extractPdfHighlights — malformed quad point must not lose the highlight ----------
{
  // One quad point is missing x/y (→ NaN), so its bbox is non-finite. Before the fix, that NaN
  // rect was still pushed (rects.length > 0), which skipped the `ann.rect` fallback below and
  // silently dropped the highlight text. It must fall back to `ann.rect` instead.
  setPdfjsLoader(async () => ({
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({
            items: [{ str: "highlighted text", transform: [1, 0, 0, 1, 10, 10], width: 20, height: 10 }],
          }),
          getAnnotations: async () => [
            {
              subtype: "Highlight",
              quadPoints: [{ x: 1, y: 1 }, {}, { x: 2, y: 1 }, { x: 2, y: 2 }], // 2nd point malformed
              rect: [0, 0, 100, 100], // fallback rect — must still be used
              contents: "",
            },
          ],
        }),
      }),
    }),
  }));
  const highlights = await extractPdfHighlights(new ArrayBuffer(8));
  check(
    highlights.length === 1 && highlights[0].text === "highlighted text",
    `extractPdfHighlights: a malformed quad point falls back to ann.rect instead of losing the highlight: ${JSON.stringify(highlights)}`
  );
  // Two quads: the first is fine but covers no text, the second is malformed. The good quad alone
  // must not suppress the ann.rect fallback, or the malformed line's text is lost.
  setPdfjsLoader(async () => ({
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({
            items: [{ str: "second line", transform: [1, 0, 0, 1, 10, 10], width: 20, height: 10 }],
          }),
          getAnnotations: async () => [
            {
              subtype: "Highlight",
              quadPoints: [{ x: 500, y: 500 }, { x: 510, y: 500 }, { x: 500, y: 510 }, { x: 510, y: 510 }, { x: 1, y: 1 }, {}, { x: 2, y: 1 }, { x: 2, y: 2 }],
              rect: [0, 0, 600, 600],
              contents: "",
            },
          ],
        }),
      }),
    }),
  }));
  const partial = await extractPdfHighlights(new ArrayBuffer(8));
  check(
    partial.length === 1 && partial[0].text === "second line",
    `extractPdfHighlights: one malformed quad among good ones still adds ann.rect: ${JSON.stringify(partial)}`
  );
}

// ---------- ingest/pdfStash.ts ----------
{
  check(!hasStashedText("plain body"), "hasStashedText: false without marker");
  check(hasStashedText(`body\n\n${STASH_MARKER}\n\ntext`), "hasStashedText: true with marker");

  const appended = appendStash("body text", "extracted pdf text");
  check(appended.includes(STASH_MARKER) && appended.includes("extracted pdf text"), "appendStash: marker + text");
  check(appendStash(appended, "more text") === appended, "appendStash: idempotent on stashed body");
  check(appendStash("body", "   ") === "body", "appendStash: blank text returns body");

  const long = appendStash("body", "y".repeat(STASH_MAX_CHARS + 100), 100);
  check(long.includes("…[truncated]") && !long.includes("y".repeat(101)), "appendStash: truncates past maxChars");

  check(resolvePdfLink("[[papers/a.pdf]]") === "papers/a.pdf", "resolvePdfLink: wikilink");
  check(resolvePdfLink("[[papers/a.pdf|alias]]") === "papers/a.pdf", "resolvePdfLink: wikilink alias stripped");
  check(resolvePdfLink("[[a.pdf#page=3]]") === "a.pdf", "resolvePdfLink: anchor stripped");
  check(resolvePdfLink("papers/a.pdf") === "papers/a.pdf", "resolvePdfLink: bare path");
  check(resolvePdfLink("[[note.md]]") === null, "resolvePdfLink: non-pdf → null");
  check(resolvePdfLink(undefined) === null, "resolvePdfLink: non-string → null");

  check(stashedText("plain body") === "", "stashedText: empty without marker");
  check(stashedText(`body\n\n${STASH_MARKER}\n\n  text  \n`) === "text", "stashedText: trimmed text after marker");
  check(stashedText(`${STASH_MARKER}\n\nkept…[truncated]`) === "kept…[truncated]", "stashedText: leaves a truncation suffix as-is");
}

// ---------- ingest/summarize.ts ----------
{
  const secs = parseSections("===BACKGROUND===\nbg text\n===METHODS===\nmethods text\n===RESULTS===\nr text\n===CONCLUSIONS===\nc text\n===MESH===\nDiskectomy\n");
  check(secs.background === "bg text" && secs.methods === "methods text", "parseSections: sections parsed");
  check(secs.mesh === "Diskectomy", "parseSections: MESH section");
  check(Object.keys(parseSections("plain prose, no markers")).length === 0, "parseSections: no markers → {}");

  const mesh = parseMeshList("Diskectomy\nLumbar Vertebrae\nDecompression, Surgical");
  check(mesh.includes("Diskectomy") && mesh.includes("Decompression, Surgical"), "parseMeshList: one per line, commas kept");
  const meshSemi = parseMeshList("Diskectomy; Lumbar Vertebrae");
  check(meshSemi.length === 2, "parseMeshList: semicolons split");
  const meshBullets = parseMeshList("- Diskectomy\n* Lumbar Vertebrae\n1. Endoscopy");
  check(meshBullets.length === 3 && meshBullets[2] === "Endoscopy", "parseMeshList: list markers stripped");
  const meshMarked = parseMeshList("preamble\n===MESH===\nDiskectomy\nLumbar Vertebrae");
  check(meshMarked.length === 2, "parseMeshList: ===MESH=== block isolated");
  check(parseMeshList("ab").length === 0, "parseMeshList: tiny fragments dropped");

  const enKo = buildSysPrompt("en+ko");
  check(enKo.includes("===KR===") && enKo.includes("===MESH==="), "buildSysPrompt: en+ko has KR + MESH markers");
  const en = buildSysPrompt("en");
  check(!en.includes("===KR===") && en.includes("===MESH==="), "buildSysPrompt: en has no KR block");
  const de = buildSysPrompt("German");
  check(de.includes("German") && !de.includes("===KR==="), "buildSysPrompt: free-text language honored");
}

// ---------- ingest/pubmedSearch.ts: buildTags (offline path) ----------
{
  check(MIN_TAGS === 5, "MIN_TAGS is 5");
  // Enough descriptors to clear MIN_TAGS → no network (no meshFromSummary lookup).
  const tags = await buildTags({
    descriptors: ["Diskectomy", "Lumbar Vertebrae", "Intervertebral Disc Displacement", "Endoscopy", "Sciatica", "Humans"],
    keywords: [],
  });
  check(tags.length >= MIN_TAGS, "buildTags: descriptors alone clear MIN_TAGS offline");
  check(!tags.includes("humans"), "buildTags: generic MeSH dropped via keywordsToTags");
  const kw = await buildTags({ descriptors: [], keywords: ["diskectomy"] });
  check(kw.includes("diskectomy"), "buildTags: author keywords pass through without network");

  // Comma-joined suggestions: the split fallback tries "A, B" as a heading before the pieces.
  const headings = ["Decompression, Surgical", "Surgical", "Lumbar Vertebrae", "Spinal Fusion", "Endoscopy"];
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const u = new URL(String(input));
      if (u.pathname.endsWith("esearch.fcgi")) {
        const term = (u.searchParams.get("term") || "").replace(/\[MeSH Terms\]$/, "");
        const i = headings.indexOf(term);
        return new Response(JSON.stringify({ esearchresult: { idlist: i >= 0 ? [String(i + 1)] : [] } }), { status: 200 });
      }
      const id = u.searchParams.get("id") || "";
      return new Response(JSON.stringify({ result: { [id]: { ds_meshterms: [headings[Number(id) - 1]] } } }), { status: 200 });
    }) as typeof fetch;
    resetNcbiGate();
    const tags = await buildTags({
      descriptors: [],
      keywords: [],
      meshFromSummary: "Lumbar Vertebrae, Decompression, Surgical, Spinal Fusion, Endoscopy",
    });
    check(
      tags.includes("decompression-surgical") && !tags.includes("surgical") && tags.includes("lumbar-vertebrae") && tags.includes("endoscopy"),
      `buildTags: inverted heading survives a comma-joined reply (${tags.join(", ")})`
    );
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---------- ingest/unpaywall.ts + retraction.ts (offline validation paths) ----------
{
  check(await findOpenAccess("", "user@uni.edu") === null, "findOpenAccess: empty DOI → null");
  let threw = "";
  try {
    await findOpenAccess("10.1038/nature14539", "anonymous@example.com");
  } catch (e) {
    threw = String(e);
  }
  check(/Contact e-mail/.test(threw), "findOpenAccess: placeholder email throws guidance");

  // version/license come from the same location as the PDF, not from best_oa_location
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          is_oa: true,
          best_oa_location: { url_for_landing_page: "https://pub/landing", url_for_pdf: null, version: "publishedVersion", license: "cc-by" },
          oa_locations: [
            { url_for_pdf: null, version: "publishedVersion", license: "cc-by" },
            { url_for_pdf: "https://repo/x.pdf", version: "acceptedVersion", license: null },
          ],
        }),
        { status: 200 }
      )) as typeof fetch;
    const oa = await findOpenAccess("10.1/x", "user@uni.edu");
    check(oa?.pdfUrl === "https://repo/x.pdf", "findOpenAccess: PDF from a non-best location");
    check(oa?.version === "acceptedVersion", `findOpenAccess: version from the PDF's location (${oa?.version})`);
    check(oa?.license === undefined, `findOpenAccess: license not borrowed from best location (${oa?.license})`);
    check(oa?.landingUrl === "https://pub/landing", "findOpenAccess: landing page still from best location");
  } finally {
    globalThis.fetch = realFetch;
  }
  check(await checkRetraction({ type: "article-journal", title: "No ids" }) === null, "checkRetraction: no DOI/PMID → null");
}

// ---------- data/library.ts ----------
{
  check(normDoi("https://doi.org/10.1038/Nature14539 ") === "10.1038/nature14539", "normDoi: URL + case normalized");
  check(normDoi("doi:10.1000/X") === "10.1000/x", "normDoi: doi: prefix stripped");
  check(normTitle("Lumbar-Disk  Herniation!") === "lumbar disk herniation", "normTitle: punctuation folded");

  const keys = matchKeys({ DOI: "10.1038/x", PMID: "123", title: "A very long title indeed here" });
  check(keys.includes("doi:10.1038/x") && keys.includes("pmid:123"), "matchKeys: doi + pmid keys");
  check(matchKeys({ title: "Editorial" }).length === 0, "matchKeys: short title is not an identifier");

  type E = { item: { DOI?: unknown; PMID?: unknown; title?: unknown } };
  const a: E = { item: { DOI: "10.1/a", title: "A sufficiently long paper title one" } };
  const b: E = { item: { DOI: "10.1/a", PMID: "999", title: "Completely different words here now" } };
  const c: E = { item: { PMID: "999", title: "Yet another distinct long title phrase" } };
  const groups = duplicateGroups([a, b, c]);
  check(groups.length === 1 && groups[0].length === 3, "duplicateGroups: transitive DOI→PMID chain is one group");
  const noId: E = { item: { title: "Editorial" } };
  check(duplicateGroups([a, noId]).length === 0, "duplicateGroups: unidentifiable note never groups");

  // Korean titles keep their Hangul: two titles that differ only there are not the same title
  check(
    normTitle("Biportal endoscopy 의 합병증") !== normTitle("Biportal endoscopy 의 장기 결과") &&
      normTitle("Biportal endoscopy 의 합병증") === "biportal endoscopy 의 합병증",
    "normTitle: Hangul is kept, not collapsed to the ASCII part"
  );
  // A shared title does not join works whose DOI / PMID differ
  const gt = "A generic but sufficiently long shared title";
  const t1: E = { item: { DOI: "10.1/x", title: gt } };
  const t2: E = { item: { DOI: "10.1/y", title: gt } };
  const t3: E = { item: { PMID: "1", title: gt } };
  const t4: E = { item: { PMID: "2", title: gt } };
  const t5: E = { item: { title: gt } };
  check(duplicateGroups([t1, t2]).length === 0, "duplicateGroups: same title, different DOIs → not duplicates");
  check(duplicateGroups([t3, t4]).length === 0, "duplicateGroups: same title, different PMIDs → not duplicates");
  check(duplicateGroups([t1, t3]).length === 1, "duplicateGroups: same title, DOI on one and PMID on the other → still a group");
  check(duplicateGroups([t1, t5]).length === 1, "duplicateGroups: same title, one side without ids → still a group");
  const chain = duplicateGroups([t1, t5, t2]);
  check(chain.length === 1 && chain[0].length === 2, "duplicateGroups: a generic title does not chain two different DOIs through a bare note");

  const entry = { file: { path: "References/a.md" }, item: { tags: ["#Diskectomy", "spine"] } };
  check(inScope(entry, { kind: "all" }), "inScope: all");
  check(inScope(entry, { kind: "note", path: "References/a.md" }), "inScope: note match");
  check(!inScope(entry, { kind: "note", path: "References/b.md" }), "inScope: note mismatch");
  check(inScope(entry, { kind: "folder", folder: "References" }), "inScope: folder");
  check(!inScope({ file: { path: "References/Spine2/a.md" }, item: {} }, { kind: "folder", folder: "References/Spine" }), "inScope: folder prefix is strict");
  check(inScope(entry, { kind: "tag", tag: "diskectomy" }), "inScope: tag case-insensitive, # tolerant");
  check(!inScope(entry, { kind: "tag", tag: "endoscopy" }), "inScope: tag mismatch");
}

// ---------- data/pdfMatch.ts: matchPdf ----------
{
  const cands: PdfCandidate[] = [
    { citekey: "park2021efficacy", DOI: "10.1038/x", PMID: "12345678", title: "The efficacy of endoscopic diskectomy for lumbar herniation", year: 2021 },
    { citekey: "kim2019outcomes", DOI: "10.1038/y", PMID: "87654321", title: "Outcomes of biportal endoscopy in spinal stenosis patients", year: 2019 },
  ];

  check(matchPdf("park2021efficacy", null, cands)?.by === "name", "matchPdf: filename equals citekey");
  check(matchPdf("Park2021Efficacy", null, cands)?.by === "name", "matchPdf: filename match is case-insensitive");
  check(matchPdf("random-download", null, cands) === null, "matchPdf: no head, no name match → null");

  const doiHead = "Downloaded from https://doi.org/10.1038/x. on 2024-01-01\nSome intro text.";
  check(matchPdf("random-download", doiHead, cands)?.citekey === "park2021efficacy", "matchPdf: DOI with URL prefix + trailing period");
  check(matchPdf("random-download", doiHead, cands)?.by === "doi", "matchPdf: DOI match reports by=doi");

  const pmidHead = "Article header.\nPMID: 87654321\nAbstract follows.";
  const pmidHit = matchPdf("random-download", pmidHead, cands);
  check(pmidHit?.citekey === "kim2019outcomes" && pmidHit?.by === "pmid", "matchPdf: PMID match");

  const titleHead = "The Efficacy of Endoscopic Diskectomy for Lumbar Herniation\nJournal of Spine, 2021.\nAuthors: Park et al.";
  const titleHit = matchPdf("random-download", titleHead, cands);
  check(titleHit?.citekey === "park2021efficacy" && titleHit?.by === "title", "matchPdf: title match with year present");

  const wrongYearHead = "The Efficacy of Endoscopic Diskectomy for Lumbar Herniation\nJournal of Spine, 2020.";
  check(matchPdf("random-download", wrongYearHead, cands) === null, "matchPdf: title matches but year is wrong → null");

  // The 4000-char head slice must actually be enforced, not just documented (mutation-checked
  // by hand: widening pdfMatch.ts's HEAD_CHARS makes this assertion fail — see report).
  const padded = "x".repeat(4000) + "\n" + titleHead;
  check(matchPdf("random-download", padded, cands) === null, "matchPdf: title present only past char 4000 → null");

  const ambiguous: PdfCandidate[] = [
    { citekey: "a1", title: "Outcomes of biportal endoscopy in spinal stenosis patients", year: 2019 },
    { citekey: "a2", title: "Outcomes of biportal endoscopy in spinal stenosis patients", year: 2019 },
  ];
  const dupHead = "Outcomes of biportal endoscopy in spinal stenosis patients\nSpine 2019.";
  check(matchPdf("random-download", dupHead, ambiguous) === null, "matchPdf: two candidates with the same title → null (ambiguous)");

  const shortTitleCands: PdfCandidate[] = [{ citekey: "short1", title: "Editorial note", year: 2021 }];
  const shortHead = "Editorial note\nSpine, 2021.";
  check(matchPdf("random-download", shortHead, shortTitleCands) === null, "matchPdf: short title (<25 chars) never title-matches");
}

// ---------- data/reference.ts ----------
{
  const item = {
    type: "article-journal",
    title: "The efficacy of endoscopic diskectomy for lumbar herniation",
    author: [{ family: "Park", given: "Sang-Min" }],
    issued: { "date-parts": [[2021]] },
    "container-title": "The Spine Journal",
    DOI: "10.1/x",
  };
  check(getYear(item) === "2021", "getYear: issued year");
  check(getYear({ type: "article-journal", title: "t" }) === "nd", "getYear: missing → nd");
  check(firstAuthorFamily(item) === "Park", "firstAuthorFamily");
  check(firstAuthorFamily({ type: "article-journal", title: "t" }) === "anon", "firstAuthorFamily: missing → anon");
  check(firstTitleWord(item) === "efficacy", "firstTitleWord: skips stopwords");
  check(slug("Héllo, World!") === "hello world", "slug: NFKD + punctuation stripped");

  const full = { ...DEFAULT_SETTINGS, citekeyStyle: "authoryeartitle" as const };
  const ay = { ...DEFAULT_SETTINGS, citekeyStyle: "authoryear" as const };
  check(generateCitekey(item, full) === "park2021efficacy", "generateCitekey: authoryeartitle");
  check(generateCitekey(item, ay) === "park2021", "generateCitekey: authoryear");

  check(journalAbbr(item) === "Spine", "journalAbbr: drops 'The'/'Journal'");
  check(authorTag(item) === "ParkSM", "authorTag: family + initials");
  const fname = generateFilename(item);
  check(fname === "2021-Spine-ParkSM-Efficacy", `generateFilename: readable name (got ${fname})`);

  check(JSON.stringify(keywordsToTags(["Humans", "Diskectomy", "discectomy"])) === JSON.stringify(["diskectomy"]), "keywordsToTags: stop dropped, synonyms folded, deduped");
  check(tagSlug("Lumbar Vertebrae") === "lumbar-vertebrae", "tagSlug");

  const block = summaryBlock({ background: "bg", results: "res", kr: "요약" });
  check(block[0] === "## Summary" && block.includes("**한국어 요약 (KR)**"), "summaryBlock: heading + KR section");
  check(summaryBlock({}).length === 0, "summaryBlock: empty → no lines");

  const note = buildNote(item, "park2021efficacy", { tags: ["diskectomy"] });
  check(note.includes("citekey: park2021efficacy") && note.startsWith("---\n"), "buildNote: frontmatter with citekey");
  check(note.includes("# The efficacy of endoscopic diskectomy"), "buildNote: title heading");
  check(note.includes("## Notes") && note.includes("## Highlights"), "buildNote: scaffold sections");
  const rich = buildNote(
    {
      ...item,
      "container-title-short": "Spine",
      editor: [{ family: "Lee", given: "K" }],
      openalex_id: "W123",
      ISBN: "",
      edition: undefined,
      "collection-title": undefined,
    },
    "park2021efficacy"
  );
  check(/^container-title-short: Spine$/m.test(rich), "buildNote: container-title-short survives");
  check(/^editor:/m.test(rich) && /family: Lee/.test(rich), "buildNote: editor survives");
  check(/^openalex_id: W123$/m.test(rich), "buildNote: openalex_id survives");
  check(!/^ISBN:/m.test(rich) && !/^edition:/m.test(rich), "buildNote: empty / undefined keys are not written");
  check(rich.indexOf("DOI:") < rich.indexOf("container-title-short:") && rich.indexOf("container-title-short:") < rich.indexOf("status:"), "buildNote: extra keys sit after the listed ones and before the plugin fields");
  check(/^\d{4}-\d{2}-\d{2}$/.test(localDate()), "localDate: YYYY-MM-DD shape");
}

// ---------- llm/client.ts: requestWithRetry (injected transport, no network) ----------
{
  const okRes = (status: number) =>
    ({ status, headers: {}, text: "", json: {}, arrayBuffer: new ArrayBuffer(0) }) as any;
  let calls = 0;
  const r1 = await requestWithRetry({ url: "https://x.test/", throw: false }, (async () => {
    calls++;
    return okRes(200);
  }) as any);
  check(r1.status === 200 && calls === 1, "requestWithRetry: immediate 200 → single call, no wait");

  let flaky = 0;
  const r2 = await requestWithRetry({ url: "https://x.test/", throw: false }, (async () => {
    flaky++;
    if (flaky === 1) throw new Error("socket hang up");
    return okRes(200);
  }) as any);
  check(r2.status === 200 && flaky === 2, "requestWithRetry: one network throw is retried, then succeeds");

  let n429 = 0;
  const r3 = await requestWithRetry({ url: "https://x.test/", throw: false }, (async () => {
    n429++;
    return okRes(n429 === 1 ? 429 : 200);
  }) as any);
  check(r3.status === 200 && n429 === 2, "requestWithRetry: 429 is retried, then succeeds");
}

// ---------- llm/cli.ts ----------
{
  check(
    JSON.stringify(buildCliArgs("codex", "", "/tmp/last.txt", false)) ===
      JSON.stringify([
        "exec",
        "--ignore-user-config",
        "--skip-git-repo-check",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "-o",
        "/tmp/last.txt",
        "-",
      ]),
    "buildCliArgs: codex, no model, no reasoning flag"
  );
  check(
    JSON.stringify(buildCliArgs("codex", "gpt-5.1-codex", "/tmp/last.txt", true)) ===
      JSON.stringify([
        "exec",
        "--ignore-user-config",
        "--skip-git-repo-check",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "-o",
        "/tmp/last.txt",
        "-m",
        "gpt-5.1-codex",
        "-c",
        'model_reasoning_effort="low"',
        "-",
      ]),
    "buildCliArgs: codex with model + noReasoning"
  );
  check(
    JSON.stringify(buildCliArgs("opencode", "", "/tmp/last.txt", false)) ===
      JSON.stringify(["run", "--pure", "--format", "json"]),
    "buildCliArgs: opencode, no model"
  );
  check(
    JSON.stringify(buildCliArgs("opencode", "opencode-go/muse-spark-1.3-contributor", "/tmp/last.txt", true)) ===
      JSON.stringify(["run", "--pure", "--format", "json", "--model", "opencode-go/muse-spark-1.3-contributor"]),
    "buildCliArgs: opencode with model (noReasoning has no opencode flag)"
  );

  const ndjson = [
    '{"type":"step_start"}',
    "",
    'not json at all',
    '{"type":"text","part":{"type":"text","text":"PO"}}',
    '{"type":"text","part":{"type":"text","text":"NG"}}',
    '{"type":"step_finish"}',
  ].join("\n");
  check(parseOpencodeOutput(ndjson) === "PONG", "parseOpencodeOutput: concatenates text parts, skips junk lines");

  let threwMsg = "";
  try {
    parseOpencodeOutput('{"type":"text","part":{"type":"text","text":"partial"}}\n{"type":"error","error":{"message":"boom"}}');
  } catch (e) {
    threwMsg = String(e);
  }
  check(/boom/.test(threwMsg), "parseOpencodeOutput: error event throws with its message");

  const prompt = promptFromMessages(
    [
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "second" },
    ],
    "sys prompt"
  );
  check(prompt.startsWith("sys prompt\n\n"), "promptFromMessages: system first");
  check(prompt.endsWith("User: second"), "promptFromMessages: ends on the last user message");
  check(prompt.includes("Assistant: reply"), "promptFromMessages: assistant turn labelled");

  const oc = cliCandidates("opencode", "/home/x", "darwin");
  check(oc[0] === "/home/x/.opencode/bin/opencode", "cliCandidates: opencode's ~/.opencode/bin first");
  const codexWin = cliCandidates("codex", "C:\\Users\\x", "win32");
  check(codexWin[codexWin.length - 1] === "C:\\Users\\x\\AppData\\Roaming\\npm\\codex.exe", "cliCandidates: win32 appends .exe under %APPDATA%/npm");
}

// ---------- ingest/metadata.ts: title tag stripping keeps comparators, drops real markup ----------
{
  const title = (t: string) => esummaryToItem("1", { uid: "1", title: t })?.item.title;
  check(title("Tumours of grade <II and >IV") === "Tumours of grade <II and >IV", "stripTags: a comparator before a letter is not a tag");
  check(title("Patients aged <65 and >80 years") === "Patients aged <65 and >80 years", "stripTags: a comparator before a digit is not a tag");
  check(title("<jats:title>Effect</jats:title> of <i>X</i> on <sup>2</sup>H") === "Effect of X on 2H", "stripTags: namespaced JATS tags and inline HTML tags are removed");
  check(title("A &amp; B &lt;5") === "A & B <5", "stripTags: entities are decoded");
  check(title("ASA class <I and >III, Child-Pugh <B or >C") === "ASA class <I and >III, Child-Pugh <B or >C", "stripTags: a comparator before a tag-like letter is kept");
  check(title("<scp>COVID</scp>-19 <mml:math><mi>β</mi></mml:math> <ext-link ext-link-type=\"uri\" xlink:href=\"x\">link</ext-link>") === "COVID-19 β link", "stripTags: any markup tag (scp, MathML, attributes) is removed");
  check(title("&#x3b2;-blocker &#8211; &amp;lt;") === "β-blocker – &lt;", "stripTags: numeric entities decode, one pass (no double decode)");
}

// ---------- graph/openalex.ts: titlesMatch + resolveWork error vs. not-found ----------
{
  check(!titlesMatch("Treatment X: a randomized trial", "Treatment X: a randomized trial protocol"), "titlesMatch: a protocol is not the trial");
  check(titlesMatch("Treatment X: A Randomized Trial.", "treatment x - a randomized trial"), "titlesMatch: exact after normalizing punctuation/case");
  check(titlesMatch("Effects of exercise on bone density in older women", "Effects of exercise on bone density in older women."), "titlesMatch: trailing punctuation only");
  check(titlesMatch("Long term clinical and radiological outcomes of lumbar spinal fusion in adults (Review)", "Long term clinical and radiological outcomes of lumbar spinal fusion in adults"), "titlesMatch: tiny difference (>=90%) accepted");
  check(!titlesMatch("", "x") && !titlesMatch("x", ""), "titlesMatch: empty never matches");

  const realFetch = globalThis.fetch;
  const reply = (status: number, body: unknown) => (globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch);
  try {
    reply(404, { error: "not found" });
    check((await resolveWork({ type: "article-journal", DOI: "10.1/x" })) === null, "resolveWork: 404 is a genuine no-match (null)");
    reply(200, { results: [] });
    check((await resolveWork({ type: "article-journal", title: "Nothing here" })) === null, "resolveWork: empty title search is null");
    reply(200, { results: [{ id: "https://openalex.org/W1", title: "Treatment X: a randomized trial protocol" }] });
    check((await resolveWork({ type: "article-journal", title: "Treatment X: a randomized trial" })) === null, "resolveWork: protocol title hit rejected");
    reply(500, {});
    let msg = "";
    await resolveWork({ type: "article-journal", DOI: "10.1/x" }).catch((e: Error) => (msg = e.message));
    check(msg === "OpenAlex returned 500", `resolveWork: 500 on a DOI lookup throws (${msg})`);
    msg = "";
    await resolveWork({ type: "article-journal", title: "Some title" }).catch((e: Error) => (msg = e.message));
    check(msg === "OpenAlex returned 500", `resolveWork: 500 on a title search throws (${msg})`);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---------- types.ts: effective() — empty path/URL settings fall back to the shipped default ----------
{
  const s = { ...DEFAULT_SETTINGS, referencesFolder: "  ", openaiBaseUrl: "", ollamaUrl: " http://h:1 " };
  check(effective(s, "referencesFolder") === "References", "effective: blank folder → References");
  check(effective(s, "openaiBaseUrl") === DEFAULT_SETTINGS.openaiBaseUrl && /openrouter/.test(effective(s, "openaiBaseUrl")), "effective: blank base URL → the OpenRouter default, not api.openai.com");
  check(effective(s, "ollamaUrl") === "http://h:1", "effective: a typed value is trimmed and kept");
}

// ---------- util/json.ts: text / numLike ----------
{
  check(text(12345678) === "12345678", "text: an unquoted YAML PMID (a number) keeps its digits");
  check(text("2024") === "2024" && text(null) === "" && text({}) === "" && text(NaN) === "", "text: strings pass, non-scalars and NaN become empty");
  check(numLike("57") === 57 && numLike(57) === 57, "numLike: a quoted count and a number both read as numbers");
  check(isNumberArray([0.1, 2]) && !isNumberArray([]) && !isNumberArray(["1"]) && !isNumberArray("AAAA") && !isNumberArray([NaN]), "isNumberArray: non-empty finite numbers only (a base64 embedding string fails)");
  check(numLike("") === undefined && numLike("n/a") === undefined && numLike(null) === undefined, "numLike: empty, non-numeric and null are undefined");
}

// ---------- llm/cli.ts: winQuote ----------
{
  check(winQuote("model_reasoning_effort=\"low\"") === '"model_reasoning_effort=""low"""', "winQuote: inner quotes doubled, whole arg wrapped");
  check(winQuote("C:\\Temp dir\\last.txt") === '"C:\\Temp dir\\last.txt"', "winQuote: a path with a space stays one argument");
}

// ---------- llm/cli.ts: shouldUseShell / spawnInvocation ----------
{
  check(shouldUseShell("win32", "C:\\npm\\codex.cmd"), "shouldUseShell: win32 + .cmd → true");
  check(shouldUseShell("win32", "C:\\npm\\codex.bat"), "shouldUseShell: win32 + .bat → true");
  check(!shouldUseShell("win32", "C:\\npm\\codex.exe"), "shouldUseShell: win32 + .exe → false");
  check(!shouldUseShell("darwin", "/usr/local/bin/codex"), "shouldUseShell: darwin → always false, even if named .cmd");
  check(!shouldUseShell("darwin", "/usr/local/bin/codex.cmd"), "shouldUseShell: extension alone doesn't matter off win32");

  const noShell = spawnInvocation("/usr/local/bin/codex", ["exec", "-"], false);
  check(noShell.command === "/usr/local/bin/codex" && noShell.args.join(",") === "exec,-", "spawnInvocation: no shell → argv passed through untouched");

  const shimmed = spawnInvocation("C:\\npm\\codex.cmd", ["exec", 'model_reasoning_effort="low"'], true);
  check(shimmed.command === '"C:\\npm\\codex.cmd"', "spawnInvocation: shell → command itself is cmd.exe-quoted");
  check(
    JSON.stringify(shimmed.args) === JSON.stringify(['"exec"', '"model_reasoning_effort=""low"""']),
    "spawnInvocation: shell → every argument is winQuote'd"
  );
}

// ---------- llm/cli.ts: real .cmd shim spawn — win32 only, no-op elsewhere ----------
await windowsCliShimChecks();

// ---------- llm/cli.ts: cliInsideVault (a CLI that lives in the vault is never run) ----------
{
  check(cliInsideVault("/v/ws/codex", "/v/ws"), "cliInsideVault: file under the vault → true");
  check(cliInsideVault("/v/ws/.bin/x/codex", "/v/ws/"), "cliInsideVault: trailing slash on the root is ignored");
  check(cliInsideVault("/v/ws", "/v/ws"), "cliInsideVault: the vault folder itself → true");
  check(!cliInsideVault("/v/ws-other/codex", "/v/ws"), "cliInsideVault: a sibling sharing the name prefix → false");
  check(!cliInsideVault("/usr/local/bin/codex", "/v/ws"), "cliInsideVault: outside → false");
  check(!cliInsideVault("/usr/local/bin/codex", ""), "cliInsideVault: no vault root known → false");
  check(cliInsideVault("C:\\Vault\\bin\\codex.cmd", "c:\\vault", true), "cliInsideVault: Windows paths, case-insensitive");
  check(!cliInsideVault("C:\\Vault\\bin\\codex.cmd", "c:\\vault", false), "cliInsideVault: case-sensitive by default");
}

// ---------- llm/cli.ts: runCli keeps multibyte output split across pipe reads, refuses a CLI in the vault ----------
if (process.platform !== "win32") {
  const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "rag-obsidian-cli-test-"));
  try {
    const bin = nodePath.join(dir, "opencode");
    // Writes one big Korean JSON event line in 7-byte pieces (7 is not a multiple of 3, so most
    // boundaries fall inside a 3-byte character), with a pause so each piece is its own read.
    nodeFs.writeFileSync(
      bin,
      `#!${process.execPath}
const line = Buffer.from(JSON.stringify({ type: "text", part: { text: "한국어 문장입니다. ".repeat(12000) } }) + "\\n");
process.stdin.resume();
let at = 0;
(function next() {
  if (at >= line.length) return;
  process.stdout.write(line.subarray(at, at + 7001));
  at += 7001;
  setTimeout(next, 1);
})();
`,
      { mode: 0o755 }
    );
    const settings = { llmProvider: "opencode", llmModel: "", cliPath: bin } as never;
    setCliVaultRoot("");
    const got = await runCli(settings, [{ role: "user", content: "hi" }], "sys");
    check(got === "한국어 문장입니다. ".repeat(12000).trim(), "runCli: Korean answer split mid-character across reads arrives intact (no U+FFFD)");
    check(!got.includes("\uFFFD"), "runCli: no replacement character in the answer");

    setCliVaultRoot(dir);
    let refused = "";
    try { await runCli(settings, [{ role: "user", content: "hi" }], "sys"); } catch (e) { refused = String(e); }
    check(/inside this vault/.test(refused) && /CLI executable/.test(refused), "runCli: a CLI inside the vault is refused with the setting named");
    setCliVaultRoot("");
  } finally {
    setCliVaultRoot("");
    nodeFs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- index/localFiles.ts: cacheRoot (pure — platform/env/home injected) ----------
{
  const home = "/Users/kim";
  check(cacheRoot("darwin", {}, home) === `${home}/Library/Application Support`, "cacheRoot: darwin → Application Support (not the purgeable Caches)");
  check(legacyCacheRoot("darwin", {}, home) === `${home}/Library/Caches`, "legacyCacheRoot: darwin → Library/Caches (one-time move source)");
  check(
    cacheRoot("win32", { LOCALAPPDATA: "C:\\Users\\kim\\AppData\\Local" }, "C:\\Users\\kim") ===
      "C:\\Users\\kim\\AppData\\Local",
    "cacheRoot: win32 → %LOCALAPPDATA%"
  );
  check(
    cacheRoot("win32", {}, "C:\\Users\\kim") === "C:\\Users\\kim/AppData/Local",
    "cacheRoot: win32 without LOCALAPPDATA falls back to ~/AppData/Local"
  );
  check(cacheRoot("linux", { XDG_DATA_HOME: "/xdg-data" }, home) === "/xdg-data", "cacheRoot: linux → $XDG_DATA_HOME");
  check(cacheRoot("linux", {}, home) === `${home}/.local/share`, "cacheRoot: linux without XDG_DATA_HOME falls back to ~/.local/share");
  check(legacyCacheRoot("linux", {}, home) === `${home}/.cache`, "legacyCacheRoot: linux → ~/.cache");
}

// ---------- ui/libraryFilter.ts: filterAndSort ----------
{
  const mk = (o: Partial<RefEntry>): RefEntry => ({
    file: {} as any,
    citekey: "x",
    title: "",
    authors: "",
    year: "",
    ...o,
  });
  const alpha = mk({
    citekey: "alpha",
    title: "Banana Paper",
    authors: "Smith",
    year: "2020",
    journal: "Nature",
    added: "2024-01-01",
    status: "unread",
    citedBy: 5,
    hasPdf: true,
    retracted: false,
  });
  const beta = mk({
    citekey: "beta",
    title: "Apple Paper",
    authors: "Adams",
    year: "2018",
    journal: "Science",
    added: "2023-06-01",
    status: "read",
    citedBy: 20,
    hasPdf: false,
    retracted: true,
  });
  const gamma = mk({ citekey: "gamma", title: "Cherry Paper" }); // every optional field missing
  const keys = (rows: RefEntry[]) => rows.map((r) => r.citekey).join(",");

  check(
    keys(filterAndSort([alpha, beta, gamma], { text: "", sort: "year-desc", chips: {} })) === "alpha,beta,gamma",
    "filterAndSort: year-desc, missing year sorts last"
  );
  check(
    keys(filterAndSort([alpha, beta, gamma], { text: "", sort: "year-asc", chips: {} })) === "beta,alpha,gamma",
    "filterAndSort: year-asc, missing year sorts last"
  );
  check(
    keys(filterAndSort([alpha, beta, gamma], { text: "", sort: "title-asc", chips: {} })) === "beta,alpha,gamma",
    "filterAndSort: title A-Z"
  );
  check(
    keys(filterAndSort([alpha, beta, gamma], { text: "", sort: "author-asc", chips: {} })) === "beta,alpha,gamma",
    "filterAndSort: first-author A-Z, missing author sorts last"
  );
  check(
    keys(filterAndSort([alpha, beta, gamma], { text: "", sort: "cited-desc", chips: {} })) === "beta,alpha,gamma",
    "filterAndSort: most cited, missing citedBy sorts last"
  );
  check(
    keys(filterAndSort([alpha, beta, gamma], { text: "", sort: "added-desc", chips: {} })) === "alpha,beta,gamma",
    "filterAndSort: recently added, missing added sorts last"
  );

  check(
    keys(filterAndSort([alpha, beta, gamma], { text: "", sort: "year-desc", chips: { hasPdf: true, unread: true } })) ===
      "alpha",
    "filterAndSort: hasPdf + unread chips AND together"
  );
  check(
    keys(
      filterAndSort([alpha, beta, gamma], { text: "", sort: "year-desc", chips: { noPdf: true, retracted: true } })
    ) === "beta",
    "filterAndSort: noPdf + retracted chips AND together"
  );

  check(
    keys(filterAndSort([alpha, beta, gamma], { text: "nature", sort: "year-desc", chips: {} })) === "alpha",
    "filterAndSort: text matches journal, case-insensitive"
  );
  check(
    keys(filterAndSort([alpha, beta, gamma], { text: "BETA", sort: "year-desc", chips: {} })) === "beta",
    "filterAndSort: text matches citekey, case-insensitive"
  );
}

// ---------- write/pandoc.ts: pandocSuperscripts ----------
check(
  pandocSuperscripts("text<sup>1</sup> and <SUP>2, 3</SUP>.") === "text^1^ and ^2,\\ 3^.",
  "pandocSuperscripts: <sup> becomes Pandoc ^…^ with spaces escaped"
);

// ---------- write/pandoc.ts: pandocCandidates ----------
{
  const mac = pandocCandidates("/Users/x", "darwin");
  check(mac[0] === "/opt/homebrew/bin/pandoc", "pandocCandidates: Homebrew (Apple Silicon) first on darwin");
  check(mac.includes("/usr/local/bin/pandoc"), "pandocCandidates: Homebrew (Intel) on darwin");
  check(mac.includes("/Users/x/.local/bin/pandoc"), "pandocCandidates: ~/.local/bin on darwin");

  const linux = pandocCandidates("/home/x", "linux");
  check(linux.includes("/home/x/.local/bin/pandoc"), "pandocCandidates: ~/.local/bin on linux");

  const win = pandocCandidates("C:\\Users\\x", "win32");
  check(win[0] === "C:\\Program Files\\Pandoc\\pandoc.exe", "pandocCandidates: Program Files first on win32");
  check(win.length === 1, "pandocCandidates: no %LOCALAPPDATA% entry when unset");

  const winLocal = pandocCandidates("C:\\Users\\x", "win32", "C:\\Users\\x\\AppData\\Local");
  check(
    winLocal[1] === "C:\\Users\\x\\AppData\\Local\\Pandoc\\pandoc.exe",
    "pandocCandidates: %LOCALAPPDATA%\\Pandoc appended on win32 when set"
  );
}

// ---------- data/findings.ts + chunker exclusion ----------
{
  const ev = '## Evidence (extracted)\n\n> [!quote]- 3 findings\n> - [kind:: comparative] [outcome:: fusion rate] [intervention:: A] [comparator:: B] [effect:: 96%] [future:: z]\n>   "Fusion was 96%."\n> - [kind:: prognostic] [outcome:: reoperation] [predictor:: age > 65] [p:: 0.01]\n>   "Older had more."\n> - [kind:: comparative] [outcome:: no quote]\n';
  const fs2 = parseFindings(`# T\n\n${ev}\n## Notes\n\n> - [kind:: comparative] [outcome:: leak]\n>   "after section"\n`);
  check(fs2.length === 2 && fs2[0].intervention === "A" && fs2[1].predictor === "age > 65" && fs2[1].p === "0.01", "parseFindings: 2 findings, quote-less skipped, stops at next heading");
  check(!("future" in fs2[0]) && parseFindings("# none").length === 0, "parseFindings: unknown key ignored, no section -> []");
  check(findingText(fs2[0]).includes("A vs B") && findingText(fs2[0]).includes("Fusion was 96%."), "findingText: intervention vs comparator + quote");
  const plain = "# T\n\nAbout cages.\n\n## Notes\n\nmore";
  const base = chunkReference({ citekey: "k", title: "T", year: 2020, tags: [], body: plain }, 800);
  const withEv = chunkReference({ citekey: "k", title: "T", year: 2020, tags: [], body: `${plain}\n\n${ev}` }, 800);
  const mid = chunkReference({ citekey: "k", title: "T", year: 2020, tags: [], body: `# T\n\n${ev}\n## Notes\n\nAbout cages.\n\nmore` }, 800);
  check(withEv.map((c) => c.embedText).join() === base.map((c) => c.embedText).join(), "chunker: trailing Evidence section not embedded");
  check(mid.every((c) => !c.text.includes("fusion rate")) && mid.some((c) => c.text.includes("About cages")), "chunker: mid-note Evidence skipped, later sections kept");
}

// ---------- index/chunker.ts: stripFrontmatter (reused by writing/export-docx) ----------
{
  const withFm = "---\ntitle: Draft\nauthor: Me\n---\n\n# Heading\n\nBody [@key].\n";
  check(
    stripFrontmatter(withFm) === "\n# Heading\n\nBody [@key].\n",
    "stripFrontmatter: drops a leading YAML block"
  );
  check(stripFrontmatter("# No frontmatter\n") === "# No frontmatter\n", "stripFrontmatter: no-op without one");
  check(
    stripFrontmatter("Body starts with\n---\nnot frontmatter\n") === "Body starts with\n---\nnot frontmatter\n",
    "stripFrontmatter: a mid-document '---' line is not mistaken for a frontmatter block"
  );
  const crlf = "---\r\ntitle: Draft\r\n---\r\nBody\r\n";
  check(stripFrontmatter(crlf) === "Body\r\n", "stripFrontmatter: handles CRLF line endings");
}

// ---------- data/merge.ts: pickKeeper ----------
{
  const note = (over: Partial<MergeNote>): MergeNote => ({
    citekey: "x",
    fm: {},
    bodyLength: 0,
    ...over,
  });

  check(
    pickKeeper([note({ citekey: "a", fm: { title: "t" } }), note({ citekey: "b", fm: { title: "t", DOI: "d" } })]) === 1,
    "pickKeeper: more non-empty fields wins"
  );

  check(
    pickKeeper([
      note({ citekey: "a", fm: { title: "t" } }),
      note({ citekey: "b", fm: { title: "t", summary_source: "pubmed-abstract" } }),
    ]) === 1,
    "pickKeeper: tied fields → has summary_source wins"
  );

  check(
    pickKeeper([
      note({ citekey: "a", fm: { title: "t" }, bodyLength: 10 }),
      note({ citekey: "b", fm: { title: "t" }, bodyLength: 50 }),
    ]) === 1,
    "pickKeeper: tied fields+summary → longer body wins"
  );

  check(
    pickKeeper([
      note({ citekey: "a", fm: { title: "t", added: "2024-03-01" } }),
      note({ citekey: "b", fm: { title: "t", added: "2024-01-15" } }),
    ]) === 1,
    "pickKeeper: tied fields+summary+body → earliest added wins"
  );

  check(
    pickKeeper([note({ citekey: "b", fm: { title: "t" } }), note({ citekey: "a", fm: { title: "t" } })]) === 1,
    "pickKeeper: fully tied → citekey order (a before b)"
  );
}

// ---------- data/merge.ts: mergeFrontmatter ----------
{
  const keeper = { citekey: "smith2020x", title: "T", tags: ["spine"], added: "2024-01-01" };
  const merged = mergeFrontmatter(keeper, [
    { citekey: "loser1", title: "T", DOI: "10.1/x", tags: ["spine", "surgery"], abstract: "abs" },
  ]);
  check(merged.DOI === "10.1/x", "mergeFrontmatter: fills a key missing on the keeper");
  check(merged.abstract === "abs", "mergeFrontmatter: fills abstract from the other note");
  check(JSON.stringify(merged.tags) === JSON.stringify(["spine", "surgery"]), "mergeFrontmatter: tags union, keeper order first");
  check(merged.citekey === "smith2020x", "mergeFrontmatter: citekey is never copied from another note");

  const notRetracted = mergeFrontmatter({ citekey: "a" }, [{ citekey: "b", retracted: false }]);
  check(!notRetracted.retracted, "mergeFrontmatter: retracted stays unset when nobody says true");
  const retracted = mergeFrontmatter({ citekey: "a", retracted: false }, [{ citekey: "b", retracted: true }]);
  check(retracted.retracted === true, "mergeFrontmatter: retracted:true wins if any note says true");

  const counts = mergeFrontmatter({ citekey: "a", cited_by_count: 5 }, [
    { citekey: "b", cited_by_count: 12 },
    { citekey: "c", cited_by_count: 3 },
  ]);
  check(counts.cited_by_count === 12, "mergeFrontmatter: cited_by_count is the max across the group");

  const noOverwrite = mergeFrontmatter({ citekey: "a", title: "keeper title" }, [{ citekey: "b", title: "other title" }]);
  check(noOverwrite.title === "keeper title", "mergeFrontmatter: keeper's own non-empty value wins over others");

  const fmNoPosition = mergeFrontmatter({ citekey: "a" }, [
    { citekey: "b", position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 3, col: 0, offset: 30 } } },
  ]);
  check(!("position" in fmNoPosition), "mergeFrontmatter: never copies metadataCache's own `position` marker");
}

// ---------- data/merge.ts: mergeBodies ----------
{
  {
    const sub = mergeBodies("## Notes\n\nkeep\n", [
      { citekey: "l", body: "## Notes\n\nintro\n### Key points\n- a\n- b\n\n## Highlights\n" },
    ]);
    check(sub.includes("### Key points") && sub.includes("- b"), "mergeBodies: a ### subheading inside the loser's Notes stays with them");
    const chained = mergeBodies("## Notes\n", [
      { citekey: "a", body: "## Notes\n\n## Merged from b\n\n### Notes\n\nb's note\n" },
    ]);
    check(chained.includes("## Merged from b") && chained.includes("b's note"), "mergeBodies: a loser's own earlier Merged-from sections are carried over");
  }

  const keeperBody = "---\ncitekey: k\n---\n\n# Title\n\n## Notes\n\nkeeper note.\n\n## Highlights\n\n";
  const merged = mergeBodies(keeperBody, [
    { citekey: "loser1", body: "## Notes\n\nloser note text.\n\n## Highlights\n" },
  ]);
  check(merged.includes("## Merged from loser1"), "mergeBodies: appends a Merged-from heading for the loser");
  check(merged.includes("loser note text."), "mergeBodies: carries the loser's Notes text over");
  check(merged.startsWith(keeperBody.replace(/\s*$/, "")), "mergeBodies: keeper body prefix is unchanged");

  const loserWithSummary =
    "## Summary\n\n**Background / Objective**\nloser summary body\n\n## Notes\n\nloser note 2.\n";
  const merged2 = mergeBodies(keeperBody, [{ citekey: "loser2", body: loserWithSummary }]);
  check(!merged2.includes("loser summary body"), "mergeBodies: does not duplicate the loser's Summary block");
  check(merged2.includes("loser note 2."), "mergeBodies: still carries the loser's Notes past its Summary block");

  const emptyNotes = mergeBodies(keeperBody, [{ citekey: "loser3", body: "## Notes\n\n\n## Highlights\n" }]);
  check(!emptyNotes.includes("Merged from loser3"), "mergeBodies: an empty Notes section is not appended");

  // Stash: moved only when the keeper has none. loser4 has both a Notes section and a stash,
  // so the merge produces a "Merged from" section AND a separately-appended top-level stash.
  const stashedBody = "## Notes\n\nloser4 note.\n\n## Full text (extracted)\n\nthe full text.";
  const keeperNoStash = mergeBodies(keeperBody, [{ citekey: "loser4", body: stashedBody }]);
  check(keeperNoStash.includes("## Full text (extracted)"), "mergeBodies: moves the loser's stash when the keeper has none");
  check(keeperNoStash.includes("the full text."), "mergeBodies: stash text is carried over");
  check(
    keeperNoStash.indexOf(STASH_MARKER) > keeperNoStash.indexOf("## Merged from loser4"),
    "mergeBodies: the moved stash is its own top-level section, appended after the Merged-from one"
  );

  const keeperWithStash = keeperBody + "\n## Full text (extracted)\n\nkeeper's own full text.";
  const keptOwnStash = mergeBodies(keeperWithStash, [{ citekey: "loser5", body: stashedBody }]);
  const stashCount = (keptOwnStash.match(/## Full text \(extracted\)/g) || []).length;
  check(stashCount === 1, "mergeBodies: keeper's existing stash is not replaced by a loser's");
  check(keptOwnStash.includes("keeper's own full text."), "mergeBodies: keeper's own stash text survives");

  // Unknown sections, free text under the H1 and an H2 inside Notes survive; generated parts do not
  const richLoser = [
    "", "# Loser title", "", "> **Summary source**: abstract", "",
    "Free text I wrote under the title.", "",
    "## Summary", "", "**Methods**", "loser summary", "",
    "## Notes", "", "my note", "", "## Inner heading", "", "inner text", "",
    "## Critique", "", "weak design.", "",
    "## Evidence (extracted)", "", "> [!quote]- 0 findings", "",
    "## Full text (extracted)", "", "stash text",
  ].join("\n");
  const richMerged = mergeBodies(keeperBody, [{ citekey: "rich", body: richLoser }]);
  check(richMerged.includes("## Merged from rich") && richMerged.includes("### Critique") && richMerged.includes("weak design."), "mergeBodies: an unknown ## section of the loser is kept");
  check(richMerged.includes("Free text I wrote under the title."), "mergeBodies: text under the loser's H1 is kept");
  check(richMerged.includes("my note") && richMerged.includes("inner text") && richMerged.includes("Inner heading"), "mergeBodies: an H2 inside the loser's Notes is kept");
  check(!richMerged.includes("Loser title") && !richMerged.includes("Summary source") && !richMerged.includes("loser summary"), "mergeBodies: the loser's H1, summary-source line and Summary block are not carried");
  check((richMerged.match(/## Full text \(extracted\)/g) ?? []).length === 1 && richMerged.indexOf("stash text") > richMerged.indexOf("### Critique"), "mergeBodies: the stash is moved once, not duplicated into Merged from");

  const withHighlights = mergeBodies(keeperBody, [
    { citekey: "loser6", body: "## Notes\n\n\n## Highlights\n\nsome highlight text.\n" },
  ]);
  check(withHighlights.includes("### Highlights"), "mergeBodies: a loser's Highlights section is nested under Merged from");
  check(withHighlights.includes("some highlight text."), "mergeBodies: Highlights text is carried over");
}

// ---------- data/merge.ts: planMerge ----------
{
  check(extractSummaryBlock("## Summary\n\n## Notes\n") === null, "extractSummaryBlock: a bare heading is not a summary");
  check(extractSummaryBlock("## Summary\n\ntext\n") !== null, "extractSummaryBlock: a heading with text is a summary");

  const keeperNoSummary: MergeSourceNote = {
    citekey: "k",
    fm: { citekey: "k" },
    body: "---\ncitekey: k\n---\n\n# T\n\n## Notes\n\n## Highlights\n",
  };

  const loserWithSummary: MergeSourceNote = {
    citekey: "loser1",
    fm: { citekey: "loser1", summary_source: "pubmed-abstract", summary_model: "gpt-x" },
    body: "## Summary\n\n**Background / Objective**\nsummary text here\n\n## Notes\n\nloser notes.\n",
  };
  const plan1 = planMerge(keeperNoSummary, [loserWithSummary]);
  check(plan1.fm.summary_source === "pubmed-abstract", "planMerge: summary_source copied from the donor whose text actually moved");
  check(plan1.fm.summary_model === "gpt-x", "planMerge: summary_model copied from that same donor");
  check(plan1.body.includes("summary text here"), "planMerge: the donor's summary text is moved into the keeper body");
  check(plan1.body.includes("## Summary"), "planMerge: the moved-in summary keeps its heading");
  check(plan1.body.indexOf("## Summary") < plan1.body.indexOf("## Notes"), "planMerge: a moved summary lands above ## Notes, like a fresh note");

  const loserNoSummaryText: MergeSourceNote = {
    citekey: "loser2",
    fm: { citekey: "loser2", summary_source: "manual" },
    body: "## Notes\n\nno summary section in this body.\n",
  };
  const plan2 = planMerge(keeperNoSummary, [loserNoSummaryText]);
  check(
    plan2.fm.summary_source === undefined,
    "planMerge: no summary text moved anywhere -> summary_source is NOT copied, even though a loser sets it"
  );
  check(!plan2.body.includes("## Summary"), "planMerge: no Summary heading is added when nothing moved");

  const keeperWithOwnStash: MergeSourceNote = {
    citekey: "k2",
    fm: { citekey: "k2" },
    body:
      "---\ncitekey: k2\n---\n\n# T\n\n## Notes\n\nkeeper notes.\n\n## Highlights\n\n\n" +
      "## Full text (extracted)\n\nkeeper full text.",
  };
  const loser3: MergeSourceNote = { citekey: "loser3", fm: { citekey: "loser3" }, body: "## Notes\n\nloser3 notes.\n" };
  const plan3 = planMerge(keeperWithOwnStash, [loser3]);
  check(
    plan3.body.indexOf("## Merged from loser3") < plan3.body.indexOf(STASH_MARKER),
    "planMerge: merged-in sections land before an existing stash, never inside it"
  );
  check(
    stashedText(plan3.body) === stashedText(keeperWithOwnStash.body),
    "planMerge: the keeper's own stash text survives unchanged"
  );
}

// ---------- data/merge.ts: renameWikilinks ----------
{
  const renames = [{ path: "References/smith2020", keeperBasename: "jones2021" }];
  check(renameWikilinks("[[smith2020]]", renames) === "[[jones2021]]", "renameWikilinks: bare basename form");
  check(
    renameWikilinks("[[References/smith2020]]", renames) === "[[jones2021]]",
    "renameWikilinks: full vault path (no .md) form"
  );
  check(
    renameWikilinks("[[smith2020|Smith's paper]]", renames) === "[[jones2021|Smith's paper]]",
    "renameWikilinks: alias suffix preserved"
  );
  check(
    renameWikilinks("[[smith2020#Results]]", renames) === "[[jones2021#Results]]",
    "renameWikilinks: heading suffix preserved"
  );
  check(
    renameWikilinks("[[smith2020#Results|see here]]", renames) === "[[jones2021#Results|see here]]",
    "renameWikilinks: heading + alias suffix preserved together"
  );
  check(renameWikilinks("![[smith2020]]", renames) === "![[jones2021]]", "renameWikilinks: leading ! embed marker preserved");
  check(
    renameWikilinks("[[smith2020b]]", renames) === "[[smith2020b]]",
    "renameWikilinks: a different note whose name only starts with the loser's name is untouched"
  );
  check(renameWikilinks("no links here", []) === "no links here", "renameWikilinks: no-op with an empty rename list");
}

// ---------- cite/bibliography.ts: renameCiteKeys ----------
{
  check(renameCiteKeys("See [@a] for details.", { a: "k" }) === "See [@k] for details.", "renameCiteKeys: single key");

  check(
    renameCiteKeys("As shown [@a; @b, p. 3].", { a: "k" }) === "As shown [@k; @b, p. 3].",
    "renameCiteKeys: cluster with a locator, unmapped key and locator untouched"
  );

  check(
    renameCiteKeys("[@a; @b]", { a: "k", b: "k" }) === "[@k]",
    "renameCiteKeys: cluster that would repeat a key after renaming dedupes to one"
  );

  const withCode = "`[@a]` and [@a].";
  check(
    renameCiteKeys(withCode, { a: "k" }) === "`[@a]` and [@k].",
    "renameCiteKeys: leaves citations inside a code span untouched"
  );

  check(
    renameCiteKeys("[@smith2020a]", { smith2020: "k" }) === "[@smith2020a]",
    "renameCiteKeys: a longer citekey sharing a prefix is not confused with the mapped one"
  );

  check(renameCiteKeys("[@unknown]", { a: "k" }) === "[@unknown]", "renameCiteKeys: unmapped citekey is left as written");
}

// ---------- data/screening.ts: applyScreening ----------
{
  // include with no kq (neither passed nor already on the note) is rejected, nothing written.
  const fm1: Record<string, unknown> = { tags: ["existing"] };
  assert.throws(
    () => applyScreening(fm1, { include: "include" }),
    /include requires at least one kq/,
    "applyScreening: include without kq is rejected"
  );
  check(
    Array.isArray(fm1.tags) && fm1.tags.length === 1 && fm1.tags[0] === "existing",
    "applyScreening: rejected call left fm.tags untouched"
  );
  check(!("include" in fm1), "applyScreening: rejected call left fm.include unset");

  // include is fine when kq is passed alongside it in the same call.
  const fm2: Record<string, unknown> = { tags: [] };
  const r2 = applyScreening(fm2, { kq: ["1"], include: "include" });
  check(r2.fields.include === "include" && r2.fields.kq.length === 1, "applyScreening: include with kq in the same call succeeds");

  // include is also fine when kq was already on the note from an earlier call.
  const fm3: Record<string, unknown> = { tags: ["kq-01"], kq: ["1"] };
  const r3 = applyScreening(fm3, { include: "include" });
  check(r3.fields.include === "include", "applyScreening: include succeeds when kq already exists on the note");

  // clearing the KQs of an already-included record is rejected too, and writes nothing.
  const fm7: Record<string, unknown> = { tags: [], include: "include", kq: ["1"] };
  assert.throws(
    () => applyScreening(fm7, { kq: [] }),
    /include requires at least one kq/,
    "applyScreening: clearing kq of an included record is rejected"
  );
  check(JSON.stringify(fm7.kq) === '["1"]', "applyScreening: rejected kq clear left fm.kq untouched");
  applyScreening(fm7, { kq: ["2"] });
  check(JSON.stringify(fm7.kq) === '["2"]', "applyScreening: replacing kq of an included record is fine");
  applyScreening(fm7, { kq: [], include: "pending" });
  check(fm7.include === "pending" && JSON.stringify(fm7.kq) === "[]", "applyScreening: kq can be cleared when include is also being changed away");
  applyScreening(fm7, { kq: [] });
  check(JSON.stringify(fm7.kq) === "[]", "applyScreening: kq can be cleared on a non-included record");

  // results live in fields only: nothing is mirrored into tags, user tags survive.
  const fm4: Record<string, unknown> = { tags: ["mine"] };
  const r4 = applyScreening(fm4, { kq: ["1", "3"], include: "pending", level: "2", design: "Randomized controlled trial", guideline: " BE " });
  check(r4.tags.length === 1 && r4.tags[0] === "mine", "applyScreening: setting fields adds no tags");
  check(fm4.include === "pending" && fm4.level === "2" && fm4.guideline === "BE", "applyScreening: values stored in fields, guideline trimmed");
  check(r4.fields.guideline === "BE", "applyScreening: result reports guideline");
  applyScreening(fm4, { guideline: "  " });
  check(!("guideline" in fm4), "applyScreening: blank guideline removes the field");

  // study_id: free text, trimmed, blank clears, never a tag; non-strings rejected.
  const fmS: Record<string, unknown> = { tags: ["mine"] };
  const rS = applyScreening(fmS, { study_id: "  NCT0123 " });
  check(fmS.study_id === "NCT0123" && rS.fields.study_id === "NCT0123", "applyScreening: study_id stored trimmed and reported");
  check(JSON.stringify(rS.tags) === '["mine"]', "applyScreening: study_id adds no tags");
  applyScreening(fmS, { guideline: "BE" });
  check(fmS.study_id === "NCT0123", "applyScreening: study_id untouched when not named");
  const rS2 = applyScreening(fmS, { study_id: "  " });
  check(!("study_id" in fmS) && rS2.fields.study_id === null, "applyScreening: blank study_id removes the field");
  let studyErr = "";
  try { applyScreening(fmS, { study_id: 5 as unknown as string }); } catch (e) { studyErr = String(e); }
  check(/INVALID_ARGUMENT: study_id must be a string/.test(studyErr) && !("study_id" in fmS), "applyScreening: non-string study_id rejected, nothing written");

  // risk of bias: enums validated before anything is written, "" clears, no tags touched.
  const fmR: Record<string, unknown> = { tags: ["mine"] };
  const rR = applyScreening(fmR, { rob_tool: "RoB 2", rob_overall: "some concerns", rob_note: "  deviations from protocol  " });
  check(fmR.rob_tool === "RoB 2" && fmR.rob_overall === "some concerns" && fmR.rob_note === "deviations from protocol", "applyScreening: rob fields stored, note trimmed");
  check(rR.fields.rob_tool === "RoB 2" && rR.fields.rob_overall === "some concerns" && rR.fields.rob_note === "deviations from protocol", "applyScreening: result reports rob fields");
  check(rR.tags.length === 1 && rR.tags[0] === "mine", "applyScreening: rob fields add no tags");
  assert.throws(() => applyScreening(fmR, { rob_tool: "RoB 3", rob_note: "x" }), /rob_tool must be one of/, "applyScreening: unknown rob_tool rejected");
  assert.throws(() => applyScreening(fmR, { rob_overall: "fine" }), /rob_overall must be one of/, "applyScreening: unknown rob_overall rejected");
  check(fmR.rob_tool === "RoB 2" && fmR.rob_note === "deviations from protocol", "applyScreening: rejected rob call wrote nothing");
  applyScreening(fmR, { rob_overall: "" });
  check(!("rob_overall" in fmR) && fmR.rob_tool === "RoB 2", "applyScreening: empty rob_overall clears only that field");
  applyScreening(fmR, { rob_tool: "", rob_note: " " });
  check(!("rob_tool" in fmR) && !("rob_note" in fmR), "applyScreening: empty rob_tool / blank rob_note clear");
  applyScreening(fmR, { level: "2" });
  check(!("rob_tool" in fmR), "applyScreening: untouched rob fields stay untouched");

  // legacy mirrored tags are dropped when their field is set, and only then.
  const fm6: Record<string, unknown> = { tags: ["mine", "kq-01", "kq-xyz", "pending", "level-2", "design-rct", "design-foo"] };
  const r6 = applyScreening(fm6, { include: "exclude" });
  check(!r6.tags.includes("pending") && r6.tags.includes("kq-01") && r6.tags.includes("level-2"), "applyScreening: include drops legacy include-state tag only");
  applyScreening(fm6, { kq: ["2"] });
  applyScreening(fm6, { level: "3" });
  const r6b = applyScreening(fm6, { design: "RCT" });
  check(
    JSON.stringify(r6b.tags) === JSON.stringify(["mine"]),
    "applyScreening: kq / level / design each drop their legacy mirrored tags"
  );

  // an invalid design (empty/blank, not just any free text) is rejected before anything is written.
  const fm5: Record<string, unknown> = { tags: [] };
  assert.throws(
    () => applyScreening(fm5, { design: "   " }),
    /design must be a non-empty string/,
    "applyScreening: a blank design is rejected"
  );
  check(!("design" in fm5), "applyScreening: rejected design call left fm.design unset");
}

// ---------- data/rob.ts: robMarkdown ----------
{
  const r = (citekey: string, include: string | null, tool: string | null, overall: string | null, note: string | null = null): RobRecord =>
    ({ citekey, authors: "Kim et al.", year: "2021", include, rob_tool: tool, rob_overall: overall, rob_note: note });
  const md = robMarkdown([
    r("b2021", "include", "RoB 2", "low"),
    r("a2021", "include", "RoB 2", "high", "no blinding | open label"),
    r("c2021", "include", "ROBINS-I", "serious"),
    r("d2021", "include", null, null),
    r("e2021", "include", "NOS", null),
    r("f2021", "exclude", null, null),
    r("g2021", "pending", null, "low"),
  ], "included records", "2026-11-03");
  check(md.indexOf("## RoB 2") < md.indexOf("## ROBINS-I") && md.indexOf("## NOS") < md.indexOf("## RoB 2"), "robMarkdown: one table per tool, sorted");
  check(md.indexOf("[@a2021]") < md.indexOf("[@b2021]"), "robMarkdown: rows sorted by citekey");
  check(md.includes("| [@a2021] | Kim et al. 2021 | high | no blinding \\| open label |"), "robMarkdown: row cells, pipe escaped");
  check(md.includes("## Tool not set") && md.includes("[@g2021]"), "robMarkdown: judgement without a tool gets its own table");
  check(md.includes("| low | 2 |") && md.includes("| high | 1 |") && md.includes("| serious | 1 |") && md.includes("| (not set) | 1 |"), "robMarkdown: count per judgement");
  const missing = md.slice(md.indexOf("## Included records without an assessment"));
  check(missing.includes("(2)") && missing.includes("- [@d2021]") && missing.includes("- [@e2021] (tool: NOS)"), "robMarkdown: unassessed included records listed");
  check(!missing.includes("f2021") && !missing.includes("g2021") && !missing.includes("a2021"), "robMarkdown: excluded, pending and assessed records not listed as missing");
  check(!md.includes("Study ID") && md.includes("| Reference | Study | Overall | Note |") && md.includes("|---|---|---|---|"), "robMarkdown: no study column without any study_id");
  const withStudy = robMarkdown([
    { ...r("a2021", "include", "RoB 2", "high"), study_id: "S1" },
    r("b2021", "include", "RoB 2", "low"),
  ], "included records", "2026-11-03");
  check(withStudy.includes("| Reference | Study | Study ID | Overall | Note |") && withStudy.includes("|---|---|---|---|---|"), "robMarkdown: Study ID column header when a record has a study_id");
  check(withStudy.includes("| [@a2021] | Kim et al. 2021 | S1 | high | — |") && withStudy.includes("| [@b2021] | Kim et al. 2021 | — | low | — |"), "robMarkdown: Study ID cell per row, em dash when blank");
  const empty = robMarkdown([], "all references", "2026-11-03");
  check(empty.includes("No risk-of-bias assessments yet.") && empty.includes("None."), "robMarkdown: empty scope reads cleanly");
}

// ---------- numeric study_id (unquoted YAML) and kq normalisation ----------
{
  // `study_id: 2019001` parses as a number; both reports must still land in one study.
  const a = toPrismaRecord("a", { include: "include", study_id: 2019001 });
  const b = toPrismaRecord("b", { include: "include", study_id: " 2019001 " });
  check(a.study_id === "2019001" && b.study_id === "2019001", "toPrismaRecord: numeric / padded study_id read as trimmed text");
  const pc = prismaCounts([a, b, toPrismaRecord("c", { include: "include" })], [], () => true);
  check(pc.reportsIncluded === 3 && pc.studiesIncluded === 2 && pc.hasStudyIds, "prismaCounts: numeric study_id groups two reports into one study");
  const rr = toRobRecord("a", "Kim", "2021", { include: "include", rob_tool: "RoB 2", rob_overall: "low", study_id: 2019001 });
  check(rr.study_id === "2019001", "toRobRecord: numeric study_id kept");
  check(robMarkdown([rr], "x", "2026-11-04").includes("| Reference | Study | Study ID | Overall | Note |"), "robMarkdown: Study ID column for a numeric study_id");
  const num = applyScreening({ study_id: 2019001 }, {});
  check(num.fields.study_id === "2019001", "applyScreening: numeric study_id reported as text");
  // the duplicate that keeps its place is the one with a decision, not merely the first
  {
    const undecided: PrismaRecord = { citekey: "u1", include: null };
    const inc: PrismaRecord = { citekey: "i1", include: "include" };
    const exc: PrismaRecord = { citekey: "x1", include: "exclude" };
    const c1 = prismaCounts([undecided, inc], [["u1", "i1"]], () => true);
    check(c1.duplicatesRemoved === 1 && c1.reportsIncluded === 1 && c1.awaitingDecision === 0, "prismaCounts: an included copy beats an undecided copy listed first");
    const c2 = prismaCounts([undecided, exc], [["u1", "x1"]], () => true);
    check(c2.excludedAtScreening === 1 && c2.awaitingDecision === 0, "prismaCounts: an excluded copy beats an undecided one");
    const c3 = prismaCounts([exc, inc], [["x1", "i1"]], () => true);
    check(c3.reportsIncluded === 1 && c3.excludedAtScreening === 0, "prismaCounts: include beats exclude");
    const c4 = prismaCounts([{ citekey: "p1", include: "pending" }, undecided], [["p1", "u1"]], () => true);
    check(c4.recordsScreened === 1 && c4.awaitingDecision === 1, "prismaCounts: ties fall back to input order");
  }
  // kq: "03" and 3 are one key question everywhere
  check(kqKey("03") === "3" && kqKey(3) === "3" && kqKey(" 3 ") === "3" && kqKey("kq-a") === "kq-a", "kqKey: leading zeros and padding collapse");
  check(hasKq(["03"], 3) && hasKq([3], "03") && hasKq(["3"], "03") && !hasKq(["13"], "3") && !hasKq(undefined, "3"), "hasKq: 3 and 03 match each other");
  check(JSON.stringify(kqChoices([["3"], ["03", "kq-a"], [3], "x"])) === '["3","kq-a"]', "kqChoices: 3 and 03 collapse into one choice");
}

// ---------- data/prisma.ts: prismaCounts / prismaMarkdown ----------
{
  const records: PrismaRecord[] = [
    { citekey: "a2020", include: "include", screening_note: null }, // has full text
    { citekey: "b2020", include: "include", screening_note: null }, // no full text
    { citekey: "c2020", include: "exclude", screening_note: "Wrong population: pediatric cohort" },
    { citekey: "d2020", include: "exclude", screening_note: "no recognized prefix here" },
    { citekey: "e2020", include: "pending", screening_note: null },
    { citekey: "f2020", include: null, screening_note: null }, // unscreened
    { citekey: "g2020", include: "include", screening_note: null }, // duplicate of a2020, dropped
  ];
  const dupGroups = [["a2020", "g2020"]];
  const fullText = new Set(["a2020"]);
  const counts = prismaCounts(records, dupGroups, (r) => fullText.has(r.citekey));

  check(counts.recordsIdentified === 7, "prismaCounts: recordsIdentified counts every scoped record");
  check(counts.duplicatesRemoved === 1, "prismaCounts: one duplicate (beyond the first) removed");
  check(counts.recordsScreened === 6, "prismaCounts: recordsScreened = identified - duplicates");
  check(counts.excludedAtScreening === 2, "prismaCounts: two excluded");
  check(counts.awaitingDecision === 2, "prismaCounts: pending + unscreened = awaiting decision");
  check(counts.reportsSoughtForRetrieval === 2, "prismaCounts: two included (duplicate not double-counted)");
  check(counts.reportsAssessed === 1, "prismaCounts: one included record has full text");
  check(counts.reportsNotRetrieved === 1, "prismaCounts: one included record has no full text");
  check(counts.studiesIncluded === 2, "prismaCounts: studiesIncluded mirrors included count");
  const wrongPop = counts.exclusionReasons.find((r) => r.reason === "Wrong population");
  const other = counts.exclusionReasons.find((r) => r.reason === "Other");
  check(!!wrongPop && wrongPop.count === 1, "prismaCounts: exclusion reason grouped by recognized prefix");
  check(!!other && other.count === 1, "prismaCounts: unrecognized note grouped under Other");

  const md = prismaMarkdown(counts, "all references", "2026-09-23");
  const nodeLines = md.split("\n").filter((l) => /^ {4}[A-Z]\[/.test(l));
  check(
    nodeLines.length >= 9 && nodeLines.every((l) => /^ {4}[A-Z]\["[^"]*"\]$/.test(l)),
    "prismaMarkdown: every node label is quoted (parentheses in a bare label break Mermaid's parser)"
  );
  check(md.includes("flowchart TD"), "prismaMarkdown: contains a valid mermaid flowchart header");
  check(md.includes("n = 7"), "prismaMarkdown: records identified count appears in the diagram");
  check(md.includes("| Records identified | 7 |"), "prismaMarkdown: records identified appears in the table");
  check(md.includes("| Studies included in review | 2 |"), "prismaMarkdown: included count appears in the table");
  check(md.includes("Wrong population"), "prismaMarkdown: exclusion reason listed");

  // no study_id on any included record: output is exactly what it was before the field existed.
  check(!counts.hasStudyIds && counts.reportsIncluded === 2, "prismaCounts: no study_id -> hasStudyIds false");
  check(
    md.includes('    H["Studies included in review<br/>n = 2<br/>full text 1 · abstract only 1"]') &&
      md.includes("| Reports assessed for eligibility | 1 |\n| Studies included in review | 2 |\n") &&
      !/Reports included|reports of included studies/.test(md),
    "prismaMarkdown: byte-identical included lines when no record has a study_id"
  );

  // study_id: distinct ids among included records; no id = its own study; duplicates/excluded ignored.
  const sRecords: PrismaRecord[] = [
    { citekey: "p1", include: "include", study_id: "S1" }, // protocol
    { citekey: "p2", include: "include", study_id: " S1 " }, // primary report (trim)
    { citekey: "p3", include: "include", study_id: "S2" },
    { citekey: "p4", include: "include" }, // own study
    { citekey: "p5", include: "include", study_id: "" }, // own study
    { citekey: "p6", include: "exclude", study_id: "S3" }, // excluded: not a study here
  ];
  const sCounts = prismaCounts(sRecords, [], () => true);
  check(sCounts.reportsIncluded === 5 && sCounts.studiesIncluded === 4 && sCounts.hasStudyIds, "prismaCounts: 5 reports of 4 studies (shared id grouped, blank id its own)");
  const sMd = prismaMarkdown(sCounts, "all references", "2026-11-04");
  check(sMd.includes("| Reports included | 5 |\n| Studies included in review | 4 |"), "prismaMarkdown: table reports reports and studies");
  check(sMd.includes('H["Studies included in review<br/>n = 4 · reports of included studies n = 5<br/>full text 5 · abstract only 0"]'), "prismaMarkdown: diagram box reports studies and reports");
  check(prismaCounts([{ citekey: "x", include: "include", study_id: "S" }], [], () => true).studiesIncluded === 1, "prismaCounts: single study id");

  // mutation check: a broken prismaCounts (off-by-one on duplicates) must fail the assertions above.
  const brokenDupGroups: string[][] = [];
  const brokenCounts = prismaCounts(records, brokenDupGroups, (r) => fullText.has(r.citekey));
  check(brokenCounts.recordsScreened === 7, "prismaCounts mutation check: no dup groups -> nothing removed");
}

// ---------- data/searchLog.ts: search-log note + PRISMA search-log section ----------
{
  const date = new Date(2026, 10, 3, 14, 5).toISOString();
  const entry = {
    source: "PubMed", query: 'biportal  endoscop*: "discectomy" / outcomes?', year_from: 2020, year_to: 2025,
    date, total: 412, returnedPmids: ["111", "222", "333"], importedPmids: ["111", "333"],
  };
  const { path, content } = searchLogNote(entry);
  check(path === "Searches/2026-11-03 1405 PubMed - biportal endoscop discectomy outcomes.md", `searchLogNote: path (${path})`);
  check(!/[\\:?"<>|]/.test(path.slice("Searches/".length)), "searchLogNote: no illegal filename characters");
  const longPath = searchLogNote({ ...entry, query: "a".repeat(100) }).path;
  check(longPath.endsWith(` - ${"a".repeat(60)}.md`), "searchLogNote: query capped at 60 chars in the name");
  const fm = parseYaml(content.split("---")[1]) as Record<string, unknown>;
  check(fm.type === "search-log" && fm.source === "PubMed" && fm.query === entry.query && fm.date === date, "searchLogNote: frontmatter identity fields");
  check(fm.year_from === 2020 && fm.year_to === 2025 && fm.total === 412 && fm.returned === 3 && fm.imported === 2, "searchLogNote: frontmatter filters and counts");
  check(content.includes("```\n" + entry.query + "\n```"), "searchLogNote: exact query in a code block");
  check(content.includes("- [PMID 111](https://pubmed.ncbi.nlm.nih.gov/111/)") && !content.includes("[PMID 222]"), "searchLogNote: imported PMIDs linked, unimported not");
  check(content.includes("publication year 2020 to 2025"), "searchLogNote: filters in the body");
  const bare = searchLogNote({ ...entry, year_from: undefined, year_to: undefined, importedPmids: [] });
  const bareFm = parseYaml(bare.content.split("---")[1]) as Record<string, unknown>;
  check(!("year_from" in bareFm) && !("year_to" in bareFm) && bareFm.imported === 0, "searchLogNote: no year keys when unfiltered, imported 0");
  check(suffixedPath(path, 1) === path && suffixedPath(path, 2).endsWith(" 2.md"), "suffixedPath: numeric suffix from 2");

  const summary = parseSearchLog(fm);
  check(summary?.total === 412 && summary.source === "PubMed", "parseSearchLog: reads a log's frontmatter");
  check(parseSearchLog({ type: "reference", total: 5 }) === null, "parseSearchLog: ignores other notes");
  check(summary?.year_from === 2020 && summary.year_to === 2025, "parseSearchLog: reads the year filters");
  const logs = [summary!, { ...summary!, query: "other query", total: 8 }, { source: "Embase", date, query: "q", total: 5 }];
  const totals = searchLogTotals(logs);
  check(totals.length === 2 && totals[0].total === 420 && totals[1].source === "Embase", "searchLogTotals: sums per source");
  {
    const a = { source: "PubMed", date: "2026-11-01T10:00:00Z", query: "Disc  Herniation ", year_from: 2020, total: 100 };
    const b = { ...a, date: "2026-11-03T10:00:00Z", query: "disc herniation", total: 120 };
    const c = { ...a, date: "2026-11-02T10:00:00Z", year_from: 2021, total: 7 }; // different filter: separate search
    const d = { ...a, source: "Embase", total: 9 }; // other source: separate
    const t = searchLogTotals([a, b, c, d]);
    check(t[0].total === 127 && t[1].total === 9, `searchLogTotals: repeated search counts once, latest total (${JSON.stringify(t)})`);
    const kept = countedSearchLogs([b, a]);
    check(kept.has(b) && !kept.has(a), "countedSearchLogs: order-independent, most recent run kept");
    const md = prismaMarkdown(prismaCounts([], [], () => true), "all references", "2026-11-03", [a, b]);
    check(md.includes("- PubMed: 120") && md.split("repeat of an earlier search, not counted").length === 2, "prismaMarkdown: repeats listed but marked, not counted");
  }

  const counts = prismaCounts([{ citekey: "a2020", include: "include" }], [], () => true);
  const withLogs = prismaMarkdown(counts, "all references", "2026-11-03", logs);
  check(withLogs.includes("from search logs") && withLogs.includes("- PubMed: 420") && withLogs.includes("- Embase: 5"), "prismaMarkdown: search-log totals per source");
  check(withLogs.includes("| Records identified | 1 |"), "prismaMarkdown: existing counts unchanged beside the log totals");
  check(!prismaMarkdown(counts, "all references", "2026-11-03").includes("search logs"), "prismaMarkdown: no log section without logs");
}

// ---------- index/providers/ollama.ts: embed() rejects a non-finite value in the payload ----------
{
  const realFetch = globalThis.fetch;
  try {
    // JSON can't carry NaN, so test what a broken endpoint can actually send: a string entry.
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ embeddings: [[0.1, "0.2", 0.3]] }), { status: 200 })) as typeof fetch;
    const provider = new OllamaProvider({ ...DEFAULT_SETTINGS, embeddingProvider: "ollama" });
    let threw = false;
    try {
      await provider.embed(["x"]);
    } catch {
      threw = true;
    }
    check(threw, "OllamaProvider.embed: a non-numeric embedding value is rejected, not silently accepted");
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ---------- data/library.ts: Library.folder() — the one referencesFolder fallback ----------
{
  const settings = { ...DEFAULT_SETTINGS, referencesFolder: "" };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const library = new Library({} as any, settings);
  check(library.folder() === "References", 'Library.folder(): empty referencesFolder falls back to "References" at the one consumption point');
  settings.referencesFolder = "MyRefs";
  check(library.folder() === "MyRefs", "Library.folder(): a set referencesFolder passes through");
}

// ---------- settings.ts: declarative definitions (searchable rows, no snap-back, visible()) ----------
{
  const settings = { ...DEFAULT_SETTINGS, embeddingProvider: "ollama" as const };
  let saves = 0;
  let keyCacheDrops = 0;
  const fakePlugin = {
    settings,
    saveSettings: async () => { saves++; },
    library: { invalidateKeyCache: () => { keyCacheDrops++; } },
    indexManager: { relocate: async () => {} },
    hasSecretStorage: () => true,
    mcpStatus: () => ({ running: false, port: 0 }),
    mcpSetupSnippets: () => null,
    restartMcp: async () => {},
    stopMcp: async () => {},
    setMcpEnabled: async (v: boolean) => { settings.mcpEnabled = v; },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tab = new ScholarRagSettingTab({} as any, fakePlugin);

  // A text control's change handler must not snap an emptied field back to a default — the
  // fallback belongs at the point of consumption (Library.folder(), llm/client.ts), not here.
  // Every toggle declared in the definitions must actually reach settings + save (review finding:
  // "Systematic review tools" had no setControlValue case, so it could not be changed).
  saves = 0;
  await tab.setControlValue("reviewTools", true);
  check(settings.reviewTools === true && saves === 1, "setControlValue: reviewTools on is stored and saved");
  await tab.setControlValue("reviewTools", false);
  check(settings.reviewTools === false && saves === 2, "setControlValue: reviewTools off is stored and saved");
  keyCacheDrops = 0;
  await tab.setControlValue("referencesFolder", "");
  check(keyCacheDrops === 1, "setControlValue: changing referencesFolder drops the library caches");
  check(settings.referencesFolder === "", "setControlValue: clearing referencesFolder stores empty, not a default snap-back");
  await tab.setControlValue("ollamaUrl", "");
  check(settings.ollamaUrl === "", "setControlValue: clearing ollamaUrl stores empty, not a default snap-back");
  await tab.setControlValue("openaiBaseUrl", "");
  check(settings.openaiBaseUrl === "", "setControlValue: clearing openaiBaseUrl stores empty, not a default snap-back");
  // Mid-typing "My Refs" passes through "My " — a trim here would eat the space on a re-read.
  await tab.setControlValue("referencesFolder", "My ");
  check(settings.referencesFolder === "My ", "setControlValue: keeps a trailing space while the user is still typing");
  await tab.setControlValue("referencesFolder", "  Papers  ");
  check(effective(settings, "referencesFolder") === "Papers", "effective: the stored value is trimmed where it is used");

  // Every provider/summary-language/MCP-dependent row must be declared once (present in the
  // definitions array regardless of current settings) with a live `visible()` — not pushed
  // conditionally — so it appears (in the tab and in search) as soon as the setting it depends on changes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const defs = (tab as any).buildDefinitions();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allRows = defs.flatMap((g: any) => g.items);
  const apiKeyRow = allRows.find((r: { name: string }) => r.name === "API key (OpenRouter or OpenAI)");
  const reviewRow = allRows.find((r: { name: string }) => r.name === "Systematic review tools");
  // Every declared toggle must be wired: flipping it through setControlValue changes the setting.
  for (const row of allRows.filter((r: { control?: { type: string } }) => r.control?.type === "toggle")) {
    const key = row.control.key as string;
    const before = !!(settings as unknown as Record<string, unknown>)[key];
    await tab.setControlValue(key, !before);
    const after = !!(settings as unknown as Record<string, unknown>)[key];
    check(after === !before, `settings: toggle "${row.name}" (${key}) is wired to setControlValue`);
    await tab.setControlValue(key, before);
  }
  check(reviewRow?.control?.type === "toggle" && reviewRow.control.key === "reviewTools", 'settings: "Systematic review tools" is a toggle on reviewTools');
  check(!!apiKeyRow, 'settings: "API key (OpenRouter or OpenAI)" row exists in the definitions even while the provider is Ollama');
  settings.llmProvider = "ollama"; // neither embeddings nor chat use the OpenAI endpoint
  check(apiKeyRow.visible() === false, 'settings: "API key (OpenRouter or OpenAI)" row is not visible while both providers are Ollama');
  settings.llmProvider = "openai"; // chat alone needs the key — the row must show (review finding)
  check(apiKeyRow.visible() === true, 'settings: "API key (OpenRouter or OpenAI)" row shows when only the chat LLM uses OpenAI');
  settings.llmProvider = "ollama";
  settings.embeddingProvider = "openai"; // live mutation of the SAME settings object, no rebuild
  check(
    apiKeyRow.visible() === true,
    "settings: the same row (array never rebuilt) becomes visible once live settings say OpenAI — visible() reads live state, not a frozen snapshot"
  );

  // "Custom…" summary language: the field stays while the user types a value that happens to be a
  // preset code (review finding — it used to hide itself mid-edit once the value became "en").
  const customRow = allRows.find((r: { name: string }) => r.name === "Custom summary language");
  await tab.setControlValue("summaryLanguagePreset", "custom");
  await tab.setControlValue("summaryLanguage", "en");
  check(customRow.visible() === true, "settings: the custom summary-language field stays visible while typing 'en'");
  check(tab.getControlValue("summaryLanguagePreset") === "custom", "settings: the preset dropdown stays on Custom… while typing");
  await tab.setControlValue("summaryLanguagePreset", "ko");
  check(customRow.visible() === false && settings.summaryLanguage === "ko", "settings: picking a preset hides the custom field");

  // No row may set both a control and a custom renderer (mirrors the real API's mutual exclusion).
  const bothSet = allRows.filter((r: { control?: unknown; render?: unknown }) => r.control && r.render);
  check(bothSet.length === 0, "settings: no row sets both control and render");
}

// ---------- ingest/zotero.ts ----------
{
  const cols = parseCollections([
    { key: "B", data: { key: "B", name: "Child", parentCollection: "A" } },
    { key: "A", data: { key: "A", name: "Parent", parentCollection: false } },
  ]);
  assert.deepEqual(cols.map((c) => c.path), ["Parent", "Parent / Child"]);
  assert.deepEqual(parseCollections("nope"), []);
  const page = parseCslPage({ items: [{ id: "x", title: "T" }] });
  assert.equal(page.length, 1);
  assert.equal(page[0].title, "T");
  assert.equal("id" in page[0], false);
  assert.deepEqual(parseCslPage(null), []);
  assert.deepEqual(parseCslPage({ items: "x" }), []);
  passed += 8;
}

// ---------- cite/format.ts: citeTooltip ----------
{
  const base = { type: "article-journal", title: "Efficacy of X.", "container-title": "Oper Neurosurg", issued: { "date-parts": [[2024]] } };
  assert.equal(
    citeTooltip({ ...base, author: [{ family: "Lv", given: "Zhen" }, { family: "Zhang", given: "Yu" }] }),
    "Lv Z, Zhang Y (2024)\nEfficacy of X.\nOper Neurosurg"
  );
  assert.equal(
    citeTooltip({ ...base, author: ["A", "B", "C", "D"].map((f) => ({ family: f, given: "Q" })) }),
    "A Q, B Q, C Q, et al. (2024)\nEfficacy of X.\nOper Neurosurg"
  );
  assert.equal(citeTooltip({ type: "book" }), "(n.d.)");
  assert.equal(citeTooltip({ type: "book", title: "T", author: [{ literal: "WHO" }] }), "WHO (n.d.)\nT");
  const t = "a [@k1; @k2] `[@x]`\n```\n[@y]\n```\nb [@z]";
  assert.deepEqual(citeClusters(t).map((c) => [t.slice(c.from, c.to), c.keys.join(",")]), [
    ["[@k1; @k2]", "k1,k2"],
    ["[@z]", "z"],
  ]);
  passed += 6;
}

// ---------- index/rerank.ts: mmr + hosted rerank ----------
{
  const v = (...a: number[]) => { const f = new Float32Array(a); const n = Math.hypot(...a); return f.map((x) => x / n); };
  const hs = [
    { id: "a", score: 1.0, vector: v(1, 0) },
    { id: "b", score: 0.95, vector: v(1, 0.01) },
    { id: "c", score: 0.9, vector: v(0, 1) },
    { id: "d", score: 0, vector: v(-1, 0) },
  ];
  assert.deepEqual(mmr(hs, 3).map((h) => h.id), ["a", "c", "b"]);
  assert.deepEqual(mmr(hs, 3, 1).map((h) => h.id), ["a", "b", "c"]);
  assert.equal(mmr(hs, 10).length, 4);
  assert.equal(mmr(hs, 2).length, 2);
  assert.deepEqual(mmr([{ id: "x", score: 1 }, { id: "y", score: 2 }], 2).map((h) => h.id), ["y", "x"]);
  assert.deepEqual(mmr([], 3), []);
  const ok = { results: [{ index: 1, relevance_score: 0.2 }, { index: 0, relevance_score: 0.9 }] };
  assert.deepEqual(parseRerankResponse(ok, 3), [{ index: 0, score: 0.9 }, { index: 1, score: 0.2 }]);
  assert.equal(parseRerankResponse({ results: [{ index: 3, relevance_score: 1 }] }, 3), null);
  assert.equal(parseRerankResponse({ results: [{ index: 0, relevance_score: 1 }, { index: 0, relevance_score: 2 }] }, 3), null);
  assert.equal(parseRerankResponse({}, 3), null);
  assert.equal(parseRerankResponse({ results: [{ index: 0 }] }, 3), null);
  assert.equal(parseRerankResponse({ results: [{ index: 2, relevance_score: 0.5 }] }, 3)?.length, 1);
  passed += 12;
}

// ---------- index/store.ts: vector bank ----------
{
  const DIM = 16;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const words = ["spine", "fusion", "endoscopy", "lumbar", "outcome", "trial", "disc", "pain", "surgery", "bone"];
  const N = 300;
  const mk = (i: number) => ({
    id: `c${i}`, citekey: `k${Math.floor(i / 3)}`, title: `T${i}`, section: "s", year: 2015 + (i % 10),
    tags: i % 4 === 0 ? ["alpha", "beta"] : i % 4 === 1 ? ["alpha"] : ["gamma"],
    authors: [i % 2 ? "kim" : "lee"],
    text: Array.from({ length: 6 }, () => words[Math.floor(rnd() * words.length)]).join(" "),
    embedText: "",
  });
  const chunks = Array.from({ length: N }, (_, i) => mk(i));
  // Float32-rounded so the reference (doubles) and the bank (float32) see the same numbers.
  const vecs = chunks.map(() => Array.from(new Float32Array(Array.from({ length: DIM }, () => rnd() - 0.5))));
  const store = new VectorStore();
  store.init(DIM, "m");
  await store.addChunks(chunks, vecs);

  // Reference: the pre-bank implementation — the same chunks in an Orama DB that owns the vectors.
  const ref = create({
    schema: { id: "string", citekey: "string", title: "string", section: "string", year: "number",
      tags: "enum[]", tagText: "string", author: "enum[]", text: "string", embedding: `vector[${DIM}]` },
  });
  await insertMultiple(ref, chunks.map((c, i) => ({
    id: c.id, citekey: c.citekey, title: c.title, section: c.section, year: c.year, tags: c.tags,
    tagText: c.tags.join(" "), author: c.authors, text: c.text, embedding: vecs[i],
  })));
  const refTop = async (q: number[], term: string, k: number, where?: Record<string, unknown>) => {
    const r = await search(ref, {
      term: term || " ", mode: MODE_HYBRID_SEARCH, vector: { value: q, property: "embedding" },
      similarity: 0, includeVectors: true, limit: k, boost: { tagText: 1.5 }, ...(where ? { where } : {}),
    } as SearchParams<AnyOrama>);
    return (r.hits as unknown as { document: { id: string } }[]).map((h) => h.document.id);
  };
  const queries = [0, 1, 2, 3].map(() => Array.from({ length: DIM }, () => rnd() - 0.5));
  const terms = ["spine fusion", "lumbar", "", "zzzunknown"];
  const cases: Array<[Record<string, unknown> | undefined, import("../src/index/store").SearchFilters]> = [
    [undefined, {}],
    [{ tags: { containsAll: ["alpha"] } }, { tags: ["alpha"] }],
    [{ year: { between: [2018, 2022] }, author: { containsAll: ["kim"] } }, { yearFrom: 2018, yearTo: 2022, author: "Kim" }],
  ];
  for (const [where, filters] of cases) {
    for (let qi = 0; qi < queries.length; qi++) {
      const got = (await store.search(queries[qi], terms[qi], 10, filters)).map((h) => h.id);
      const want = await refTop(queries[qi], terms[qi], 10, where);
      assert.equal(got.length, 10);
      assert.deepEqual(got, want, `parity q${qi} ${JSON.stringify(filters)}`);
      passed++;
    }
  }
  const h0 = (await store.search(queries[0], "lumbar", 3))[0];
  assert.ok(h0.vector && h0.vector.length === DIM, "hit carries a bank view");
  assert.ok(Math.abs(Math.hypot(...Array.from(h0.vector)) - 1) < 1e-5, "bank rows are unit length");
  passed += 2;

  // gated fusion: a text hit outside the vector arm's top slice keeps only its text share (≤ 0.5);
  // Orama's formula (gatedFusion=false) lifts some of them above 0.5 with a vector score.
  store.vectorArm = 20;
  const near = new Set((await store.search(queries[0], "", 20)).map((h) => h.id));
  const gated = (await store.search(queries[0], "spine fusion lumbar", 200)).filter((h) => !near.has(h.id));
  assert.ok(gated.length > 0 && gated.every((h) => h.score <= 0.5 + 1e-9), "gated: far text hits get no vector share");
  store.gatedFusion = false;
  const full = (await store.search(queries[0], "spine fusion lumbar", 200)).filter((h) => !near.has(h.id));
  assert.ok(full.some((h) => h.score > 0.5), "orama formula: far text hits do get a vector share");
  store.gatedFusion = true;
  store.vectorArm = 500;
  passed += 2;

  // (b) serialize -> load round-trip
  const ser = await store.serialize();
  assert.equal(ser.vectors.byteLength, N * DIM * 4);
  const store2 = new VectorStore();
  await store2.load(ser.docs, ser.vectors, ser.meta);
  for (let qi = 0; qi < queries.length; qi++) {
    const a = await store.search(queries[qi], terms[qi], 10);
    const b = await store2.search(queries[qi], terms[qi], 10);
    assert.deepEqual(b.map((h) => h.id), a.map((h) => h.id), `round-trip q${qi}`);
    passed++;
  }

  const sliced = await store.serializeStream();
  const slices = [...sliced.vectorSlices(DIM * 4 * 7)]; // 7 rows per slice
  assert.ok(slices.length === Math.ceil(N / 7) && slices.every((b) => b.byteLength <= DIM * 4 * 7), "vector slices respect the byte cap");
  assert.deepEqual(
    Buffer.concat(slices.map((b) => Buffer.from(b))),
    Buffer.from(ser.vectors),
    "concatenated vector slices are byte-identical to the one-buffer serialize()"
  );
  passed += 2;

  const streamed = await store.serializeStream();
  assert.equal([...streamed.parts].join(""), ser.docs, "streamed docs.json is byte-identical to serialize()");
  store.flush();
  assert.equal((await store.serialize()).docs, ser.docs, "flush changes nothing observable");
  passed += 2;

  const scaled = new Float32Array(ser.vectors).map((x, i) => x * (1 + (Math.floor(i / DIM) % 5))); // an old index holds raw, un-normalized vectors
  const store3 = new VectorStore();
  await store3.load(ser.docs, scaled.buffer, ser.meta);
  assert.deepEqual((await store3.search(queries[0], terms[0], 10)).map((h) => h.id), (await store.search(queries[0], terms[0], 10)).map((h) => h.id));
  passed++;

  // (c) remove + re-add: removed ids never come back; freed rows are reused only after a text-index compaction
  const gone = new Set((await store.search(queries[0], "", 5)).map((h) => h.citekey));
  for (const ck of gone) await store.removeCitekey(ck);
  const after = await store.search(queries[0], "", 50);
  assert.ok(after.every((h) => !gone.has(h.citekey)), "removed citekeys never return");
  assert.equal(store["idAt"].filter((x: string | null) => x !== null).length, store.count, "freed rows are cleared");
  const rowsBefore = store["idAt"].length;
  const nv = Array.from({ length: DIM }, () => rnd() - 0.5);
  await store.addChunks([mk(1000)], [nv]);
  assert.equal(store["idAt"].length, rowsBefore + 1, "stale rows are not reused before a compaction");
  assert.equal((await store.search(nv, "", 1))[0].id, "c1000");
  store["ti"]?.compact();
  await store.addChunks([mk(1001)], [vecs[1]]);
  assert.equal(store["idAt"].length, rowsBefore + 1, "after a compaction a freed row is reused");
  const nv2 = Array.from({ length: DIM }, () => rnd() - 0.5);
  await store.addChunks([mk(1001)], [nv2]); // same id again replaces it
  assert.equal(store["rowOf"].size, store.count, "one live row per tracked chunk");
  assert.equal(store["ti"]?.size, store.count, "text index agrees");
  assert.equal((await store.search(nv2, "", 1))[0].id, "c1001");
  passed += 7;

  // (d) dimension mismatch throws
  await assert.rejects(store.search([1, 2, 3], "x", 3), /dim/);
  await assert.rejects(store.addChunks([mk(2000)], [[1, 2, 3]]), /dim/);
  passed += 2;
}

// ---------- index/textIndex.ts ----------
{
  // tokenizer: Orama's default English one
  assert.deepEqual(tokenize("Spinal-Fusion, L4/5 don't"), ["spinal-fusion", "l4", "5", "don't"]);
  assert.deepEqual(tokenize("Café ÀÈÌÒÙ"), ["cafe", "aeiou"]);
  assert.deepEqual(tokenize("감압술 ODI 개선 odi"), ["odi"], "non-Latin script splits; tokens are unique");
  assert.deepEqual(tokenize("  "), []);
  passed += 5;

  // text-only parity against a real Orama DB (same random corpus), incl. removal + compaction
  let seed = 777;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const vocab = Array.from({ length: 120 }, (_, i) => (i % 7 === 0 ? `Term${i}-x` : `word${i}`)).concat(["spine", "fusion", "Spinal", "lumbar", "disc", "café", "한국어"]);
  const docs = Array.from({ length: 400 }, (_, i) => ({
    id: `k${Math.floor(i / 4)}#${i % 4}`, citekey: `k${Math.floor(i / 4)}`, title: `Title ${vocab[Math.floor(rnd() * vocab.length)]} ${i % 9}`,
    section: i % 3 ? "Methods" : "Abstract", year: 2000 + (i % 25),
    tags: i % 5 === 0 ? ["Spinal Fusion", "Pain"] : i % 5 === 1 ? ["Pain"] : [],
    author: [i % 2 ? "kim" : "lee", ...(i % 6 === 0 ? ["park"] : [])],
    text: Array.from({ length: 5 + Math.floor(rnd() * 40) }, () => vocab[Math.floor(rnd() * vocab.length)]).join(" "),
  }));
  const ti = new TextIndex();
  docs.forEach((d, r) => ti.add(r, d));
  const ref = create({
    schema: { id: "string", citekey: "string", title: "string", section: "string", year: "number", tags: "enum[]", tagText: "string", author: "enum[]", text: "string" },
  });
  await insertMultiple(ref, docs.map((d) => ({ ...d, tagText: d.tags.join(" ") })));
  const oramaIds = async (term: string, where?: Record<string, unknown>) => {
    const r = await search(ref, { term, limit: 2000, boost: { tagText: 1.5 }, ...(where ? { where } : {}) } as SearchParams<AnyOrama>);
    return (r.hits as unknown as { document: { id: string }; score: number }[]).map((h) => ({ id: h.document.id, score: h.score }));
  };
  const checkParity = async (label: string, term: string, f: Parameters<TextIndex["allowedRows"]>[0], where?: Record<string, unknown>, live?: Set<string>) => {
    const want = (await oramaIds(term, where)).filter((h) => !live || live.has(h.id));
    const got = ti.search(term, ti.allowedRows(f), 2000).map((h) => ({ id: ti.doc(h.row)?.id ?? "", score: h.score }));
    assert.equal(got.length, want.length, `${label}: same match count`);
    for (let i = 0; i < Math.min(10, want.length); i++) assert.ok(Math.abs(got[i].score - want[i].score) < 1e-6 * Math.max(1, want[i].score) || got[i].id === want[i].id, `${label}: rank ${i}`);
    const topScore = new Map(want.map((h) => [h.id, h.score]));
    for (const h of got) assert.ok(Math.abs(h.score - (topScore.get(h.id) ?? NaN)) < 1e-6 * Math.max(1, h.score), `${label}: score of ${h.id}`);
    passed += 3;
  };
  const queries = ["spine fusion", "spin", "Term7-x lumbar", "word3 word10 disc", "title 4", "café", "k12", "nothingmatches", "pain", "spinal fusion pain"];
  for (const q of queries) await checkParity(`q=${q}`, q, {});
  await checkParity("filters", "spine disc", { yearFrom: 2005, yearTo: 2015, tags: ["Pain"], author: "Kim" }, { year: { between: [2005, 2015] }, tags: { containsAll: ["Pain"] }, author: { containsAll: ["kim"] } });
  await checkParity("year gte", "lumbar", { yearFrom: 2010 }, { year: { gte: 2010 } });
  await checkParity("year lte", "lumbar", { yearTo: 2010 }, { year: { lte: 2010 } });
  assert.deepEqual(ti.search("", null, 10), []);
  assert.equal(ti.allowedRows({ tags: ["no such tag"] })?.some((x) => x === 1), false);
  passed += 2;

  // remove (lazy) then compaction: results track a fresh index of the survivors, and Orama minus the removed
  const dead = new Set<number>();
  for (let r = 0; r < docs.length; r += 3) { ti.remove(r); dead.add(r); }
  const fresh = new TextIndex();
  const live = new Set<string>();
  docs.forEach((d, r) => { if (!dead.has(r)) { fresh.add(r, d); live.add(d.id); } });
  const same = (a: TextIndex, b: TextIndex, q: string) => {
    const x = a.search(q, null, 50), y = b.search(q, null, 50);
    assert.deepEqual(x.map((h) => h.row), y.map((h) => h.row), `rank ${q}`);
    x.forEach((h, i) => assert.ok(Math.abs(h.score - y[i].score) < 1e-9, `score ${q}`));
  };
  for (const q of ["spine fusion", "lumbar", "word3 disc", "pain"]) same(ti, fresh, q);
  assert.equal(ti.size, fresh.size);
  const epoch = ti.epoch;
  ti.compact();
  assert.equal(ti.epoch, epoch + 1);
  for (const q of ["spine fusion", "lumbar", "word3 disc", "pain"]) same(ti, fresh, q);
  assert.ok(ti.search("spine", null, 2000).every((h) => !dead.has(h.row)), "removed rows never return");
  assert.equal(ti.doc(0), undefined);
  // re-adding into a freed row after compaction works, and a stale re-add compacts first
  ti.add(0, docs[1]);
  assert.equal(ti.doc(0)?.id, docs[1].id);
  ti.remove(3);
  ti.add(3, docs[7]);
  assert.equal(ti.doc(3)?.id, docs[7].id);
  passed += 18;

  // UTF-8 fidelity of stored strings / tags / authors
  const u = new TextIndex();
  const odd = { id: "u#0", citekey: "kim2024", title: "척추 유합술 — café naïve 🙂", section: "초록", year: 2024, tags: ["척추", "Spinal Fusion"], author: ["김", "o'brien"], text: "요추 감압술 ODI 🙂 résumé 日本語" };
  u.add(0, odd);
  assert.deepEqual(u.doc(0), odd);
  assert.equal(u.search("odi", null, 5)[0].row, 0);
  assert.equal(u.allowedRows({ tags: ["척추"], author: "김" })?.[0], 1);
  passed += 3;
}

// ---------- data/findings.ts: fenced format ----------
{
  const md = "# T\n\n## Evidence (extracted)\n\n> [!quote]- 1 findings · x\n> ```text\n> [kind:: comparative] [outcome:: ODI] [p:: 0.02]\n>   \"ODI improved (p = 0.02).\"\n> ```\n\n## Notes\n";
  const fs = parseFindings(md);
  check(fs.length === 1 && fs[0].outcome === "ODI" && fs[0].p === "0.02" && fs[0].quote === "ODI improved (p = 0.02).", "parseFindings: fenced (non-list) format");
}

// ---------- data/findings.ts: isRestated + rerankHttpReason ----------
{
  check(isRestated("Ghogawala et al. demonstrated that ODI improved (p = 0.02)."), "isRestated: et al.");
  check(isRestated("Fusion rates were 90% in earlier series [7, 9]."), "isRestated: numeric citation");
  check(isRestated("Previous studies reported a reoperation rate of 10%."), "isRestated: previous studies");
  check(isRestated("This matches the rate reported earlier (Smith, 2019)."), "isRestated: (Author, year)");
  check(!isRestated("ODI improved from 41.5 to 14.0 in the fusion group (p = 0.02)."), "isRestated: own result");
  check(!isRestated("At 2 years (95% CI 1.2-3.6), n = 61 patients."), "isRestated: CI is not a citation");
  check(/free-model limit/.test(rerankHttpReason(429, '{"error":{"message":"Rate limit exceeded: free-models-per-day"}}')), "rerankHttpReason: free daily cap");
  check(/key was rejected/.test(rerankHttpReason(401, "")), "rerankHttpReason: bad key");
}

// ---------- index/expand.ts: source priority + duplicate headings ----------
{
  const dup = buildExpander(null, { "Low Back Pain": ["Lumbago"], "low back pain": ["Lumbago"] }).expand("lumbago treatment");
  check(dup.terms.some((t) => /low back pain/i.test(t)), "expand: the same heading cached twice (case) still expands");
  const both = buildExpander(
    parseVocabulary({ version: 1, concepts: [{ name: "Spinal Fusion", aliases: ["arthrodesis"], narrower: ["PLIF"] }] }),
    { "Spinal Fusion": ["Fusion, Spinal"] }
  ).expand("spinal fusion outcomes");
  check(both.terms.includes("arthrodesis"), "expand: a vocabulary concept survives a MeSH heading with the same name");
}

// ---------- index/expand.ts: isForeignQuery ----------
{
  check(isForeignQuery("감압술에 유합술을 추가하면 ODI가 개선되는가?"), "isForeignQuery: Korean with an English acronym");
  check(!isForeignQuery("Does adding fusion to decompression improve ODI?"), "isForeignQuery: English");
  check(!isForeignQuery("TLIF 대 PLIF blood loss in lumbar fusion"), "isForeignQuery: mostly Latin letters stays English");
  check(isForeignQuery("腰椎すべり症の手術"), "isForeignQuery: Japanese");
  check(!isForeignQuery("12345 ?!"), "isForeignQuery: no letters");
}

// ---------- index/expand.ts ----------
{
  const vocab = parseVocabulary({
    version: 1,
    concepts: [
      { name: "Lumbar Spinal Stenosis", aliases: ["요추관 협착증", "LSS", "x", "x", "lumbar canal narrowing"], narrower: ["Lateral recess stenosis"] },
      { name: "Decompression", aliases: ["감압술", "laminectomy"], broader: ["Spine surgery"] },
      { name: "Oswestry Disability Index", aliases: ["ODI"] },
      { name: "", aliases: ["junk"] },
    ],
  });
  assert.equal(vocab.concepts.length, 3);
  assert.deepEqual(vocab.concepts[0].aliases, ["요추관 협착증", "LSS", "lumbar canal narrowing"]);
  const mesh = { "Intervertebral Disc Displacement": ["Herniated Disc", "Slipped Disc", "Disk Herniation"] };
  const ex = buildExpander(vocab, mesh);
  const e1 = ex.expand("herniated disc outcomes");
  assert.deepEqual(e1.matched, ["Intervertebral Disc Displacement"]);
  assert.ok(e1.terms.includes("Intervertebral Disc Displacement") && e1.terms.includes("Slipped Disc"));
  assert.ok(!e1.terms.includes("Herniated Disc"), "already in the query");
  assert.equal(expandedTerm("herniated disc outcomes", e1).startsWith("herniated disc outcomes Intervertebral"), true);
  // Korean with attached particle and different spacing reaches the English names.
  const e2 = ex.expand("요추관협착증에서 감압술");
  assert.deepEqual(e2.matched, ["Lumbar Spinal Stenosis", "Decompression"]);
  assert.ok(e2.terms.includes("Lumbar Spinal Stenosis") && e2.terms.includes("laminectomy") && e2.terms.includes("Lateral recess stenosis"));
  assert.ok(!e2.terms.some((t) => /[가-힣]/.test(t)), "Latin aliases preferred, Korean ones not added while Latin exist");
  // Short acronym: whole token only.
  assert.deepEqual(ex.expand("ODI change").matched, ["Oswestry Disability Index"]);
  assert.deepEqual(ex.expand("periodic follow-up").matched, []);
  assert.deepEqual(ex.expand("odi점수").matched, ["Oswestry Disability Index"]);
  // Cap of 12, round-robin across concepts, no duplicates.
  const many = parseVocabulary({
    concepts: ["alpha", "beta", "gamma"].map((n) => ({
      name: n + " thing",
      aliases: [1, 2, 3, 4, 5].map((i) => `${n} alias ${i}`),
      narrower: [1, 2, 3, 4, 5].map((i) => `${n} child ${i}`),
    })),
  });
  const e3 = buildExpander(many, null).expand("alpha thing beta thing gamma thing");
  assert.equal(e3.terms.length, 12);
  assert.equal(new Set(e3.terms.map((t) => t.toLowerCase())).size, 12);
  assert.ok(e3.terms.some((t) => t.startsWith("gamma")), "later concept is not crowded out");
  assert.ok(!e3.terms.includes("alpha thing"), "name already in query");
  // Empty vocabulary: nothing added, query unchanged.
  const none = buildExpander(null, null).expand("herniated disc");
  assert.deepEqual(none, { terms: [], matched: [] });
  assert.equal(expandedTerm("q", none), "q");
  // A surface claimed by two concepts is ambiguous and ignored.
  const amb = buildExpander(parseVocabulary({ concepts: [{ name: "Aa one", aliases: ["shared term"] }, { name: "Bb two", aliases: ["shared term"] }] }), null);
  assert.deepEqual(amb.expand("shared term").matched, []);
  passed += 20;
}

// ---------- cite/itemMemo.ts: per-citekey lookup replaces the whole-library scan ----------
{
  const lib = [
    { citekey: "a2020", item: { type: "article-journal", title: "A", author: [{ family: "Alpha" }], issued: { "date-parts": [[2020]] } } },
    { citekey: "b2021", item: { type: "article-journal", title: "B", author: [{ family: "Beta" }], issued: { "date-parts": [[2021]] } } },
    ...Array.from({ length: 2000 }, (_, i) => ({ citekey: `x${i}`, item: { type: "article-journal", title: `X${i}` } })),
  ];
  let entriesCalls = 0;
  let getCalls = 0;
  const byKey = new Map(lib.map((e) => [e.citekey, e.item]));
  const stub = {
    entries: () => (entriesCalls++, lib),
    getItem: (k: string) => (getCalls++, byKey.get(k) ?? null),
  };
  const cited = ["a2020", "b2021", "a2020", "nope", "b2021", "nope"]; // repeats + an unknown key
  const old = new Map(stub.entries().map((e) => [e.citekey, e.item])); // the pre-0.8.10 render path
  entriesCalls = 0;
  const memo = itemMemo((k) => stub.getItem(k) as never);
  const labelOf = (it: unknown) => (it ? inTextLabel(it as never) : null);
  for (const k of cited) {
    check(labelOf(memo.get(k)) === labelOf(old.get(k) ?? null), `itemMemo: label for ${k} matches the full-scan map`);
  }
  check(entriesCalls === 0, "itemMemo: no library scan");
  check(getCalls === 3, `itemMemo: one getItem per distinct cited key, misses memoized (got ${getCalls})`);
  memo.clear();
  memo.get("a2020");
  check(getCalls === 4, "itemMemo: clear() drops the memo");
}

// ---------- graph/citations.ts: prune is debounced (a bulk delete = one library scan) ----------
{
  const data = {
    byCitekey: { k1: { openalexId: "W1", refs: [] }, k2: { openalexId: "W2", refs: ["W1"] }, k3: { openalexId: "W3", refs: [] } },
    idToCitekey: { W1: "k1", W2: "k2", W3: "k3" },
  };
  let scans = 0;
  let live = ["k1", "k2", "k3"];
  const app = {
    vault: { adapter: { exists: async () => true, read: async () => JSON.stringify(data), write: async () => {}, mkdir: async () => {} } },
  };
  const lib = {
    entries: () => (scans++, live.map((citekey) => ({ citekey, item: {}, file: {} }))),
    folder: () => "References",
  };
  const g = new CitationGraph(app as never, lib as never, {} as never, "_x");
  await g.restore();
  g.pruneDelayMs = 30;
  let notified = 0;
  g.onChange(() => notified++);
  live = ["k1", "k2"]; // k3's note was deleted along with 499 others
  const calls = Array.from({ length: 500 }, () => g.prune());
  check(scans === 0, "prune: nothing scans while the burst is still arriving");
  await Promise.all(calls);
  await new Promise((r) => setTimeout(r, 100)); // stray timers from an un-debounced version would fire by now
  check(scans === 1, `prune: 500 calls, one library scan (got ${scans})`);
  check(g.size === 2 && !g.has("k3"), "prune: the missing note's node is dropped");
  check(notified === 1, `prune: listeners fire once (got ${notified})`);
  await g.prune();
  check(scans === 2 && notified === 1, "prune: a later burst scans again; nothing changed, so no second notify");
}

// ---------- graph/citations.ts: prune keeps the id of a live node; dispose stops timers ----------
{
  // `old` and `new` are the same work (W1) after a citekey change; `new` owns the id mapping.
  const data = {
    byCitekey: {
      old: { openalexId: "W1", refs: [] },
      new: { openalexId: "W1", refs: [] },
      citer: { openalexId: "W2", refs: ["W1"] },
      gone: { openalexId: "W3", refs: [] },
    },
    idToCitekey: { W1: "new", W2: "citer", W3: "gone" },
  };
  let live = ["new", "citer"];
  let scans = 0;
  const app = {
    vault: { adapter: { exists: async () => true, read: async () => JSON.stringify(data), write: async () => {}, mkdir: async () => {} } },
  };
  const lib = { entries: () => (scans++, live.map((citekey) => ({ citekey, item: {}, file: {} }))), folder: () => "References" };
  const g = new CitationGraph(app as never, lib as never, {} as never, "_x");
  await g.restore();
  g.pruneDelayMs = 10;
  await g.prune();
  check(!g.has("old") && !g.has("gone") && g.has("new"), "prune: dead nodes dropped, live node kept");
  check(g.referencesInLibrary("citer").join() === "new", `prune: a dead node of the same work must not unmap the live one (got ${g.referencesInLibrary("citer")})`);

  const before = scans;
  let cancelled = 0;
  (g as unknown as { flush: { cancel: () => void } }).flush = { cancel: () => void cancelled++ };
  live = ["citer"];
  const pending = g.prune();
  g.dispose();
  await pending; // resolves, never hangs
  await new Promise((r) => setTimeout(r, 50));
  check(scans === before, "dispose: a pending prune never scans after unload");
  check(cancelled === 1, "dispose: the add-flush debouncer is cancelled");
}
  // ---------- ingest/pdf.ts: titleInHead ----------
  {
    const own = "Outcomes of Biportal Endoscopic Decompression for Lumbar Stenosis";
    const page =
      "Spine J. 2024\nOutcomes of Biportal Endoscopic Decompression for Lumbar Stenosis\nPark S, Kim H\n" +
      "Abstract. Background: as in 10.1016/j.other.2020.01.001 (Smith) ...\n" +
      "x".repeat(5000) + "\nReferences\n1. Smith J. A Completely Different Paper About Knees. Lancet 2020.";
    check(titleInHead(own, page), "titleInHead: the PDF's own title is accepted");
    check(!titleInHead("A Completely Different Paper About Knees", page), "titleInHead: a title found only in the references is rejected");
    check(!titleInHead("", page) && !titleInHead(undefined, page), "titleInHead: empty title is rejected");
    const wrapped = "Outcomes of Biportal Endo-\nscopic Decompression for Lum-\nbar Stenosis\nPark S";
    check(titleInHead(own, wrapped), "titleInHead: a wrapped / hyphenated title is accepted");
    check(
      titleInHead(
        "Comparison of unilateral biportal endoscopic and microscopic decompression for lumbar spinal stenosis",
        "Comparison of unilateral biportal endoscopic and microscopic decompression for lumbar disc herniation"
      ),
      "titleInHead: only the first 60 normalized characters must match"
    );
  }

  // ---------- llm/cli.ts: binary allowlist + minimal environment ----------
  {
    check(cliBinaryAllowed("codex", "/opt/homebrew/bin/codex"), "cliBinaryAllowed: codex");
    check(cliBinaryAllowed("opencode", "C:\\Users\\x\\AppData\\Roaming\\npm\\OpenCode.CMD"), "cliBinaryAllowed: Windows .cmd, any case");
    check(cliBinaryAllowed("codex", "C:\\x\\codex.exe"), "cliBinaryAllowed: .exe stripped");
    check(!cliBinaryAllowed("codex", "/usr/bin/opencode"), "cliBinaryAllowed: the other provider's CLI is refused");
    check(!cliBinaryAllowed("codex", "/bin/sh") && !cliBinaryAllowed("codex", "/tmp/codex-evil") && !cliBinaryAllowed("codex", "/tmp/codex.sh"), "cliBinaryAllowed: arbitrary programs are refused");
    const env = buildCliEnv(
      {
        PATH: "/x", HOME: "/home/u", LANG: "en_US.UTF-8", LC_ALL: "C", XDG_DATA_HOME: "/d", CODEX_HOME: "/c", OPENCODE_CONFIG: "/o",
        OPENAI_API_KEY: "sk-secret", AWS_SECRET_ACCESS_KEY: "aws", ANTHROPIC_API_KEY: "a", GITHUB_TOKEN: "g",
        Path: "C:\\win", SystemRoot: "C:\\Windows",
      },
      "/final"
    );
    check(env.OPENAI_API_KEY === undefined && env.AWS_SECRET_ACCESS_KEY === undefined && env.ANTHROPIC_API_KEY === undefined && env.GITHUB_TOKEN === undefined, "buildCliEnv: drops API keys and cloud secrets");
    check(env.HOME === "/home/u" && env.LANG === "en_US.UTF-8" && env.LC_ALL === "C" && env.XDG_DATA_HOME === "/d" && env.CODEX_HOME === "/c" && env.OPENCODE_CONFIG === "/o" && env.SystemRoot === "C:\\Windows", "buildCliEnv: keeps HOME, locale, XDG_*, CODEX_*, OPENCODE_*, SystemRoot");
    check(env.PATH === "/final" && env.Path === undefined, "buildCliEnv: PATH is replaced, not duplicated");
  }

  // ---------- commands/merge.ts: concurrent edits ----------
  {
    const KEEP = "---\ncitekey: keep2020\n---\n\n## Notes\n\nkeeper text\n";
    const LOSE = "---\ncitekey: lose2020\n---\n\n## Notes\n\nloser text\n";
    const setup = (_hooks: object) => {
      const files = new Map<string, { f: TFile; text: string }>();
      const add = (path: string, text: string) => {
        const f = Object.assign(new TFile(path), { stat: { mtime: 1 } });
        files.set(path, { f, text });
        return f;
      };
      const keeper = add("References/keep2020.md", KEEP);
      const loser = add("References/lose2020.md", LOSE);
      const trashed: string[] = [];
      const fmOf = (f: TFile) => ({ frontmatter: { citekey: f.basename.replace(/^(\D+)(\d+)$/, "$1$2") } });
      const plugin = {
        app: {
          vault: {
            getAbstractFileByPath: (p: string) => files.get(p)?.f ?? null,
            read: async (f: TFile) => {
              const text = files.get(f.path)!.text;
              return text;
            },
            cachedRead: async (f: TFile) => files.get(f.path)!.text,
            process: async (f: TFile, fn: (c: string) => string) => {
              const e = files.get(f.path)!;
              e.text = fn(e.text);
              return e.text;
            },
            getMarkdownFiles: () => [...files.values()].map((e) => e.f),
          },
          metadataCache: { getFileCache: (f: TFile) => fmOf(f), resolvedLinks: {} },
          fileManager: {
            processFrontMatter: async () => undefined,
            trashFile: async (f: TFile) => {
              trashed.push(f.path);
              files.delete(f.path);
            },
          },
        },
      };
      const plan = { keeperFile: keeper, loserFiles: [loser], expectedMtimes: new Map([[keeper.path, 1], [loser.path, 1]]) };
      return { plugin, plan, files, trashed, keeper, loser };
    };

    const ok = setup({});
    const r0 = await mergeDuplicateGroups(ok.plugin as never, [ok.plan]);
    check(r0.groupsMerged === 1 && r0.notesTrashed === 1 && r0.losersKept === 0 && r0.skippedChanged === 0, "mergeDuplicateGroups: untouched group merges and trashes the loser");
    check(ok.files.get("References/keep2020.md")!.text.includes("loser text"), "mergeDuplicateGroups: loser notes land in the keeper");

    const EDITED = KEEP + "\nwritten while merging\n";
    const h1 = setup({});
    h1.plugin.app.vault.read = (async (f: TFile) => {
      const e = h1.files.get(f.path)!;
      const text = e.text;
      if (f === h1.keeper) e.text = EDITED; // the keeper changes right after the merge read it
      return text;
    }) as never;
    const r1 = await mergeDuplicateGroups(h1.plugin as never, [h1.plan]);
    check(h1.files.get(h1.keeper.path)!.text === EDITED, "mergeDuplicateGroups: a keeper edited between read and write keeps the edit");
    check(r1.groupsMerged === 0 && r1.skippedChanged === 1 && r1.notesTrashed === 0 && h1.trashed.length === 0, "mergeDuplicateGroups: that group is reported skipped and nothing is trashed");

    const h2 = setup({});
    h2.plugin.app.vault.getMarkdownFiles = (() => {
      h2.files.get(h2.loser.path)!.text = LOSE + "\nlate edit\n"; // after merge, before trashing
      return [...h2.files.values()].map((e) => e.f);
    }) as never;
    const r2 = await mergeDuplicateGroups(h2.plugin as never, [h2.plan]);
    check(r2.groupsMerged === 1 && r2.notesTrashed === 0 && r2.losersKept === 1, "mergeDuplicateGroups: a loser edited before trashing is kept and reported");
    check(h2.files.has(h2.loser.path) && h2.trashed.length === 0, "mergeDuplicateGroups: the edited loser is still in the vault");

    const h3 = setup({});
    const origRead = h3.plugin.app.vault.read;
    let loserReads = 0;
    h3.plugin.app.vault.read = (async (f: TFile) => {
      const text = await origRead(f);
      if (f === h3.loser && ++loserReads === 1) h3.files.get(f.path)!.text = LOSE + "\nedited after copy\n";
      return text;
    }) as never;
    const r3 = await mergeDuplicateGroups(h3.plugin as never, [h3.plan]);
    check(r3.skippedChanged === 1 && !h3.files.get(h3.keeper.path)!.text.includes("loser text") && h3.trashed.length === 0, "mergeDuplicateGroups: a loser edited after its text was copied abandons the group");
  }

  // ---------- commands/merge.ts: one guarded write, evidence carried over ----------
  {
    const mk = (path: string, text: string) => Object.assign(new TFile(path), { stat: { mtime: 1 } });
    const build = (keepText: string, loseText: string) => {
      const files = new Map<string, { f: TFile; text: string }>();
      const keeper = mk("References/keep2020.md", "");
      const loser = mk("References/lose2020.md", "");
      files.set(keeper.path, { f: keeper, text: keepText });
      files.set(loser.path, { f: loser, text: loseText });
      let fmCalls = 0;
      const plugin = {
        app: {
          vault: {
            getAbstractFileByPath: (p: string) => files.get(p)?.f ?? null,
            read: async (f: TFile) => files.get(f.path)!.text,
            cachedRead: async (f: TFile) => files.get(f.path)!.text,
            process: async (f: TFile, fn: (c: string) => string) => {
              const e = files.get(f.path)!;
              e.text = fn(e.text);
              return e.text;
            },
            getMarkdownFiles: () => [...files.values()].map((e) => e.f),
          },
          metadataCache: { getFileCache: () => ({ frontmatter: { citekey: "stale-cache" } }), resolvedLinks: {} },
          fileManager: {
            processFrontMatter: async () => { fmCalls++; },
            trashFile: async (f: TFile) => { files.delete(f.path); },
          },
        },
      };
      const plan = { keeperFile: keeper, loserFiles: [loser], expectedMtimes: new Map([[keeper.path, 1], [loser.path, 1]]) };
      return { plugin, plan, files, keeper, loser, fmCalls: () => fmCalls };
    };
    const KEEP = "---\ncitekey: keep2020\ntitle: Old title\n---\n\n## Notes\n\nk\n";
    const LOSE = "---\ncitekey: lose2020\nDOI: 10.1/x\n---\n\n## Notes\n\nl\n";

    // (a) a title corrected after the snapshot is never reverted: the group is skipped
    const a = build(KEEP, LOSE);
    const origRead = a.plugin.app.vault.read;
    a.plugin.app.vault.read = (async (f: TFile) => {
      const t = await origRead(f);
      if (f === a.keeper) a.files.get(f.path)!.text = t.replace("Old title", "New title");
      return t;
    }) as never;
    const ra = await mergeDuplicateGroups(a.plugin as never, [a.plan]);
    check(a.files.get(a.keeper.path)!.text.includes("title: New title") && ra.skippedChanged === 1 && ra.groupsMerged === 0 && a.files.has(a.loser.path), "mergeDuplicateGroups: a keeper title edited after the snapshot is kept and the group skipped");

    // one write carries frontmatter + body, nothing goes through processFrontMatter
    const b = build(KEEP, LOSE);
    const rb = await mergeDuplicateGroups(b.plugin as never, [b.plan]);
    const merged = b.files.get(b.keeper.path)!.text;
    check(rb.groupsMerged === 1 && b.fmCalls() === 0 && merged.startsWith("---\ncitekey: keep2020\ntitle: Old title\nDOI: 10.1/x\n---\n") && merged.includes("## Merged from lose2020"), "mergeDuplicateGroups: frontmatter and body land in one write, keeper citekey from the text not the cache");

    // (b) a loser-only finding survives; (c) an identical one is not doubled
    const row = (o: string, q: string) => `> - [kind:: comparative] [outcome:: ${o}]\n>   "${q}"`;
    const kEv = KEEP + `\n## Evidence (extracted)\n\n> [!quote]- 1 findings\n${row("fusion", "Fusion was 96%.")}\n`;
    const lEv = LOSE + `\n## Evidence (extracted)\n\n> [!quote]- 2 findings\n${row("Fusion", "fusion  was 96%.")}\n${row("pain", "Pain fell.")}\n`;
    const c = build(kEv, lEv);
    await mergeDuplicateGroups(c.plugin as never, [c.plan]);
    const fs = parseFindings(splitNote(c.files.get(c.keeper.path)!.text)!.body);
    check(fs.length === 2 && fs.some((f) => f.outcome === "pain" && f.quote === "Pain fell."), "mergeDuplicateGroups: a loser-only finding survives and parses back");
    check(fs.filter((f) => f.outcome.toLowerCase() === "fusion").length === 1, "mergeDuplicateGroups: an identical finding (case/whitespace) is not duplicated");
    check(c.files.get(c.keeper.path)!.text.includes("> [!quote]- 2 findings"), "mergeDuplicateGroups: the callout's finding count is updated");

    // keeper without a section gets one
    const d = build(KEEP, lEv);
    await mergeDuplicateGroups(d.plugin as never, [d.plan]);
    const df = parseFindings(d.files.get(d.keeper.path)!.text);
    check(df.length === 2 && df[0].outcome === "Fusion", "mergeDuplicateGroups: a keeper with no Evidence section gets one from the loser");
    check(mergeBodies("## Notes\n", [{ citekey: "l", body: "# T\n\n## Notes\n\n## Highlights\n" }]) === "## Notes\n", "mergeBodies: no loser evidence leaves the body untouched");
  }

  // ---------- commands/evidenceExport.ts: CSV + row collection ----------
  {
    const base = { citekey: "k1", author: "Kim", year: "2020", title: "T, with comma", doi: "10.1/x", pmid: "1", study_id: "S1", kq: "KQ1; KQ2", include: "include", design: "RCT", level: "1" };
    const fa: Finding = { kind: "comparative", outcome: "fusion rate", quote: 'He said "96%", then\nleft; 한글 근거 문장', effect: "96%" };
    const fb: Finding = { kind: "prognostic", outcome: "reop", quote: "Older had more.", predictor: "age > 65", p: "0.01" };
    const csv = evidenceCsv([{ ...base, finding: fa }, { ...base, citekey: "k2", title: "척추 유합", finding: fb }]);
    check(csv.charCodeAt(0) === 0xfeff, "evidenceCsv: starts with a UTF-8 BOM");
    const head = csv.slice(1).split("\r\n")[0];
    check(head === "citekey,first_author,year,title,doi,pmid,study_id,kq,include,design,level,kind,outcome,effect,predictor,p,quote", "evidenceCsv: reference columns, union of finding keys in first-seen order, quote last");
    check(csv.includes('"T, with comma"'), "evidenceCsv: a comma-bearing field is quoted");
    check(csv.includes('"He said ""96%"", then\nleft; 한글 근거 문장"'), "evidenceCsv: quote with quotes, comma, newline and Korean is copied verbatim, quotes doubled");
    check(csv.includes(",척추 유합,") && csv.includes(",96%,,,"), "evidenceCsv: Korean unquoted, absent keys left empty");
    check(csv.includes(",10.1/x,1,S1,KQ1; KQ2,include,"), "evidenceCsv: study_id column sits right after pmid");
    check(csv.endsWith("Older had more.\r\n") && csv.slice(1).split("\r\n").length === 4, "evidenceCsv: CRLF rows, one row per finding");
    const g = (effect: string) => evidenceCsv([{ ...base, finding: { ...fb, effect } }]).slice(1).split("\r\n")[1];
    check(g("-0.45").includes(",-0.45,") && !g("-0.45").includes("'-0.45"), "evidenceCsv: a plain negative number stays a number");
    check(g("-0.45 (-0.8 to -0.1)").includes(",'-0.45 (-0.8 to -0.1),"), "evidenceCsv: a cell starting with - that is not a number is guarded");
    check(g("=1+1").includes(",'=1+1,") && g("@x").includes(",'@x,") && g("+1 up").includes(",'+1 up,") && g("\tx").includes(",'\tx,"), "evidenceCsv: = + @ tab starts are guarded");
    check(g('=HYPERLINK("u", "a")').includes(`,"'=HYPERLINK(""u"", ""a"")",`), "evidenceCsv: a guarded cell that needs quoting is guarded, then quoted");
    check(g("a-b =c").includes(",a-b =c,"), "evidenceCsv: ordinary text is unchanged");

    const NOTE = (n: string) => `---\ncitekey: x\n---\n\n## Evidence (extracted)\n\n> - [kind:: comparative] [outcome:: o${n}]\n>   "q${n}"\n`;
    const mk = (path: string, item: Record<string, unknown>, body: string) => ({ citekey: String(item.citekey), file: Object.assign(new TFile(path), { stat: { mtime: 1 } }), item, body });
    const ents = [
      mk("References/A/a1.md", { citekey: "a1", author: [{ family: "Lee" }], issued: { "date-parts": [[2021]] }, title: "A1", DOI: "10.2/a", PMID: "22", kq: ["KQ1", "KQ3"], include: "include", tags: ["spine"] }, NOTE("1")),
      mk("References/B/b1.md", { citekey: "b1", title: "B1" }, "---\ncitekey: b1\n---\n\nno evidence"),
      mk("References/B/b2.md", { citekey: "b2", title: "B2", tags: ["spine"] }, NOTE("2")),
    ];
    const bodies = new Map(ents.map((e) => [e.file.path, e.body]));
    const plug = { library: { entries: () => ents }, app: { vault: { cachedRead: async (f: TFile) => bodies.get(f.path)! } } };
    const all = await collectEvidenceRows(plug as never, { kind: "all" });
    check(all.rows.length === 2 && all.papers === 2 && all.rows[0].author === "Lee" && all.rows[0].year === "2021" && all.rows[0].kq === "KQ1; KQ3" && all.rows[0].doi === "10.2/a" && all.rows[0].pmid === "22" && all.rows[1].year === "", "collectEvidenceRows: reference fields mapped, papers without findings skipped");
    const fold = await collectEvidenceRows(plug as never, { kind: "folder", folder: "References/B" });
    const tag = await collectEvidenceRows(plug as never, { kind: "tag", tag: "#Spine" });
    check(fold.rows.length === 1 && fold.rows[0].citekey === "b2" && tag.rows.length === 2, "collectEvidenceRows: folder and tag scope");
    const none = await collectEvidenceRows(plug as never, { kind: "folder", folder: "References/C" });
    check(none.rows.length === 0 && none.papers === 0, "collectEvidenceRows: empty scope -> no rows");
  }

  // ---------- data/snowball.ts: aggregation ----------
  {
    const recs: SnowballRecord[] = [
      { citekey: "a", selfId: "WA", referenced: ["W1", "W2", "WB", "W1"], citing: [{ id: "W3", title: "Three", year: 2020 }, { id: "W4", title: "Four", year: 2023 }] },
      { citekey: "b", selfId: "WB", referenced: ["W1", "W5", "WA"], citing: [{ id: "W3", title: "Three", year: 2020 }, { id: "W6", title: "Six", year: 2021, doi: "10.1/known" }] },
    ];
    const known = (w: SnowballWork): boolean => w.id === "W2" || w.doi === "10.1/known";
    const out = aggregateSnowball(recs, known);
    const ids = out.map((c) => c.id);
    check(!ids.includes("WA") && !ids.includes("WB"), "snowball: included records are never candidates");
    check(!ids.includes("W2") && !ids.includes("W6"), "snowball: works already in the library are dropped (by id and by DOI)");
    check(ids.join(",") === "W3,W1,W4,W5", `snowball: ranked by links then year desc (${ids.join(",")})`);
    const w1 = out.find((c) => c.id === "W1")!;
    check(w1.citedBy.join() === "a,b" && w1.cites.length === 0, "snowball: backward link counts each record once, duplicates collapse");
    const w3 = out.find((c) => c.id === "W3")!;
    check(w3.cites.join() === "a,b" && w3.title === "Three" && w3.year === 2020, "snowball: forward link carries both records and the metadata");
    const mix = aggregateSnowball([{ citekey: "a", selfId: "WA", referenced: ["W9"], citing: [{ id: "W9", title: "Nine", year: 2019 }] }], () => false)[0];
    check(mix.citedBy.length === 1 && mix.cites.length === 1 && mix.title === "Nine", "snowball: a work both cited and citing merges into one row");
    const md = snowballMarkdown({ scope: "all included records", processed: 2, failures: 1, date: "2026-11-03 14:30" }, out);
    check(md.includes("not for citing directly") && md.includes("newest 100") && md.includes("[W1](https://openalex.org/W1)") && md.includes("cited by: a, b"), "snowballMarkdown: provenance, caveat and rows");
    // refill: backward ids carry no title, so title-known library notes must not eat the quota
    const mk = (n: number, titled = false): SnowballWork[] => Array.from({ length: n }, (_, k) => ({ id: `K${k}`, ...(titled ? { title: `t${k}` } : {}) }));
    const cands = (ws: SnowballWork[]) => ws.map((w) => ({ ...w, citedBy: ["a"], cites: [] as string[] }));
    const inLib = (w: SnowballWork): boolean => !!w.title && w.title.startsWith("lib ");
    const titlesFor = async (ids: string[]) => new Map(ids.map((id) => [id, { title: id.startsWith("K") ? `lib ${id}` : `new ${id}` }]));
    const refill = await pickSnowballCandidates(cands([...mk(200), { id: "N1" }]), inLib, titlesFor);
    check(refill.rows.length === 1 && refill.rows[0].id === "N1" && refill.rows[0].title === "new N1" && !refill.limitHit, `snowball: 200 known untitled + 1 new -> 1 candidate (${refill.rows.length})`);
    const many = await pickSnowballCandidates(cands(Array.from({ length: 300 }, (_, k) => ({ id: `N${k}` }))), inLib, titlesFor);
    check(many.rows.length === 200 && many.rows[199].id === "N199", "snowball: cap of 200 respected");
    const odd = await pickSnowballCandidates(cands(Array.from({ length: 300 }, (_, k) => ({ id: `N${k}` }))), inLib, titlesFor, 120);
    check(odd.rows.length === 120, `snowball: cap mid-batch respected (${odd.rows.length})`);
    let looked = 0;
    const counting = async (ids: string[]) => ((looked += ids.length), titlesFor(ids));
    const capped = await pickSnowballCandidates(cands(mk(1200)), inLib, counting);
    check(capped.limitHit && capped.rows.length === 0 && looked === 1000, `snowball: lookups bounded at 1000 and flagged (${looked})`);
    const failing = await pickSnowballCandidates(cands([{ id: "N1" }]), inLib, async () => { throw new Error("429"); });
    check(failing.rows.length === 1 && failing.rows[0].title === undefined, "snowball: a failed title lookup keeps the candidate");
    check(snowballMarkdown({ scope: "s", processed: 1, failures: 0, date: "d", limitHit: true }, []).includes("title lookups were used"), "snowballMarkdown: states the lookup limit when hit");
  }


// ---------- index: chunker fixes, vector bank reuse, NodeFileIO reads, hosted-rerank gate ----------
{
  // splitText: a short paragraph then an oversized one must not emit the overlap tail as its own chunk
  const A = "A".repeat(300);
  const B = "B".repeat(1500);
  const cs = chunkReference({ citekey: "k", title: "T", year: 2020, tags: [], body: `${A}\n\n${B}` }, 1000);
  check(!cs.some((c) => c.text.trim() === "A".repeat(150)), "splitText: no chunk is only the 150-char overlap tail");
  check(cs.filter((c) => c.text.includes("A".repeat(150))).length === 1, "splitText: the A paragraph lands in exactly one chunk");

  check(yearFromIssued({ "date-parts": [[2020, 3]] }) === 2020, "yearFromIssued: numeric parts");
  check(yearFromIssued({ "date-parts": [["2020", 3]] }) === 2020, "yearFromIssued: string parts");
  check(yearFromIssued({ "date-parts": [[null]] }) === 0 && yearFromIssued({ "date-parts": [["n.d."]] }) === 0 && yearFromIssued(undefined) === 0, "yearFromIssued: junk is 0");

  // the bank: a restored one is exactly sized; re-embedding one note must not grow it
  const DIM = 4;
  const mkc = (ck: string, n: number) => Array.from({ length: n }, (_, i) => ({
    id: `${ck}#${i}`, citekey: ck, title: ck, section: "abstract", year: 2020, tags: [] as string[], authors: [] as string[], text: `word${i} ${ck}`, embedText: "",
  }));
  const vecs = (n: number) => Array.from({ length: n }, (_, i) => [1, i + 1, 2, 3]);
  const s1 = new VectorStore();
  s1.init(DIM, "m");
  for (const ck of ["a", "b", "c"]) await s1.addChunks(mkc(ck, 3), vecs(3));
  const ser = await s1.serialize();
  const s2 = new VectorStore();
  await s2.load(ser.docs, ser.vectors, ser.meta);
  const cap0 = s2.bankCapacity;
  check(cap0 === 9 * DIM, `store.load: bank sized exactly (${cap0})`);
  await s2.removeCitekey("b");
  await s2.addChunks(mkc("b", 3), vecs(3));
  check(s2.bankCapacity === cap0, `re-embedding one note after load does not grow the bank (${s2.bankCapacity} vs ${cap0})`);
  const hit = await s2.search([1, 1, 2, 3], "word1 b", 20);
  check(hit.filter((h) => h.citekey === "b").length === 3 && hit.length === 9, `...and every chunk is still searchable (${hit.length})`);
  await s2.removeCitekey("b");
  await s2.addChunks(mkc("b", 4), vecs(4));
  check(s2.bankCapacity > cap0 && s2.count === 10, "a note that grows still gets rows (the bank grows only then)");
  // the loaded buffer is normalized in place and used as the bank
  const raw = new Float32Array([3, 0, 0, 4]).buffer;
  const s3 = new VectorStore();
  await s3.load(JSON.stringify([{ id: "x#0", citekey: "x", title: "x", section: "s", year: 1, tags: [], author: [], text: "t" }]), raw, { modelId: "m", dim: 4, chunkIds: { x: ["x#0"] }, count: 1 });
  const bank3 = new Float32Array(raw);
  check(Math.abs(bank3[0] - 0.6) < 1e-6 && Math.abs(bank3[3] - 0.8) < 1e-6, "store.load: vectors normalized in place in the loaded buffer");

  // NodeFileIO.readBinary: whole buffer handed over, and the chunked path for big files
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "refwright-rb-"));
  const nio = new NodeFileIO();
  const payload = new Uint8Array(1000).map((_, i) => i % 251);
  fs.writeFileSync(`${tmp}/v.f32`, payload);
  const whole = new Uint8Array(await nio.readBinary(`${tmp}/v.f32`));
  check(whole.length === 1000 && whole.every((x, i) => x === payload[i]), "NodeFileIO.readBinary: contents intact");
  nio.readLimit = 10;
  nio.readPiece = 64;
  const nfs = (nio as unknown as { fs: { open: (...a: unknown[]) => Promise<unknown> } }).fs;
  const realOpen = nfs.open.bind(nfs);
  let opened = 0;
  nfs.open = (...a: unknown[]) => ((opened += 1), realOpen(...a));
  const pieces = await nio.readBinary(`${tmp}/v.f32`);
  check(opened === 1 && pieces.byteLength === 1000 && new Uint8Array(pieces).every((x, i) => x === payload[i]), "NodeFileIO.readBinary: file above the limit is read in pieces");
  fs.rmSync(tmp, { recursive: true });

  const hs = { openaiBaseUrl: "https://openrouter.ai/api/v1", embeddingProvider: "ollama" as const, llmProvider: "ollama" as const };
  check(!canHostedRerank(hs) && canHostedRerank({ ...hs, llmProvider: "openai" }) && canHostedRerank({ ...hs, embeddingProvider: "openai" }) && !canHostedRerank({ ...hs, embeddingProvider: "openai", openaiBaseUrl: "https://api.openai.com/v1" }), "canHostedRerank: OpenRouter and a hosted embedding or chat provider");
}

// ---------- cite: renderNote clusters, compile, export, fences, summary placement ----------
{
  const eng = new CiteEngine(
    { vault: { adapter: { read: async (p: string) => readFileSync(p, "utf8"), write: async () => undefined } } } as never,
    "."
  );
  const mk = (id: string, family: string, title: string, extra: Record<string, unknown> = {}) => ({
    id, type: "article-journal", title, author: [{ family, given: "A" }], issued: { "date-parts": [[2020]] },
    "container-title": "J Test", volume: "1", page: "1-9", status: "unread", citekey: id, ...extra,
  });
  const lib: Record<string, ReturnType<typeof mk>> = {
    zed2020a: mk("zed2020a", "Zed", "First Zed paper"),
    zed2020b: mk("zed2020b", "Zed", "Second Zed paper"),
    abe2020: mk("abe2020", "Abe", "An Abe paper"),
    a: mk("a", "Zed", "Alpha"),
    b: mk("b", "Abe", "Beta"),
  };
  const getItem = (k: string) => (lib[k] ?? null) as never;

  // 1. a later cluster disambiguating an earlier one (2020a / 2020b) updates the earlier label
  const dis = await eng.renderNote("apa", ["zed2020a", "abe2020", "zed2020b"], getItem);
  check(/2020a/.test(dis.inText.zed2020a) && /2020b/.test(dis.inText.zed2020b), `renderNote: earlier label gets its year suffix (${dis.inText.zed2020a} / ${dis.inText.zed2020b})`);
  check(!/2020[ab]/.test(dis.inText.abe2020), "renderNote: an undisambiguated label stays plain");
  check(dis.bibliography.every((e) => !/Unread/.test(e)), "renderNote: plugin `status` never reaches the bibliography");
  const disC = await eng.renderNote("apa", ["zed2020a", "abe2020", "zed2020b"], getItem, [[{ id: "zed2020a" }], [{ id: "abe2020" }], [{ id: "zed2020b" }]]);
  check(/2020a/.test(disC.clusterText![0]) && /2020b/.test(disC.clusterText![2]), `renderNote clusters: earlier bracket updated (${disC.clusterText!.join(" | ")})`);

  // 2. compile keeps locators, prefixes, suppress-author; one cluster per bracket
  const comp = (content: string, style: string) =>
    renderCompiledManuscript({
      content, styleId: style, citeStyle: "apa" as never, getItem,
      renderStyle: (st, ks, gi, cl) => eng.renderNote(st, ks, gi, cl),
    });
  const apa = await comp("Text [see @a, p. 23; @b] and [-@a].\n", "apa");
  check(apa.content.includes("(Abe, 2020; see Zed, 2020, p. 23)"), `compile APA: one cluster with prefix and locator kept (citeproc sorts the cluster) (${apa.content.split("\n")[0]})`);
  check(apa.content.includes("and (2020)."), `compile APA: -@a suppresses the author (${apa.content.split("\n")[0]})`);
  const ama = await comp("One [@a; @b] two [@b] three [@a].\n", "american-medical-association");
  const amaBody = ama.content.split("\n")[0];
  check((amaBody.match(/<sup>/g) ?? []).length === 3 && /One<sup>1,2<\/sup> two<sup>2<\/sup> three<sup>1<\/sup>\./.test(amaBody), `compile AMA: merged superscript clusters, numbering kept (${amaBody})`);
  const ord = await comp("First [@b] then [@a] and [@b; @a].\n", "american-medical-association");
  check(/First<sup>1<\/sup> then<sup>2<\/sup> and<sup>1,2<\/sup>\./.test(ord.content) && /\n1\. Abe A\. Beta/.test(ord.content), `compile: numbers follow first citation, bibliography agrees (${JSON.stringify(ord.content)})`);
  const sp = await comp("S [@a; @b].\n", "spine");
  check((sp.content.split("\n")[0].match(/<sup>/g) ?? []).length === 1, `compile spine: one superscript cluster (${sp.content.split("\n")[0]})`);
  // an unknown key leaves the whole bracket as written and does not shift later clusters
  const unk = await comp("X [@a; @nope] Y [@b].\n", "apa");
  check(unk.content.includes("[@a; @nope]") && unk.content.includes("(Abe, 2020)"), `compile: bracket with an unknown key untouched (${unk.content.split("\n")[0]})`);

  const items = parseCiteItems("see @a, pp. 23-25, emphasis added; -@b chap. 3");
  check(items[0].prefix === "see " && items[0].locator === "23-25" && items[0].label === "page" && items[0].suffix === ", emphasis added", `parseCiteItems: prefix/locator/suffix (${JSON.stringify(items[0])})`);
  check(items[1]["suppress-author"] === true && items[1].label === "chapter" && items[1].locator === "3", `parseCiteItems: suppress + chapter (${JSON.stringify(items[1])})`);
  check(parseCiteItems("@a, 23")[0].label === "page" && parseCiteItems("@a")[0].locator === undefined, "parseCiteItems: bare number is a page; no locator otherwise");

  // 5. number is not glued to the entry
  for (const st of ["elsevier-vancouver", "american-medical-association"]) {
    const r = await eng.renderNote(st, ["a", "b"], getItem);
    check(/^(\[1\]|1\.) \S/.test(r.bibliography[0]), `bibliography: number separated from entry in ${st} (${r.bibliography[0].slice(0, 20)})`);
  }

  // 9. bibliography only
  const bo = await eng.renderBibliographyOnly("apa", ["a", "b", "nope"], getItem);
  check(bo.bibliography.length === 2 && bo.entryIds.includes("a") && bo.entryIds.includes("b"), "renderBibliographyOnly: entries for known keys only");
  check((await eng.renderBibliographyOnly("apa", ["nope"], getItem)).bibliography.length === 0, "renderBibliographyOnly: nothing known -> empty");

  // 3/4. export
  const messy = { type: "article-journal", title: "R&D {unbalanced and 50% of A_b #1 $", author: [{ family: "X", given: "Y" }], keyword: "spine; fusion, pain", URL: "http://x.org/a_b?c=1&d=2", status: "unread", citekey: "k" } as never;
  const bib = exportRefs([{ citekey: "k", item: messy }], "bibtex");
  check(bib.includes("keywords = {spine, fusion, pain}"), `bibtex: string keyword normalized (${bib})`);
  check(bib.includes("R\\&D \\{unbalanced and 50\\% of A\\_b \\#1 \\$"), "bibtex: specials and the unbalanced brace escaped");
  check(bib.includes("url = {http://x.org/a_b?c=1&d=2}"), "bibtex: url stays verbatim");
  check(exportRefs([{ citekey: "k", item: { ...(messy as object), title: "A {DNA} test" } as never }], "bibtex").includes("{A {DNA} test}"), "bibtex: balanced braces kept");
  const ris = exportRefs([{ citekey: "k", item: messy }], "ris");
  check(ris.split("\n").filter((l) => l.startsWith("KW  - ")).join("|") === "KW  - spine|KW  - fusion|KW  - pain", "ris: string keyword is split, not iterated by character");
  const cj = JSON.parse(exportRefs([{ citekey: "k", item: messy }], "csl-json"))[0];
  check(cj.id === "k" && cj.status === undefined && cj.citekey === undefined && cj.title, "csl-json: plugin fields (status, citekey) are not exported");
  check(PLUGIN_FIELDS.has("status"), "PLUGIN_FIELDS exported");

  // 6. summary lands before Notes / the stash, never inside the stash
  const blk = ["## Summary", "", "new"];
  const noNotes = replaceSummaryBlock("# T\n\nbody\n\n## Full text (extracted)\n\nPDF TEXT\n", blk);
  check(noNotes.indexOf("## Summary") < noNotes.indexOf(STASH_MARKER) && noNotes.endsWith("PDF TEXT\n") && noNotes.includes("new\n\n## Full text"), `replaceSummaryBlock: before the stash (${JSON.stringify(noNotes)})`);
  const withNotes = replaceSummaryBlock("# T\n\n## Notes\n\nmine\n\n## Full text (extracted)\n\nPDF\n", blk);
  check(withNotes.indexOf("## Summary") < withNotes.indexOf("## Notes") && withNotes.indexOf("## Notes") < withNotes.indexOf(STASH_MARKER), "replaceSummaryBlock: before ## Notes, stash stays last");
  check(replaceSummaryBlock("# T\n\nbody\n", blk) === "# T\n\nbody\n\n## Summary\n\nnew\n", "replaceSummaryBlock: no Notes, no stash -> end");

  // 7. fences: ~~~ and 4-backtick fences are code on every path
  const fences = "[@a] ok\n\n~~~\n[@a] [@b]\n~~~\n\n````\n[@a]\n```\n[@a] still code\n````\n\nlast [@b]\n";
  const ren = renameCiteKeys(fences, { a: "z" });
  check(ren === fences.replace("[@a] ok", "[@z] ok"), `renameCiteKeys: ~~~ and 4-backtick fences untouched (${JSON.stringify(ren)})`);
  check(extractCitekeys(fences).join() === "a,b", "extractCitekeys: only prose citations");
  check(extractCitekeys("~~~\n[@a]\n~~~\n").length === 0, "extractCitekeys: ~~~ block skipped");
  check(anchorsToCitekeys("~~~\n[1]\n~~~\n[1]\n", ["k"]) === "~~~\n[1]\n~~~\n[@k]\n", "anchorsToCitekeys: ~~~ block skipped");
  check(replaceCitations("```js\n[@a]\n```\n`[@b]` [@c]", (ks) => `<${ks}>`) === "```js\n[@a]\n```\n`[@b]` <c>", "replaceCitations: ``` and inline code skipped");
  check(paragraphsOf("~~~\nfake [@a] para\n~~~\n\nReal para.\n").map((x) => x.text).join("|") === "Real para.", "paragraphsOf: ~~~ fence skipped");
  check(paragraphsOf("````\n```\nfake\n````\n\nReal.\n").map((x) => x.text).join("|") === "Real.", "paragraphsOf: 4-backtick fence with inner ``` skipped");
  check(citeClusters(fences).length === 2, "citeClusters: same fence rules");

  // 8. splitAtReferences ignores a References heading inside a fence
  const sr = splitAtReferences("Body\n\n```md\n## References\n```\n\nMore\n\n## References\n\n- old\n\n# Appendix\nkeep\n");
  check(sr.base.endsWith("More") && sr.tail === "\n# Appendix\nkeep\n", `splitAtReferences: fenced heading skipped (${JSON.stringify(sr)})`);
  const sr2 = splitAtReferences("## References\n\n- x\n\n~~~\n# not a heading\n~~~\n\n- y\n");
  check(sr2.tail === "", `splitAtReferences: fenced heading does not end the section (${JSON.stringify(sr2)})`);
}

console.log(`unit: all ${passed} assertions passed`);
}

void main();
