// Obsidian runs plugin code in a browser window; modules call `window.setTimeout` for popout
// compatibility, so give Node the same global.
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  (globalThis as { window?: unknown }).window = globalThis;
}

// Minimal stand-in for the parts of the Obsidian API the non-UI modules use,
// so the real plugin source can run in Node for integration testing.
import * as yaml from "yaml";

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
  return yaml.stringify(obj, { lineWidth: 0 });
}

export function parseYaml(s: string): unknown {
  return yaml.parse(s);
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
export class PluginSettingTab {
  /** 1.13's re-render of the declarative definitions — a no-op here (tests read the rows directly). */
  update(): void {}
  display(): void {}
}
export class Setting {}
/** Minimal stand-in for the real `SettingGroup` (obsidian.d.ts) so settings.ts loads. Every method
 *  is a no-op: the < 1.13 fallback renderer (`display()`) is not exercised by the Node tests — it
 *  is checked in Obsidian itself. */
export class SettingGroup {
  constructor(_containerEl?: unknown) {}
  setHeading(_text?: unknown): this {
    return this;
  }
  addClass(_cls?: string): this {
    return this;
  }
  addSetting(_cb: (setting: unknown) => void): this {
    return this;
  }
  addSearch(_cb: unknown): this {
    return this;
  }
  addExtraButton(_cb: unknown): this {
    return this;
  }
}
/** Real signature takes a semver string. Tests run settings.ts as on 1.13+ (its `update()` is the
 *  no-op in the PluginSettingTab stub above), so a constant is enough. */
export function requireApiVersion(_version: string): boolean {
  return true;
}
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
