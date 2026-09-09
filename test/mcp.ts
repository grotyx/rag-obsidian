import assert from "node:assert/strict";
import vm from "node:vm";
import { handleProtocol, McpTool } from "../src/mcp/protocol";
import { bridgeSource } from "../src/mcp/bridge";
import { contentHash, McpVault, validateMarkdownPath } from "../src/mcp/vault";
import { McpService, MCP_TOOLS } from "../src/mcp/service";

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
  await vault.replaceInNote("Notes/a.md", "same same", "done", repeated.hash);
  assert.equal(fake.files.get("Notes/a.md")?.content, "done");

  const beforeMove = await vault.readNote("Notes/a.md");
  await assert.rejects(() => vault.moveNote("Notes/a.md", "References/ref.md", beforeMove.hash), /already exists/i);
  const moved = await vault.moveNote("Notes/a.md", "Archive/a.md", beforeMove.hash);
  assert.equal(moved.path, "Archive/a.md");

  await assert.rejects(() => vault.trashNote("Archive/a.md", "stale"), /CONTENT_CHANGED/);
  const beforeTrash = await vault.readNote("Archive/a.md");
  await vault.trashNote("Archive/a.md", beforeTrash.hash);
  assert.deepEqual(fake.trashed, ["Archive/a.md"]);
}

async function serviceChecks(): Promise<void> {
  assert.deepEqual(MCP_TOOLS.map((t) => t.name), [
    "library_status", "search_library", "rebuild_search_index", "list_references",
    "get_reference", "list_tags", "search_pubmed", "add_reference", "list_notes",
    "read_note", "create_note", "update_note", "replace_in_note", "move_note",
    "trash_note", "compile_manuscript",
  ]);
  assert.equal(MCP_TOOLS.find((t) => t.name === "search_library")?.annotations?.readOnlyHint, true);
  assert.equal(MCP_TOOLS.find((t) => t.name === "trash_note")?.annotations?.destructiveHint, true);

  const fake = fakeApp({
    "References/ref.md": "---\ncitekey: smith2024\ntitle: Trial\n---\n\n## Summary\n\nUseful.\n\n## Full text (extracted)\n\nvery long",
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
    searchPubmed: async () => [{ pmid: "123", pmc: "", item }],
    fetchMetadata: async () => ({ type: "article-journal", title: "New", PMID: "999" }),
  });

  assert.deepEqual(await service.callTool("library_status", {}), {
    pluginVersion: "0.5.0", vaultName: "Research", referenceFolder: "References",
    indexReady: true, chunkCount: 10, embeddingModel: "test:embed",
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
  const ref = await service.callTool("get_reference", { citekey: "smith2024" }) as any;
  assert.equal(ref.fullTextOmitted, true);
  assert.doesNotMatch(ref.content, /very long/);
  const tags = await service.callTool("list_tags", {}) as any;
  assert.deepEqual(tags.tags, [{ tag: "Outcome", count: 1 }, { tag: "Spine", count: 1 }]);

  const pubmed = await service.callTool("search_pubmed", { query: "trial" }) as any;
  assert.equal(pubmed.results[0].existingCitekey, "smith2024");
  await assert.rejects(() => service.callTool("add_reference", { identifier: "123" }), /explicit PMID/i);
  await assert.rejects(() => service.callTool("add_reference", { identifier: "a title" }), /explicit identifier/i);
  const added = await service.callTool("add_reference", { identifier: "PMID:999" }) as any;
  assert.equal(added.status, "created");
  assert.equal(created, true);

  await assert.rejects(() => service.callTool("search_library", { query: "q", typo: 1 }), /Unknown argument/);
  await assert.rejects(() => service.callTool("not_a_tool", {}), /Unknown tool/);
}

async function main(): Promise<void> {
  await protocolChecks();
  bridgeChecks();
  await vaultChecks();
  await serviceChecks();
  console.log("MCP checks passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
