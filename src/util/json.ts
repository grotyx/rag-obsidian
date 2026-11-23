/** Narrowing helpers for external JSON (Crossref, PubMed, OpenAlex, LLM/embedding responses, …)
 *  whose shape is only trusted at the fields actually read. Each helper degrades to the same
 *  empty/falsy value the old `any`-typed code implicitly fell back to on a missing/wrong-typed
 *  field, so swapping `any` for `unknown` plus these does not change behavior. */

export function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** A scalar as text: strings as-is, finite numbers stringified ("" otherwise). YAML reads an
 *  unquoted `PMID: 12345678`, a year tag or a volume as a number — `str()` would drop those. */
export function text(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
}

/** A number from a number or a numeric string (frontmatter `cited_by_count: "57"`). */
export function numLike(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** A string, or undefined (not "") when the value isn't one — for fields where absent must stay absent. */
export function optStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Type guard: a non-empty array of finite numbers (an embedding, a PDF rect). */
export function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number" && Number.isFinite(x));
}

/** One tag in comparable form: trimmed, leading `#` dropped. Stored tags, filter arguments and the
 *  index all go through this, so `#trial` and `trial` are the same tag. */
export function tagKey(t: string): string {
  return t.trim().replace(/^#/, "");
}

/** Tags from frontmatter or a CSL item: a list or one scalar string (`tags: diskectomy`), leading
 *  `#` dropped, blanks skipped. The one reading of `tags` shared by the index, the filters and MCP. */
export function tagsOf(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  return list.map((t) => tagKey(text(t))).filter((t) => t !== "");
}
