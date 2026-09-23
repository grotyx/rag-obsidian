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

import { parseLibrary } from "../src/ingest/import";
import { cleanDoi, detectId, splitName, parsePubDate } from "../src/ingest/metadata";
import { ncbiGapMs, ncbiGate, resetNcbiGate } from "../src/ingest/ncbi";
import { findIdentifier, isPdfMagic } from "../src/ingest/pdf";
import { hasStashedText, appendStash, resolvePdfLink, stashedText, STASH_MARKER, STASH_MAX_CHARS } from "../src/ingest/pdfStash";
import { buildSysPrompt, parseSections, parseMeshList } from "../src/ingest/summarize";
import { buildTags, MIN_TAGS } from "../src/ingest/pubmedSearch";
import { findOpenAccess } from "../src/ingest/unpaywall";
import { checkRetraction } from "../src/ingest/retraction";
import { requestWithRetry } from "../src/llm/client";
import { buildCliArgs, cliCandidates, parseOpencodeOutput, promptFromMessages, winQuote } from "../src/llm/cli";
import { cacheRoot } from "../src/index/localFiles";
import { pandocCandidates } from "../src/write/pandoc";
import { stripFrontmatter } from "../src/index/chunker";
import {
  duplicateGroups,
  inScope,
  matchKeys,
  normDoi,
  normTitle,
  RefEntry,
} from "../src/data/library";
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
import { DEFAULT_SETTINGS } from "../src/types";
import { applyScreening } from "../src/data/screening";
import { prismaCounts, prismaMarkdown, PrismaRecord } from "../src/data/prisma";

let passed = 0;
function check(cond: boolean, label: string): void {
  assert.ok(cond, label);
  passed++;
}

async function main(): Promise<void> {
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

// ---------- llm/cli.ts: winQuote ----------
{
  check(winQuote("model_reasoning_effort=\"low\"") === '"model_reasoning_effort=""low"""', "winQuote: inner quotes doubled, whole arg wrapped");
  check(winQuote("C:\\Temp dir\\last.txt") === '"C:\\Temp dir\\last.txt"', "winQuote: a path with a space stays one argument");
}

// ---------- index/localFiles.ts: cacheRoot (pure — platform/env/home injected) ----------
{
  const home = "/Users/kim";
  check(cacheRoot("darwin", {}, home) === `${home}/Library/Caches`, "cacheRoot: darwin → Library/Caches");
  check(
    cacheRoot("win32", { LOCALAPPDATA: "C:\\Users\\kim\\AppData\\Local" }, "C:\\Users\\kim") ===
      "C:\\Users\\kim\\AppData\\Local",
    "cacheRoot: win32 → %LOCALAPPDATA%"
  );
  check(
    cacheRoot("win32", {}, "C:\\Users\\kim") === "C:\\Users\\kim/AppData/Local",
    "cacheRoot: win32 without LOCALAPPDATA falls back to ~/AppData/Local"
  );
  check(cacheRoot("linux", { XDG_CACHE_HOME: "/xdg-cache" }, home) === "/xdg-cache", "cacheRoot: linux → $XDG_CACHE_HOME");
  check(cacheRoot("linux", {}, home) === `${home}/.cache`, "cacheRoot: linux without XDG_CACHE_HOME falls back to ~/.cache");
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

  // tags mirrored, and swapping a decision/level replaces the stale tag rather than stacking it.
  const fm4: Record<string, unknown> = { tags: [] };
  applyScreening(fm4, { kq: ["1", "3"], include: "pending", level: "2", design: "Randomized controlled trial" });
  const afterPending = applyScreening(fm4, { include: "exclude" });
  check(!afterPending.tags.includes("pending"), "applyScreening: switching pending -> exclude drops the stale include-state tag");
  check(afterPending.tags.includes("exclude"), "applyScreening: exclude tag mirrored");
  const afterLevel = applyScreening(fm4, { level: "3" });
  check(!afterLevel.tags.includes("level-2") && afterLevel.tags.includes("level-3"), "applyScreening: level-2 -> level-3 replaces the tag");
  check(afterLevel.tags.includes("kq-01") && afterLevel.tags.includes("kq-03"), "applyScreening: kq tags survive an unrelated field update");
  check(afterLevel.tags.includes("design-randomized-controlled-trial"), "applyScreening: design tag slugified");

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

console.log(`unit: all ${passed} assertions passed`);
}

void main();
