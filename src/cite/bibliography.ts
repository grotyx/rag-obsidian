import { Library } from "../data/library";
import { formatCitation } from "./format";
import { CiteStyle, CSLItem } from "../types";
import { STASH_MARKER } from "../ingest/pdfStash";

const CITE_RE = /\[([^\]]*@[^\]]*)\]/g; // [@key]  ·  [-@key]  ·  [@a; @b]  ·  [@key, p. 23]
const KEY_RE = /-?@([A-Za-z0-9_][A-Za-z0-9_:.#$%&+?<>~/-]*)/g; // Pandoc citekey (locators ignored)

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

/** Document offsets `[from, to)` of fenced blocks and inline code. A fence is ``` or ~~~ (any
 *  length >= 3) and closes on the same character at least as long, so a four-backtick block may
 *  hold ``` lines. The one scanner every citation path uses (reading view, compile, rename, the
 *  editor), so they agree on what is code. An unclosed fence runs to the end of the text.
 *  ponytail: line-based scan over the whole note per call; fine for notes, not megabyte files. */
export function codeRanges(text: string): [number, number][] {
  const code: [number, number][] = [];
  let fence: string | null = null;
  let fenceStart = 0;
  let pos = 0;
  for (const line of text.split("\n")) {
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (fence === null && m && !(m[1][0] === "`" && m[2].includes("`"))) {
      fence = m[1];
      fenceStart = pos;
    } else if (fence !== null) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !m[2].trim()) {
        code.push([fenceStart, pos + line.length]);
        fence = null;
      }
    } else {
      for (const c of line.matchAll(/`[^`]*`/g)) code.push([pos + (c.index ?? 0), pos + (c.index ?? 0) + c[0].length]);
    }
    pos += line.length + 1;
  }
  if (fence !== null) code.push([fenceStart, text.length]);
  return code;
}

/** Replace every `re` match that does not touch code; `fn` returns the replacement, or null to
 *  keep the match as written. */
function replaceOutsideCode(text: string, re: RegExp, fn: (m: RegExpExecArray) => string | null): string {
  const code = codeRanges(text);
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    if (!m[0]) re.lastIndex++;
    if (code.some(([a, b]) => from < b && to > a)) continue;
    const r = fn(m);
    if (r === null) continue;
    out += text.slice(last, from) + r;
    last = to;
  }
  return out + text.slice(last);
}

/** Rewrite `[…@key…]` citations that are NOT inside code. `render` gets one bracket's keys
 *  and its raw text, and returns the replacement — or null to leave the bracket as written
 *  (unknown citekey, an e-mail in brackets). Mirrors what `extractCitekeys` chooses to see. */
export function replaceCitations(
  text: string,
  render: (keys: string[], raw: string) => string | null
): string {
  return replaceOutsideCode(text, citePattern(), (m) => render(keysInCite(m[1]), m[0]));
}

/** One Pandoc citation item, in citeproc's `citationItems` shape. */
export interface CiteItem {
  id: string;
  prefix?: string;
  suffix?: string;
  locator?: string;
  label?: string;
  "suppress-author"?: boolean;
}

const LOCATOR_LABELS: Record<string, string> = {
  p: "page", pp: "page", page: "page", pages: "page",
  chap: "chapter", chaps: "chapter", ch: "chapter", chapter: "chapter",
  sec: "section", secs: "section", sect: "section", section: "section", "§": "section",
  fig: "figure", figs: "figure", figure: "figure",
  vol: "volume", vols: "volume", volume: "volume",
  para: "paragraph", paras: "paragraph", "¶": "paragraph", paragraph: "paragraph",
  col: "column", cols: "column", column: "column",
  pt: "part", part: "part", bk: "book", book: "book",
};
const LOCATOR_VALUE = String.raw`(\d[\d\-–]*(?:\s*[,&]\s*\d[\d\-–]*)*|[ivxlcdm]+(?![A-Za-z]))`;

/** Split the text after a citekey into locator (with label) and suffix, Pandoc style:
 *  `, p. 23, emphasis added` / ` chap. 3` / `, 23`. A bare number is a page; anything else
 *  is all suffix. */
function parseTrail(trail: string): { locator?: string; label?: string; suffix?: string } {
  const t = trail.replace(/^\s*,?\s*/, "");
  if (!t) return {};
  const labelled = t.match(new RegExp(String.raw`^([A-Za-z]+|§|¶)\.?\s*${LOCATOR_VALUE}(?![\w])(.*)$`));
  let label: string | undefined;
  let locator: string | undefined;
  let rest: string;
  if (labelled && LOCATOR_LABELS[labelled[1].toLowerCase()]) {
    label = LOCATOR_LABELS[labelled[1].toLowerCase()];
    locator = labelled[2].trim();
    rest = labelled[3];
  } else {
    const bare = t.match(new RegExp(String.raw`^(\d[\d\-–]*(?:\s*[,&]\s*\d[\d\-–]*)*)(?![\w])(.*)$`));
    if (!bare) return { suffix: trail.trim().startsWith(",") ? trail.trim() : ` ${t}` };
    label = "page";
    locator = bare[1].trim();
    rest = bare[2];
  }
  const suffix = rest.trim();
  return { locator, label, suffix: suffix ? (suffix.startsWith(",") ? suffix : ` ${suffix}`) : undefined };
}

/** Parse one bracket body (`see @a, p. 23; -@b`) into Pandoc citation items: prefix, key,
 *  locator with label, suffix, suppress-author. Segments without a key are dropped. */
export function parseCiteItems(body: string): CiteItem[] {
  const out: CiteItem[] = [];
  for (const seg of body.split(";")) {
    const re = new RegExp(KEY_RE.source, "g");
    const m = re.exec(seg);
    if (!m) continue;
    const item: CiteItem = { id: m[1] };
    const prefix = seg.slice(0, m.index).trim();
    if (prefix) item.prefix = `${prefix} `;
    if (m[0].startsWith("-")) item["suppress-author"] = true;
    const { locator, label, suffix } = parseTrail(seg.slice(m.index + m[0].length));
    if (locator) {
      item.locator = locator;
      item.label = label;
    }
    if (suffix) item.suffix = suffix;
    out.push(item);
  }
  return out;
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

/** Rewrite an answer's `[n]` source anchors into Pandoc `[@citekey]` clusters, so a saved chat
 *  answer is a citable draft that "Update bibliography" understands. `citekeys[n-1]` is the
 *  source behind `[n]`; adjacent anchors (`[1][3]`) collapse into one cluster. A run holding any
 *  unknown number is left exactly as written (same all-or-nothing rule as `resolveCluster`), and
 *  anchors inside code are skipped, like `replaceCitations`. */
export function anchorsToCitekeys(text: string, citekeys: string[]): string {
  return replaceOutsideCode(text, /(?:\[\d+\])+/g, (m) => {
    const keys = resolveCluster(m[0].match(/\d+/g) ?? [], (d) => citekeys[parseInt(d, 10) - 1] ?? null);
    return keys ? `[${keys.map((k) => `@${k}`).join("; ")}]` : null;
  });
}

/** Rewrite `[@key]` citations under a citekey rename map (merge-duplicates' loser → keeper).
 *  Preserves everything else in the bracket verbatim — separators, locators (`, p. 3`) — by
 *  replacing only the matched key tokens in place. A cluster that maps two keys onto the same
 *  new key (`[@a; @b]` where both rename to the same keeper) collapses to one, dropping any
 *  locators, since there is no single locator left to keep. Keys not in `map` are untouched;
 *  code spans are skipped, like `replaceCitations`. */
export function renameCiteKeys(text: string, map: Record<string, string>): string {
  if (!Object.keys(map).length) return text;
  return replaceCitations(text, (keys, raw) => {
    const mapped = keys.map((k) => map[k] ?? k);
    if (mapped.every((k, i) => k === keys[i])) return null; // nothing renamed in this cluster
    const unique = [...new Set(mapped)];
    if (unique.length !== mapped.length) return `[${unique.map((k) => `@${k}`).join("; ")}]`;
    return raw.replace(new RegExp(KEY_RE.source, "g"), (tok, key: string) =>
      tok.startsWith("-@") ? `-@${map[key] ?? key}` : `@${map[key] ?? key}`
    );
  });
}

/** Pull unique citekeys (in first-seen order) out of `[@citekey]` Pandoc citations. */
export function extractCitekeys(text: string): string[] {
  const keys: string[] = [];
  replaceCitations(text, (ks) => {
    for (const k of ks) if (!keys.includes(k)) keys.push(k);
    return null;
  });
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

/** Split a note around its References section (any heading depth: `##` or `###`):
 *  `base` is everything before the heading (trailing whitespace trimmed), `tail` is any
 *  later section (e.g. "## Appendix", "### Notes") to reattach after the bibliography. */
export function splitAtReferences(content: string): { base: string; tail: string } {
  const code = codeRanges(content);
  const inCode = (i: number) => code.some(([a, b]) => i >= a && i < b);
  const heading = /(^|\n)#{1,6}\s+References[ \t]*(\n|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = heading.exec(content)) !== null && inCode(m.index + m[1].length)) heading.lastIndex = m.index + 1;
  if (!m) return { base: content.replace(/\s+$/, ""), tail: "" };
  const nextRe = /\n#{1,6}[ \t]/g;
  nextRe.lastIndex = m.index + m[0].length;
  let next: RegExpExecArray | null;
  while ((next = nextRe.exec(content)) !== null && inCode(next.index + 1)) nextRe.lastIndex = next.index + 1;
  return {
    base: content.slice(0, m.index).replace(/\s+$/, ""),
    tail: next ? content.slice(next.index) : "",
  };
}

/** Compact in-text label `(Author, Year)` for inline rendering. */
export function inTextLabel(item: CSLItem): string {
  const fam = item.author?.[0]?.family || item.author?.[0]?.literal || "?";
  const dp = item.issued?.["date-parts"]?.[0];
  const yr = dp && dp[0] ? dp[0] : "n.d.";
  return `(${fam}, ${yr})`;
}

/** Decode HTML entities (citeproc's `&#38;`/`&amp;`, escaped markup in PubMed/Crossref text) and
 *  collapse whitespace. One pass, so `&amp;lt;` becomes the text "&lt;", not "<". */
export function decodeEntities(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return s
    .replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos|nbsp));/g, (_m: string, h?: string, d?: string, n?: string) =>
      h ? safeCodePoint(parseInt(h, 16)) : d ? safeCodePoint(parseInt(d, 10)) : named[n ?? ""]
    )
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

/** Where a note's summary block starts (its heading line) and ends (the next heading that is
 *  not its own `## 요약 (KR)` half, or end of content), or null when there is none. The opening
 *  heading is `## Summary` (current, language-agnostic) or, for notes written before the heading
 *  was unified, the legacy `## Summary (EN)` — optionally followed by its `## 요약 (KR)` other
 *  half, which the walk below also skips over. Shared by `replaceSummaryBlock` (insert) and
 *  `extractSummaryBlock` (read) so they can never disagree on the boundary. */
function summaryBlockRange(content: string): { start: number; end: number } | null {
  const m = content.match(/(^|\n)##[ \t]+(Summary(?:[ \t]*\([^)\n]*\))?|요약 \(KR\))[ \t]*(\n|$)/);
  if (!m || m.index === undefined) return null;
  const start = m.index + m[1].length;
  let cur = m.index + m[0].length;
  for (;;) {
    const next = content.slice(cur).search(/\n#{1,6}[ \t]+/);
    if (next < 0) return { start, end: content.length };
    const at = cur + next + 1;
    // The KR heading is the block's own second half — keep walking past it.
    const kr = content.slice(at).match(/^##[ \t]+요약 \(KR\)[ \t]*(\n|$)/);
    if (kr) {
      cur = at + kr[0].length;
      continue;
    }
    return { start, end: at };
  }
}

/** Replace a note's summary block with `newBlockLines`, appending it at the end when the note
 *  has none (see `summaryBlockRange` for the boundary rule, same one `splitAtReferences` uses,
 *  so a following `## Notes` / `## References` / `# Appendix` survives). */
export function replaceSummaryBlock(content: string, newBlockLines: string[]): string {
  const block = newBlockLines.join("\n").replace(/\s*$/, "");
  const range = summaryBlockRange(content);
  if (!range) {
    // A new block goes above `## Notes` / the extracted full-text stash (whichever comes
    // first), never inside the stash, which is a few hundred KB of PDF text.
    const at = [/(^|\n)##[ \t]+Notes[ \t]*(\n|$)/, new RegExp(`(^|\\n)${STASH_MARKER.replace(/[()]/g, "\\$&")}`)]
      .map((re) => {
        const m = content.match(re);
        return m?.index === undefined ? -1 : m.index + m[1].length;
      })
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)[0];
    if (at === undefined) return `${content.replace(/\s*$/, "")}\n\n${block}\n`;
    return `${content.slice(0, at).replace(/\s*$/, "")}\n\n${block}\n\n${content.slice(at)}`;
  }
  const { start, end } = range;
  if (end >= content.length) return `${content.slice(0, start)}${block}\n`;
  return `${content.slice(0, start)}${block}\n\n${content.slice(end)}`;
}

/** The note's summary block as written (heading line included), trimmed — or null when the note
 *  has no block, or the block is heading-only with no text under it. The read-side counterpart
 *  of `replaceSummaryBlock`, used by merge-duplicates to move a loser's summary into the keeper. */
export function extractSummaryBlock(content: string): string | null {
  const range = summaryBlockRange(content);
  if (!range) return null;
  const text = content.slice(range.start, range.end).trim();
  // Headings alone (`## Summary`, legacy `## 요약 (KR)`) are not a summary.
  const body = text.replace(/^#{1,6}[ \t].*$/gm, "").trim();
  return body ? text : null;
}
