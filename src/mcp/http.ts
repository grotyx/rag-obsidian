/* eslint-disable @typescript-eslint/no-require-imports -- Obsidian on Windows cannot dynamically import node: built-ins */
/* global Buffer, process -- desktop MCP server runs in Electron's Node.js context */
import type { Server, IncomingMessage, ServerResponse } from "node:http";
import { bridgeSource } from "./bridge";
import { handleProtocol, McpRequest, McpTool, mcpError } from "./protocol";
import { validateMarkdownPath } from "./vault";

const MAX_REQUEST_BYTES = 1_000_000;

export interface McpConnectionInfo {
  running: true;
  port: number;
  token: string;
  vaultPath: string;
  bridgePath: string;
  discoveryPath: string;
}

export interface McpServerStatus {
  running: boolean;
  port?: number;
  vaultPath: string;
  bridgePath?: string;
}

interface McpHttpOptions {
  vaultPath: string;
  pluginPath: string;
  version: string;
  tools: McpTool[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

/** Load Node built-ins only after the desktop guard; dynamic node: imports fail in Obsidian on Windows. */
export function loadDesktopNode(): {
  crypto: typeof import("node:crypto");
  fs: typeof import("node:fs/promises");
  http: typeof import("node:http");
  os: typeof import("node:os");
  pathApi: typeof import("node:path");
} {
  return {
    crypto: require("node:crypto"),
    fs: require("node:fs/promises"),
    http: require("node:http"),
    os: require("node:os"),
    pathApi: require("node:path"),
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function mcpSetupSnippets(vaultPath: string, bridgePath: string): { claudeCode: string; codex: string } {
  return {
    claudeCode: `claude mcp add --transport stdio rag-obsidian -- node ${shellQuote(bridgePath)} --vault ${shellQuote(vaultPath)}`,
    codex: `[mcp_servers.rag-obsidian]\ncommand = "node"\nargs = [${JSON.stringify(bridgePath)}, "--vault", ${JSON.stringify(vaultPath)}]`,
  };
}

function inside(root: string, target: string, pathApi: typeof import("node:path")): boolean {
  const relative = pathApi.relative(root, target);
  return relative === "" || (!relative.startsWith(".." + pathApi.sep) && relative !== ".." && !pathApi.isAbsolute(relative));
}

/** OS-level containment check that catches symlinks after lexical vault-path validation. */
export async function assertVaultPath(vaultPath: string, relativePath: string, allowMissing: boolean): Promise<void> {
  const { fs, pathApi } = loadDesktopNode();
  const safe = validateMarkdownPath(relativePath);
  const root = await fs.realpath(vaultPath);
  const target = pathApi.resolve(root, ...safe.split("/"));
  let resolved: string;
  try {
    resolved = await fs.realpath(target);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (!allowMissing || code !== "ENOENT") throw error;
    let parent = pathApi.dirname(target);
    while (true) {
      try {
        resolved = await fs.realpath(parent);
        break;
      } catch (parentError) {
        if ((parentError as { code?: string }).code !== "ENOENT" || parent === root) throw parentError;
        parent = pathApi.dirname(parent);
      }
    }
  }
  if (!inside(root, resolved, pathApi)) throw new Error(`INVALID_PATH: path resolves outside vault: ${relativePath}`);
}

async function guardToolPaths(vaultPath: string, request: McpRequest): Promise<void> {
  if (request.method !== "tools/call") return;
  const name = request.params?.name;
  const args = request.params?.arguments;
  if (!args || typeof args !== "object" || Array.isArray(args)) return;
  const values = args as Record<string, unknown>;
  const check = async (field: string, allowMissing: boolean): Promise<void> => {
    const value = values[field];
    if (typeof value === "string" && value) await assertVaultPath(vaultPath, value, allowMissing);
  };
  if (["read_note", "update_note", "replace_in_note", "trash_note"].includes(String(name))) await check("path", false);
  if (name === "create_note") await check("path", true);
  if (name === "move_note") {
    await check("path", false);
    await check("new_path", true);
  }
  if (name === "compile_manuscript") {
    await check("path", false);
    await check("output_path", true);
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    let tooLarge = false;
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_REQUEST_BYTES) tooLarge = true;
      else body += chunk;
    });
    req.on("end", () => tooLarge ? reject(new Error("REQUEST_TOO_LARGE")) : resolve(body));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

export class McpHttpServer {
  private server: Server | null = null;
  private info: McpConnectionInfo | null = null;

  constructor(private options: McpHttpOptions) {}

  status(): McpServerStatus {
    return this.info
      ? { running: true, port: this.info.port, vaultPath: this.info.vaultPath, bridgePath: this.info.bridgePath }
      : { running: false, vaultPath: this.options.vaultPath };
  }

  setupSnippets(): { claudeCode: string; codex: string } {
    return mcpSetupSnippets(this.options.vaultPath, `${this.options.pluginPath}/mcp-bridge.cjs`);
  }

  async start(): Promise<McpConnectionInfo> {
    if (this.info) return this.info;
    const { crypto, fs, http, os, pathApi } = loadDesktopNode();
    const vaultPath = await fs.realpath(this.options.vaultPath);
    const token = crypto.randomBytes(32).toString("hex");
    let port = 0;
    const authorized = (header: string | undefined): boolean => {
      const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
      if (supplied.length !== token.length) return false;
      return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
    };
    const server = http.createServer((req, res) => {
      void this.handle(req, res, port, authorized);
    });
    server.requestTimeout = 35_000;
    server.headersTimeout = 10_000;
    server.maxHeadersCount = 32;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("MCP server did not receive a TCP port");
    }
    port = address.port;
    const key = crypto.createHash("sha256").update(vaultPath).digest("hex").slice(0, 24);
    const discoveryPath = pathApi.join(os.tmpdir(), `rag-obsidian-mcp-${key}.json`);
    const bridgePath = pathApi.join(this.options.pluginPath, "mcp-bridge.cjs");
    const discovery = JSON.stringify({ port, token, pluginVersion: this.options.version, vaultPath, pid: process.pid });
    const replace = async (temp: string, target: string): Promise<void> => {
      try {
        await fs.rename(temp, target);
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== "EEXIST" && code !== "EPERM") throw error;
        const existing = await fs.lstat(target);
        if (!existing.isFile() && !existing.isSymbolicLink()) throw error;
        await fs.unlink(target);
        await fs.rename(temp, target);
      }
    };
    let bridgeTemp = "";
    let discoveryTemp = "";
    try {
      await fs.mkdir(this.options.pluginPath, { recursive: true });
      bridgeTemp = pathApi.join(this.options.pluginPath, `.mcp-bridge.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
      await fs.writeFile(bridgeTemp, bridgeSource(), { mode: 0o600, flag: "wx" });
      await replace(bridgeTemp, bridgePath);
      bridgeTemp = "";
      await fs.chmod(bridgePath, 0o600);
      discoveryTemp = `${discoveryPath}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`;
      await fs.writeFile(discoveryTemp, discovery, { mode: 0o600, flag: "wx" });
      await fs.chmod(discoveryTemp, 0o600);
      await replace(discoveryTemp, discoveryPath);
      discoveryTemp = "";
      this.server = server;
      this.info = { running: true, port, token, vaultPath, bridgePath, discoveryPath };
      return this.info;
    } catch (error) {
      server.close();
      await Promise.all([bridgeTemp, discoveryTemp].filter(Boolean).map(async (temp) => {
        try { await fs.unlink(temp); } catch { /* best-effort cleanup */ }
      }));
      throw error;
    }
  }

  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
    port: number,
    authorized: (header: string | undefined) => boolean
  ): Promise<void> {
    const remote = req.socket.remoteAddress ?? "";
    if (remote !== "127.0.0.1" && remote !== "::ffff:127.0.0.1") {
      res.writeHead(403).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "POST" }).end();
      return;
    }
    if (req.url !== "/mcp" || req.headers.host !== `127.0.0.1:${port}`) {
      res.writeHead(404).end();
      return;
    }
    if (!authorized(req.headers.authorization)) {
      res.writeHead(401).end();
      return;
    }
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      res.writeHead(415).end();
      return;
    }
    try {
      const raw = await readBody(req);
      let request: McpRequest;
      try {
        request = JSON.parse(raw) as McpRequest;
      } catch {
        json(res, 200, mcpError(null, -32700, "Parse error"));
        return;
      }
      const response = await handleProtocol(request, this.options.tools, async (name, args) => {
        await guardToolPaths(this.options.vaultPath, { ...request, params: { name, arguments: args } });
        return this.options.callTool(name, args);
      }, this.options.version);
      if (!response) res.writeHead(204).end();
      else json(res, 200, response);
    } catch (error) {
      if (error instanceof Error && error.message === "REQUEST_TOO_LARGE") res.writeHead(413).end();
      else json(res, 200, mcpError(null, -32603, error instanceof Error ? error.message : String(error)));
    }
  }

  async stop(): Promise<void> {
    const server = this.server;
    const info = this.info;
    this.server = null;
    this.info = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (!info) return;
    const { fs } = loadDesktopNode();
    try {
      const current = JSON.parse(await fs.readFile(info.discoveryPath, "utf8")) as { token?: string };
      if (current.token === info.token) await fs.unlink(info.discoveryPath);
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") console.warn("[RAG Obsidian] MCP discovery cleanup failed", error);
    }
  }

  async restart(): Promise<McpConnectionInfo> {
    await this.stop();
    return this.start();
  }
}
/* eslint-enable @typescript-eslint/no-require-imports -- end desktop-only Node loader */
