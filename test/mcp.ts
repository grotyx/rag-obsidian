import assert from "node:assert/strict";
import vm from "node:vm";
import { handleProtocol, McpTool } from "../src/mcp/protocol";
import { bridgeSource } from "../src/mcp/bridge";
import { contentHash, McpVault, validateMarkdownPath } from "../src/mcp/vault";

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

async function main(): Promise<void> {
  await protocolChecks();
  bridgeChecks();
  await vaultChecks();
  console.log("MCP checks passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
