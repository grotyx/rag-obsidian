interface FileLike {
  path: string;
  name?: string;
  basename?: string;
  extension?: string;
  stat?: { mtime?: number; size?: number };
}

interface VaultLike {
  getMarkdownFiles(): FileLike[];
  getAbstractFileByPath(path: string): FileLike | null;
  read(file: FileLike): Promise<string>;
  create(path: string, content: string): Promise<FileLike>;
  modify(file: FileLike, content: string): Promise<void>;
  createFolder(path: string): Promise<void>;
}

interface FileManagerLike {
  renameFile(file: FileLike, newPath: string): Promise<void>;
  trashFile(file: FileLike): Promise<void>;
}

interface AppLike {
  vault: VaultLike;
  fileManager: FileManagerLike;
}

export interface NoteMutation {
  path: string;
  hash: string;
  indexQueued: boolean;
}

export interface NotePage {
  path: string;
  content: string;
  offset: number;
  nextOffset?: number;
  totalChars: number;
  hash: string;
}

const MAX_READ_CHARS = 50_000;
const DEFAULT_READ_CHARS = 12_000;
const MAX_WRITE_CHARS = 2_000_000;

function invalidPath(message: string): never {
  throw new Error(`INVALID_PATH: ${message}`);
}

export function validateMarkdownPath(raw: string): string {
  if (typeof raw !== "string" || !raw.trim()) invalidPath("path is required");
  if (/^[a-z]:[\\/]/i.test(raw) || /^[\\/]/.test(raw)) invalidPath("path must be vault-relative");
  if (/\0|%2e|%2f|%5c/i.test(raw)) invalidPath("encoded traversal is not allowed");
  const parts = raw.replace(/\\/g, "/").split("/").filter(Boolean);
  if (!parts.length || parts.some((p) => p === "." || p === "..")) invalidPath("traversal is not allowed");
  if (parts[0].toLowerCase() === ".obsidian") invalidPath(".obsidian is private");
  const path = parts.join("/");
  if (!/\.md$/i.test(path)) invalidPath("only Markdown notes are allowed");
  return path;
}

function validateFolderPath(raw = ""): string {
  if (!raw.trim()) return "";
  const probe = validateMarkdownPath(raw.replace(/[\\/]+$/, "") + "/_.md");
  return probe.slice(0, -5);
}

export async function contentHash(content: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isFile(value: FileLike | null): value is FileLike {
  return !!value && value.extension?.toLowerCase() === "md";
}

function boundedInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) throw new Error("INVALID_ARGUMENT: expected a finite number");
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export class McpVault {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private app: AppLike, private isReference: (path: string) => boolean = () => false) {}

  private serialized<T>(job: () => Promise<T>): Promise<T> {
    const run = this.chain.then(job);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private file(path: string): FileLike {
    const file = this.app.vault.getAbstractFileByPath(validateMarkdownPath(path));
    if (!isFile(file)) throw new Error(`NOT_FOUND: Markdown note not found: ${path}`);
    return file;
  }

  private async current(path: string, expectedHash: string): Promise<{ file: FileLike; content: string }> {
    const file = this.file(path);
    const content = await this.app.vault.read(file);
    if (await contentHash(content) !== expectedHash) {
      throw new Error(`CONTENT_CHANGED: read ${file.path} again before changing it`);
    }
    return { file, content };
  }

  private async ensureParents(path: string): Promise<void> {
    const parts = path.split("/").slice(0, -1);
    let folder = "";
    for (const part of parts) {
      folder = folder ? `${folder}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    }
  }

  async listNotes(folder = "", limit = 50, cursor = ""): Promise<{
    notes: Array<{ path: string; size: number; mtime: number }>;
    nextCursor?: string;
  }> {
    const prefix = validateFolderPath(folder);
    const cap = boundedInt(limit, 50, 1, 100);
    const all = this.app.vault.getMarkdownFiles()
      .filter((f) => !f.path.toLowerCase().startsWith(".obsidian/"))
      .filter((f) => !prefix || f.path.startsWith(prefix + "/"))
      .filter((f) => !cursor || f.path > cursor)
      .sort((a, b) => a.path.localeCompare(b.path));
    const page = all.slice(0, cap);
    return {
      notes: page.map((f) => ({ path: f.path, size: f.stat?.size ?? 0, mtime: f.stat?.mtime ?? 0 })),
      ...(all.length > cap ? { nextCursor: page[page.length - 1].path } : {}),
    };
  }

  async readNote(path: string, offset = 0, maxChars = DEFAULT_READ_CHARS): Promise<NotePage> {
    const file = this.file(path);
    const content = await this.app.vault.read(file);
    const start = boundedInt(offset, 0, 0, content.length);
    const count = boundedInt(maxChars, DEFAULT_READ_CHARS, 1, MAX_READ_CHARS);
    const end = Math.min(content.length, start + count);
    return {
      path: file.path,
      content: content.slice(start, end),
      offset: start,
      ...(end < content.length ? { nextOffset: end } : {}),
      totalChars: content.length,
      hash: await contentHash(content),
    };
  }

  createNote(path: string, content: string): Promise<NoteMutation> {
    return this.serialized(async () => {
      const target = validateMarkdownPath(path);
      if (content.length > MAX_WRITE_CHARS) throw new Error("CONTENT_TOO_LARGE: note exceeds 2,000,000 characters");
      if (this.app.vault.getAbstractFileByPath(target)) throw new Error(`ALREADY_EXISTS: ${target} already exists`);
      await this.ensureParents(target);
      await this.app.vault.create(target, content);
      return { path: target, hash: await contentHash(content), indexQueued: this.isReference(target) };
    });
  }

  updateNote(path: string, content: string, expectedHash: string): Promise<NoteMutation> {
    return this.serialized(async () => {
      if (content.length > MAX_WRITE_CHARS) throw new Error("CONTENT_TOO_LARGE: note exceeds 2,000,000 characters");
      const { file } = await this.current(path, expectedHash);
      await this.app.vault.modify(file, content);
      return { path: file.path, hash: await contentHash(content), indexQueued: this.isReference(file.path) };
    });
  }

  replaceInNote(path: string, oldText: string, newText: string, expectedHash: string): Promise<NoteMutation> {
    return this.serialized(async () => {
      if (!oldText) throw new Error("INVALID_ARGUMENT: old_text is required");
      const { file, content } = await this.current(path, expectedHash);
      const first = content.indexOf(oldText);
      if (first < 0 || content.indexOf(oldText, first + oldText.length) >= 0) {
        throw new Error("REPLACE_COUNT: old_text must occur exactly once");
      }
      const next = content.slice(0, first) + newText + content.slice(first + oldText.length);
      if (next.length > MAX_WRITE_CHARS) throw new Error("CONTENT_TOO_LARGE: note exceeds 2,000,000 characters");
      await this.app.vault.modify(file, next);
      return { path: file.path, hash: await contentHash(next), indexQueued: this.isReference(file.path) };
    });
  }

  moveNote(path: string, newPath: string, expectedHash: string): Promise<NoteMutation> {
    return this.serialized(async () => {
      const target = validateMarkdownPath(newPath);
      const { file, content } = await this.current(path, expectedHash);
      if (this.app.vault.getAbstractFileByPath(target)) throw new Error(`ALREADY_EXISTS: ${target} already exists`);
      await this.ensureParents(target);
      await this.app.fileManager.renameFile(file, target);
      return {
        path: target,
        hash: await contentHash(content),
        indexQueued: this.isReference(file.path) || this.isReference(target),
      };
    });
  }

  trashNote(path: string, expectedHash: string): Promise<{ path: string; trashed: true }> {
    return this.serialized(async () => {
      const { file } = await this.current(path, expectedHash);
      await this.app.fileManager.trashFile(file);
      return { path: file.path, trashed: true };
    });
  }
}
