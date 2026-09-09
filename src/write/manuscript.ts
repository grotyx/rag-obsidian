import { CSLItem, CiteStyle } from "../types";
import { formatCitation } from "../cite/format";
import {
  decodeEntities,
  extractCitekeys,
  inTextLabel,
  replaceCitations,
  resolveCluster,
  splitAtReferences,
} from "../cite/bibliography";

export interface CompiledManuscript {
  content: string;
  cited: string[];
  missing: string[];
}

export interface CompileInput {
  content: string;
  styleId: string;
  citeStyle: CiteStyle;
  getItem: (citekey: string) => CSLItem | null;
  renderStyle: (
    styleId: string,
    citekeys: string[],
    getItem: (citekey: string) => CSLItem | null
  ) => Promise<{ bibliography: string[]; inText: Record<string, string> }>;
}

function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ""));
}

function lightweightBibliography(keys: string[], getItem: (citekey: string) => CSLItem | null, style: CiteStyle): string {
  return keys
    .map(getItem)
    .filter((item): item is CSLItem => !!item)
    .map((item) => formatCitation(item, style))
    .sort((a, b) => a.localeCompare(b))
    .map((entry) => `- ${entry}`)
    .join("\n");
}

/** Render a manuscript without UI or filesystem side effects so Obsidian and MCP share one path. */
export async function renderCompiledManuscript(input: CompileInput): Promise<CompiledManuscript> {
  const keys = extractCitekeys(input.content);
  if (!keys.length) throw new Error("NO_CITATIONS: no [@citekey] citations in this note");
  const missing = keys.filter((key) => !input.getItem(key));
  let body = input.content;
  let references = "";
  const replace = (text: string, render: (key: string) => string | null): string =>
    replaceCitations(text, (cluster) => resolveCluster(cluster, render)?.join("; ") ?? null);

  if (input.styleId) {
    try {
      const rendered = await input.renderStyle(input.styleId, keys, input.getItem);
      body = replace(input.content, (key) => rendered.inText[key] ? plainText(rendered.inText[key]) : null);
      references = rendered.bibliography.join("\n\n");
    } catch {
      // A style failure uses the same lightweight fallback as the Obsidian command.
    }
  }
  if (!references) {
    body = replace(input.content, (key) => {
      const item = input.getItem(key);
      return item ? inTextLabel(item) : null;
    });
    references = lightweightBibliography(keys, input.getItem, input.citeStyle);
  }
  const { base, tail } = splitAtReferences(body);
  return {
    content: `${base ? base + "\n\n" : ""}## References\n\n${references}\n${tail}`,
    cited: keys,
    missing,
  };
}
