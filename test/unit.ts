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
import { findIdentifier } from "../src/ingest/pdf";
import { hasStashedText, appendStash, resolvePdfLink, stashedText, STASH_MARKER, STASH_MAX_CHARS } from "../src/ingest/pdfStash";
import { buildSysPrompt, parseSections, parseMeshList } from "../src/ingest/summarize";
import { buildTags, MIN_TAGS } from "../src/ingest/pubmedSearch";
import { findOpenAccess } from "../src/ingest/unpaywall";
import { checkRetraction } from "../src/ingest/retraction";
import { requestWithRetry } from "../src/llm/client";
import { buildCliArgs, cliCandidates, parseOpencodeOutput, promptFromMessages } from "../src/llm/cli";
import { cacheRoot } from "../src/index/localFiles";
import {
  duplicateGroups,
  inScope,
  matchKeys,
  normDoi,
  normTitle,
} from "../src/data/library";
import { matchPdf, PdfCandidate } from "../src/data/pdfMatch";
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

console.log(`unit: all ${passed} assertions passed`);
}

void main();
