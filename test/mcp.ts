import assert from "node:assert/strict";
import vm from "node:vm";
import { handleProtocol, McpTool } from "../src/mcp/protocol";
import { bridgeSource } from "../src/mcp/bridge";

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

async function main(): Promise<void> {
  await protocolChecks();
  bridgeChecks();
  console.log("MCP checks passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
