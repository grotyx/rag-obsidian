/** Query expansion for the lexical (BM25) arm only; the vector arm keeps the original query.
 *  Pure: no obsidian imports. Vocabulary is data (a user JSON file and/or cached MeSH entry
 *  terms), never code — the core stays domain-agnostic. */
import { arr, optStr, rec } from "../util/json";

export interface Concept {
  name: string;
  aliases: string[];
  broader: string[];
  narrower: string[];
}
export interface Vocabulary {
  version: 1;
  concepts: Concept[];
}
export interface Expansion {
  terms: string[];
  matched: string[];
}
export interface Expander {
  expand(query: string): Expansion;
}

const MAX_ADDED = 12;
const HANGUL = /\p{Script=Hangul}/u;
const LATIN = /\p{Script=Latin}/u;

/** Lowercase, NFC, punctuation (except hyphen) to space, collapsed. */
export function normalizeQuery(s: string): string {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function strings(v: unknown): string[] {
  const out: string[] = [];
  for (const x of arr(v)) {
    const s = optStr(x)?.trim();
    if (s && s.length > 1 && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out;
}

/** Validate a user vocabulary file; unusable concepts are dropped, never thrown on. */
export function parseVocabulary(json: unknown): Vocabulary {
  const concepts: Concept[] = [];
  for (const c of arr(rec(json).concepts)) {
    const r = rec(c);
    const name = optStr(r.name)?.trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    concepts.push({
      name,
      aliases: strings(r.aliases).filter((a) => a.toLowerCase() !== lower),
      broader: strings(r.broader),
      narrower: strings(r.narrower),
    });
  }
  return { version: 1, concepts };
}

interface Group {
  /** Terms to add when matched, best first (name/heading leads). */
  terms: string[];
}

/** Hangul-only surfaces match as substrings with spaces removed (Korean attaches particles
 *  and varies spacing); everything else matches in the normalized text. */
const isCompact = (s: string): boolean => HANGUL.test(s) && !LATIN.test(s);
const latinFirst = (xs: string[]): string[] => [...xs.filter((x) => LATIN.test(x)), ...xs.filter((x) => !LATIN.test(x))];

export function buildExpander(vocab: Vocabulary | null, mesh: Record<string, string[]> | null): Expander {
  const groups: Group[] = [];
  // surface -> group index; -1 = ambiguous (claimed by two groups of the same source), dropped.
  // Names beat aliases; a vocabulary claim beats a MeSH one (the user's own vocabulary is the
  // stronger signal), so only clashes *within* a source make a surface ambiguous.
  const names = new Map<string, number>();
  const aliases = new Map<string, number>();
  let vocabGroups = 0;
  const claim = (m: Map<string, number>, surface: string, g: number): void => {
    const k = normalizeQuery(surface);
    if (k.length < 2) return;
    const prev = m.get(k);
    if (prev === undefined) m.set(k, g);
    else if (prev !== g && !(prev >= 0 && prev < vocabGroups && g >= vocabGroups)) m.set(k, -1);
  };
  for (const c of vocab?.concepts ?? []) {
    const g = groups.push({ terms: [c.name, ...latinFirst(c.aliases).slice(0, 4), ...c.broader.slice(0, 1), ...c.narrower.slice(0, 4)] }) - 1;
    claim(names, c.name, g);
    for (const a of c.aliases) claim(aliases, a, g);
  }
  vocabGroups = groups.length;
  // One group per heading: the cache can hold "Low Back Pain" and the tag form "low back pain".
  const merged = new Map<string, { heading: string; entries: string[] }>();
  for (const [heading, entries] of Object.entries(mesh ?? {})) {
    const k = normalizeQuery(heading);
    const m = merged.get(k);
    if (m) m.entries.push(...entries);
    else merged.set(k, { heading, entries: [...entries] });
  }
  for (const { heading, entries } of merged.values()) {
    const uniq = [...new Set(entries)];
    const g = groups.push({ terms: [heading, ...latinFirst(uniq).slice(0, 4)] }) - 1;
    claim(names, heading, g);
    for (const e of uniq) claim(aliases, e, g);
  }
  const surfaces = new Map<string, number>(aliases);
  for (const [k, g] of names) surfaces.set(k, g);
  for (const [k, g] of [...surfaces]) if (g < 0) surfaces.delete(k);
  // ponytail: linear scan of every surface per query (~ms for 100k); build an automaton if it shows up in profiles.
  const ordered = [...surfaces].sort((a, b) => b[0].length - a[0].length);

  return {
    expand(query: string): Expansion {
      const text = normalizeQuery(query);
      const compact = text.replace(/\s/g, "");
      const usedText = new Array<boolean>(text.length).fill(false);
      const usedCompact = new Array<boolean>(compact.length).fill(false);
      const hits: { at: number; g: number }[] = [];
      for (const [surface, g] of ordered) {
        const compactHay = isCompact(surface);
        const hay = compactHay ? compact : text;
        const used = compactHay ? usedCompact : usedText;
        const needle = compactHay ? surface.replace(/\s/g, "") : surface;
        // Short Latin acronyms ("odi") must be whole tokens: hyphen also counts as a word edge.
        const short = !compactHay && needle.length <= 3 && LATIN.test(needle);
        const word = short ? /[\p{Script=Latin}\p{N}-]/u : /[\p{Script=Latin}\p{N}]/u;
        for (let from = 0; ; from++) {
          const i = hay.indexOf(needle, from);
          if (i < 0) break;
          from = i;
          const j = i + needle.length;
          // Hangul carries particles ("에서"), so only Latin phrases need word edges.
          if (!compactHay && ((i > 0 && word.test(hay[i - 1])) || (j < hay.length && word.test(hay[j])))) continue;
          if (used.slice(i, j).some(Boolean)) continue;
          used.fill(true, i, j);
          hits.push({ at: i / Math.max(hay.length, 1), g });
          break;
        }
      }
      hits.sort((x, y) => x.at - y.at);
      const seenG = new Set<number>();
      const matched: string[] = [];
      const lists: string[][] = [];
      for (const h of hits) {
        if (seenG.has(h.g)) continue;
        seenG.add(h.g);
        matched.push(groups[h.g].terms[0]);
        lists.push(groups[h.g].terms);
      }
      // Round-robin so one concept with many aliases cannot crowd out the others.
      const terms: string[] = [];
      const have = new Set<string>();
      for (let r = 0; terms.length < MAX_ADDED && lists.some((l) => r < l.length); r++) {
        for (const l of lists) {
          if (terms.length >= MAX_ADDED) break;
          // "Spinal Fusion (general)" / "Complication Rate (overall)": the qualifier is a label, not search text.
          const t = l[r]?.replace(/\s*\([^)]*\)\s*$/, "").replace(/\//g, " ").trim();
          if (!t) continue;
          const k = normalizeQuery(t);
          if (!k || have.has(k) || (LATIN.test(k) ? ` ${text} `.includes(` ${k} `) : compact.includes(k.replace(/\s/g, "")))) continue;
          have.add(k);
          terms.push(t);
        }
      }
      return { terms, matched };
    },
  };
}

/** True when most letters are outside the Latin script (Korean, Japanese, Chinese, Cyrillic…):
 *  such a query is worth translating before it meets an English index. */
export function isForeignQuery(q: string): boolean {
  const letters = q.match(/\p{L}/gu) ?? [];
  if (!letters.length) return false;
  const latin = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length;
  return latin / letters.length < 0.5;
}

/** What the BM25 arm receives: the original query plus the added terms. */
export function expandedTerm(query: string, e: Expansion): string {
  return e.terms.length ? `${query} ${e.terms.join(" ")}` : query;
}
