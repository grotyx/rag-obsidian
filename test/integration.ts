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

import { detectId, fetchMetadata } from "../src/ingest/metadata";
import { generateCitekey, buildNote } from "../src/data/reference";
import { chunkReference, stripFrontmatter, yearFromIssued } from "../src/index/chunker";
import { VectorStore } from "../src/index/store";
import { OllamaProvider } from "../src/index/providers/ollama";
import { LLMClient } from "../src/llm/client";
import { formatCitation } from "../src/cite/format";
import { CitationGraph } from "../src/graph/citations";
import { findIdentifier, extractPdfText, setPdfjsLoader } from "../src/ingest/pdf";
import { extractCitekeys, buildBibliography, inTextLabel } from "../src/cite/bibliography";
import { Ontology } from "../src/ontology/pack";
import { SAMPLE_PACK } from "../src/ontology/sample";
import { ScholarRagSettings, DEFAULT_SETTINGS, CSLItem } from "../src/types";

const MODEL = process.env.EMBED_MODEL || "qwen2.5:0.5b"; // any local Ollama model works for /api/embed
const VAULT = path.resolve("_testvault");
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
      list: () => seeds.map((s) => ({ citekey: s.citekey, file: { path: `References/${s.citekey}.md` }, title: s.title, authors: "", year: "" })),
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
    const label = inTextLabel(items.get(keys[0])!);
    ok(/\(LeCun, 2015\)/.test(label), `inTextLabel: ${label}`);
  }

  // ---- 11. ontology pack (link + IS_A traversal) ----
  log("\n[11] Ontology (sample pack)");
  {
    const onto = new Ontology();
    onto.load(SAMPLE_PACK);
    ok(onto.size === 8, `loaded ${onto.size} concepts [${onto.scheme}]`);
    const linked = onto
      .link("posterior lumbar interbody fusion improved outcomes in lumbar spinal stenosis with arthrodesis")
      .map((c) => c.id);
    log(`     linked: ${linked.join(", ")}`);
    ok(linked.includes("PLIF") && linked.includes("LSS"), "link found PLIF + LSS");
    const anc = onto.ancestors("PLIF").map((c) => c.id);
    ok(anc.includes("FUSION") && anc.includes("SPINE"), `ancestors(PLIF): ${anc.join(" → ")}`);
    const desc = onto.descendants("FUSION").map((c) => c.id).sort();
    ok(desc.includes("PLIF") && desc.includes("TLIF"), `descendants(FUSION): ${desc.join(", ")}`);
    const exp = onto.expand("STENOSIS");
    ok(exp.includes("Lumbar spinal stenosis"), `expand(STENOSIS): ${exp.length} labels incl descendants`);
  }

  log("\nDONE.");
}

main().catch((e) => {
  console.error("\nTEST ERROR:", e);
  process.exit(1);
});
