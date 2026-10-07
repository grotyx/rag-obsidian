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
import { VectorStore } from "../src/index/store";
import { TextIndex, tokenize } from "../src/index/textIndex";
import { create, insertMultiple, search, MODE_HYBRID_SEARCH, AnyOrama, SearchParams } from "@orama/orama";

import { parseLibrary } from "../src/ingest/import";
import { parseCollections, parseCslPage } from "../src/ingest/zotero";
import { cleanDoi, detectId, splitName, parsePubDate, esummaryToItem } from "../src/ingest/metadata";
import { ncbiGapMs, ncbiGate, resetNcbiGate } from "../src/ingest/ncbi";
import { findIdentifier, isPdfMagic, extractPdfHighlights, setPdfjsLoader } from "../src/ingest/pdf";
import { hasStashedText, appendStash, resolvePdfLink, stashedText, STASH_MARKER, STASH_MAX_CHARS } from "../src/ingest/pdfStash";
import { buildSysPrompt, parseSections, parseMeshList } from "../src/ingest/summarize";
import { buildTags, MIN_TAGS } from "../src/ingest/pubmedSearch";
import { findOpenAccess } from "../src/ingest/unpaywall";
import { checkRetraction } from "../src/ingest/retraction";
import { rerankHttpReason, mmr, parseRerankResponse } from "../src/index/rerank";
import { requestWithRetry } from "../src/llm/client";
import {
  buildCliArgs,
  cliCandidates,
  parseOpencodeOutput,
  promptFromMessages,
  shouldUseShell,
  spawnInvocation,
  winQuote,
} from "../src/llm/cli";
import { windowsCliShimChecks } from "./windows";
import { cacheRoot, legacyCacheRoot } from "../src/index/localFiles";
import { pandocCandidates, pandocSuperscripts } from "../src/write/pandoc";
import { stripFrontmatter, chunkReference } from "../src/index/chunker";
import { parseFindings, findingText, isRestated } from "../src/data/findings";
import { referenceProblems, refcheckReport } from "../src/write/refcheck";
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
  MergeNote,
  MergeSourceNote,
} from "../src/data/merge";
import { extractSummaryBlock, renameCiteKeys } from "../src/cite/bibliography";
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
import { applyScreening } from "../src/data/screening";
import { prismaCounts, prismaMarkdown, PrismaRecord } from "../src/data/prisma";

let passed = 0;
function check(cond: boolean, label: string): void {
  assert.ok(cond, label);
  passed++;
}

async function main(): Promise<void> {
// ---------- write/refcheck.ts + cite/styleIndex.ts ----------
{
  const good = { type: "article-journal", title: "T", author: [{ family: "A" }], issued: { "date-parts": [[2020]] },
    "container-title": "J", volume: "1", page: "1-2", DOI: "10.1/x" };
  check(referenceProblems(good, {}).length === 0, "refcheck: complete reference has no problems");
  check(referenceProblems(null, {})[0] === "not in the library", "refcheck: missing item");
  check(referenceProblems(good, { retracted: true }).includes("retracted"), "refcheck: retracted flag");
  check(referenceProblems({ ...good, DOI: undefined }, {}).includes("no DOI or PMID"), "refcheck: no DOI");
  check(referenceProblems({ ...good, DOI: undefined, PMID: "1" }, {}).length === 0, "refcheck: PMID suffices");
  check(referenceProblems({ ...good, title: undefined }, {}).includes("missing title"), "refcheck: title");
  check(referenceProblems({ ...good, author: [] }, {}).includes("missing authors"), "refcheck: authors");
  check(referenceProblems({ ...good, issued: undefined }, {}).includes("missing year"), "refcheck: year");
  check(referenceProblems({ ...good, "container-title": undefined }, {}).includes("missing journal"), "refcheck: journal");
  check(referenceProblems({ ...good, volume: undefined, page: undefined }, {}).includes("incomplete: volume, pages"), "refcheck: volume/pages");
  check(referenceProblems({ ...good, type: "book", volume: undefined, "container-title": undefined }, {}).length === 0, "refcheck: volume only for journal articles");
  const rep = refcheckReport("ms", [{ key: "a", problems: [] }, { key: "b", problems: ["no DOI or PMID"] }], ["note x"]);
  check(rep.includes("2 cited, 1 with problems") && rep.includes("| `b` | no DOI or PMID |") && !rep.includes("`a`") && rep.includes("- note x"), "refcheckReport: table of problem rows only");
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

  // results live in fields only: nothing is mirrored into tags, user tags survive.
  const fm4: Record<string, unknown> = { tags: ["mine"] };
  const r4 = applyScreening(fm4, { kq: ["1", "3"], include: "pending", level: "2", design: "Randomized controlled trial", guideline: " BE " });
  check(r4.tags.length === 1 && r4.tags[0] === "mine", "applyScreening: setting fields adds no tags");
  check(fm4.include === "pending" && fm4.level === "2" && fm4.guideline === "BE", "applyScreening: values stored in fields, guideline trimmed");
  check(r4.fields.guideline === "BE", "applyScreening: result reports guideline");
  applyScreening(fm4, { guideline: "  " });
  check(!("guideline" in fm4), "applyScreening: blank guideline removes the field");

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

  // mutation check: a broken prismaCounts (off-by-one on duplicates) must fail the assertions above.
  const brokenDupGroups: string[][] = [];
  const brokenCounts = prismaCounts(records, brokenDupGroups, (r) => fullText.has(r.citekey));
  check(brokenCounts.recordsScreened === 7, "prismaCounts mutation check: no dup groups -> nothing removed");
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
  const fakePlugin = {
    settings,
    saveSettings: async () => {},
    hasSecretStorage: () => true,
    mcpStatus: () => ({ running: false, port: 0 }),
    mcpSetupSnippets: () => null,
    restartMcp: async () => {},
    stopMcp: async () => {},
    setMcpEnabled: async () => {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tab = new ScholarRagSettingTab({} as any, fakePlugin);

  // A text control's change handler must not snap an emptied field back to a default — the
  // fallback belongs at the point of consumption (Library.folder(), llm/client.ts), not here.
  await tab.setControlValue("referencesFolder", "");
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
  const apiKeyRow = allRows.find((r: { name: string }) => r.name === "OpenAI API key");
  check(!!apiKeyRow, 'settings: "OpenAI API key" row exists in the definitions even while the provider is Ollama');
  settings.llmProvider = "ollama"; // neither embeddings nor chat use the OpenAI endpoint
  check(apiKeyRow.visible() === false, 'settings: "OpenAI API key" row is not visible while both providers are Ollama');
  settings.llmProvider = "openai"; // chat alone needs the key — the row must show (review finding)
  check(apiKeyRow.visible() === true, 'settings: "OpenAI API key" row shows when only the chat LLM uses OpenAI');
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

console.log(`unit: all ${passed} assertions passed`);
}

void main();
