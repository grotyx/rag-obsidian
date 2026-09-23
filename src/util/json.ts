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
