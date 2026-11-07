import { citePattern, codeRanges, keysInCite } from "./bibliography";

export interface CiteCluster {
  from: number;
  to: number;
  keys: string[];
}

/** `[@a; @b]` brackets in `text` (document offsets), skipping fenced blocks and inline code
 *  (the same scanner as `replaceCitations`, so every path agrees). */
export function citeClusters(text: string): CiteCluster[] {
  const code = codeRanges(text);
  const out: CiteCluster[] = [];
  const re = citePattern();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    if (code.some(([a, b]) => from < b && to > a)) continue;
    const keys = keysInCite(m[1]);
    if (keys.length) out.push({ from, to, keys });
  }
  return out;
}
