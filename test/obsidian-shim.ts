// Minimal stand-in for the parts of the Obsidian API the non-UI modules use,
// so the real plugin source can run in Node for integration testing.
import * as yaml from "js-yaml";

export interface RequestUrlResponse {
  status: number;
  text: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  headers: Record<string, string>;
}

export async function requestUrl(
  opts: string | { url: string; method?: string; headers?: Record<string, string>; body?: string; throw?: boolean }
): Promise<RequestUrlResponse> {
  const o = typeof opts === "string" ? { url: opts } : opts;
  const r = await fetch(o.url, {
    method: o.method ?? "GET",
    headers: o.headers,
    body: o.body,
  });
  const text = await r.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => (headers[k] = v));
  return { status: r.status, text, json, headers };
}

export function stringifyYaml(obj: unknown): string {
  return yaml.dump(obj, { lineWidth: -1 });
}

export function parseYaml(s: string): unknown {
  return yaml.load(s);
}

/** Real Obsidian's contract: backslash→slash, resolve `.`/`..` segments, drop leading/trailing
 *  slashes. The plugin relies on `.`/`..` resolution (src/write/manuscript.ts's same-file guard
 *  compares two notes by their normalized paths) — a shim that only collapsed slashes would pass
 *  tests a real mismatch here would catch. */
export function normalizePath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

/** Stand-ins for the Obsidian classes that pure modules only reference in type position.
 *  `library.ts` imports TFile for its signatures; the node suite exercises its
 *  frontmatter helpers, which never construct one. */
export class TFile {
  path = "";
  name = "";
  basename = "";
  extension = "md";
  constructor(path = "") {
    this.path = path;
    this.name = path.split("/").pop() ?? "";
    this.basename = this.name.replace(/\.md$/, "");
  }
}

export class App {}

export class Plugin {}
export class WorkspaceLeaf {}
export class TAbstractFile {}
export class TFolder extends TAbstractFile {}
export class FileSystemAdapter {}
export class PluginSettingTab {}
export class Setting {}
export class Modal {}
export class SuggestModal<T> {}
export class FuzzySuggestModal<T> {}
export class ItemView {}
export class EditorSuggest<T> {}
export class ButtonComponent {}
export class TextComponent {}
export class Notice {}
export const Platform = { isDesktopApp: true, isMobile: false };
export const MarkdownRenderer = {};

/** Obsidian's debounce(cb, timeout, resetTimer): fires on the trailing edge; a further call
 *  restarts the timer, which is the only mode the plugin uses. */
export function debounce<T extends unknown[]>(
  fn: (...args: T) => unknown,
  wait = 0,
  _resetTimer = false
): (...args: T) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: T) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
