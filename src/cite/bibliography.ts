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

// Fenced blocks and inline code, as one alternation: `split` with this capturing group
// yields [prose, code, prose, code, …], so code chunks sit at the odd indices.
const CODE_RE = /(```[\s\S]*?```|`[^`\n]*`)/g;

/** Rewrite `[…@key…]` citations that are NOT inside code. `render` gets one bracket's keys
 *  and its raw text, and returns the replacement — or null to leave the bracket as written
 *  (unknown citekey, an e-mail in brackets). Mirrors what `extractCitekeys` chooses to see. */
export function replaceCitations(
  text: string,
  render: (keys: string[], raw: string) => string | null
): string {
  return text
    .split(CODE_RE)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(citePattern(), (raw, body) => render(keysInCite(String(body)), raw) ?? raw)
    )
    .join("");
}

/** Resolve one bracket's citekeys, or null if ANY of them is unknown — the caller then leaves
 *  the citation exactly as the author wrote it. All-or-nothing on purpose: silently dropping a
 *  typo'd key from `[@real; @typo]` would hide the mistake, and reading view and
 *  "Compile manuscript" must agree on what a citation looks like. */
export function resolveCluster<T>(keys: string[], lookup: (key: string) => T | null): T[] | null {
  if (!keys.length) return null;
  const out: T[] = [];
  for (const k of keys) {
    const v = lookup(k);
    if (v == null) return null;
    out.push(v);
  }
  return out;
}

/** Pull unique citekeys (in first-seen order) out of `[@citekey]` Pandoc citations. */
export function extractCitekeys(text: string): string[] {
  const keys: string[] = [];
  const clean = text.replace(CODE_RE, " "); // skip code
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

/** citeproc emits HTML entities (`&#38;`, `&amp;`) — decode them (and collapse whitespace)
 *  for the plain-text and DOM renderers of its output. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, n) => safeCodePoint(parseInt(n, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeCodePoint(n: number): string {
  try {
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  } catch {
    return "";
  }
}
