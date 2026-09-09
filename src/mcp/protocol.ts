export type McpId = string | number;

export interface McpRequest {
  jsonrpc: "2.0";
  id?: McpId;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpResponse {
  jsonrpc: "2.0";
  id: McpId | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

const PROTOCOL_VERSION = "2026-07-28";

export function mcpSuccess(id: McpId, result: Record<string, unknown>): McpResponse {
  return { jsonrpc: "2.0", id, result };
}

export function mcpError(id: McpId | null, code: number, message: string, data?: unknown): McpResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function toolFailure(id: McpId, error: unknown): McpResponse {
  const message = error instanceof Error ? error.message : String(error);
  return mcpSuccess(id, {
    content: [{ type: "text", text: message }],
    isError: true,
  });
}

/** Minimal MCP server surface needed by Claude Code and Codex tool clients. */
export async function handleProtocol(
  req: McpRequest,
  tools: McpTool[],
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  version = "0.5.0"
): Promise<McpResponse | null> {
  if (!req || req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return mcpError(req?.id ?? null, -32600, "Invalid JSON-RPC request");
  }
  if (req.id === undefined) return null;
  if (req.method === "initialize") {
    const requested = req.params?.protocolVersion;
    return mcpSuccess(req.id, {
      protocolVersion: typeof requested === "string" ? requested : PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: "rag-obsidian", version },
      instructions:
        "Search the library before factual writing, inspect sources when needed, and cite only returned citekeys as [@citekey].",
    });
  }
  if (req.method === "ping") return mcpSuccess(req.id, {});
  if (req.method === "tools/list") return mcpSuccess(req.id, { tools });
  if (req.method === "tools/call") {
    const name = req.params?.name;
    const args = req.params?.arguments ?? {};
    if (typeof name !== "string" || !args || typeof args !== "object" || Array.isArray(args)) {
      return mcpError(req.id, -32602, "Invalid tools/call parameters");
    }
    try {
      const value = await callTool(name, args as Record<string, unknown>);
      return mcpSuccess(req.id, {
        content: [{ type: "text", text: JSON.stringify(value) }],
        structuredContent: value,
      });
    } catch (error) {
      return toolFailure(req.id, error);
    }
  }
  return mcpError(req.id, -32601, `Method not found: ${req.method}`);
}
