import { Library } from "../data/library";
import { formatCitation } from "./format";
import { CiteStyle, CSLItem } from "../types";

const CITE_RE = /\[([^\]]*@[^\]]*)\]/g; // [@key]  ·  [-@key]  ·  [@a; @b]  ·  [@key, p. 23]
const KEY_RE = /-?@([A-Za-z0-9_][A-Za-z0-9_:.#$%&+?<>~\/-]*)/g; // Pandoc citekey (locators ignored)

/** Fresh global regex over `[...@...]` citation brackets (own lastIndex per caller). */
export function citePattern(): RegExp {
  return new RegExp(CITE_RE.source, "g");
}

/** Citekeys inside one bracket body (`@a; @b, p. 3` → [a, b]). Prefix/locator/`-` are ignored. */
export function keysInCite(body: string): string[] {
  const keys: string[] = [];
  const re = new RegExp(KEY_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) if (!keys.includes(m[1])) keys.push(m[1]);
  return keys;
}

/** Pull unique citekeys (in first-seen order) out of `[@citekey]` Pandoc citations. */
export function extractCitekeys(text: string): string[] {
  const keys: string[] = [];
  const clean = text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " "); // skip code
  let m: RegExpExecArray | null;
  CITE_RE.lastIndex = 0;
  while ((m = CITE_RE.exec(clean)) !== null) {
    for (const k of keysInCite(m[1])) if (!keys.includes(k)) keys.push(k);
  }
  return keys;
}

/** Build a Markdown bibliography (sorted) for the given citekeys. */
export function buildBibliography(citekeys: string[], library: Library, style: CiteStyle): string {
  const formatted = citekeys
    .map((ck) => library.getItem(ck))
    .filter((it): it is CSLItem => !!it)
    .map((it) => formatCitation(it, style));
  formatted.sort((a, b) => a.localeCompare(b));
  return formatted.map((e) => `- ${e}`).join("\n");
}

/** Split a note around its "## References" section: `base` is everything before the heading
 *  (trailing whitespace trimmed), `tail` is any later same-or-higher-level section
 *  (e.g. "## Appendix") to reattach after the freshly built bibliography. */
export function splitAtReferences(content: string): { base: string; tail: string } {
  const m = content.match(/(^|\n)##\s+References[ \t]*(\n|$)/i);
  if (!m || m.index === undefined) return { base: content.replace(/\s+$/, ""), tail: "" };
  const rest = content.slice(m.index + m[0].length);
  const next = rest.search(/\n#{1,2} /);
  return {
    base: content.slice(0, m.index).replace(/\s+$/, ""),
    tail: next >= 0 ? rest.slice(next) : "",
  };
}

/** Compact in-text label `(Author, Year)` for inline rendering. */
export function inTextLabel(item: CSLItem): string {
  const fam = item.author?.[0]?.family || item.author?.[0]?.literal || "?";
  const dp = item.issued?.["date-parts"]?.[0];
  const yr = dp && dp[0] ? dp[0] : "n.d.";
  return `(${fam}, ${yr})`;
}
