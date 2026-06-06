export interface Chunk {
  id: string;
  citekey: string;
  title: string;
  year: number;
  section: string;
  tags: string[];
  /** Raw text shown to the user. */
  text: string;
  /** Text actually embedded — carries a contextual prefix `[title | section | year]`. */
  embedText: string;
}

export interface ChunkInput {
  citekey: string;
  title: string;
  year: number;
  tags: string[];
  abstract?: string;
  /** Markdown body with frontmatter already stripped. */
  body: string;
}

/** Strip a leading YAML frontmatter block from markdown. */
export function stripFrontmatter(content: string): string {
  const m = content.match(/^---\n[\s\S]*?\n---\n?/);
  return m ? content.slice(m[0].length) : content;
}

/** Pull the year out of a CSL `issued` frontmatter value. */
export function yearFromIssued(issued: unknown): number {
  if (issued && typeof issued === "object") {
    const dp = (issued as Record<string, unknown>)["date-parts"];
    if (Array.isArray(dp) && Array.isArray(dp[0]) && typeof dp[0][0] === "number") {
      return dp[0][0] as number;
    }
  }
  return 0;
}

/** Split text into ~maxChars windows on paragraph/sentence boundaries, with overlap. */
function splitText(text: string, maxChars: number, overlap = 150): string[] {
  const clean = text.replace(/\r/g, "").trim();
  if (clean.length <= maxChars) return clean ? [clean] : [];
  const paras = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && (cur.length + p.length + 2 > maxChars)) {
      chunks.push(cur);
      cur = cur.slice(Math.max(0, cur.length - overlap));
    }
    // a single paragraph longer than maxChars: hard-split
    if (p.length > maxChars) {
      if (cur.trim()) chunks.push(cur);
      cur = "";
      for (let i = 0; i < p.length; i += maxChars - overlap) {
        chunks.push(p.slice(i, i + maxChars));
      }
      continue;
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur.trim()) chunks.push(cur);
  return chunks.map((c) => c.trim()).filter(Boolean);
}

/** Build embeddable chunks for one reference note. */
export function chunkReference(input: ChunkInput, maxChars: number): Chunk[] {
  const { citekey, title, year, tags } = input;
  const sections: Array<{ section: string; text: string }> = [];
  if (input.abstract) sections.push({ section: "abstract", text: input.abstract });

  // Body: skip the H1 title line; keep the rest under a "notes" section bucket.
  const body = input.body
    .replace(/^#\s.*$/m, "")
    .replace(/^##\s*(Notes|Highlights)\s*$/gim, "")
    .trim();
  if (body) sections.push({ section: "notes", text: body });

  const chunks: Chunk[] = [];
  let n = 0;
  for (const { section, text } of sections) {
    for (const piece of splitText(text, maxChars)) {
      const id = `${citekey}#${n++}`;
      const prefix = `[${title} | ${section} | ${year || "n.d."}]`;
      chunks.push({
        id,
        citekey,
        title,
        year,
        section,
        tags,
        text: piece,
        embedText: `${prefix}\n\n${piece}`,
      });
    }
  }
  return chunks;
}
