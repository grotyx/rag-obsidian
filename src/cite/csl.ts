import { App, requestUrl, normalizePath } from "obsidian";
import { CSLItem } from "../types";
import type { CiteItem } from "./bibliography";
import * as CSL from "citeproc";

/** citeproc-js ships no types (`src/citeproc.d.ts` declares the module as untyped) — describe
 *  only the Engine surface this file actually calls. */
interface CiteprocEngine {
  updateItems(ids: string[]): void;
  processCitationCluster(
    citation: { citationID: string; citationItems: CiteItem[]; properties: { noteIndex: number } },
    pre: [string, number][],
    post: unknown[]
  ): [unknown, [number, string, string][]];
  makeBibliography(): [{ entry_ids?: string[][] }, string[]] | undefined;
}
interface CiteprocModule {
  Engine: new (
    sys: { retrieveLocale: (lang: string) => string; retrieveItem: (id: string) => unknown },
    style: string
  ) => CiteprocEngine;
}
const Citeproc = CSL as unknown as CiteprocModule;

const RAW_STYLES = "https://raw.githubusercontent.com/citation-style-language/styles/master";
const RENAMED_STYLES = `${RAW_STYLES}/renamed-styles.json`;
const RAW_LOCALE = "https://raw.githubusercontent.com/citation-style-language/locales/master/locales-en-US.xml";

// Style ids come from note frontmatter and flow into vault paths + URLs:
// restrict to safe chars (no slashes, no leading dot → no `../` traversal).
const SAFE_STYLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Styles shipped in `<plugin>/styles/` (id → friendly label). Prioritized spine journals. */
export const BUNDLED_STYLES: Record<string, string> = {
  spine: "Spine",
  "elsevier-vancouver": "The Spine Journal (Elsevier–Vancouver)",
  "springer-basic-brackets": "European Spine Journal (Springer)",
  "american-medical-association": "AMA 11th (≈ Global Spine J)",
  apa: "APA 7th edition",
};

/** Frontmatter keys the plugin manages. They share the note with the CSL-JSON fields, and
 *  citeproc would render some of them: CSL defines `status` ("in press"), so a note's
 *  `status: unread` printed "Unread." into every bibliography entry. */
export const PLUGIN_FIELDS = new Set([
  "citekey",
  "status",
  "added",
  "tags",
  "pdf",
  "summary_source",
  "mesh_terms",
  "summary_model",
  "oa_url",
  "oa_pdf",
  "oa_version",
  "retracted",
  "cited_by_count",
  "openalex_id",
  "kq",
  "include",
  "level",
  "design",
  "screening_note",
  "guideline",
  "study_id",
  "rob_tool",
  "rob_overall",
  "rob_note",
  "search_chunk",
  "sweep_category",
  "imported_from",
  "csl",
  "citation-style",
  "aliases",
  "position", // Obsidian's own frontmatter cache marker
]);

/** A note's CSL fields only: the plugin-managed frontmatter keys removed. */
export function cslFields<T extends object>(item: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(item)) if (!PLUGIN_FIELDS.has(field)) out[field] = value;
  return out;
}

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
    if (!SAFE_STYLE_ID.test(id)) {
      // callers catch and fall back to the default/lightweight style
      throw new Error(`Citation style "${id}" is not a valid style id.`);
    }
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
    // Old ids (e.g. "vancouver" → "nlm-citation-sequence") live on only in renamed-styles.json.
    const renamed = await this.renamedId(id);
    if (renamed) return this.fetchStyle(renamed);
    throw new Error(`Citation style "${id}" not found (not bundled, not in the CSL repo).`);
  }

  private async renamedId(id: string): Promise<string | null> {
    try {
      const r = await requestUrl({ url: RENAMED_STYLES });
      const to = (r.json as Record<string, unknown>)[id];
      return typeof to === "string" && to !== id && SAFE_STYLE_ID.test(to) ? to : null;
    } catch {
      return null;
    }
  }

  private static readonly PLUGIN_FIELDS = PLUGIN_FIELDS;

  /** A citeproc engine over `keys` with every item registered, or null when none resolves. */
  private async open(
    styleId: string,
    keys: string[],
    getItem: (key: string) => CSLItem | null
  ): Promise<{ engine: CiteprocEngine; ids: string[] } | null> {
    const byId = new Map<string, unknown>();
    for (const k of keys) {
      const it = getItem(k);
      if (it) byId.set(k, { id: k, ...cslFields(it) });
    }
    const ids = [...byId.keys()]; // Map keeps document order even for numeric-looking citekeys
    if (!ids.length) return null;
    const styleXml = await this.style(styleId);
    const localeXml = await this.locales();
    const sys = { retrieveLocale: () => localeXml, retrieveItem: (id: string) => byId.get(id) };
    const engine = new Citeproc.Engine(sys, styleXml);
    engine.updateItems(ids);
    return { engine, ids };
  }

  private bibliographyOf(engine: CiteprocEngine): { bibliography: string[]; entryIds: string[] } {
    const bibRes = engine.makeBibliography();
    const ids: string[] = (bibRes?.[0]?.entry_ids ?? []).map((a) => a[0]);
    const entries = (bibRes?.[1] ?? [])
      .map((h, i) => ({ id: ids[i] ?? "", text: htmlToMarkdown(h) }))
      .filter((e) => e.text);
    // `bibliography[i]` is the entry for citekey `entryIds[i]` (style's own order).
    return { bibliography: entries.map((e) => e.text), entryIds: entries.map((e) => e.id) };
  }

  /** Render the styled reference list (markdown) and per-citekey in-text labels (HTML),
   *  processed in one pass so numeric in-text markers match the bibliography numbering.
   *
   *  With `clusters` (one array of Pandoc citation items per `[...]` bracket, in document order),
   *  each bracket is processed as ONE citeproc cluster instead, and `clusterText[i]` is bracket
   *  i's HTML: locators, prefixes, suppress-author and merged numeric output ("¹˒²", "(A, 2020;
   *  B, 2020)") all come from the style. `inText` is then empty — the caller wanted brackets. */
  async renderNote(
    styleId: string,
    keys: string[],
    getItem: (key: string) => CSLItem | null,
    clusters?: CiteItem[][]
  ): Promise<{ bibliography: string[]; inText: Record<string, string>; entryIds: string[]; clusterText?: string[] }> {
    const opened = await this.open(styleId, keys, getItem);
    if (!opened) return { bibliography: [], inText: {}, entryIds: [], clusterText: clusters ? [] : undefined };
    const { engine, ids } = opened;

    // Process each citation in document order so numbering increments. A later cluster can
    // change an earlier label (same author and year → 2020a / 2020b), so EVERY update citeproc
    // returns is applied, not just the one for the cluster just processed.
    const inText: Record<string, string> = {};
    const clusterText: string[] = [];
    const slot = new Map<string, number>(); // citationID → index into clusters / ids
    const pre: [string, number][] = [];
    const feed = (citationItems: CiteItem[], i: number) => {
      const cid = `cit${i}`;
      slot.set(cid, i);
      const res = engine.processCitationCluster(
        { citationID: cid, citationItems, properties: { noteIndex: 0 } },
        pre.slice(),
        []
      );
      for (const u of res[1]) {
        const at = slot.get(u[2]);
        if (at === undefined) continue;
        if (clusters) clusterText[at] = u[1];
        else inText[ids[at]] = u[1];
      }
      pre.push([cid, 0]);
    };
    if (clusters) clusters.forEach((c, i) => feed(c, i));
    else ids.forEach((id, i) => feed([{ id }], i));

    return { ...this.bibliographyOf(engine), inText, clusterText: clusters ? clusterText : undefined };
  }

  /** The styled reference list only: `updateItems` + `makeBibliography`, no per-citation
   *  pass. For callers that never show in-text labels (the annotated bibliography), where the
   *  cluster pass is pure waste on a big library. Numeric styles number entries in `keys` order. */
  async renderBibliographyOnly(
    styleId: string,
    keys: string[],
    getItem: (key: string) => CSLItem | null
  ): Promise<{ bibliography: string[]; entryIds: string[] }> {
    const opened = await this.open(styleId, keys, getItem);
    return opened ? this.bibliographyOf(opened.engine) : { bibliography: [], entryIds: [] };
  }
}

/** citeproc emits HTML; convert the bits we care about to Markdown and decode entities. */
function htmlToMarkdown(html: string): string {
  return html
    .replace(/<i>([\s\S]*?)<\/i>/gi, "*$1*")
    .replace(/<b>([\s\S]*?)<\/b>/gi, "**$1**")
    .replace(/<sup>([\s\S]*?)<\/sup>/gi, "$1")
    .replace(/<sub>([\s\S]*?)<\/sub>/gi, "$1")
    .replace(/<\/div>/gi, " ") // "[1]" / "1." and the entry arrive as sibling divs; keep a gap
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m: string, h: string) => cp(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m: string, n: string) => cp(parseInt(n, 10)))
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
