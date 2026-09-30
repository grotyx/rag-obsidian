import { App, FuzzySuggestModal, Notice, TFile, normalizePath, requestUrl } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { BUNDLED_STYLES } from "../cite/csl";
import { StyleInfo, parseStyleIndex } from "../cite/styleIndex";
import { rec } from "../util/json";

const INDEX_URL = "https://www.zotero.org/styles-files/styles.json";
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

/** Style list: on-disk reduced cache (30 days) → Zotero's styles.json → stale cache → empty. */
async function loadIndex(app: App, pluginDir: string): Promise<StyleInfo[]> {
  const path = normalizePath(`${pluginDir}/styles/cache/index.json`);
  let cached: StyleInfo[] = [];
  let fetched = 0;
  try {
    const j = rec(JSON.parse(await app.vault.adapter.read(path)));
    cached = parseStyleIndex(j.styles);
    fetched = typeof j.fetched === "number" ? j.fetched : 0;
  } catch {
    /* no cache yet */
  }
  if (cached.length && Date.now() - fetched < MAX_AGE_MS) return cached;
  try {
    const res = await requestUrl({ url: INDEX_URL });
    const styles = parseStyleIndex(res.json);
    if (!styles.length) throw new Error("empty style list");
    try {
      await app.vault.adapter.write(path, JSON.stringify({ fetched: Date.now(), styles }));
    } catch {
      /* cache write is best-effort */
    }
    return styles;
  } catch {
    return cached;
  }
}

type Item = StyleInfo & { bundled: boolean };

/** Pick a citation style by journal name; sets the active manuscript's `csl:` or the global default. */
export class StyleSuggestModal extends FuzzySuggestModal<Item> {
  private items: Item[] = [];

  constructor(app: App, private plugin: ScholarRagPlugin) {
    super(app);
    this.setPlaceholder("Type a journal or style name…");
    const bundled: Item[] = Object.entries(BUNDLED_STYLES).map(([id, title]) => ({ id, title, format: "", bundled: true }));
    this.items = bundled;
    void loadIndex(app, plugin.manifest.dir ?? "").then((all) => {
      if (!all.length && bundled.length === this.items.length) new Notice("Could not load the style list; only bundled styles are available");
      const have = new Set(bundled.map((b) => b.id));
      this.items = [...bundled, ...all.filter((s) => !have.has(s.id)).map((s) => ({ ...s, bundled: false }))];
      // re-run the search so the list fills in while the modal is open
      const input = this.inputEl;
      input.dispatchEvent(new Event("input"));
    });
  }

  getItems(): Item[] {
    return this.items;
  }

  getItemText(s: Item): string {
    return s.short ? `${s.title} (${s.short})` : s.title;
  }

  renderSuggestion(m: { item: Item }, el: HTMLElement): void {
    const s = m.item;
    el.createDiv({ text: s.title });
    el.createEl("small", { text: [s.id, s.format, s.bundled ? "bundled" : ""].filter(Boolean).join(" · ") });
  }

  onChooseItem(s: Item): void {
    const file = this.app.workspace.getActiveFile();
    const inLibrary = file?.path.startsWith(this.plugin.library.folder() + "/");
    if (file instanceof TFile && file.extension === "md" && !inLibrary) {
      void this.app.fileManager
        .processFrontMatter(file, (fm: Record<string, unknown>) => {
          fm.csl = s.id;
        })
        .then(() => new Notice(`Citation style for this note: ${s.title}`));
    } else {
      this.plugin.settings.cslStyleId = s.id;
      void this.plugin.saveSettings().then(() => new Notice(`Default citation style: ${s.title}`));
    }
  }
}
