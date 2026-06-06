import { App, requestUrl, normalizePath } from "obsidian";
import { CSLItem } from "../types";
import * as CSL from "citeproc";

const RAW_STYLES = "https://raw.githubusercontent.com/citation-style-language/styles/master";
const RAW_LOCALE = "https://raw.githubusercontent.com/citation-style-language/locales/master/locales-en-US.xml";

/** Styles shipped in `<plugin>/styles/` (id → friendly label). Prioritized spine journals. */
export const BUNDLED_STYLES: Record<string, string> = {
  spine: "Spine",
  "elsevier-vancouver": "The Spine Journal (Elsevier–Vancouver)",
  "springer-basic-brackets": "European Spine Journal (Springer)",
  "american-medical-association": "AMA 11th (≈ Global Spine J)",
  apa: "APA 7th edition",
};

/** container-title (lowercased) → default CSL style id, for "match the journal" convenience. */
export const JOURNAL_STYLE: Record<string, string> = {
  spine: "spine",
  "the spine journal": "elsevier-vancouver",
  "spine j": "elsevier-vancouver",
  "european spine journal": "springer-basic-brackets",
  "eur spine j": "springer-basic-brackets",
  "global spine journal": "american-medical-association",
  "global spine j": "american-medical-association",
};

/** citeproc-js wrapper: resolves CSL styles (bundled → cached → CSL repo) and renders bibliographies. */
export class CiteEngine {
  private locale = "";
  private styles = new Map<string, string>();

  constructor(private app: App, private pluginDir: string) {}

  private path(rel: string): string {
    return normalizePath(`${this.pluginDir}/styles/${rel}`);
  }
  private async readFile(rel: string): Promise<string | null> {
    try {
      return await this.app.vault.adapter.read(this.path(rel));
    } catch {
      return null;
    }
  }

  private async locales(): Promise<string> {
    if (this.locale) return this.locale;
    const bundled = await this.readFile("locales-en-US.xml");
    if (bundled) return (this.locale = bundled);
    const r = await requestUrl({ url: RAW_LOCALE });
    return (this.locale = r.text);
  }

  /** Resolve a style id to independent CSL XML: bundled → on-disk cache → CSL repo; follow dependent parent. */
  async style(id: string, seen: Set<string> = new Set()): Promise<string> {
    const cached = this.styles.get(id);
    if (cached) return cached;
    let xml =
      (await this.readFile(`${id}.csl`)) ||
      (await this.readFile(`cache/${id}.csl`)) ||
      (await this.fetchStyle(id));
    const parent =
      xml.match(/rel="independent-parent"[^>]*href="[^"]*\/styles\/([^"/]+)"/i) ||
      xml.match(/href="[^"]*\/styles\/([^"/]+)"[^>]*rel="independent-parent"/i);
    seen.add(id);
    if (parent && !seen.has(parent[1])) xml = await this.style(parent[1], seen); // guard dependent cycles
    this.styles.set(id, xml);
    return xml;
  }

  private async fetchStyle(id: string): Promise<string> {
    for (const rel of [`${id}.csl`, `dependent/${id}.csl`]) {
      try {
        const r = await requestUrl({ url: `${RAW_STYLES}/${rel}` });
        if (r.status === 200 && r.text.includes("<style")) {
          // cache for offline reuse (best-effort)
          try {
            await this.app.vault.adapter.write(this.path(`cache/${id}.csl`), r.text);
          } catch {
            /* ignore cache write failure */
          }
          return r.text;
        }
      } catch {
        /* try the dependent path next */
      }
    }
    throw new Error(`Citation style "${id}" not found (not bundled, not in the CSL repo).`);
  }

  /** Render the styled reference list (markdown) and per-citekey in-text labels (HTML),
   *  processed in one pass so numeric in-text markers match the bibliography numbering. */
  async renderNote(
    styleId: string,
    keys: string[],
    getItem: (key: string) => CSLItem | null
  ): Promise<{ bibliography: string[]; inText: Record<string, string> }> {
    const items = keys
      .map((k) => {
        const it = getItem(k);
        return it ? ({ ...(it as CSLItem), id: k } as CSLItem & { id: string }) : null;
      })
      .filter((x): x is CSLItem & { id: string } => !!x);
    if (!items.length) return { bibliography: [], inText: {} };

    const styleXml = await this.style(styleId);
    const localeXml = await this.locales();
    const byId: Record<string, unknown> = {};
    for (const it of items) byId[it.id] = it;
    const sys = { retrieveLocale: () => localeXml, retrieveItem: (id: string) => byId[id] };
    const engine = new CSL.Engine(sys, styleXml);
    engine.updateItems(items.map((i) => i.id));

    // In-text: process each citation as a cluster in document order so numbering increments.
    const inText: Record<string, string> = {};
    const pre: [string, number][] = [];
    items.forEach((it, i) => {
      const cid = `cit${i}`;
      const res = engine.processCitationCluster(
        { citationID: cid, citationItems: [{ id: it.id }], properties: { noteIndex: 0 } },
        pre.slice(),
        []
      );
      for (const u of res[1] as [number, string, string][]) if (u[2] === cid) inText[it.id] = u[1];
      pre.push([cid, 0]);
    });

    const bibRes = engine.makeBibliography();
    const bibliography: string[] = (bibRes && bibRes[1] ? bibRes[1] : []).map(htmlToMarkdown).filter(Boolean);
    return { bibliography, inText };
  }
}

/** citeproc emits HTML; convert the bits we care about to Markdown and decode entities. */
function htmlToMarkdown(html: string): string {
  return html
    .replace(/<i>([\s\S]*?)<\/i>/gi, "*$1*")
    .replace(/<b>([\s\S]*?)<\/b>/gi, "**$1**")
    .replace(/<sup>([\s\S]*?)<\/sup>/gi, "$1")
    .replace(/<sub>([\s\S]*?)<\/sub>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, n) => cp(parseInt(n, 10)))
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function cp(n: number): string {
  try {
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  } catch {
    return "";
  }
}
