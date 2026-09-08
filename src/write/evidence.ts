import type { SearchHit } from "../index/store";
import { extractCitekeys, keysInCite, splitAtReferences } from "../cite/bibliography";

export interface Paragraph {
  /** The paragraph's text, exactly as it appears in the note (offsets index the raw markdown). */
  text: string;
  start: number;
  end: number;
  /** Holds at least one `[@key]` cluster (code spans/blocks don't count — `extractCitekeys` skips them). */
  cited: boolean;
}

/** Prose paragraphs of a manuscript, above `## References` only. Headings, fenced code,
 *  frontmatter, comments (`%%…%%`, `<!-- … -->`), blockquotes/callouts, tables and bare list
 *  markers are skipped; offsets point into the original string so a caller can insert a
 *  citation at `end`. */
export function paragraphsOf(markdown: string): Paragraph[] {
  const base = splitAtReferences(markdown).base;
  const lines = base.split("\n");
  const out: Paragraph[] = [];
  let buf: string[] = [];
  let bufStart = 0;
  let bufEnd = 0;
  let offset = 0;
  let fenced = false;
  let comment: RegExp | null = null; // the closer of the comment block we are inside
  let inFrontmatter = /^---\s*$/.test(lines[0] ?? "");

  const flush = () => {
    const text = buf.join("\n").trim();
    // a block of nothing but list bullets / numbers is structure, not prose
    if (text && text.replace(/^\s*([-*+]|\d+[.)])\s*/gm, "").trim()) {
      out.push({ text, start: bufStart, end: bufEnd, cited: extractCitekeys(text).length > 0 });
    }
    buf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const start = offset;
    offset += line.length + 1; // +1 for the "\n" split removed
    if (inFrontmatter) {
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) inFrontmatter = false;
      continue;
    }
    if (/^\s*```/.test(line)) {
      flush();
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (comment) {
      if (comment.test(line)) comment = null;
      continue;
    }
    const opens = line.match(/^\s*(%%|<!--)/);
    if (opens) {
      flush();
      const closer = opens[1] === "%%" ? /%%/ : /-->/;
      if (!closer.test(line.slice(opens[0].length))) comment = closer; // else it closed on this line
      continue;
    }
    // blank / heading / blockquote-callout / table row — structure, not prose
    if (!line.trim() || /^\s*(#{1,6}\s|>|\|)/.test(line)) {
      flush();
      continue;
    }
    if (!buf.length) bufStart = start;
    buf.push(line);
    bufEnd = start + line.replace(/\s+$/, "").length;
  }
  flush();
  return out;
}

// Each rule is one cheap regex over the paragraph. False negatives are fine (a missed
// suggestion); false positives are not (a nag on a sentence that never wanted a citation).
const NOT_A_CLAIM: RegExp[] = [
  /\?/, // a paragraph that asks something is posing, not asserting
  /\b(we|i)\s+(describe|present|report|show|propose|introduce|argue|discuss|will)\b/i, // the author's own plan
  /\b(this|the)\s+(section|paper|chapter|note|manuscript|study|review)\b/i, // signposting
  /\b(figure|table|fig\.|appendix)\s*\d/i, // pointer to the author's own exhibit
  /^(in summary|in conclusion|to summarize|overall|here we|finally|taken together)\b/i, // hedged wrap-up
];

/** Does this paragraph read like a declarative claim that would normally carry a citation? */
export function looksLikeClaim(text: string): boolean {
  const t = text.trim();
  if (t.split(/\s+/).filter(Boolean).length < 8) return false; // too short to be a claim
  if (!/\.\s*$/.test(t)) return false; // an assertion ends in a full stop
  return !NOT_A_CLAIM.some((re) => re.test(t));
}

/** Paragraphs that assert something and cite nothing. */
export function unsupportedClaims(markdown: string): Paragraph[] {
  return paragraphsOf(markdown).filter((p) => !p.cited && looksLikeClaim(p.text));
}

/** Chunk hits → one row per reference (its best-scoring chunk), retrieval order kept. */
export function rankHits(hits: SearchHit[], max = 8): SearchHit[] {
  const best = new Map<string, SearchHit>();
  for (const h of hits) {
    const prev = best.get(h.citekey);
    if (!prev || h.score > prev.score) best.set(h.citekey, h); // set() keeps the first insertion's position
  }
  return [...best.values()].slice(0, max);
}

/** Where a new `[@key]` goes relative to the text before the cursor: inside the sentence
 *  ("stays [@key].", not "stays.[@key]") and after a space. `back` is how many characters
 *  before the cursor the insertion starts (1 when stepping in front of terminal punctuation). */
export function citationInsertion(before: string, key: string): { back: number; text: string } {
  const cite = `[@${key}]`;
  const m = before.match(/([.!?])$/);
  if (m && !/\.\.\.$/.test(before)) {
    const body = before.slice(0, -1);
    return { back: 1, text: (body.length && !/\s$/.test(body) ? " " : "") + cite };
  }
  return { back: 0, text: (before.length && !/\s$/.test(before) ? " " : "") + cite };
}

/** Same, but merging into the citation cluster the cursor sits behind: `[@a].` + b →
 *  `[@a; @b].`. A bracket only counts as a cluster when every key in it is `@`-prefixed and
 *  `isKnown` (so `[john@x.org]` gets a citation appended after it, not merged into it).
 *  `null` = the key is already in that cluster. */
export function citationEdit(
  before: string,
  key: string,
  isKnown: (key: string) => boolean
): { back: number; text: string } | null {
  const m = before.match(/\[([^[\]]*@[^[\]]*)\]([.,;:!?)]*)$/);
  if (m) {
    const keys = keysInCite(m[1]);
    if (keys.length && m[1].split(";").every((part) => /^\s*-?@/.test(part)) && keys.every(isKnown)) {
      if (keys.includes(key)) return null;
      return { back: m[2].length + 1, text: `; @${key}` }; // insert in front of the closing "]"
    }
  }
  return citationInsertion(before, key);
}
