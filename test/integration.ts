/**
 * Integration test: runs the REAL plugin source (metadata, reference, chunker,
 * store, ollama provider) against live APIs + Ollama + Orama, with the Obsidian
 * API replaced by a thin Node shim. Validates ~90% of the plugin end-to-end.
 *
 * Run: node esbuild bundles this with `obsidian` aliased to ./obsidian-shim.ts.
 */
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import * as yaml from "js-yaml";

import { detectId, fetchMetadata, parsePubDate } from "../src/ingest/metadata";
import { duplicateGroups, inScope, BackfillScope } from "../src/data/library";
import { mapPool, POOL_WIDTH } from "../src/util/pool";
import { buildTags, MIN_TAGS } from "../src/ingest/pubmedSearch";
import { ncbiGate, ncbiGapMs, resetNcbiGate } from "../src/ingest/ncbi";
import { parseMeshList } from "../src/ingest/summarize";
import { exportRefs } from "../src/cite/export";
import { generateCitekey, buildNote } from "../src/data/reference";
import { chunkReference, stripFrontmatter, yearFromIssued, chunkHash } from "../src/index/chunker";
import { VectorStore, INDEX_SCHEMA, SearchFilters } from "../src/index/store";
import { OllamaProvider } from "../src/index/providers/ollama";
import { LLMClient } from "../src/llm/client";
import { RagChat } from "../src/chat/rag";
import { formatCitation } from "../src/cite/format";
import { CiteEngine } from "../src/cite/csl";
import { CitationGraph } from "../src/graph/citations";
import { findIdentifier, extractPdfText, setPdfjsLoader } from "../src/ingest/pdf";
import { findOpenAccess } from "../src/ingest/unpaywall";
import {
  anchorsToCitekeys,
  extractCitekeys,
  buildBibliography,
  inTextLabel,
  citePattern,
  keysInCite,
  replaceCitations,
  resolveCluster,
  splitAtReferences,
  replaceSummaryBlock,
} from "../src/cite/bibliography";
import { ScholarRagSettings, DEFAULT_SETTINGS, CSLItem } from "../src/types";

const MODEL = process.env.EMBED_MODEL || "qwen2.5:0.5b"; // any local Ollama model works for /api/embed
const VAULT = path.resolve("_testvault-auto"); // wiped on every run — keep `_testvault` for manual click-testing
const REFS = path.join(VAULT, "References");

function log(s: string) {
  console.log(s);
}

/** In-process mock LLM endpoint returning Ollama- and OpenAI-shaped chat responses. */
async function startMockLLM(): Promise<{
  server: http.Server;
  port: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lastBody: () => any;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let captured: any = {};
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      try {
        captured = JSON.parse(body || "{}");
      } catch {
        captured = {};
      }
      res.setHeader("content-type", "application/json");
      if (req.url?.includes("/api/chat")) {
        res.end(JSON.stringify({ message: { role: "assistant", content: "Deep learning is representation learning with deep neural networks [1][2]." } }));
      } else if (req.url?.includes("/chat/completions")) {
        res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Deep learning uses neural networks [1]." } }] }));
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const port = (server.address() as any).port;
  return { server, port, lastBody: () => captured };
}

/** Deterministic local embedder (bag-of-words hashed, L2-normalized) — test-only
 *  fallback so the pipeline can be validated without a live embedding service. */
function hashEmbed(text: string, dim: number): number[] {
  const v = new Array(dim).fill(0);
  for (const tok of text.toLowerCase().split(/\W+/).filter(Boolean)) {
    let h = 0;
    for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) >>> 0;
    v[h % dim] += 1;
  }
  const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / norm);
}
function ok(cond: boolean, label: string) {
  console.log(`  ${cond ? "✅" : "❌"} ${label}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  fs.rmSync(VAULT, { recursive: true, force: true });
  fs.mkdirSync(REFS, { recursive: true });

  const settings: ScholarRagSettings = {
    ...DEFAULT_SETTINGS,
    embeddingProvider: "ollama",
    embeddingModel: MODEL,
    chunkChars: 800,
    ollamaUrl: "http://127.0.0.1:11434", // node fetch: force IPv4 (Obsidian requestUrl handles localhost itself)
  };

  // ---- 1. fetch metadata (live Crossref + PubMed) and write notes ----
  log("\n[1] Metadata fetch + note creation (Crossref, PubMed)");
  const ids = ["10.1038/nature14539", "pmid:26017442", "10.1109/5.726791"];
  const created: string[] = [];
  const items = new Map<string, CSLItem>();
  const used = new Set<string>();
  const unique = (base: string): string => {
    if (!used.has(base)) { used.add(base); return base; }
    for (const s of "abcdefghij") if (!used.has(base + s)) { used.add(base + s); return base + s; }
    return base + used.size;
  };
  for (const raw of ids) {
    const id = detectId(raw);
    ok(id.kind !== "unknown", `detectId(${raw}) → ${id.kind}`);
    const item = await fetchMetadata(id, "");
    ok(!!item.title, `  title: ${String(item.title).slice(0, 60)}`);
    const citekey = unique(generateCitekey(item, settings)); // mirrors Library.uniqueCitekey
    items.set(citekey, item);
    const note = buildNote(item, citekey);
    // add a body note so chunker has more than the abstract to work with
    const withNote = note + "\nKey idea: this work is foundational for the field.\n";
    const file = path.join(REFS, `${citekey}.md`);
    fs.writeFileSync(file, withNote);
    created.push(file);
    log(`     wrote ${citekey}.md`);
  }

  // ---- 2. chunk every note (real chunker + frontmatter parse) ----
  log("\n[2] Chunking");
  const allChunks = [];
  for (const file of created) {
    const content = fs.readFileSync(file, "utf8");
    const fmBlock = content.match(/^---\n([\s\S]*?)\n---/);
    const fm = fmBlock ? (yaml.load(fmBlock[1]) as Record<string, unknown>) : {};
    const chunks = chunkReference(
      {
        citekey: String(fm.citekey),
        title: String(fm.title ?? ""),
        year: yearFromIssued(fm.issued),
        tags: [],
        abstract: typeof fm.abstract === "string" ? fm.abstract : undefined,
        body: stripFrontmatter(content),
      },
      settings.chunkChars
    );
    log(`     ${fm.citekey}: ${chunks.length} chunk(s) [${[...new Set(chunks.map((c) => c.section))].join(", ")}]`);
    allChunks.push(...chunks);
  }
  ok(allChunks.length > 0, `total chunks: ${allChunks.length}`);
  ok(
    allChunks.every((c) => c.embedText.startsWith("[")),
    "every chunk carries a [title | section | year] prefix"
  );

  // ---- 3. embed: try live Ollama, else deterministic local fallback ----
  log(`\n[3] Embedding`);
  const provider = new OllamaProvider(settings);
  let embed: (texts: string[]) => Promise<number[][]>;
  let providerId: string;
  try {
    await provider.embed(["probe"]);
    embed = (texts) => provider.embed(texts);
    providerId = provider.id;
    log(`     using live Ollama (${MODEL})`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`     ⚠ Ollama embeddings unavailable (${msg.slice(0, 70)})`);
    log(`     → falling back to deterministic local embedder (pipeline test only)`);
    embed = async (texts) => texts.map((t) => hashEmbed(t, 256));
    providerId = "hash:256";
  }
  const vectors = await embed(allChunks.map((c) => c.embedText));
  ok(vectors.length === allChunks.length, `embedded ${vectors.length}/${allChunks.length}`);
  const dim = vectors[0].length;
  ok(dim > 0, `dim discovered: ${dim}`);

  // ---- 4. Orama store: add, search, remove ----
  log("\n[4] Index + hybrid search");
  const store = new VectorStore();
  store.init(dim, providerId);
  await store.addChunks(allChunks, vectors);
  ok(store.count === allChunks.length, `store.count = ${store.count}`);

  const [qv] = await embed(["neural networks that learn features from data"]);
  const hits = await store.search(qv, "deep learning neural network", settings.topK, {});
  log("     query: 'neural networks that learn features from data'");
  for (const h of hits.slice(0, 5)) log(`       ${h.score.toFixed(3)}  [${h.section}] ${h.title}`);
  ok(hits.length > 0, "search returned hits");

  // year filter
  const filtered = await store.search(qv, "learning", settings.topK, { yearFrom: 2014 });
  ok(filtered.every((h) => h.year === 0 || h.year >= 2014), "year filter (>=2014) respected");

  // remove one citekey
  const victim = allChunks[0].citekey;
  const before = store.count;
  await store.removeCitekey(victim);
  ok(store.count < before, `removeCitekey(${victim}): ${before} → ${store.count}`);

  // ---- 5. persist -> restore round-trip ----
  log("\n[5] Persist → restore");
  const { data, meta } = await store.serialize();
  ok(typeof data === "string" && data.length > 0, `serialized ${data.length} bytes`);
  const store2 = new VectorStore();
  await store2.load(data, meta);
  ok(store2.count === store.count, `restored count = ${store2.count}`);
  const hits2 = await store2.search(qv, "deep learning", settings.topK, {});
  ok(hits2.length > 0, "search works on restored index");

  // ---- 6. citation formatting (real CSL-JSON from fetched items) ----
  log("\n[6] Citation formatting");
  const sample = [...items.keys()][1] ?? [...items.keys()][0];
  const item = items.get(sample)!;
  for (const style of ["apa", "vancouver", "plain"] as const) {
    const s = formatCitation(item, style);
    ok(s.length > 10 && /\d{4}|n\.d\./.test(s), `${style}: ${s.slice(0, 90)}`);
  }

  // ---- 7. citation-grounded chat (real RAG assembly + live Ollama /api/chat) ----
  log("\n[7] Citation-grounded chat");
  const hitsC = await store2.search(qv, "deep learning neural networks", settings.topK, {});
  const order: string[] = [];
  for (const h of hitsC) if (!order.includes(h.citekey)) order.push(h.citekey);
  const numOf = (ck: string) => order.indexOf(ck) + 1;
  const context = hitsC.map((h) => `[${numOf(h.citekey)}] (${h.title}, ${h.year || "n.d."}) ${h.text}`).join("\n\n");
  ok(order.length > 0 && context.includes("[1]"), `assembled ${order.length} numbered sources`);

  // Validate LLM client request+parse deterministically against an in-process mock
  // (covers ollama + openai response shapes; independent of any live service).
  const { server, port, lastBody } = await startMockLLM();
  try {
    const system = "Answer ONLY from the provided sources. Cite claims with [n].";
    const user = `Question: What is deep learning, briefly?\n\nSources:\n${context}`;

    const ollama = new LLMClient({ ...settings, llmProvider: "ollama", llmModel: "mock", ollamaUrl: `http://127.0.0.1:${port}` });
    const a1 = await ollama.chat([{ role: "user", content: user }], system);
    ok(a1.includes("[1]") && a1.includes("Deep learning"), `ollama parse: ${a1.slice(0, 70)}`);
    ok(lastBody().messages?.[0]?.content === system, "ollama request injects system message");

    const openai = new LLMClient({ ...settings, llmProvider: "openai", llmModel: "mock", openaiApiKey: "x", openaiBaseUrl: `http://127.0.0.1:${port}` });
    const a2 = await openai.chat([{ role: "user", content: user }], system);
    ok(a2.includes("Deep learning"), `openai parse: ${a2.slice(0, 70)}`);

    // "Chat with library" uses `chatModel` when set; everything else keeps `llmModel`.
    const twoModel = {
      ...settings,
      llmProvider: "openai" as const,
      llmModel: "default-model",
      chatModel: "chat-model",
      openaiApiKey: "x",
      openaiBaseUrl: `http://127.0.0.1:${port}`,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const idx: any = { ready: true, search: async () => hitsC };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lib: any = { getItem: (ck: string) => items.get(ck) ?? null };
    await new RagChat(idx, lib, twoModel).answer("what is deep learning?");
    ok(lastBody().model === "chat-model", `RagChat used chatModel: ${lastBody().model}`);
    await new LLMClient(twoModel).chat([{ role: "user", content: "x" }], "sys");
    ok(lastBody().model === "default-model", `other calls used llmModel: ${lastBody().model}`);

    // resolve sources to formatted citations (the grounding payload the UI renders)
    const sources = order.map((ck, i) => ({
      n: i + 1,
      formatted: items.get(ck) ? formatCitation(items.get(ck)!, settings.citeStyle) : ck,
    }));
    for (const s of sources) log(`       [${s.n}] ${s.formatted.slice(0, 90)}`);
    ok(sources.every((s) => s.formatted.length > 0), "every source resolved to a formatted citation");
  } finally {
    server.close();
  }

  // ---- 8. citation graph (live OpenAlex via stub app/library) ----
  log("\n[8] Citation graph (live OpenAlex)");
  {
    const seeds = [
      { citekey: "lecun2015deep", title: "Deep learning", DOI: "10.1038/nature14539" },
      { citekey: "lecun1998", title: "Gradient-based learning", DOI: "10.1109/5.726791" },
      { citekey: "he2016resnet", title: "Deep Residual Learning", DOI: "10.1109/cvpr.2016.90" },
    ];
    const seedMap = new Map<string, CSLItem>(
      seeds.map((s) => [s.citekey, { type: "article-journal", title: s.title, DOI: s.DOI }])
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stubApp: any = {
      vault: { adapter: { exists: async () => false, read: async () => "{}", write: async () => {}, mkdir: async () => {} } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fileManager: { processFrontMatter: async (_f: any, fn: any) => fn({}) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stubLib: any = {
      entries: () =>
        seeds.map((s) => ({
          citekey: s.citekey,
          item: seedMap.get(s.citekey)!,
          file: { path: `References/${s.citekey}.md` },
          title: s.title,
          authors: "",
          year: "",
        })),
      getItem: (ck: string) => seedMap.get(ck) ?? null,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const graph = new CitationGraph(stubApp, stubLib, { ...settings, openalexMailto: "test@example.com" } as any, "_x");
    const n = await graph.build();
    ok(n >= 2, `graph built: ${n}/3 papers resolved on OpenAlex`);

    const refsLib = graph.referencesInLibrary("he2016resnet");
    const citedBy = graph.citedByInLibrary("lecun1998");
    const coupled = graph.coupled("lecun2015deep", 1);
    log(`     he2016resnet → refs in library: [${refsLib.join(", ") || "—"}]`);
    log(`     lecun1998 → cited by in library: [${citedBy.join(", ") || "—"}]`);
    log(`     lecun2015deep → coupled (≥1 shared): ${coupled.map((c) => `${c.citekey}:${c.shared}`).join(", ") || "—"}`);
    ok(Array.isArray(refsLib) && Array.isArray(citedBy) && Array.isArray(coupled), "graph queries return arrays");

    const missing = await graph.missingFrequent(2);
    log(`     missing frequently-cited (≥2): ${missing.length}`);
    for (const m of missing.slice(0, 3)) log(`       ×${m.count}  ${m.title.slice(0, 60)}`);
    ok(missing.every((m) => m.count >= 2), "missing entries respect minCount");
  }

  // ---- 9. PDF logic (findIdentifier + extractPdfText via injected pdfjs) ----
  log("\n[9] PDF logic");
  ok(findIdentifier("see doi:10.1038/nature14539 for details")?.value === "10.1038/nature14539", "findIdentifier: DOI");
  ok(findIdentifier("preprint arXiv:2005.11401 cs.CL")?.value === "2005.11401", "findIdentifier: arXiv");
  ok(findIdentifier("nothing here") === null, "findIdentifier: none");

  setPdfjsLoader(async () => ({
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 2,
        getPage: async () => ({ getTextContent: async () => ({ items: [{ str: "Hello" }, { str: "world" }] }) }),
      }),
    }),
  }));
  const ex = await extractPdfText(new ArrayBuffer(8));
  ok(ex.pages === 2 && /Hello world/.test(ex.text), `extractPdfText: ${ex.pages}p "${ex.text.replace(/\n/g, " ").trim()}"`);

  // Unpaywall rejects placeholder addresses; say so instead of reporting "no OA copy".
  {
    let msg = "";
    await findOpenAccess("10.1038/nature14539", "").catch((e) => (msg = String(e.message)));
    let msg2 = "";
    await findOpenAccess("10.1038/nature14539", "anonymous@example.com").catch((e) => (msg2 = String(e.message)));
    ok(
      /contact e-mail/i.test(msg) && /contact e-mail/i.test(msg2),
      `findOpenAccess demands a real contact address: ${msg.slice(0, 60)}`
    );
    // PLOS: best_oa_location carries only a landing page, the PDF sits in another oa_location.
    // Unpaywall requires a real contact address, so this one runs only when CONTACT_EMAIL is set.
    const contact = process.env.CONTACT_EMAIL;
    if (contact) {
      const oa = await findOpenAccess("10.1371/journal.pmed.1000097", contact).catch(() => null);
      ok(
        !!oa?.isOA && !!oa?.pdfUrl && /\.pdf/i.test(oa.pdfUrl),
        `findOpenAccess scans every oa_location for a PDF: ${oa?.pdfUrl ?? "none"}`
      );
    } else {
      log("     (set CONTACT_EMAIL to also check the live oa_locations scan)");
    }
  }

  // ---- 10. bibliography / citations (Phase 5) ----
  log("\n[10] Bibliography / citations");
  {
    const keys = [...items.keys()];
    const doc = `Foundational [@${keys[0]}] and combined [@${keys[1]}; @${keys[2]}].`;
    const found = extractCitekeys(doc);
    ok(found.length === 3 && found[0] === keys[0], `extractCitekeys: [${found.join(", ")}]`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stubLib: any = { getItem: (ck: string) => items.get(ck) ?? null };
    const bib = buildBibliography(found, stubLib, "apa");
    bib.split("\n").forEach((l) => log("       " + l.slice(0, 92)));
    ok(bib.split("\n").length >= 2, "bibliography rendered");
    // Every field buildNote writes must be either a real CSL variable or declared plugin-managed,
    // or citeproc renders it into the entry (that is how `status: unread` printed "Unread.").
    {
      // PMCID and mesh_terms ride along: one is CSL (citeproc may use it), the other is ours.
      const noteText = buildNote(
        { ...items.get(keys[0])!, PMCID: "PMC2707599" },
        "x2024test",
        { tags: ["t"], summarySource: "s", meshTerms: ["Lumbar Vertebrae"] }
      );
      const fmKeys = (noteText.match(/^---\n([\s\S]*?)\n---/) || ["", ""])[1]
        .split("\n")
        .filter((l) => /^[A-Za-z][A-Za-z0-9_-]*:/.test(l))
        .map((l) => l.split(":")[0]);
      const CSL_VARS = new Set([
        "type", "title", "author", "editor", "container-title", "collection-title", "publisher",
        "publisher-place", "page", "volume", "issue", "number", "issued", "accessed", "DOI",
        "PMID", "PMCID", "ISBN", "ISSN", "URL", "abstract", "keyword", "language", "note",
        "edition", "genre", "medium", "source", "archive", "call-number", "citation-key",
      ]);
      const PLUGIN_FIELDS = new Set([
        "citekey", "status", "added", "tags", "pdf", "summary_source", "mesh_terms", "summary_model", "oa_url",
        "oa_pdf", "oa_version", "retracted", "cited_by_count", "openalex_id", "csl",
        "citation-style", "aliases", "position",
      ]);
      const stray = fmKeys.filter((k) => !CSL_VARS.has(k) && !PLUGIN_FIELDS.has(k));
      ok(stray.length === 0, `every buildNote field is CSL or declared plugin-managed${stray.length ? ": " + stray.join(", ") : ""}`);
      ok(
        fmKeys.includes("PMCID") && fmKeys.includes("mesh_terms"),
        `a PubMed note carries its PMC id and the MeSH headings behind its tags: ${fmKeys.join(", ")}`
      );
      // What citeproc actually sees: mesh_terms is stripped, PMCID is not (CSL defines it).
      const engineFields = (CiteEngine as unknown as { PLUGIN_FIELDS: Set<string> }).PLUGIN_FIELDS;
      ok(
        engineFields.has("mesh_terms") && !engineFields.has("PMCID"),
        "CiteEngine strips mesh_terms and leaves PMCID for citeproc"
      );
    }

    // Plugin-managed frontmatter must not reach citeproc: CSL has a `status` variable, so
    // `status: unread` used to print "Unread." into every bibliography entry.
    const noteFm = { ...items.get(keys[0])!, citekey: keys[0], status: "unread", added: "2026-09-07", tags: ["x"] };
    ok(
      !/unread/i.test(formatCitation(noteFm as CSLItem, "apa")),
      "plugin frontmatter stays out of the formatted citation"
    );

    const label = inTextLabel(items.get(keys[0])!);
    ok(/\(LeCun, 2015\)/.test(label), `inTextLabel: ${label}`);

    // Pandoc grammar shared by extractCitekeys, reading-view rendering and compile:
    // multi-key clusters, locators, suppress-author, prefixes — and code is skipped.
    const grammar = "[@a; @b] [@c, p. 23] [-@d] [see @e] `[@code]` [mail@example.com]";
    const brackets = [...grammar.matchAll(citePattern())].map((m) => keysInCite(m[1]));
    ok(
      JSON.stringify(brackets) === JSON.stringify([["a", "b"], ["c"], ["d"], ["e"], ["code"], ["example.com"]]),
      `citePattern+keysInCite: ${JSON.stringify(brackets)}`
    );
    ok(extractCitekeys(grammar).join() === "a,b,c,d,e,example.com", "extractCitekeys skips code spans");

    // Reading view and compile share one rule: a bracket renders only when EVERY key resolves.
    const known2: Record<string, string> = { a: "(A)", b: "(B)" };
    const look = (k: string) => known2[k] ?? null;
    ok(
      JSON.stringify(resolveCluster(["a", "b"], look)) === '["(A)","(B)"]' &&
        resolveCluster(["a", "typo"], look) === null &&
        resolveCluster([], look) === null,
      "resolveCluster: all keys or nothing"
    );

    // Compile-manuscript rewrites citations; code must survive verbatim, unknown keys stay.
    const src = "Cite [@a; @b] and `[@a]` plus\n```\n[@b]\n```\nand [@zz].";
    const known: Record<string, string> = { a: "(A, 2020)", b: "(B, 1998)" };
    const compiled = replaceCitations(src, (ks) => {
      const l = ks.map((k) => known[k] ?? null);
      return l.length && l.every(Boolean) ? l.join("; ") : null;
    });
    ok(
      compiled.includes("(A, 2020); (B, 1998)") &&
        compiled.includes("`[@a]`") &&
        compiled.includes("```\n[@b]\n```") &&
        compiled.includes("[@zz]"),
      `replaceCitations keeps code + unknown keys: ${JSON.stringify(compiled.slice(0, 60))}`
    );

    // "## References" on the first line / without a trailing newline / with a later section.
    const s1 = splitAtReferences("Intro [@a]\n\n## References");
    ok(s1.base === "Intro [@a]" && s1.tail === "", `splitAtReferences (no trailing \\n): ${JSON.stringify(s1)}`);
    const s2 = splitAtReferences("## References\n\n- old\n");
    ok(s2.base === "" && s2.tail === "", `splitAtReferences (first line): ${JSON.stringify(s2)}`);
    const s3 = splitAtReferences("Body\n\n## References\n\n- old\n\n# Appendix\nkeep\n");
    ok(s3.base === "Body" && s3.tail === "\n# Appendix\nkeep\n", `splitAtReferences (tail kept): ${JSON.stringify(s3)}`);

    // "Re-summarize this reference" swaps the EN+KR block; anything after it must survive.
    const fresh = ["## Summary (EN)", "", "**Methods**", "new", "", "## 요약 (KR)", "", "새 요약", ""];
    const old =
      "# T\n\n## Summary (EN)\n\n**Methods**\nold\n\n## 요약 (KR)\n\n옛 요약\n\n# Appendix\nkeep\n";
    const r1 = replaceSummaryBlock(old, fresh);
    ok(
      r1.includes("new") && r1.includes("새 요약") && !r1.includes("old") && !r1.includes("옛 요약") &&
        r1.endsWith("# Appendix\nkeep\n") && r1.startsWith("# T\n\n## Summary (EN)"),
      `replaceSummaryBlock replaces EN+KR, keeps the appendix: ${JSON.stringify(r1)}`
    );
    const r2 = replaceSummaryBlock("# T\n\n## Notes\n\n## Highlights\n", fresh);
    ok(
      r2.startsWith("# T\n\n## Notes\n\n## Highlights\n\n## Summary (EN)") && r2.includes("새 요약"),
      `replaceSummaryBlock appends when absent: ${JSON.stringify(r2)}`
    );
    const r3 = replaceSummaryBlock("## Summary (EN)\n\nold\n\n## References\n\n- ref\n", fresh);
    ok(
      r3.includes("## References\n\n- ref\n") && !r3.includes("old"),
      `replaceSummaryBlock leaves ## References alone: ${JSON.stringify(r3)}`
    );
  }

  // ---- 12. small pure helpers touched by the src/ review ----
  log("\n[12] Helpers");
  {
    // mapPool: order preserved, concurrency capped, all items visited.
    {
      let inFlight = 0;
      let peak = 0;
      const out = await mapPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10 + (n % 3) * 5));
        inFlight--;
        return n * 2;
      });
      ok(
        out.join() === "2,4,6,8,10,12,14" && peak <= 3 && peak > 1,
        `mapPool keeps order and caps concurrency (peak ${peak})`
      );
      ok(POOL_WIDTH >= 10, `the worker pool is sized for the LLM wait (${POOL_WIDTH})`);

      // Cancelling a batch: in-flight items finish, no new ones start, and the promise still
      // resolves so the caller can write what completed.
      {
        const ctl = new AbortController();
        let ran = 0;
        let ranAfterAbort = 0;
        const part = await mapPool(
          [1, 2, 3, 4, 5, 6, 7],
          3,
          async (n) => {
            ran++;
            if (ctl.signal.aborted) ranAfterAbort++;
            await new Promise((r) => setTimeout(r, 10));
            if (ran === 3) ctl.abort(); // the first batch of 3 has settled
            return n * 2;
          },
          ctl.signal
        );
        ok(
          ranAfterAbort <= 3 &&
            ran <= 6 &&
            part.filter((v) => v !== undefined).length === ran &&
            part[0] === 2,
          `mapPool stops starting work when aborted and still resolves (ran ${ran}/7)`
        );
      }

      // The retry is the headline fix of 0.4.10 and had no coverage: answer 429 once, then 200.
    {
      let hits = 0;
      const flaky = http.createServer((req, res) => {
        let body = "";
        req.on("data", (d) => (body += d));
        req.on("end", () => {
          hits++;
          if (hits === 1) {
            res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "1" });
            res.end(JSON.stringify({ error: "slow down" }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ choices: [{ message: { content: "recovered" } }] }));
        });
      });
      await new Promise<void>((r) => flaky.listen(0, "127.0.0.1", r));
      const fport = (flaky.address() as { port: number }).port;
      const started = Date.now();
      const reply = await new LLMClient({
        ...settings,
        llmProvider: "openai",
        llmModel: "mock",
        openaiApiKey: "x",
        openaiBaseUrl: `http://127.0.0.1:${fport}`,
      }).chat([{ role: "user", content: "hi" }], "sys");
      flaky.close();
      ok(
        reply === "recovered" && hits === 2 && Date.now() - started >= 400,
        `a 429 is retried after a wait, not surfaced (${hits} attempts, ${Date.now() - started}ms)`
      );
    }

    // The gate is what lets a 15-wide pool talk to an API that allows 10 requests/second.
      // Measure it: fire concurrently, record when each turn is released.
      resetNcbiGate();
      const stamps: number[] = [];
      await Promise.all(
        Array.from({ length: 5 }, async () => {
          await ncbiGate(true);
          stamps.push(Date.now());
        })
      );
      stamps.sort((a, b) => a - b);
      const gaps = stamps.slice(1).map((t, i) => t - stamps[i]);
      const slack = 25; // timer coarseness
      ok(
        gaps.every((g) => g >= ncbiGapMs(true) - slack) && 1000 / ncbiGapMs(true) < 10,
        `ncbiGate spaces concurrent callers ${gaps.join("/")}ms apart (needs ~${ncbiGapMs(true)})`
      );

      // An idle gate must not charge for a wait nobody owes.
      resetNcbiGate();
      const t0 = Date.now();
      await ncbiGate(false);
      ok(Date.now() - t0 < 50, `an idle gate releases immediately (${Date.now() - t0}ms)`);
      ok(
        1000 / ncbiGapMs(false) < 3 && ncbiGapMs(false) > ncbiGapMs(true),
        `the keyless tier stays under NCBI's 3/s (${(1000 / ncbiGapMs(false)).toFixed(1)}/s)`
      );

      // Mixed tiers: a keyed call following a keyless one must not fire 110ms after it. The
      // keyless request counted against the address's 3/s budget, so the wait between the two
      // has to honour the stricter neighbour, not just the newcomer's own tier.
      resetNcbiGate();
      await ncbiGate(false);
      const mixed = Date.now();
      await ncbiGate(true);
      const waited = Date.now() - mixed;
      ok(
        waited >= ncbiGapMs(false) - 25,
        `a keyed call after a keyless one still waits the keyless gap (${waited}ms, needs ${ncbiGapMs(false)})`
      );
    }

    // Tags: PubMed MeSH is authoritative but thin on recent papers, so the summary's MeSH line
    // tops it up to MIN_TAGS. Author keywords ride along but never substitute for MeSH.
    {
      const many = await buildTags({
        descriptors: ["Spinal Stenosis", "Decompression, Surgical", "Lumbar Vertebrae", "Endoscopy", "Humans", "Treatment Outcome"],
        keywords: ["biportal"],
      });
      ok(many.length >= MIN_TAGS && many.includes("biportal"), `full MeSH kept as-is (${many.length} tags)`);

      // The real case that slipped through: PubMed gave five headings, but "Humans" is dropped
      // as a blanket term, so the note ended up with four and no top-up was attempted.
      const blanket = await buildTags({
        descriptors: ["Humans", "Postoperative Complications", "Endoscopy", "Minimally Invasive Surgical Procedures", "Spinal Diseases"],
        keywords: [],
        meshFromSummary: "Lumbar Vertebrae, Treatment Outcome, Spinal Fusion",
      });
      ok(
        blanket.length >= MIN_TAGS && !blanket.includes("humans"),
        `a blanket heading does not count toward the minimum: ${blanket.join(", ")}`
      );

      // Two real headings + a summary line: the LLM terms are only asked for because we are short.
      const thin = await buildTags({
        descriptors: ["Spinal Stenosis", "Humans"],
        keywords: ["ube"],
        // A model ignoring "one per line" sends exactly this shape, inverted headings and all.
        meshFromSummary: "Lumbar Vertebrae, Decompression, Surgical, Endoscopy, Spinal Fusion, Laminectomy",
      });
      ok(
        thin.length >= MIN_TAGS && thin.includes("spinal-stenosis"),
        `thin MeSH topped up to ${MIN_TAGS}: ${thin.join(", ")}`
      );

      // A model that wraps the list in a sentence must not turn that sentence into a tag —
      // canonicalizeMeshTerms keeps unmatched terms verbatim, so prose would land in frontmatter.
      // NLM publishes inverted names with commas; splitting on commas silently turned one real
      // heading into two fragments, and "Surgical" is itself a heading, so nothing looked wrong.
      const inverted = parseMeshList("Decompression, Surgical\nDiabetes Mellitus, Type 2\n- 5-Methylcytosine");
      ok(
        inverted.length === 3 &&
          inverted[0] === "Decompression, Surgical" &&
          inverted[2] === "5-Methylcytosine",
        `inverted headings and leading digits survive: ${JSON.stringify(inverted)}`
      );

      const chatty = await buildTags({
        descriptors: ["Humans"],
        keywords: [],
        meshFromSummary:
          "Here are 8 MeSH headings for this article: Lumbar Vertebrae, Endoscopy, Treatment Outcome",
      });
      ok(
        chatty.includes("endoscopy") && !chatty.some((t) => /here-are|mesh-headings|article/.test(t)),
        `prose is dropped, the headings beside it are not: ${chatty.join(", ")}`
      );
      ok(
        parseMeshList("1. Spinal Fusion\n2) Endoscopy.").join("|") === "Spinal Fusion|Endoscopy",
        "list markers and a trailing period are stripped, the heading is not"
      );
    }

    // "Find duplicates" must group on ANY shared identifier, like add-time dedup does.
    const notes = [
      { name: "byDoi", item: { DOI: "10.1/X", PMID: "111", title: "Deep learning for spine" } },
      { name: "byPmid", item: { PMID: "111", title: "Deep learning for spine surgery" } },
      { name: "unrelated", item: { DOI: "10.9/Z", title: "Something else entirely here" } },
      { name: "noIds", item: { title: "Editorial" } },
      { name: "noIds2", item: { title: "Editorial" } },
    ];
    const groups = duplicateGroups(notes).map((g) => g.map((n) => n.name).sort().join("+"));
    ok(
      groups.length === 1 && groups[0] === "byDoi+byPmid",
      `duplicateGroups joins on a shared PMID and ignores short titles: ${JSON.stringify(groups)}`
    );

    // "Add by PMID" keeps the PMC id the esummary payload already carries, so the fill-gaps
    // command need not re-fetch the record to find it. PMID 19621072 = the PRISMA statement.
    const prisma = await fetchMetadata(detectId("pmid:19621072"), "");
    ok(
      /^PMC\d+$/.test(String(prisma.PMCID || "")),
      `fetchMetadata(PMID) keeps the PMC id: ${String(prisma.PMCID)}`
    );

    const pm = detectId("https://pubmed.ncbi.nlm.nih.gov/26017442/");
    ok(pm.kind === "pmid" && pm.value === "26017442", `detectId(pubmed URL) → ${pm.kind}:${pm.value}`);
    ok(JSON.stringify(parsePubDate("2020 Mar 15")) === '{"date-parts":[[2020,3,15]]}', "parsePubDate keeps the day");
    ok(JSON.stringify(parsePubDate("2020")) === '{"date-parts":[[2020]]}', "parsePubDate year only");
    const numericPage = { ...items.get([...items.keys()][0])!, page: 155 as unknown as string };
    const bib = exportRefs([{ citekey: "x", item: numericPage }], "bibtex");
    const ris = exportRefs([{ citekey: "x", item: numericPage }], "ris");
    ok(/pages\s*=\s*\{155\}/.test(bib) && /SP {2}- 155/.test(ris), "export tolerates numeric page");
    const c1 = chunkReference({ citekey: "k", title: "T", year: 2020, tags: ["a"], body: "same body" }, 800);
    const c2 = chunkReference({ citekey: "k", title: "T", year: 2020, tags: ["a"], body: "same body" }, 800);
    const c3 = chunkReference({ citekey: "k", title: "T", year: 2021, tags: ["a"], body: "same body" }, 800);
    ok(chunkHash(c1) === chunkHash(c2) && chunkHash(c1) !== chunkHash(c3), "chunkHash: stable, and sees a prefix change");
  }

  // ---- 13. chat answer → citable note ([n] anchors → [@citekey] clusters) ----
  log("\n[13] Chat answer → citable note");
  {
    const src = ["smith2020", "doe2019", "lee2021"];
    const one = anchorsToCitekeys("Deep nets learn features [2].", src);
    ok(one === "Deep nets learn features [@doe2019].", `single anchor → citekey: ${one}`);

    const many = anchorsToCitekeys("Two lines of work agree [1][3].", src);
    ok(many === "Two lines of work agree [@smith2020; @lee2021].", `[1][3] → one cluster: ${many}`);

    // A number with no source behind it stays exactly as the model wrote it — as does the
    // whole run it sits in, so a half-rewritten cluster can never be produced.
    const dangling = anchorsToCitekeys("Unsupported [9] and mixed [1][9].", src);
    ok(
      dangling === "Unsupported [9] and mixed [1][9].",
      `unmatched anchors left untouched: ${dangling}`
    );

    // Code is data, not prose: `[1]` in a snippet is an array index.
    const code = anchorsToCitekeys("Use `xs[1]` here [1].\n\n```\nys[2]\n```\n", src);
    ok(
      code.includes("`xs[1]`") && code.includes("ys[2]") && code.includes("[@smith2020]"),
      `anchors inside code survive, prose ones do not: ${JSON.stringify(code)}`
    );

    // The whole point: the saved note must be readable by "Update bibliography".
    ok(
      extractCitekeys(many).join("|") === "smith2020|lee2021",
      `extractCitekeys reads the rewritten cluster: ${extractCitekeys(many).join("|")}`
    );
  }

  // ---- 14. "fill gaps" scope (inScope) ----
  log("\n[14] Fill-gaps scope (inScope)");
  {
    const spineA = { file: { path: "References/Spine/a.md" }, item: { tags: ["Spine", "endoscopy"] } };
    const spineB = { file: { path: "References/Spine/b.md" }, item: { tags: "#Spine" } };
    const spine2 = { file: { path: "References/Spine2/c.md" }, item: { tags: ["spine"] } };
    const untagged = { file: { path: "References/other.md" }, item: {} };

    const all: BackfillScope = { kind: "all" };
    ok(
      [spineA, spineB, spine2, untagged].every((e) => inScope(e, all)),
      "all scope matches every entry"
    );

    const note: BackfillScope = { kind: "note", path: spineA.file.path };
    ok(
      inScope(spineA, note) && !inScope(spineB, note) && !inScope(spine2, note),
      "note scope matches only the exact path"
    );

    const folder: BackfillScope = { kind: "folder", folder: "References/Spine" };
    ok(
      inScope(spineA, folder) && inScope(spineB, folder) && !inScope(spine2, folder) && !inScope(untagged, folder),
      "folder scope matches notes under it but not a sibling folder with the same prefix (Spine vs Spine2)"
    );

    const tagPlain: BackfillScope = { kind: "tag", tag: "spine" };
    const tagHash: BackfillScope = { kind: "tag", tag: "#Spine" };
    ok(
      inScope(spineA, tagPlain) && inScope(spineB, tagPlain) && inScope(spine2, tagPlain) && !inScope(untagged, tagPlain),
      "tag scope matches case-insensitively across array/string tags"
    );
    ok(
      inScope(spineA, tagHash) && inScope(spineB, tagHash),
      "tag scope tolerates a leading # on either the scope tag or the stored tag"
    );
    ok(
      !inScope(untagged, { kind: "tag", tag: "endoscopy" }) && !inScope(spineA, { kind: "tag", tag: "nope" }),
      "tag scope does not match an unrelated or missing tag"
    );
  }

  // ---- 15. search filters: year range, tag AND, author facet ----
  log("\n[15] Search filters");
  {
    const mk = (citekey: string, title: string, year: number, tags: string[], authors: string[]) =>
      chunkReference(
        { citekey, title, year, tags, authors, body: `${title}: a study of fusion outcomes.` },
        800
      );
    const docs = [
      ...mk("old2001", "Lumbar fusion", 2001, ["Spinal Fusion", "Outcome"], ["Kim", "Choi"]),
      ...mk("mid2012", "Cervical fusion", 2012, ["Spinal Fusion"], ["Park"]),
      ...mk("new2022", "Adult deformity", 2022, ["Spinal Fusion", "Outcome"], ["Lee", "Kim"]),
    ];
    const fstore = new VectorStore();
    fstore.init(dim, providerId);
    await fstore.addChunks(docs, await embed(docs.map((c) => c.embedText)));
    const [fq] = await embed(["fusion outcomes"]);
    const keys = async (f: SearchFilters, st: VectorStore = fstore) =>
      [...new Set((await st.search(fq, "fusion outcomes", 20, f)).map((h) => h.citekey))].sort().join(",");

    ok((await keys({})) === "mid2012,new2022,old2001", `no filter returns all three: ${await keys({})}`);
    ok((await keys({ yearFrom: 2010 })) === "mid2012,new2022", "yearFrom 2010 drops the 2001 note");
    ok((await keys({ yearFrom: 2005, yearTo: 2015 })) === "mid2012", "yearFrom+yearTo keeps only 2012");
    ok((await keys({ tags: ["Spinal Fusion"] })) === "mid2012,new2022,old2001", "multi-word tag matches whole");
    ok(
      (await keys({ tags: ["Spinal Fusion", "Outcome"] })) === "new2022,old2001",
      "two tags are ANDed (the note missing 'Outcome' drops out)"
    );
    ok((await keys({ tags: ["Nonexistent"] })) === "", "an unknown tag matches nothing");
    ok((await keys({ author: "kim" })) === "new2022,old2001", "author facet matches a non-first author");
    ok((await keys({ author: "Park" })) === "mid2012", "author input is case-insensitive");
    ok(
      (await keys({ author: "Kim", yearFrom: 2015, tags: ["Outcome"] })) === "new2022",
      "author + year + tag combine"
    );

    // persist/restore keeps the new facets filterable, and stamps the schema version
    const fser = await fstore.serialize();
    ok(fser.meta.schema === INDEX_SCHEMA, `meta carries schema ${fser.meta.schema}`);
    const fstore2 = new VectorStore();
    await fstore2.load(fser.data, fser.meta);
    ok(
      (await keys({ tags: ["Spinal Fusion", "Outcome"], yearFrom: 2010 }, fstore2)) === "new2022",
      "filters still work on a restored index"
    );
  }

  log("\nDONE.");
}

main().catch((e) => {
  console.error("\nTEST ERROR:", e);
  process.exit(1);
});
