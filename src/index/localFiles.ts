/* eslint-disable @typescript-eslint/no-require-imports -- Obsidian on Windows cannot dynamically import node: built-ins */

/** Minimal file interface the vault's `DataAdapter` already satisfies structurally
 *  (exists/mkdir/read/write/readBinary/writeBinary/remove/rename), so `IndexManager` can
 *  point at either it or `NodeFileIO` without a branch at every call site. */
export interface FileIO {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

/** Load Node built-ins only when called, exactly like `mcp/http.ts`'s `loadDesktopNode`
 *  (a top-level `require` would still get bundled into main.js and break on mobile). */
function loadNode(): {
  fs: typeof import("node:fs/promises");
  crypto: typeof import("node:crypto");
  os: typeof import("node:os");
  pathApi: typeof import("node:path");
} {
  return {
    fs: require("node:fs/promises"),
    crypto: require("node:crypto"),
    os: require("node:os"),
    pathApi: require("node:path"),
  };
}

/** `FileIO` over `fs.promises`, absolute paths — the index-outside-the-vault location.
 *  Construct only behind `Platform.isDesktopApp`. */
export class NodeFileIO implements FileIO {
  private fs = loadNode().fs;

  async exists(path: string): Promise<boolean> {
    try {
      await this.fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
  async mkdir(path: string): Promise<void> {
    await this.fs.mkdir(path, { recursive: true });
  }
  read(path: string): Promise<string> {
    return this.fs.readFile(path, "utf8");
  }
  async write(path: string, data: string): Promise<void> {
    await this.fs.writeFile(path, data, "utf8");
  }
  async readBinary(path: string): Promise<ArrayBuffer> {
    const buf = await this.fs.readFile(path);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    await this.fs.writeFile(path, Buffer.from(data));
  }
  async remove(path: string): Promise<void> {
    await this.fs.unlink(path);
  }
  async rename(from: string, to: string): Promise<void> {
    await this.fs.rename(from, to);
  }
}

/** OS cache root for the given platform/env/home — pure, so it's unit-testable without
 *  touching the real OS. macOS: `~/Library/Caches`. Windows: `%LOCALAPPDATA%` (fallback
 *  `~/AppData/Local`). Else: `$XDG_CACHE_HOME` or `~/.cache`. */
export function cacheRoot(platform: string, env: Record<string, string | undefined>, home: string): string {
  if (platform === "darwin") return `${home}/Library/Caches`;
  if (platform === "win32") return env.LOCALAPPDATA || `${home}/AppData/Local`;
  return env.XDG_CACHE_HOME || `${home}/.cache`;
}

/** `<OS cache>/academic-paper-citation-manager/<key>/index` for a vault, where `key` is the
 *  first 24 hex chars of sha256(vault realpath, NFC-normalized) — the same formula
 *  `mcp/http.ts` uses for its discovery-file key (duplicated here rather than shared: two
 *  lines, different module). Resolves the vault's realpath itself (desktop-only). */
export async function localIndexDir(vaultBasePath: string): Promise<string> {
  const { fs, crypto, os, pathApi } = loadNode();
  const real = (await fs.realpath(vaultBasePath)).normalize("NFC");
  const key = crypto.createHash("sha256").update(real).digest("hex").slice(0, 24);
  return pathApi.join(cacheRoot(process.platform, process.env, os.homedir()), "academic-paper-citation-manager", key, "index");
}
/* eslint-enable @typescript-eslint/no-require-imports -- end desktop-only Node loader */
