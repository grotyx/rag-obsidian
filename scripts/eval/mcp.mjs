// Minimal client for the plugin's loopback MCP server (the vault must be open in Obsidian with MCP on).
import fs from "fs"; import os from "os"; import path from "path"; import crypto from "crypto";

export function connect(vault) {
  const name = `rag-obsidian-mcp-${crypto.createHash("sha256").update(vault.normalize("NFC")).digest("hex").slice(0, 24)}.json`;
  const disc = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), name), "utf8"));
  let id = 0;
  return async function call(tool, args) {
    for (let i = 0; ; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${disc.port}/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${disc.token}` },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name: tool, arguments: args } }),
        });
        const t = await r.text(); // the server sometimes answers an empty body under load
        if (!t) throw new Error("empty body");
        const j = JSON.parse(t);
        if (j.error) throw new Error(JSON.stringify(j.error));
        const txt = j.result?.content?.[0]?.text ?? "";
        if (j.result?.isError) throw new Error(txt);
        return j.result.structuredContent ?? JSON.parse(txt);
      } catch (e) {
        if (i >= 4) throw e;
        await new Promise((s) => setTimeout(s, 1500 * (i + 1)));
      }
    }
  };
}
