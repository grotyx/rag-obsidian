import { citePattern, keysInCite } from "./bibliography";

export interface CiteCluster {
  from: number;
  to: number;
  keys: string[];
}

/** `[@a; @b]` brackets in `text` (document offsets), skipping fenced blocks and inline code.
 *  ponytail: line-based fence scan over the whole note per call; fine for notes, not megabyte files. */
export function citeClusters(text: string): CiteCluster[] {
  const code: [number, number][] = [];
  let fence: string | null = null;
  let fenceStart = 0;
  let pos = 0;
  for (const line of text.split("\n")) {
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence === null && m) {
      fence = m[1][0];
      fenceStart = pos;
    } else if (fence !== null && m && m[1][0] === fence) {
      code.push([fenceStart, pos + line.length]);
      fence = null;
    } else if (fence === null) {
      for (const c of line.matchAll(/`[^`]*`/g)) code.push([pos + (c.index ?? 0), pos + (c.index ?? 0) + c[0].length]);
    }
    pos += line.length + 1;
  }
  if (fence !== null) code.push([fenceStart, text.length]); // unclosed fence runs to the end
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
