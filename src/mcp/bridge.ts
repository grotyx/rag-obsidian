/* eslint-disable @typescript-eslint/no-require-imports -- emitted standalone CommonJS has no imports */
/* global Buffer, process -- standalone bridge runs in Node.js */
/** Standalone CommonJS bridge emitted beside main.js; intentionally Node-stdlib only. */
export function bridgeSource(): string {
  return `(${bridgeMain.toString()})();\n`;
}

function bridgeMain(): void {
  const crypto = require("node:crypto");
  const fs = require("node:fs");
  const http = require("node:http");
  const os = require("node:os");
  const path = require("node:path");
  const readline = require("node:readline");

  const at = process.argv.indexOf("--vault");
  if (at < 0 || !process.argv[at + 1]) {
    process.stderr.write("rag-obsidian MCP: pass --vault /absolute/path/to/vault\n");
    process.exit(2);
  }
  let vault: string;
  try {
    vault = fs.realpathSync(process.argv[at + 1]);
  } catch {
    process.stderr.write(`rag-obsidian MCP: vault not found: ${process.argv[at + 1]}\n`);
    process.exit(2);
    return;
  }
  const key = crypto.createHash("sha256").update(vault).digest("hex").slice(0, 24);
  const discovery = path.join(os.tmpdir(), `rag-obsidian-mcp-${key}.json`);
  let chain = Promise.resolve();

  function failure(id: string | number | null, message: string): string {
    return JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message },
    });
  }

  async function forward(line: string): Promise<void> {
    let request: { id?: string | number };
    try {
      request = JSON.parse(line);
    } catch {
      process.stdout.write(failure(null, "Invalid JSON from MCP client") + "\n");
      return;
    }
    let info: { port: number; token: string };
    try {
      info = JSON.parse(fs.readFileSync(discovery, "utf8"));
      if (!Number.isInteger(info.port) || typeof info.token !== "string") throw new Error("invalid discovery file");
    } catch {
      if (request.id !== undefined) {
        process.stdout.write(failure(request.id, "Obsidian MCP is unavailable. Open this vault in Obsidian and enable MCP access.") + "\n");
      }
      return;
    }
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const req = http.request({
          host: "127.0.0.1",
          port: info.port,
          path: "/mcp",
          method: "POST",
          headers: {
            authorization: `Bearer ${info.token}`,
            "content-type": "application/json",
            "content-length": Buffer.byteLength(line),
          },
          timeout: 30_000,
        }, (res: { statusCode?: number; on: (event: string, fn: (value?: Buffer) => void) => void }) => {
          let out = "";
          res.on("data", (chunk?: Buffer) => {
            out += String(chunk ?? "");
            if (out.length > 10_000_000) req.destroy(new Error("Obsidian MCP response is too large"));
          });
          res.on("end", () => {
            if (res.statusCode === 204) resolve("");
            else if (res.statusCode === 200) resolve(out);
            else reject(new Error(`Obsidian MCP returned HTTP ${res.statusCode ?? 0}`));
          });
        });
        req.on("timeout", () => req.destroy(new Error("Obsidian MCP request timed out")));
        req.on("error", reject);
        req.end(line);
      });
      if (body) process.stdout.write(body.trim() + "\n");
    } catch (error) {
      if (request.id !== undefined) {
        const message = error instanceof Error ? error.message : String(error);
        process.stdout.write(failure(request.id, `${message}. Confirm Obsidian is open with MCP enabled.`) + "\n");
      }
    }
  }

  readline.createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line: string) => {
    if (!line.trim()) return;
    chain = chain.then(() => forward(line)).catch((error: unknown) => {
      process.stderr.write(String(error) + "\n");
    });
  });
}
/* eslint-enable @typescript-eslint/no-require-imports -- end standalone CommonJS source */
