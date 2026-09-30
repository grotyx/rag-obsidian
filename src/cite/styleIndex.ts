import { arr, rec, str } from "../util/json";

export interface StyleInfo {
  id: string;
  title: string;
  short?: string;
  format: string; // "numeric" | "author-date" | "note" | "" …
}

/** Reduce Zotero's `styles.json` (title, titleShort, name, dependent, categories) to what the picker needs. */
export function parseStyleIndex(json: unknown): StyleInfo[] {
  const out: StyleInfo[] = [];
  for (const raw of arr(json)) {
    const r = rec(raw);
    const id = str(r.name);
    const title = str(r.title);
    if (!id || !title) continue;
    const short = str(r.titleShort);
    out.push({ id, title, ...(short && short !== title ? { short } : {}), format: str(rec(r.categories).format) });
  }
  return out;
}
