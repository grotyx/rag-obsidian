import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import * as yaml from "js-yaml";
import { handleProtocol, McpTool } from "../src/mcp/protocol";
import { bridgeSource } from "../src/mcp/bridge";
import { contentHash, McpVault, validateMarkdownPath } from "../src/mcp/vault";
import { McpService, MCP_TOOLS, mcpToolsFor } from "../src/mcp/service";
import { compileMcpManuscript, renderCompiledManuscript } from "../src/write/manuscript";
import { assertVaultPath, loadDesktopNode, mcpSetupSnippets, McpHttpServer } from "../src/mcp/http";
import { DEFAULT_SETTINGS } from "../src/types";
import { CiteEngine } from "../src/cite/csl";

async function protocolChecks(): Promise<void> {
  const tools: McpTool[] = [{
    name: "echo",
    description: "Return text.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
  }];
  const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => ({ name, ...args });

  const init = await handleProtocol(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    tools,
    call
  );
  assert.equal(init?.result?.protocolVersion, "2025-06-18");
  assert.equal((init?.result?.serverInfo as Record<string, unknown>).name, "rag-obsidian");
  assert.match(String(init?.result?.instructions), /get_reference_source.*save_reference_summary/);
  const defaultInit = await handleProtocol({ jsonrpc: "2.0", id: 10, method: "initialize" }, tools, call);
  assert.equal(defaultInit?.result?.protocolVersion, "2025-11-25");
  assert.equal((defaultInit?.result?.serverInfo as Record<string, unknown>).version, "0.6.0");
  const modernInit = await handleProtocol(
    { jsonrpc: "2.0", id: 11, method: "initialize", params: { protocolVersion: "2026-07-28" } }, tools, call
  );
  assert.equal(modernInit?.result?.protocolVersion, "2025-11-25");
  const discover = await handleProtocol({ jsonrpc: "2.0", id: 12, method: "server/discover" }, tools, call);
  assert.equal(discover?.error?.code, -32601);

  const listed = await handleProtocol({ jsonrpc: "2.0", id: 2, method: "tools/list" }, tools, call);
  assert.deepEqual((listed?.result?.tools as McpTool[]).map((t) => t.name), ["echo"]);

  const called = await handleProtocol({
    jsonrpc: "2.0",
    id: "call-1",
    method: "tools/call",
    params: { name: "echo", arguments: { text: "hello" } },
  }, tools, call);
  assert.deepEqual(called?.result?.structuredContent, { name: "echo", text: "hello" });
  assert.equal(JSON.parse(String((called?.result?.content as Array<Record<string, unknown>>)[0].text)).text, "hello");

  const ping = await handleProtocol({ jsonrpc: "2.0", id: 3, method: "ping" }, tools, call);
  assert.deepEqual(ping?.result, {});

  const missing = await handleProtocol({ jsonrpc: "2.0", id: 4, method: "missing" }, tools, call);
  assert.equal(missing?.error?.code, -32601);

  const invalid = await handleProtocol({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { arguments: {} },
  }, tools, call);
  assert.equal(invalid?.error?.code, -32602);

  const failed = await handleProtocol({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "echo", arguments: {} },
  }, tools, async () => { throw new Error("broken"); });
  assert.equal(failed?.result?.isError, true);
  assert.match(String((failed?.result?.content as Array<Record<string, unknown>>)[0].text), /broken/);

  assert.equal(await handleProtocol({ jsonrpc: "2.0", method: "notifications/initialized" }, tools, call), null);
}

function bridgeChecks(): void {
  const source = bridgeSource();
  assert.match(source, /--vault/);
  assert.match(source, /127\.0\.0\.1/);
  assert.doesNotThrow(() => new vm.Script(source, { filename: "mcp-bridge.cjs" }));
}

function distributionSecurityChecks(): void {
  const source = [
    "src/ingest/pdf.ts",
    "src/index/providers/transformers.ts",
  ].filter(fs.existsSync).map((file) => fs.readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(source, /new Function\s*\(/, "plugin code must not evaluate downloaded modules");
  assert.doesNotMatch(source, /https:\/\/(?:cdn\.jsdelivr\.net|esm\.sh)/, "runtime dependencies must be bundled");
}

interface FakeFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  stat: { mtime: number; size: number };
}

function fakeApp(initial: Record<string, string> = {}): {
  app: any;
  files: Map<string, { file: FakeFile; content: string }>;
  trashed: string[];
} {
  const files = new Map<string, { file: FakeFile; content: string }>();
  const folders = new Set<string>();
  const trashed: string[] = [];
  const put = (path: string, content: string): FakeFile => {
    const name = path.split("/").pop() as string;
    const file = {
      path,
      name,
      basename: name.replace(/\.md$/i, ""),
      extension: "md",
      stat: { mtime: Date.now(), size: content.length },
    };
    files.set(path, { file, content });
    return file;
  };
  for (const [path, content] of Object.entries(initial)) put(path, content);
  const app = {
    vault: {
      getMarkdownFiles: () => [...files.values()].map((x) => x.file),
      getAbstractFileByPath: (path: string) => files.get(path)?.file ?? (folders.has(path) ? { path } : null),
      read: async (file: FakeFile) => files.get(file.path)?.content ?? "",
      create: async (path: string, content: string) => put(path, content),
      modify: async (file: FakeFile, content: string) => { put(file.path, content); },
      createFolder: async (path: string) => { folders.add(path); },
    },
    fileManager: {
      renameFile: async (file: FakeFile, newPath: string) => {
        const content = files.get(file.path)?.content ?? "";
        files.delete(file.path);
        put(newPath, content);
      },
      trashFile: async (file: FakeFile) => {
        trashed.push(file.path);
        files.delete(file.path);
      },
      // Mirrors the real Obsidian API: parse frontmatter into an object, let the caller mutate
      // it in place, then write the note back with the updated YAML.
      processFrontMatter: async (file: FakeFile, fn: (fm: Record<string, unknown>) => void) => {
        const entry = files.get(file.path);
        if (!entry) throw new Error(`NOT_FOUND: ${file.path}`);
        const match = entry.content.match(/^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/);
        const fm = (match ? yaml.load(match[1]) : {}) as Record<string, unknown> ?? {};
        fn(fm);
        const body = match ? entry.content.slice(match[0].length) : "\n" + entry.content;
        put(file.path, `---\n${yaml.dump(fm, { lineWidth: -1 }).trimEnd()}\n---${body}`);
      },
    },
  };
  return { app, files, trashed };
}

async function vaultChecks(): Promise<void> {
  for (const bad of [
    "/tmp/x.md", "../x.md", "a/../x.md", ".obsidian/data.md", ".OBSIDIAN/x.md",
    "PDFs/a.pdf", "C:\\x.md", "%2e%2e/x.md", "",
  ]) assert.throws(() => validateMarkdownPath(bad), undefined, bad);
  assert.equal(validateMarkdownPath("Manuscripts//paper.md"), "Manuscripts/paper.md");
  assert.equal(await contentHash("same"), await contentHash("same"));
  assert.notEqual(await contentHash("same"), await contentHash("different"));

  const fake = fakeApp({
    "Notes/a.md": "alpha beta alpha",
    "References/ref.md": "reference",
  });
  const vault = new McpVault(fake.app, (path) => path.startsWith("References/"));
  const page = await vault.readNote("Notes/a.md", 6, 4);
  assert.deepEqual({ content: page.content, nextOffset: page.nextOffset, totalChars: page.totalChars }, {
    content: "beta", nextOffset: 10, totalChars: 16,
  });
  assert.equal((await vault.listNotes("Notes", 10)).notes[0].path, "Notes/a.md");

  const created = await vault.createNote("Drafts/new.md", "draft");
  assert.equal(created.path, "Drafts/new.md");
  assert.equal(created.indexQueued, false);
  await assert.rejects(() => vault.createNote("Drafts/new.md", "overwrite"), /already exists/i);

  const read = await vault.readNote("Notes/a.md");
  await assert.rejects(() => vault.updateNote("Notes/a.md", "changed", "stale"), /CONTENT_CHANGED/);
  const updated = await vault.updateNote("Notes/a.md", "changed", read.hash);
  assert.equal(fake.files.get("Notes/a.md")?.content, "changed");
  assert.equal(updated.hash, await contentHash("changed"));

  const current = await vault.readNote("Notes/a.md");
  await assert.rejects(() => vault.replaceInNote("Notes/a.md", "missing", "x", current.hash), /exactly once/i);
  await vault.updateNote("Notes/a.md", "same same", current.hash);
  const repeated = await vault.readNote("Notes/a.md");
  await assert.rejects(() => vault.replaceInNote("Notes/a.md", "same", "x", repeated.hash), /exactly once/i);
  await vault.updateNote("Notes/a.md", "aaa", repeated.hash);
  const overlapping = await vault.readNote("Notes/a.md");
  await assert.rejects(() => vault.replaceInNote("Notes/a.md", "aa", "x", overlapping.hash), /exactly once/i);
  await vault.updateNote("Notes/a.md", "same same", overlapping.hash);
  const exact = await vault.readNote("Notes/a.md");
  await vault.replaceInNote("Notes/a.md", "same same", "done", exact.hash);
  assert.equal(fake.files.get("Notes/a.md")?.content, "done");

  const beforeMove = await vault.readNote("Notes/a.md");
  await assert.rejects(() => vault.moveNote("Notes/a.md", "References/ref.md", beforeMove.hash), /already exists/i);
  const moved = await vault.moveNote("Notes/a.md", "Archive/a.md", beforeMove.hash);
  assert.equal(moved.path, "Archive/a.md");

  await assert.rejects(() => vault.trashNote("Archive/a.md", "stale"), /CONTENT_CHANGED/);
  const beforeTrash = await vault.readNote("Archive/a.md");
  await vault.trashNote("Archive/a.md", beforeTrash.hash);
  assert.deepEqual(fake.trashed, ["Archive/a.md"]);

  const customConfig = fakeApp({ ".settings/private.md": "secret" });
  const guarded = new McpVault(customConfig.app, () => false, ".settings");
  await assert.rejects(() => guarded.readNote(".settings/private.md"), /private configuration/i);

  const guardCalls: Array<[string, boolean]> = [];
  const pathGuarded = new McpVault(fake.app, () => false, ".obsidian", async (path, allowMissing) => {
    guardCalls.push([path, allowMissing]);
    if (path === "References/ref.md") throw new Error("outside vault");
  });
  await pathGuarded.readNote("Drafts/new.md");
  await assert.rejects(() => pathGuarded.readNote("References/ref.md"), /outside vault/);
  assert.deepEqual((await pathGuarded.listNotes()).notes.map((note) => note.path), ["Drafts/new.md"]);
  await pathGuarded.createNote("Drafts/guarded.md", "ok");
  assert.deepEqual(guardCalls, [
    ["Drafts/new.md", false], ["References/ref.md", false], ["Drafts/new.md", false],
    ["References/ref.md", false], ["Drafts/guarded.md", true],
  ]);
}

async function serviceChecks(): Promise<void> {
  assert.doesNotMatch(
    fs.readFileSync(path.join(process.cwd(), "src/mcp/service.ts"), "utf8"),
    /from ["'][^"']*(?:llm\/|ingest\/summarize)/,
  );
  assert.deepEqual(MCP_TOOLS.map((t) => t.name), [
    "library_status", "search_library", "rebuild_search_index", "list_references",
    "get_reference", "get_reference_source", "save_reference_summary", "list_tags", "search_pubmed", "add_reference", "list_notes",
    "read_note", "create_note", "update_note", "replace_in_note", "move_note",
    "trash_note", "compile_manuscript", "set_reference_fields",
  ]);
  assert.equal(MCP_TOOLS.find((t) => t.name === "search_library")?.annotations?.readOnlyHint, true);
  assert.equal(MCP_TOOLS.find((t) => t.name === "trash_note")?.annotations?.destructiveHint, true);
  const libraryOnly = mcpToolsFor(false).map((t) => t.name);
  assert.equal(libraryOnly.length, 12, "note tools off leaves the 12 library tools");
  for (const hidden of ["list_notes", "read_note", "create_note", "update_note", "replace_in_note", "move_note", "trash_note"]) {
    assert.ok(!libraryOnly.includes(hidden), `${hidden} hidden when note tools are off`);
  }
  assert.equal(mcpToolsFor(true), MCP_TOOLS);

  const fake = fakeApp({
    "References/ref.md": "---\ncitekey: smith2024\ntitle: Trial\n---\n\n## Summary\n\nUseful.\n\n##\tNotes\n\n##\tHighlights\n\n## Full text (extracted)\n\nvery long",
  });
  const item = {
    type: "article-journal", title: "Trial", citekey: "smith2024", status: "read",
    tags: ["Spine", "Outcome"], PMID: "123", issued: { "date-parts": [[2024]] },
  };
  let searchArgs: unknown[] = [];
  let rebuilt = 0;
  let created = false;
  const file = fake.files.get("References/ref.md")?.file;
  const plugin: any = {
    manifest: { version: "0.5.0" },
    app: {
      ...fake.app,
      vault: { ...fake.app.vault, getName: () => "Research" },
    },
    settings: {
      referencesFolder: "References", topK: 20, pubmedApiKey: "", openalexMailto: "",
    },
    indexManager: {
      ready: true,
      count: 10,
      indexedModelId: "test:embed",
      search: async (...args: unknown[]) => {
        searchArgs = args;
        return [{ id: "smith2024#0", citekey: "smith2024", title: "Trial", section: "abstract", year: 2024, text: "evidence", score: 0.9 }];
      },
      rebuild: async () => { rebuilt++; return 11; },
    },
    library: {
      folder: () => "References",
      entries: () => [{ citekey: "smith2024", item, file, year: "2024", authors: "Smith", title: "Trial" }],
      getFile: (citekey: string) => citekey === "smith2024" ? file : null,
      getItem: (citekey: string) => citekey === "smith2024" ? item : null,
      findDuplicate: (candidate: Record<string, unknown>) => candidate.PMID === "123" ? "smith2024" : null,
      createReference: async () => { created = true; return { path: "References/new.md" }; },
    },
  };
  const vault = new McpVault(plugin.app, (path) => path.startsWith("References/"));
  const service = new McpService(plugin, vault, {
    vaultPath: "/vault/Research",
    searchPubmed: async () => ({ hits: [{ pmid: "123", pmc: "", item }], total: 1 }),
    fetchMetadata: async () => ({ type: "article-journal", title: "New", PMID: "999" }),
    fetchPubmedRecord: async () => ({ abstract: "PubMed abstract", descriptors: [], keywords: [], pmc: "PMC123" }),
    fetchPmcFullText: async () => "Complete article body with quantitative results.",
  });

  assert.deepEqual(await service.callTool("library_status", {}), {
    pluginVersion: "0.5.0", vaultName: "Research", referenceFolder: "References",
    vaultPath: "/vault/Research", indexReady: true, chunkCount: 10, embeddingModel: "test:embed",
  });
  const search = await service.callTool("search_library", {
    query: "question", limit: 4, year_from: 2020, tags: ["Spine"],
  }) as any;
  assert.equal(search.results[0].citekey, "smith2024");
  assert.equal(search.results[0].path, "References/ref.md");
  assert.deepEqual(searchArgs, ["question", { yearFrom: 2020, tags: ["Spine"] }, 4]);
  assert.deepEqual(await service.callTool("rebuild_search_index", {}), { chunkCount: 11 });
  assert.equal(rebuilt, 1);

  const refs = await service.callTool("list_references", { tags: ["Spine"] }) as any;
  assert.equal(refs.references[0].citekey, "smith2024");
  assert.equal(refs.references[0].summarySource, null);
  const ref = await service.callTool("get_reference", { citekey: "smith2024" }) as any;
  assert.equal(ref.fullTextOmitted, true);
  assert.doesNotMatch(ref.content, /very long/);
  const source = await service.callTool("get_reference_source", { citekey: "smith2024" }) as any;
  assert.equal(source.sourceType, "pmc-fulltext");
  assert.match(source.sourceLabel, /PMC123/);
  assert.match(source.sourceText, /Complete article body/);
  assert.equal(source.hash, ref.hash);
  const saved = await service.callTool("save_reference_summary", {
    citekey: "smith2024",
    expected_hash: source.hash,
    source_type: source.sourceType,
    summary_model: "claude-code",
    background: "Background.",
    methods: "Methods.",
    results: "Results.",
    conclusions: "Conclusions.",
    korean: "한국어 요약.",
  }) as any;
  const summarized = fake.files.get("References/ref.md")?.content ?? "";
  assert.equal(saved.summarySource, "pmc-fulltext");
  assert.match(summarized, /^summary_source: pmc-fulltext$/m);
  assert.match(summarized, /^summary_model: claude-code$/m);
  assert.match(summarized, /\*\*Results\*\*\nResults\./);
  assert.match(summarized, /\*\*한국어 요약 \(KR\)\*\*\n한국어 요약\./);
  assert.match(summarized, /##\tNotes\n\n##\tHighlights/);
  assert.doesNotMatch(summarized, /Useful\./);
  await assert.rejects(() => service.callTool("save_reference_summary", {
    citekey: "smith2024", expected_hash: source.hash, source_type: "pmc-fulltext",
    background: "B", methods: "M", results: "R", conclusions: "C",
  }), /CONTENT_CHANGED/);
  const storedReference = fake.files.get("References/ref.md");
  if (storedReference) storedReference.content = "x".repeat(60_000);
  const truncatedRef = await service.callTool("get_reference", { citekey: "smith2024" }) as any;
  assert.equal(truncatedRef.content.length, 50_000);
  assert.equal(truncatedRef.contentTruncated, true);
  const tags = await service.callTool("list_tags", {}) as any;
  assert.deepEqual(tags.tags, [{ tag: "Outcome", count: 1 }, { tag: "Spine", count: 1 }]);

  const pubmed = await service.callTool("search_pubmed", { query: "trial" }) as any;
  assert.equal(pubmed.results[0].existingCitekey, "smith2024");
  assert.equal(pubmed.totalCount, 1);
  assert.equal(pubmed.truncated, false);

  await assert.rejects(() => service.callTool("search_pubmed", { query: "trial", limit: 151 }), /INVALID_ARGUMENT/);
  let cappedAt = 0;
  const noNotes = new McpService({ ...plugin, settings: { ...plugin.settings, mcpNoteTools: false } } as never, vault);
  await assert.rejects(noNotes.callTool("list_notes", {}), /UNKNOWN_TOOL/, "a hidden note tool is refused even if called directly");
  const cap150 = await new McpService(plugin, vault, {
    searchPubmed: async (_q: string, opts: { n?: number }) => { cappedAt = opts.n ?? 0; return { hits: [], total: 0 }; },
  }).callTool("search_pubmed", { query: "trial", limit: 150 }) as any;
  assert.equal(cappedAt, 150, "limit 150 is accepted and passed through");
  assert.deepEqual(cap150, { results: [], totalCount: 0, truncated: false });

  const truncatedService = new McpService(plugin, vault, {
    searchPubmed: async () => ({ hits: [{ pmid: "1", pmc: "", item }, { pmid: "2", pmc: "", item }], total: 500 }),
  });
  const truncated = await truncatedService.callTool("search_pubmed", { query: "trial", limit: 2 }) as any;
  assert.equal(truncated.results.length, 2);
  assert.equal(truncated.totalCount, 500);
  assert.equal(truncated.truncated, true, "totalCount above the returned page means truncated");

  await assert.rejects(() => service.callTool("add_reference", { identifier: "123" }), /explicit PMID/i);
  await assert.rejects(() => service.callTool("add_reference", { identifier: "a title" }), /explicit identifier/i);
  const added = await service.callTool("add_reference", { identifier: "PMID:999" }) as any;
  assert.equal(added.status, "created");
  assert.deepEqual(added.tagsAdded, []);
  assert.deepEqual(added.nextAction, {
    tool: "get_reference_source",
    arguments: { citekey: added.citekey },
    then: "Generate a source-grounded summary and call save_reference_summary with the returned hash and sourceType.",
  });
  assert.equal(created, true);

  await assert.rejects(
    () => service.callTool("add_reference", { identifier: "PMID:999", tags: ["ok", 5] }),
    /INVALID_ARGUMENT/,
    "a non-string tag is rejected"
  );

  const abstractService = new McpService(plugin, vault, {
    fetchPubmedRecord: async () => ({ abstract: "API abstract", descriptors: [], keywords: [], pmc: "PMC123" }),
    fetchPmcFullText: async () => "",
  });
  const abstractSource = await abstractService.callTool("get_reference_source", { citekey: "smith2024" }) as any;
  assert.equal(abstractSource.sourceType, "pubmed-abstract");
  assert.equal(abstractSource.sourceText, "API abstract");

  const storedPlugin = {
    ...plugin,
    library: {
      ...plugin.library,
      getItem: () => ({ type: "article-journal", title: "DOI paper", DOI: "10.1/example", abstract: "Crossref abstract" }),
    },
  };
  const storedSource = await new McpService(storedPlugin, vault).callTool("get_reference_source", { citekey: "smith2024" }) as any;
  assert.equal(storedSource.sourceType, "stored-abstract");
  assert.equal(storedSource.sourceText, "Crossref abstract");

  // A substantial linked-PDF stash (>= 2,000 chars) wins over PMC/PubMed, and skips both fetches.
  let pmcCalls = 0;
  const countingDeps = {
    fetchPubmedRecord: async () => { pmcCalls++; return { abstract: "", descriptors: [], keywords: [], pmc: "PMC999" }; },
    fetchPmcFullText: async () => { pmcCalls++; return "Fallback PMC body."; },
  };
  const refEntry = fake.files.get("References/ref.md");
  if (!refEntry) throw new Error("test fixture missing References/ref.md");
  const pdfStashText = "Extracted PDF sentence. ".repeat(100).trim(); // ~2,500 chars
  refEntry.content = `---\ncitekey: smith2024\ntitle: Trial\n---\n\n## Summary\n\nOld.\n\n##\tNotes\n\n##\tHighlights\n\n## Full text (extracted)\n\n${pdfStashText}`;
  const pdfService = new McpService(plugin, vault, countingDeps);
  const pdfSource = await pdfService.callTool("get_reference_source", { citekey: "smith2024" }) as any;
  assert.equal(pdfSource.sourceType, "pdf-fulltext");
  assert.match(pdfSource.sourceLabel, /Linked PDF/);
  assert.equal(pdfSource.sourceText, pdfStashText);
  assert.equal(pmcCalls, 0, "a substantial PDF stash must skip fetchPubmedRecord/fetchPmcFullText entirely");

  // save_reference_summary accepts source_type "pdf-fulltext" and records it in frontmatter
  // (must run before the content below changes, so pdfSource.hash still matches).
  const pdfSaved = await pdfService.callTool("save_reference_summary", {
    citekey: "smith2024", expected_hash: pdfSource.hash, source_type: "pdf-fulltext",
    background: "B.", methods: "M.", results: "R.", conclusions: "C.",
  }) as any;
  assert.equal(pdfSaved.summarySource, "pdf-fulltext");
  assert.match(fake.files.get("References/ref.md")?.content ?? "", /^summary_source: pdf-fulltext$/m);

  // A short stash (< 2,000 chars) is not substantial: falls back to the PMC/PubMed path.
  // (updateNote/save above replaced the map entry, so re-fetch it before mutating.)
  const refEntryAfterSave = fake.files.get("References/ref.md");
  if (!refEntryAfterSave) throw new Error("test fixture missing References/ref.md");
  refEntryAfterSave.content = `---\ncitekey: smith2024\ntitle: Trial\n---\n\n## Full text (extracted)\n\ntoo short`;
  const shortStashSource = await pdfService.callTool("get_reference_source", { citekey: "smith2024" }) as any;
  assert.equal(shortStashSource.sourceType, "pmc-fulltext");
  assert.equal(shortStashSource.sourceText, "Fallback PMC body.");
  assert.equal(pmcCalls, 2, "a short stash falls back to fetchPubmedRecord + fetchPmcFullText");

  const blank = await service.callTool("create_note", { path: "Blank.md", content: "" }) as any;
  assert.equal(blank.path, "Blank.md");

  await assert.rejects(() => service.callTool("search_library", { query: "q", typo: 1 }), /Unknown argument/);
  await assert.rejects(() => service.callTool("not_a_tool", {}), /Unknown tool/);

  const blockedVault = new McpVault(plugin.app, () => true, ".obsidian", async (path) => {
    if (path.startsWith("References/")) throw new Error("outside vault");
  });
  const blocked = new McpService(plugin, blockedVault, {
    searchPubmed: async () => ({ hits: [], total: 0 }),
    fetchMetadata: async () => ({ type: "article-journal", title: "Blocked", PMID: "999" }),
  });
  const safeSearch = await blocked.callTool("search_library", { query: "q" }) as any;
  assert.deepEqual(safeSearch.results, []);
  await assert.rejects(() => blocked.callTool("add_reference", { identifier: "PMID:999" }), /outside vault/);
  const blockedDuplicate = new McpService(plugin, blockedVault, {
    fetchMetadata: async () => item,
  });
  await assert.rejects(() => blockedDuplicate.callTool("add_reference", { identifier: "PMID:123" }), /outside vault/);

  let concurrentCreates = 0;
  let concurrentExists = false;
  const concurrentFile = { ...file, path: "References/concurrent.md", basename: "concurrent" };
  const concurrentPlugin: any = {
    ...plugin,
    library: {
      ...plugin.library,
      findDuplicate: (candidate: Record<string, unknown>) => candidate.PMID === "777" && concurrentExists ? "concurrent" : null,
      getFile: (citekey: string) => citekey === "concurrent" ? concurrentFile : null,
      createReference: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        concurrentCreates++;
        concurrentExists = true;
        return concurrentFile;
      },
    },
  };
  const concurrentService = new McpService(concurrentPlugin, vault, {
    fetchMetadata: async () => ({ type: "article-journal", title: "Concurrent", PMID: "777" }),
  });
  const concurrent = await Promise.all([
    concurrentService.callTool("add_reference", { identifier: "PMID:777" }),
    concurrentService.callTool("add_reference", { identifier: "PMID:777" }),
  ]) as any[];
  assert.equal(concurrentCreates, 1);
  assert.deepEqual(concurrent.map((result) => result.status).sort(), ["created", "existing"]);
}

/** add_reference's optional `tags`: normalized on create, and merged onto an already-imported
 *  duplicate's frontmatter without duplicating tags it already carries (the PubMed import
 *  workflow re-runs overlapping date ranges, so a re-add must stay idempotent). */
async function addReferenceTagsChecks(): Promise<void> {
  const fake = fakeApp({
    "References/dup.md": "---\ncitekey: dup2024\ntitle: Existing\ntags:\n  - spine\n---\n\nBody\n",
  });
  const file = fake.files.get("References/dup.md")?.file;
  let createOpts: unknown = null;
  const plugin: any = {
    manifest: { version: "0.6.6" },
    app: fake.app,
    settings: { referencesFolder: "References", pubmedApiKey: "", openalexMailto: "" },
    indexManager: { ready: false, count: 0, indexedModelId: null, search: async () => [], rebuild: async () => 0 },
    library: {
      folder: () => "References",
      entries: () => [],
      getFile: (citekey: string) => citekey === "dup2024" ? file : null,
      getItem: () => null,
      findDuplicate: (candidate: Record<string, unknown>) => candidate.PMID === "555" ? "dup2024" : null,
      createReference: async (_item: unknown, opts?: unknown) => { createOpts = opts; return file; },
    },
  };
  const vault = new McpVault(plugin.app, (path: string) => path.startsWith("References/"));

  const create = new McpService(plugin, vault, {
    fetchMetadata: async () => ({ type: "article-journal", title: "New", PMID: "111" }),
  });
  const created = await create.callTool("add_reference", { identifier: "PMID:111", tags: ["Spine", "New Finding"] }) as any;
  assert.equal(created.status, "created");
  assert.deepEqual(created.tagsAdded, ["spine", "new-finding"]);
  assert.deepEqual(createOpts, { tags: ["spine", "new-finding"] }, "normalized tags reach createReference's opts");

  const dup = new McpService(plugin, vault, {
    fetchMetadata: async () => ({ type: "article-journal", title: "Dup", PMID: "555" }),
  });
  const merged = await dup.callTool("add_reference", { identifier: "PMID:555", tags: ["Spine", "New Finding"] }) as any;
  assert.equal(merged.status, "existing");
  assert.deepEqual(merged.tagsAdded, ["new-finding"], "the already-present 'spine' tag is not reported as newly added");
  const fm = yaml.load((fake.files.get("References/dup.md")?.content.match(/^---\n([\s\S]*?)\n---/) || ["", ""])[1]) as any;
  assert.deepEqual(fm.tags, ["spine", "new-finding"], "existing tags are preserved, new ones appended once");

  const rerun = await dup.callTool("add_reference", { identifier: "PMID:555", tags: ["Spine"] }) as any;
  assert.equal(rerun.status, "existing");
  assert.deepEqual(rerun.tagsAdded, [], "re-adding a duplicate with an already-present tag adds nothing");
}

/** set_reference_fields: whitelist enforcement, hash guard, field + mirrored-tag writes, and the
 *  include pending -> include transition that must drop the stale 'pending' tag. */
async function screeningFieldChecks(): Promise<void> {
  const fake = fakeApp({
    "References/kq.md": "---\ncitekey: kq2024\ntitle: Trial\ntags:\n  - existing-tag\n---\n\nBody\n",
  });
  const file = fake.files.get("References/kq.md")?.file;
  const item = { type: "article-journal", title: "Trial", citekey: "kq2024", tags: ["existing-tag"] };
  const plugin: any = {
    manifest: { version: "0.6.6" },
    app: fake.app,
    settings: { referencesFolder: "References", pubmedApiKey: "", openalexMailto: "" },
    indexManager: { ready: false, count: 0, indexedModelId: null, search: async () => [], rebuild: async () => 0 },
    library: {
      folder: () => "References",
      entries: () => [{ citekey: "kq2024", item, file, year: "2024", authors: "", title: "Trial" }],
      getFile: (citekey: string) => citekey === "kq2024" ? file : null,
      getItem: (citekey: string) => citekey === "kq2024" ? item : null,
      findDuplicate: () => null,
      createReference: async () => file,
    },
  };
  const vault = new McpVault(plugin.app, (path: string) => path.startsWith("References/"));
  const service = new McpService(plugin, vault);

  await assert.rejects(
    () => service.callTool("set_reference_fields", { citekey: "kq2024", expected_hash: "irrelevant", fields: { bogus: "x" } }),
    /INVALID_ARGUMENT: unknown field: bogus/,
    "an unknown fields key is rejected before anything is written"
  );
  assert.doesNotMatch(fake.files.get("References/kq.md")?.content ?? "", /bogus/);

  const before = await vault.readFullNote("References/kq.md");
  await assert.rejects(
    () => service.callTool("set_reference_fields", { citekey: "kq2024", expected_hash: "stale-hash", fields: { include: "pending" } }),
    /CONTENT_CHANGED/
  );

  const pending = await service.callTool("set_reference_fields", {
    citekey: "kq2024", expected_hash: before.hash,
    fields: { kq: ["1", "3"], include: "pending", level: "2", design: "Randomized controlled trial", screening_note: "looks relevant" },
  }) as any;
  assert.deepEqual(pending.fields.kq, ["1", "3"]);
  assert.equal(pending.fields.include, "pending");
  assert.equal(pending.fields.level, "2");
  assert.equal(pending.fields.design, "Randomized controlled trial");
  assert.equal(pending.fields.screening_note, "looks relevant");
  for (const tag of ["kq-01", "kq-03", "pending", "level-2", "design-randomized-controlled-trial", "existing-tag"]) {
    assert.ok(pending.tags.includes(tag), `missing mirrored tag: ${tag}`);
  }

  const included = await service.callTool("set_reference_fields", {
    citekey: "kq2024", expected_hash: pending.hash, fields: { include: "include" },
  }) as any;
  assert.ok(!included.tags.includes("pending"), "switching include away from pending drops the stale tag");
  assert.ok(included.tags.includes("include"));
  assert.equal(included.fields.include, "include");
  assert.deepEqual(included.fields.kq, ["1", "3"], "fields not touched by this call keep their prior value");
  assert.equal(included.fields.level, "2");

  const retagged = await service.callTool("set_reference_fields", {
    citekey: "kq2024", expected_hash: included.hash,
    fields: { add_tags: ["extra-tag"], remove_tags: ["existing-tag"] },
  }) as any;
  assert.ok(retagged.tags.includes("extra-tag"));
  assert.ok(!retagged.tags.includes("existing-tag"), "remove_tags takes effect");

  const withScreening = { ...item, kq: ["1"], include: "include", level: "2", design: "rct" };
  const screenedService = new McpService(
    { ...plugin, library: { ...plugin.library, entries: () => [{ citekey: "kq2024", item: withScreening, file, year: "2024", authors: "", title: "Trial" }] } },
    vault
  );
  const listed = (await screenedService.callTool("list_references", {}) as any).references[0];
  assert.deepEqual(
    { kq: listed.kq, include: listed.include, level: listed.level, design: listed.design },
    { kq: ["1"], include: "include", level: "2", design: "rct" },
    "list_references surfaces the screening fields"
  );

  const engineFields = (CiteEngine as unknown as { PLUGIN_FIELDS: Set<string> }).PLUGIN_FIELDS;
  for (const key of ["kq", "include", "level", "design", "screening_note"]) {
    assert.ok(engineFields.has(key), `PLUGIN_FIELDS must strip ${key} from citeproc rendering`);
  }
}

async function manuscriptChecks(): Promise<void> {
  const items: Record<string, any> = {
    known: { type: "article-journal", title: "Known", author: [{ family: "Kim" }], issued: { "date-parts": [[2024]] } },
  };
  const source = "Finding [@known] and missing [@unknown]. Code `[@known]`.\n\n## References\n\nold\n";
  const rendered = await renderCompiledManuscript({
    content: source,
    styleId: "test-style",
    citeStyle: "apa",
    getItem: (key) => items[key] ?? null,
    renderStyle: async () => ({ bibliography: ["1. Known citation"], inText: { known: "<i>1</i>" } }),
  });
  assert.match(rendered.content, /Finding 1 and missing \[@unknown\]/);
  assert.match(rendered.content, /Code `\[@known\]`/);
  assert.match(rendered.content, /## References\n\n1\. Known citation/);
  assert.deepEqual(rendered.cited, ["known", "unknown"]);
  assert.deepEqual(rendered.missing, ["unknown"]);

  const fallback = await renderCompiledManuscript({
    content: "Finding [@known].",
    styleId: "broken",
    citeStyle: "apa",
    getItem: (key) => items[key] ?? null,
    renderStyle: async () => { throw new Error("style failed"); },
  });
  assert.doesNotMatch(fallback.content, /\[@known\]/);
  assert.match(fallback.content, /## References/);

  const fake = fakeApp({ "Draft.md": "Finding [@known].", "Manuscripts/Notes.md": "Finding [@known]." });
  const vault = new McpVault(fake.app);
  const plugin: any = {
    app: fake.app,
    settings: { citeStyle: "apa" },
    library: { getItem: (key: string) => items[key] ?? null },
    citeEngine: { renderNote: async () => ({ bibliography: ["Known citation"], inText: { known: "1" } }) },
    styleForNote: () => "style",
  };
  const output = await compileMcpManuscript(plugin, vault, "Draft.md") as any;
  assert.equal(output.path, "Draft (compiled).md");
  assert.match(fake.files.get(output.path)?.content ?? "", /Known citation/);
  await assert.rejects(() => compileMcpManuscript(plugin, vault, "Draft.md"), /expected_output_hash/i);

  // "Manuscripts/Notes.md" and "Manuscripts//Notes.md" are the same file — a lexical
  // `target === path` check misses that. Deliberately NOT "./Draft.md": that variant happens to
  // get rejected downstream anyway (validateMarkdownPath refuses any literal "." path segment as
  // traversal), which would make this test pass whether or not the guard being tested does
  // anything — the double-slash form has no such coincidental protection, so only this guard
  // stands between a client and overwriting the source via output_path.
  await assert.rejects(
    () => compileMcpManuscript(plugin, vault, "Manuscripts/Notes.md", "Manuscripts//Notes.md"),
    /INVALID_PATH/,
    "an output_path that normalizes to the source is rejected, not just an identical string"
  );
}

async function httpChecks(): Promise<void> {
  const desktopNode = loadDesktopNode();
  assert.equal(typeof desktopNode.crypto.randomBytes, "function");
  assert.equal(typeof desktopNode.http.createServer, "function");
  assert.equal(desktopNode instanceof Promise, false);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rag-obsidian-mcp-test-"));
  const vaultPath = path.join(root, "vault");
  const pluginPath = path.join(vaultPath, ".obsidian", "plugins", "rag-obsidian");
  fs.mkdirSync(pluginPath, { recursive: true });
  fs.writeFileSync(path.join(vaultPath, "inside.md"), "inside");
  fs.writeFileSync(path.join(root, "outside.md"), "outside");
  fs.symlinkSync(path.join(root, "outside.md"), path.join(vaultPath, "linked.md"));
  const bridgeTarget = path.join(root, "bridge-target.cjs");
  fs.writeFileSync(bridgeTarget, "do not overwrite");
  fs.symlinkSync(bridgeTarget, path.join(pluginPath, "mcp-bridge.cjs"));
  await assertVaultPath(vaultPath, "inside.md", false);
  await assert.rejects(() => assertVaultPath(vaultPath, "linked.md", false), /outside vault/i);
  await assertVaultPath(vaultPath, "new/future.md", true);
  const setup = mcpSetupSnippets("/Vault With Space", "/Plugin Path/mcp-bridge.cjs");
  assert.match(setup.claudeCode, /'\/Plugin Path\/mcp-bridge\.cjs'/);
  assert.match(setup.codex, /args = \["\/Plugin Path\/mcp-bridge\.cjs", "--vault", "\/Vault With Space"\]/);
  assert.deepEqual((JSON.parse(setup.opencode) as { "rag-obsidian": { command: string[] } })["rag-obsidian"].command, ["node", "/Plugin Path/mcp-bridge.cjs", "--vault", "/Vault With Space"]);
  assert.match(setup.agy, /^agy mcp add rag-obsidian node /);
  assert.match(setup.agy, /'\/Plugin Path\/mcp-bridge\.cjs'/);

  const server = new McpHttpServer({
    vaultPath,
    pluginPath,
    version: "0.5.0",
    tools: [{ name: "echo", description: "Echo.", inputSchema: { type: "object", properties: {} } }],
    callTool: async (_name, args) => args,
  });
  const info = await server.start();
  try {
    assert.equal(info.running, true);
    assert.equal(fs.statSync(info.discoveryPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(info.bridgePath).isFile(), true);
    assert.equal(fs.lstatSync(info.bridgePath).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(bridgeTarget, "utf8"), "do not overwrite");

    const unauthorized = await fetch(`http://127.0.0.1:${info.port}/mcp`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    assert.equal(unauthorized.status, 401);

    // A Bearer value can match the token's *string* length while its UTF-8 byte length differs
    // — crypto.timingSafeEqual throws on a buffer-length mismatch rather than returning false, so
    // comparing string length before it isn't enough. Must still answer 401, not hang. U+00C8 (È)
    // is one UTF-16 unit like any ASCII char, but 2 UTF-8 bytes; kept within the Latin-1 range
    // (≤ U+00FF) so `fetch` accepts it as a header value at all.
    const nonAsciiSameStringLength = "È".repeat(info.token.length);
    assert.equal(nonAsciiSameStringLength.length, info.token.length, "test setup: string lengths match");
    assert.notEqual(
      Buffer.from(nonAsciiSameStringLength).length,
      Buffer.from(info.token).length,
      "test setup: UTF-8 byte lengths differ"
    );
    const nonAsciiAuth = await fetch(`http://127.0.0.1:${info.port}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${nonAsciiSameStringLength}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    assert.equal(nonAsciiAuth.status, 401, "a same-string-length, different-byte-length Bearer value is rejected cleanly, not hung");

    const wrongMethod = await fetch(`http://127.0.0.1:${info.port}/mcp`, {
      headers: { authorization: `Bearer ${info.token}` },
    });
    assert.equal(wrongMethod.status, 405);

    const response = await fetch(`http://127.0.0.1:${info.port}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${info.token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as any).result.tools[0].name, "echo");

    const blockedPath = await fetch(`http://127.0.0.1:${info.port}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${info.token}`, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "read_note", arguments: { path: "linked.md" } } }),
    });
    const blockedResult = await blockedPath.json() as any;
    assert.equal(blockedResult.id, 12);
    assert.equal(blockedResult.result.isError, true);

    const oversized = await fetch(`http://127.0.0.1:${info.port}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${info.token}`, "content-type": "application/json" },
      body: "x".repeat(1_000_001),
    });
    assert.equal(oversized.status, 413);

    const bridged = await new Promise<any>((resolve, reject) => {
      const child = spawn(process.execPath, [info.bridgePath, "--vault", vaultPath], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`bridge timeout: ${stderr}`));
      }, 5_000);
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
        const newline = stdout.indexOf("\n");
        if (newline < 0) return;
        clearTimeout(timer);
        child.kill();
        resolve(JSON.parse(stdout.slice(0, newline)));
      });
      child.stdin.end(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }) + "\n");
    });
    assert.equal(bridged.result.tools[0].name, "echo");
  } finally {
    await server.stop();
    assert.equal(fs.existsSync(info.discoveryPath), false);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * On macOS + a cloud-sync client (OneDrive, Dropbox…), a vault folder with non-ASCII characters
 * can be materialized in decomposed Unicode (NFD) even though the user's own typing/copy-paste
 * of the same path is precomposed (NFC). The plugin (http.ts) and the standalone bridge
 * (bridge.ts) hash the vault path independently to find the same discovery file — if either side
 * skips normalization, a visually identical path hashes two different ways and the bridge reports
 * "Obsidian MCP is unavailable" against a server that is actually running. Reproduces the real
 * failure end to end: the server is started with an NFD vault path (as Obsidian would hand back
 * from such a folder), the bridge is invoked with the NFC form (as a user would type it), and the
 * exchange must still succeed.
 */
/** Spawns the real emitted bridge and round-trips one tools/list call, exactly as
 *  Claude Code / Codex would over stdio. */
function runBridgeTools(bridgePath: string, vaultArg: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bridgePath, "--vault", vaultArg], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`bridge timeout: ${stderr}`)); }, 5_000);
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      const newline = stdout.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timer);
      child.kill();
      resolve(JSON.parse(stdout.slice(0, newline)));
    });
    child.stdin.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) + "\n");
  });
}

async function unicodeVaultPathChecks(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rag-obsidian-mcp-nfd-"));
  const nfdName = "개인".normalize("NFD"); // decomposes into jamo — byte-distinct from the NFC form
  const nfdVault = path.join(root, nfdName);
  fs.mkdirSync(nfdVault, { recursive: true });
  const nfcVault = path.join(root, "개인".normalize("NFC"));
  // Only meaningful on a normalization-insensitive filesystem (APFS default) — elsewhere the two
  // forms are simply different paths and the scenario this guards against cannot occur.
  if (!fs.existsSync(nfcVault)) {
    console.log("  (skipping: filesystem is not Unicode-normalization-insensitive)");
    return;
  }
  const pluginPath = path.join(nfdVault, ".obsidian", "plugins", "academic-paper-citation-manager");
  fs.mkdirSync(pluginPath, { recursive: true });
  const tools = [{ name: "echo", description: "Echo.", inputSchema: { type: "object", properties: {} } }];

  // Direction 1: Obsidian hands back the decomposed (NFD) form — exercises http.ts's normalize.
  const serverA = new McpHttpServer({ vaultPath: nfdVault, pluginPath, version: "0.6.0", tools, callTool: async (_n, a) => a });
  const infoA = await serverA.start();
  try {
    const bridged = await runBridgeTools(infoA.bridgePath, nfcVault);
    assert.equal(bridged.result?.tools?.[0]?.name, "echo", "NFD server path + NFC bridge --vault must still connect (http.ts normalizes)");
  } finally {
    await serverA.stop();
  }

  // Direction 2: the server sees the precomposed (NFC) form but the user's --vault is decomposed
  // (e.g. pasted from a source that already normalizes to NFD) — exercises bridge.ts's normalize.
  const serverB = new McpHttpServer({ vaultPath: nfcVault, pluginPath, version: "0.6.0", tools, callTool: async (_n, a) => a });
  const infoB = await serverB.start();
  try {
    const bridged = await runBridgeTools(infoB.bridgePath, nfdVault);
    assert.equal(bridged.result?.tools?.[0]?.name, "echo", "NFC server path + NFD bridge --vault must still connect (bridge.ts normalizes)");
  } finally {
    await serverB.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * The bridge path is fixed (<pluginPath>/mcp-bridge.cjs) and the discovery path is a predictable
 * hash of the vault path — both live in locations another local process could plant something at
 * before this server ever starts. `start()`'s replace() already refuses to touch a planted
 * directory (only a plain file/symlink gets clobbered), but it used to rethrow the raw ENOENT/
 * EPERM from the OS, which tells the user nothing actionable. Confirms it now fails with a message
 * naming the actual problem.
 */
async function discoveryPrePlantChecks(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rag-obsidian-mcp-preplant-"));
  const vaultPath = path.join(root, "vault");
  const pluginPath = path.join(vaultPath, ".obsidian", "plugins", "rag-obsidian");
  fs.mkdirSync(pluginPath, { recursive: true });
  // A directory where the bridge file should go — start() must neither delete it nor silently
  // succeed; it must fail loudly with something the user can act on.
  fs.mkdirSync(path.join(pluginPath, "mcp-bridge.cjs"));
  const server = new McpHttpServer({
    vaultPath,
    pluginPath,
    version: "0.0.0-test",
    tools: [],
    callTool: async () => ({}),
  });
  try {
    await assert.rejects(
      () => server.start(),
      /Cannot replace .*mcp-bridge\.cjs.*isn't this plugin's own/,
      "a planted directory at the bridge path fails with an actionable message, not a raw ENOTDIR/EPERM"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * `stop()` used to warn-and-walk-away on a corrupt discovery file instead of removing it, leaving
 * a stale file behind that points the bridge at a dead port until the next start() overwrites it.
 * A parse failure can't be a live instance's valid file either way, so it's safe to clear.
 */
async function staleDiscoveryCleanupChecks(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rag-obsidian-mcp-stale-"));
  const vaultPath = path.join(root, "vault");
  const pluginPath = path.join(vaultPath, ".obsidian", "plugins", "rag-obsidian");
  fs.mkdirSync(pluginPath, { recursive: true });
  const server = new McpHttpServer({
    vaultPath,
    pluginPath,
    version: "0.0.0-test",
    tools: [],
    callTool: async () => ({}),
  });
  try {
    const info = await server.start();
    fs.writeFileSync(info.discoveryPath, "not json{{{");
    await server.stop();
    assert.equal(fs.existsSync(info.discoveryPath), false, "a corrupted discovery file is removed on stop(), not left stale");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  assert.equal(DEFAULT_SETTINGS.mcpEnabled, false);
  await protocolChecks();
  bridgeChecks();
  distributionSecurityChecks();
  await vaultChecks();
  await serviceChecks();
  await addReferenceTagsChecks();
  await screeningFieldChecks();
  await manuscriptChecks();
  await httpChecks();
  await unicodeVaultPathChecks();
  await discoveryPrePlantChecks();
  await staleDiscoveryCleanupChecks();
  console.log("MCP checks passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
