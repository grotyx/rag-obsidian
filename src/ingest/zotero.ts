import { requestUrl } from "obsidian";
import { CSLItem } from "../types";
import { arr, rec, str } from "../util/json";
import { parseCslJson } from "./import";

const BASE = "http://127.0.0.1:23119/api/users/0";
const PAGE = 100;
export const ZOTERO_UNREACHABLE =
  "Zotero is not reachable. Open Zotero 7 and enable Settings → Advanced → Allow other applications on this computer to communicate with Zotero.";

export interface ZoteroCollection {
  key: string;
  /** "Parent / Child" */
  path: string;
}

/** `/collections` JSON → flat list with the parent path in the label, sorted by path. */
export function parseCollections(json: unknown): ZoteroCollection[] {
  const raw = arr(json).map((c) => {
    const d = rec(rec(c).data);
    return { key: str(d.key ?? rec(c).key), name: str(d.name), parent: str(d.parentCollection) };
  }).filter((c) => c.key && c.name);
  const byKey = new Map(raw.map((c) => [c.key, c]));
  const pathOf = (key: string, depth = 0): string => {
    const c = byKey.get(key);
    if (!c) return "";
    const up = c.parent && depth < 20 ? pathOf(c.parent, depth + 1) : "";
    return up ? `${up} / ${c.name}` : c.name;
  };
  return raw.map((c) => ({ key: c.key, path: pathOf(c.key) })).sort((a, b) => a.path.localeCompare(b.path));
}

/** One `format=csljson` page (`{items:[…]}`) → CSL items without `id`. Bad input → []. */
export function parseCslPage(json: unknown): CSLItem[] {
  try {
    return parseCslJson(JSON.stringify(arr(rec(json).items)));
  } catch {
    return [];
  }
}

async function get(path: string): Promise<unknown> {
  let res;
  try {
    res = await requestUrl({ url: `${BASE}${path}`, throw: false });
  } catch {
    throw new Error(ZOTERO_UNREACHABLE);
  }
  if (res.status !== 200) {
    throw new Error(
      res.status === 403 || res.status === 0
        ? ZOTERO_UNREACHABLE
        : `Zotero answered HTTP ${res.status}.`
    );
  }
  return res.json as unknown;
}

export async function fetchZoteroCollections(): Promise<ZoteroCollection[]> {
  const out: unknown[] = [];
  for (let start = 0; ; start += PAGE) {
    const page = arr(await get(`/collections?limit=${PAGE}&start=${start}`));
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return parseCollections(out);
}

/** All top-level items of the library (or one collection), paged until a short page. */
export async function fetchZoteroItems(
  collectionKey: string | null,
  onProgress?: (n: number) => void
): Promise<CSLItem[]> {
  const base = collectionKey ? `/collections/${encodeURIComponent(collectionKey)}/items/top` : "/items/top";
  const out: CSLItem[] = [];
  for (let start = 0; ; start += PAGE) {
    // Standalone PDFs would import as empty references. ponytail: standalone notes still come
    // through (the search syntax has no documented NOT-of-OR); filter on include=data if they bite.
    const json = await get(`${base}?format=csljson&itemType=-attachment&limit=${PAGE}&start=${start}`);
    const page = arr(rec(json).items);
    out.push(...parseCslPage(json));
    onProgress?.(out.length);
    if (page.length < PAGE) break;
  }
  return out;
}
