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
  return { status: r.status, text, json, headers: {} };
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
