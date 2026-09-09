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
import { parseMeshList, buildSysPrompt, summarizeSource } from "../src/ingest/summarize";
import { exportRefs } from "../src/cite/export";
import { generateCitekey, buildNote, summaryBlock } from "../src/data/reference";
import { chunkReference, stripFrontmatter, yearFromIssued, chunkHash } from "../src/index/chunker";
import { VectorStore, INDEX_SCHEMA, SearchFilters, SearchHit, describeFilters } from "../src/index/store";
import { paragraphsOf, looksLikeClaim, unsupportedClaims, rankHits, citationInsertion, citationEdit } from "../src/write/evidence";
import { OllamaProvider } from "../src/index/providers/ollama";
import { LLMClient } from "../src/llm/client";
import { RagChat } from "../src/chat/rag";
import { formatCitation } from "../src/cite/format";
import { CiteEngine } from "../src/cite/csl";
import { TFile } from "obsidian";
import { CitationGraph } from "../src/graph/citations";
import { capPerReference, parseRerankOrder, buildRerankUser } from "../src/index/rerank";
import { layoutGraph, topByDegree, LayoutNode, LayoutEdge } from "../src/graph/layout";
import { findIdentifier, extractPdfText, setPdfjsLoader } from "../src/ingest/pdf";
import { wrapCdnImportError } from "../src/util/cdn";
import { hasStashedText, appendStash, resolvePdfLink, STASH_MARKER } from "../src/ingest/pdfStash";
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

/** In-process mock LLM endpoint returning Ollama- and OpenAI-shaped chat responses.
 *  `openaiReply` overrides the canned `/chat/completions` content (used to feed
 *  `summarizeSource` a marker-formatted reply instead of the default chat sentence). */
async function startMockLLM(openaiReply?: string): Promise<{
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
        const content = openaiReply ?? "Deep learning uses neural networks [1].";
        res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
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

    // The reranker is an optimisation, so it must never change what the answer is grounded in
    // beyond order — and it must not send OpenRouter's `reasoning` field to a plain OpenAI host.
    const rerankOn = { ...twoModel, llmRerank: true };
    await new RagChat(idx, lib, rerankOn).answer("what is deep learning?");
    ok(lastBody().model === "chat-model", "rerank on: the answer still comes from chatModel");
    ok(lastBody().reasoning === undefined, "no `reasoning` field for a non-OpenRouter endpoint");
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
    const addedFile = new TFile("References/krizhevsky2017imagenet.md");
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

    // Incremental maintenance: a note added after the build joins the graph without a rebuild,
    // and a deleted one is pruned — this is what keeps the Related pane from going stale.
    const added: CSLItem = { type: "article-journal", title: "ImageNet classification with deep convolutional neural networks", DOI: "10.1145/3065386" };
    seeds.push({ citekey: "krizhevsky2017imagenet", title: String(added.title), DOI: String(added.DOI) });
    seedMap.set("krizhevsky2017imagenet", added);
    stubApp.vault.getAbstractFileByPath = (path: string) => (path === "References/krizhevsky2017imagenet.md" ? addedFile : null);
    stubApp.metadataCache = {
      getFileCache: () => ({ frontmatter: { citekey: "krizhevsky2017imagenet", ...added } }),
    };
    const sizeBefore = graph.size;
    graph.enqueue(addedFile);
    // 3s debounce, then one OpenAlex round trip — poll rather than guess a sleep.
    for (let i = 0; i < 30 && graph.size === sizeBefore; i++) await new Promise((r) => setTimeout(r, 500));
    ok(graph.size === sizeBefore + 1, `enqueue adds one node without a rebuild: ${sizeBefore} → ${graph.size}`);

    let notified = 0;
    const off = graph.onChange(() => notified++);
    seeds.splice(seeds.findIndex((s) => s.citekey === "krizhevsky2017imagenet"), 1); // note "deleted"
    await graph.prune();
    off();
    ok(graph.size === sizeBefore, `prune drops the node whose note is gone: back to ${graph.size}`);
    ok(notified === 1, "prune notifies subscribed views once");

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
    const oaUrl = detectId("https://openalex.org/W2741809807");
    const oaBare = detectId("w2741809807");
    ok(
      oaUrl.kind === "openalex" && oaUrl.value === "W2741809807" && oaBare.kind === "openalex" && oaBare.value === "W2741809807",
      `detectId(OpenAlex URL / bare id) → ${oaUrl.kind}:${oaUrl.value}, ${oaBare.kind}:${oaBare.value}`
    );
    ok(detectId("W2741809807 is great").kind !== "openalex", "a sentence starting with W+digits is not an OpenAlex id");
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

  // ---- 16. summary language setting ----
  log("\n[16] Summary language setting");
  {
    // The prompt: "en+ko" is the only mode that asks for a ===KR=== block; every other mode
    // (including free-text languages) asks for the structured sections in that language instead.
    const pEn = buildSysPrompt("en");
    ok(!pEn.includes("===KR===") && !/not English/.test(pEn), `en: English sections only, no KR marker`);

    const pKo = buildSysPrompt("ko");
    ok(
      !pKo.includes("===KR===") &&
        /Write the BACKGROUND\/METHODS\/RESULTS\/CONCLUSIONS sections in Korean, not English\./.test(pKo),
      "ko: structured sections asked for in Korean, no separate KR marker"
    );

    const pBoth = buildSysPrompt("en+ko");
    ok(
      pBoth.includes("===KR===") && pBoth.includes("Korean summary must stay concise"),
      "en+ko: unchanged two-block behaviour (EN sections + concise KR)"
    );

    const pCustom = buildSysPrompt("German");
    ok(
      !pCustom.includes("===KR===") &&
        /Write the BACKGROUND\/METHODS\/RESULTS\/CONCLUSIONS sections in German, not English\./.test(pCustom),
      "custom language: one summary in that language, no KR marker"
    );

    // summarizeSource against the mock LLM server: the mock ignores the prompt and always
    // replies with the same marker text, so this exercises the request (language passed through
    // to buildSysPrompt) and the response parse (parseSections) together — for "en" the
    // caller only cares that a KR-shaped reply CAN be parsed, and for "en+ko" that it is.
    const { server: sumServer, port: sumPort, lastBody: sumBody } = await startMockLLM(
      "===BACKGROUND===\nB\n===METHODS===\nM\n===RESULTS===\nR\n===CONCLUSIONS===\nC\n===MESH===\nX, Y"
    );
    try {
      const sumLlm = new LLMClient({
        ...settings,
        llmProvider: "openai",
        llmModel: "mock",
        openaiApiKey: "x",
        openaiBaseUrl: `http://127.0.0.1:${sumPort}`,
      });
      const fakeItem: CSLItem = { title: "T", "container-title": "J", issued: { "date-parts": [[2020]] } };
      const outEn = await summarizeSource(sumLlm, fakeItem, "source text", "abstract", "en");
      ok(
        outEn.background === "B" && outEn.kr === undefined,
        `summarizeSource("en"): structured sections parsed, no kr field: ${JSON.stringify(outEn)}`
      );
      ok(!sumBody().messages?.[0]?.content.includes("===KR==="), "summarizeSource threaded \"en\" into the prompt");
    } finally {
      sumServer.close();
    }

    // summaryBlock: one stable "## Summary" heading regardless of language, so a note
    // summarized in any mode is still found by replaceSummaryBlock later.
    const enBlock = summaryBlock({ background: "B", methods: "M", results: "R", conclusions: "C" });
    ok(enBlock[0] === "## Summary" && !enBlock.some((l) => l.includes("요약")), `en-only block: ${JSON.stringify(enBlock)}`);
    const bothBlock = summaryBlock({ background: "B", kr: "K" });
    ok(
      bothBlock.filter((l) => l === "## Summary").length === 1 && bothBlock.includes("**한국어 요약 (KR)**"),
      `en+ko block: single heading, KR as an inline label: ${JSON.stringify(bothBlock)}`
    );

    // replaceSummaryBlock must still recognise notes written before the heading was unified
    // ("## Summary (EN)" / "## 요약 (KR)"), plus the new bare "## Summary" and a
    // language-suffixed variant, so re-summarize/backfill find and replace all three shapes.
    const freshBlock = ["## Summary", "", "**Methods**", "new", ""];
    const legacyNote =
      "# T\n\n## Summary (EN)\n\n**Methods**\nold\n\n## 요약 (KR)\n\n옛 요약\n\n# Appendix\nkeep\n";
    const rLegacy = replaceSummaryBlock(legacyNote, freshBlock);
    ok(
      rLegacy.includes("new") && !rLegacy.includes("old") && !rLegacy.includes("옛 요약") &&
        rLegacy.endsWith("# Appendix\nkeep\n"),
      `replaceSummaryBlock recognises the legacy EN+KR heading pair: ${JSON.stringify(rLegacy.slice(0, 40))}`
    );
    const newNote = "# T\n\n## Summary\n\n**Methods**\nold\n\n# Appendix\nkeep\n";
    const rNew = replaceSummaryBlock(newNote, freshBlock);
    ok(
      rNew.includes("new") && !rNew.includes("old") && rNew.endsWith("# Appendix\nkeep\n"),
      "replaceSummaryBlock recognises the new bare ## Summary heading"
    );
    const langNote = "# T\n\n## Summary (German)\n\n**Methods**\nalt\n\n# Appendix\nkeep\n";
    const rLang = replaceSummaryBlock(langNote, freshBlock);
    ok(
      rLang.includes("new") && !rLang.includes("alt") && rLang.endsWith("# Appendix\nkeep\n"),
      "replaceSummaryBlock recognises a language-suffixed ## Summary (X) heading"
    );
  }

  // ---- 17. citation map layout (pure force-directed layout behind RelatedView's SVG) ----
  log("\n[17] Citation map layout");
  {
    const W = 320;
    const H = 260;
    // a = the active note (pinned centre) with one cited paper b; c—d are a separate pair.
    const mapNodes: LayoutNode[] = [{ id: "a", pinned: true }, { id: "b" }, { id: "c" }, { id: "d" }];
    const mapEdges: LayoutEdge[] = [
      { source: "a", target: "b" },
      { source: "c", target: "d" },
    ];
    const p1 = layoutGraph(mapNodes, mapEdges, { width: W, height: H });

    ok(p1.size === mapNodes.length, `every node placed: ${p1.size}/${mapNodes.length}`);
    ok(
      [...p1.values()].every(
        (p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H
      ),
      `all positions finite and inside ${W}×${H}: ${JSON.stringify([...p1.entries()])}`
    );

    const centre = p1.get("a");
    ok(centre?.x === W / 2 && centre?.y === H / 2, `pinned node stays at the centre: ${JSON.stringify(centre)}`);

    const dist = (i: string, j: string) => {
      const a = p1.get(i);
      const b = p1.get(j);
      if (!a || !b) return Infinity;
      return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    };
    ok(
      dist("a", "b") < dist("a", "c") && dist("c", "d") < dist("a", "c"),
      `springs pull connected nodes together: a-b ${dist("a", "b").toFixed(1)}, c-d ${dist("c", "d").toFixed(
        1
      )}, both under the unconnected a-c ${dist("a", "c").toFixed(1)}`
    );

    // Seeded on a circle by index, never Math.random — same input, same output.
    const p2 = layoutGraph(mapNodes, mapEdges, { width: W, height: H });
    ok(
      [...p1.keys()].every((k) => p1.get(k)?.x === p2.get(k)?.x && p1.get(k)?.y === p2.get(k)?.y),
      "layout is deterministic across two runs"
    );

    // Degree cap: a hub note's map keeps the pinned centre plus the best-connected nodes.
    const hubNodes: LayoutNode[] = [{ id: "hub", pinned: true }];
    for (let i = 0; i < 6; i++) hubNodes.push({ id: `n${i}` });
    // n0 has 3 edges, n1 has 2, n2 has 1, n3..n5 none.
    const hubEdges: LayoutEdge[] = [
      { source: "n0", target: "n1" },
      { source: "n0", target: "n2" },
      { source: "n0", target: "hub" },
      { source: "n1", target: "hub" },
    ];
    const keptIds = topByDegree(hubNodes, hubEdges, 3).map((n) => n.id);
    ok(
      JSON.stringify(keptIds) === JSON.stringify(["hub", "n0", "n1"]),
      `degree cap keeps the pinned node then the best-connected: ${JSON.stringify(keptIds)}`
    );
    ok(
      topByDegree(hubNodes, hubEdges, 99).length === hubNodes.length,
      "degree cap is a no-op when the graph already fits"
    );
  }

  // ---- 18. Mobile guards ----
  log("\n[18] Mobile guards");
  {
    // pdf.ts and transformers.ts both wrap a blocked/failed CDN dynamic import() (a real risk
    // on mobile webviews) through this one helper — test the helper directly rather than the
    // production loader, since tests inject their own loader and never hit `defaultLoader`.
    const raw = new Error("Failed to fetch dynamically imported module");
    const wrapped = wrapCdnImportError("PDF reading", raw);
    ok(
      /^PDF reading is unavailable/.test(wrapped.message) &&
        /CDN/.test(wrapped.message) &&
        wrapped.message.includes(raw.message),
      `wrapCdnImportError: clear notice-ready message, original preserved: "${wrapped.message}"`
    );
    const wrapped2 = wrapCdnImportError("Transformers.js embeddings", "not an Error object");
    ok(
      wrapped2.message.startsWith("Transformers.js embeddings is unavailable") &&
        wrapped2.message.includes("not an Error object"),
      `wrapCdnImportError: handles a non-Error throw: "${wrapped2.message}"`
    );
  }

  // ---- 19. filters reach the chat ----
  log("\n[19] Filters in the chat pane");
  {
    ok(describeFilters({}) === "", "no filter describes as the empty string");
    ok(
      describeFilters({ yearFrom: 2022, yearTo: 2025 }) === "2022–2025",
      `two-sided year range: "${describeFilters({ yearFrom: 2022, yearTo: 2025 })}"`
    );
    ok(describeFilters({ yearFrom: 2022 }) === "2022–", "an open-ended 'from' keeps the dash");
    ok(describeFilters({ yearTo: 2025 }) === "–2025", "an open-ended 'to' keeps the dash");
    ok(describeFilters({ tags: ["endoscopy"] }) === "tag: endoscopy", "one tag is singular");
    ok(
      describeFilters({ tags: ["endoscopy", "stent"], author: "kim" }) ===
        "tags: endoscopy + stent · author: kim",
      `tags (ANDed with +) and author: "${describeFilters({ tags: ["endoscopy", "stent"], author: "kim" })}"`
    );

    // End-to-end: the same question, filtered and not, against a real Orama index.
    const cdocs = chunkReference(
      { citekey: "old2001", title: "Lumbar fusion", year: 2001, tags: [], authors: ["Kim"], body: "Fusion outcomes at ten years." },
      800
    );
    const cstore = new VectorStore();
    cstore.init(dim, providerId);
    await cstore.addChunks(cdocs, await embed(cdocs.map((c) => c.embedText)));
    const { server: cserver, port: cport } = await startMockLLM();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cidx: any = {
        ready: true,
        search: async (q: string, f: SearchFilters = {}) =>
          cstore.search((await embed([q]))[0], q, 20, f),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clib: any = { getItem: () => null };
      const chat = new RagChat(cidx, clib, {
        ...settings,
        llmProvider: "openai" as const,
        llmModel: "mock",
        openaiApiKey: "x",
        openaiBaseUrl: `http://127.0.0.1:${cport}`,
      });
      const open = await chat.answer("fusion outcomes");
      ok(open.sources.length > 0, `unfiltered chat retrieves ${open.sources.length} source(s)`);
      const scoped = await chat.answer("fusion outcomes", [], { yearFrom: 2030 });
      ok(scoped.sources.length === 0, "a yearFrom past every note leaves the answer with no sources");
    } finally {
      cserver.close();
    }
  }

  // ---- 21. Evidence for the paragraph you are writing (pure logic) ----
  log("\n[21] Writing evidence (paragraphs, claim heuristic, hit ranking)");
  {
    const manuscript = [
      "---",
      "title: Draft",
      "---",
      "",
      "# Intro",
      "",
      "Some prose paragraph that cites work properly and runs well beyond eight words [@smith2020].",
      "",
      "This paragraph asserts something substantial about the world without any citation at all.",
      "",
      "```js",
      'const cite = "[@fake]";',
      "```",
      "",
      "Is this a claim that needs a citation for its assertion to hold?",
      "",
      "- alpha",
      "- beta",
      "",
      "## References",
      "",
      "- Smith. A cited work whose entry also runs beyond eight words here.",
    ].join("\n");

    const paras = paragraphsOf(manuscript);
    ok(paras.length === 4, `paragraphsOf: heading/fence/frontmatter/blank skipped → ${paras.length} paragraphs`);
    ok(
      paras.every((p) => manuscript.slice(p.start, p.end) === p.text),
      "paragraphsOf: start/end offsets address the paragraph exactly (insertion point)"
    );
    ok(
      !paras.some((p) => p.text.includes("title: Draft")),
      "paragraphsOf: frontmatter is not a paragraph"
    );
    ok(!paras.some((p) => p.text.includes("fake")), "paragraphsOf: fenced code block is skipped");
    ok(
      !paras.some((p) => p.text.includes("Smith.")),
      "paragraphsOf: nothing below ## References is returned"
    );
    ok(
      paras.filter((p) => p.cited).length === 1 && paras[0].cited,
      "paragraphsOf: only the [@smith2020] paragraph is cited (the fenced [@fake] does not count)"
    );
    ok(
      paras.some((p) => p.text === "- alpha\n- beta"),
      "paragraphsOf: a list block survives as one paragraph"
    );

    ok(
      looksLikeClaim("Regular aspirin use lowers the incidence of colorectal adenoma in older adults."),
      "looksLikeClaim: a long declarative sentence is a claim"
    );
    ok(!looksLikeClaim("Aspirin lowers risk."), "looksLikeClaim: under eight words is not a claim");
    ok(
      !looksLikeClaim("Regular aspirin use lowers the incidence of colorectal adenoma in adults"),
      "looksLikeClaim: no full stop is not a claim"
    );
    ok(
      !looksLikeClaim("Why does this matter? The mechanism is still unclear in every published cohort."),
      "looksLikeClaim: a paragraph that asks a question is not a claim"
    );
    ok(
      !looksLikeClaim("We describe a retrospective cohort of two hundred consecutive patients."),
      "looksLikeClaim: the author's own plan language is not a claim"
    );
    ok(
      !looksLikeClaim("This section explains how the retrieval index is built and then persisted."),
      "looksLikeClaim: signposting is not a claim"
    );
    ok(
      !looksLikeClaim("Figure 2 shows the distribution of scores across the whole evaluation corpus."),
      "looksLikeClaim: a pointer to the author's own exhibit is not a claim"
    );
    ok(
      !looksLikeClaim("In summary, the retrieval index improved precision on every benchmark run."),
      "looksLikeClaim: a hedged wrap-up is not a claim"
    );

    const claims = unsupportedClaims(manuscript);
    ok(
      claims.length === 1 && claims[0].text.startsWith("This paragraph asserts"),
      `unsupportedClaims: exactly the one uncited assertion → ${JSON.stringify(claims.map((c) => c.text.slice(0, 30)))}`
    );

    const hit = (citekey: string, id: string, score: number): SearchHit => ({
      id,
      citekey,
      title: citekey.toUpperCase(),
      section: "abstract",
      year: 2020,
      text: `chunk ${id}`,
      score,
    });
    const hits = [hit("a", "a#1", 0.4), hit("b", "b#1", 0.9), hit("a", "a#2", 0.7), hit("c", "c#1", 0.2)];
    const ranked = rankHits(hits);
    ok(
      ranked.length === 3 && ranked.map((h) => h.citekey).join(",") === "a,b,c",
      `rankHits: one row per citekey, retrieval order kept → ${ranked.map((h) => h.citekey).join(",")}`
    );
    ok(ranked[0].score === 0.7, `rankHits: keeps the best-scoring chunk per reference → ${ranked[0].score}`);
    ok(rankHits(hits, 2).length === 2, "rankHits: caps at max");

    const ins1 = citationInsertion("Outcomes were comparable.", "a");
    const ins2 = citationInsertion("Outcomes were comparable", "a");
    const ins3 = citationInsertion("Outcomes were comparable ", "a");
    ok(
      ins1.back === 1 && ins1.text === " [@a]" && ins2.back === 0 && ins2.text === " [@a]" && ins3.back === 0 && ins3.text === "[@a]",
      `citationInsertion: before the full stop, after a space → ${JSON.stringify([ins1, ins2, ins3])}`
    );
    ok(citationInsertion("", "a").text === "[@a]" && citationInsertion("wait...", "a").back === 0, "citationInsertion: empty prefix and an ellipsis are left alone");

    // Non-prose blocks: a callout, a table row and a comment must never be offered as claims.
    const only = (md: string) => paragraphsOf(md).map((p) => p.text).join(" | ");
    ok(
      only("> [!note] Tip\n> A quoted sentence long enough to read like ordinary prose.") === "",
      `paragraphsOf: a callout/blockquote is not prose → "${only("> [!note] Tip\n> A quoted sentence.")}"`
    );
    ok(
      only("| head | value |\n| --- | --- |\n| alpha | beta |") === "",
      "paragraphsOf: a table is not prose"
    );
    ok(
      only("%%\nA private comment that asserts something about the world.\n%%") === "",
      "paragraphsOf: a %% comment block is skipped"
    );
    ok(
      only("%% inline comment %%\nReal prose that follows the comment.") === "Real prose that follows the comment.",
      "paragraphsOf: a one-line %% comment is skipped, the prose after it is not"
    );
    ok(
      only("<!--\nA hidden editorial note.\n-->\nReal prose that follows the comment.") === "Real prose that follows the comment.",
      "paragraphsOf: an HTML comment block is skipped"
    );

    // Cluster merge: what citationEdit says to insert, applied to the text before the cursor.
    const known = (k: string) => k === "a" || k === "b";
    const apply = (before: string, key: string): string => {
      const e = citationEdit(before, key, known);
      if (!e) return "(already cited)";
      return before.slice(0, before.length - e.back) + e.text + before.slice(before.length - e.back);
    };
    ok(
      apply("Outcomes were comparable [@a].", "b") === "Outcomes were comparable [@a; @b].",
      `citationEdit: merges into the cluster behind terminal punctuation → "${apply("Outcomes were comparable [@a].", "b")}"`
    );
    ok(
      apply("Mail me at [john@x.org]", "b") === "Mail me at [john@x.org] [@b]",
      `citationEdit: [john@x.org] is not a citation cluster → "${apply("Mail me at [john@x.org]", "b")}"`
    );
    ok(apply("Outcomes were comparable [@a]", "a") === "(already cited)", "citationEdit: the key is already in the cluster");
    ok(
      apply("Outcomes were comparable [@zz]", "b") === "Outcomes were comparable [@zz] [@b]",
      "citationEdit: a bracket whose keys are not in the library is not a cluster"
    );
  }

  // ---- 20. Linked-PDF stash (pdfStash + chunk growth) ----
  log("\n[20] Linked-PDF stash");
  {
    const bare = "# Paper\n\n## Notes\n\nA sentence.";
    ok(!hasStashedText(bare), "hasStashedText: a bare note has no stash");
    const once = appendStash(bare, "Full text of the paper.");
    ok(
      hasStashedText(once) && once.includes(STASH_MARKER) && once.includes("Full text of the paper."),
      "appendStash: writes the marker and the text"
    );
    ok(appendStash(once, "OTHER TEXT") === once, "appendStash: idempotent — a second call changes nothing");
    ok(appendStash(bare, "   \n ") === bare, "appendStash: nothing to stash leaves the body alone");
    const cut = appendStash(bare, "x".repeat(500), 100);
    const kept = ((cut.split(STASH_MARKER)[1] ?? "").match(/x/g) || []).length;
    ok(kept === 100 && /…\[truncated\]/.test(cut), `appendStash: trims to maxChars (${kept} kept) and says so`);

    ok(resolvePdfLink("[[a.pdf]]") === "a.pdf", "resolvePdfLink: [[a.pdf]]");
    ok(resolvePdfLink("[[folder/a.pdf|alias]]") === "folder/a.pdf", "resolvePdfLink: strips folder alias");
    ok(resolvePdfLink("a.pdf") === "a.pdf", "resolvePdfLink: a bare path works too");
    ok(resolvePdfLink("[[a.pdf#page=3]]") === "a.pdf", "resolvePdfLink: a #page anchor is not part of the path");
    ok(
      resolvePdfLink("[[folder/a.pdf#page=3|alias]]") === "folder/a.pdf",
      "resolvePdfLink: anchor and alias together"
    );
    ok(resolvePdfLink("[[a.md]]") === null, "resolvePdfLink: a non-PDF link is not a PDF");
    ok(resolvePdfLink(undefined) === null, "resolvePdfLink: missing frontmatter → null");

    // A linked PDF's text must actually reach the index: extract it the way the command does
    // (pdfjs behind the injectable loader), stash it, and re-chunk the note.
    setPdfjsLoader(async () => ({
      GlobalWorkerOptions: { workerSrc: "" },
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 19,
          getPage: async (p: number) => ({
            getTextContent: async () => ({
              items: [{ str: `Page ${p}. ` + "clinical outcome after endoscopic decompression. ".repeat(40) }],
            }),
          }),
        }),
      }),
    }));
    const doc = await extractPdfText(new ArrayBuffer(8));
    const input = { citekey: "k", title: "T", year: 2020, tags: [] as string[], abstract: "A short abstract." };
    const before = chunkReference({ ...input, body: bare }, 800);
    const after = chunkReference({ ...input, body: appendStash(bare, doc.text) }, 800);
    ok(
      doc.pages === 19 && after.length > before.length,
      `stashed full text chunks into more pieces: ${before.length} → ${after.length} (${doc.pages}p)`
    );

    // The "nothing extractable" check lives in extractPdfText itself, so every caller gets it.
    setPdfjsLoader(async () => ({
      GlobalWorkerOptions: { workerSrc: "" },
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({ getTextContent: async () => ({ items: [] }) }),
        }),
      }),
    }));
    let scanned = "";
    try {
      await extractPdfText(new ArrayBuffer(8));
    } catch (e) {
      scanned = e instanceof Error ? e.message : String(e);
    }
    ok(/no extractable text/i.test(scanned), `extractPdfText: an image-only PDF throws for every caller → "${scanned}"`);
  }

  log("\nDONE.");

  // ---- 22. Retrieval diversity cap + LLM rerank parsing ----
  log("\n[22] Retrieval cap & rerank");
  {
    const hit = (citekey: string, id: number, score: number) =>
      ({ id: `${citekey}#${id}`, citekey, title: citekey, section: "abstract", year: 2024, text: `t${id}`, score }) as any;
    // One paper with a stashed full text produces many chunks; it used to take every slot.
    const greedy = [
      hit("a", 0, 9), hit("a", 1, 8), hit("a", 2, 7), hit("a", 3, 6), hit("a", 4, 5),
      hit("b", 0, 4), hit("c", 0, 3), hit("d", 0, 2),
    ];
    const capped = capPerReference(greedy, 5, 3);
    ok(capped.length === 5, `cap returns k hits: ${capped.length}`);
    ok(capped.filter((h) => h.citekey === "a").length === 3, "cap keeps at most 3 chunks per reference");
    ok(new Set(capped.map((h) => h.citekey)).size === 3, "cap spreads 5 slots over 3 papers (uncapped: 1)");
    ok(capped[0].id === "a#0", "cap preserves score order among what it keeps");

    // A question only two papers can answer must still return k passages.
    const narrow = [hit("a", 0, 9), hit("a", 1, 8), hit("a", 2, 7), hit("a", 3, 6), hit("b", 0, 5)];
    const topped = capPerReference(narrow, 5, 3);
    ok(topped.length === 5, "cap tops back up from the spill when diversity runs out");
    ok(topped[4].citekey === "a" && topped[4].id === "a#3", "topped-up hit is the best of the spill");

    ok(capPerReference([], 5, 3).length === 0, "cap on an empty result set");

    // Rerank replies are model output: tolerate prose, repeats, and out-of-range numbers.
    ok(parseRerankOrder("[3,1,2]", 3).join() === "2,0,1", "rerank order: clean JSON array");
    ok(parseRerankOrder("Sure! Here you go: [2, 1]", 3).join() === "1,0,2", "rerank order: prose around the array, missing index appended");
    ok(parseRerankOrder("[2,2,9,1]", 3).join() === "1,0,2", "rerank order: repeats and out-of-range dropped");
    ok(parseRerankOrder("no numbers at all", 3).join() === "0,1,2", "rerank order: unusable reply keeps retrieval order");
    ok(parseRerankOrder("[3,2,1]", 3).length === 3, "rerank order returns every index exactly once");

    const longHit = hit("x", 0, 1);
    longHit.text = "y".repeat(900);
    const prompt = buildRerankUser("does it work?", [longHit]);
    ok(prompt.includes("[1] (x, 2024)"), "rerank prompt numbers each passage with its title/year");
    ok(prompt.includes("…") && prompt.length < 700, `rerank prompt truncates long passages: ${prompt.length} chars`);
  }
}

main().catch((e) => {
  console.error("\nTEST ERROR:", e);
  process.exit(1);
});
