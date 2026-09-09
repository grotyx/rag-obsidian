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

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
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
