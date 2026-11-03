import { App, FuzzySuggestModal, Notice, normalizePath } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { citingWorks, fetchTitles } from "../graph/openalex";
import { aggregateSnowball, snowballMarkdown, SnowballRecord, SnowballWork } from "../data/snowball";
import { startBatch } from "../ui/progress";
import { mapPool } from "../util/pool";
import { localDate } from "../data/reference";
import type { CSLItem } from "../types";

const TOP = 200;
const WIDTH = 3;

type Scope = { kind: "all" } | { kind: "kq"; kq: string };

const kqsOf = (item: CSLItem): string[] => (Array.isArray(item.kq) ? (item.kq as unknown[]).map(String) : []);

/** Pick "All included" or one key question among the included records. */
export class SnowballScopeModal extends FuzzySuggestModal<Scope> {
  constructor(app: App, private plugin: ScholarRagPlugin) {
    super(app);
    this.setPlaceholder("Snowball from all included records, or one key question…");
  }

  getItems(): Scope[] {
    const kqs = new Set<string>();
    for (const e of this.plugin.library.entries()) if (e.item.include === "include") kqsOf(e.item).forEach((k) => kqs.add(k));
    return [{ kind: "all" }, ...[...kqs].sort().map((kq): Scope => ({ kind: "kq", kq }))];
  }

  getItemText(s: Scope): string {
    return s.kind === "all" ? "All included" : s.kq;
  }

  onChooseItem(s: Scope): void {
    void snowball(this.plugin, s);
  }
}

/** Backward + forward citation chasing over the included records, written to `Snowball <date>.md`. */
export async function snowball(plugin: ScholarRagPlugin, scope: Scope): Promise<void> {
  const included = plugin.library
    .entries()
    .filter((e) => e.item.include === "include" && (scope.kind === "all" || kqsOf(e.item).includes(scope.kq)));
  if (!included.length) {
    new Notice("No included records in that scope.");
    return;
  }
  const batch = startBatch(plugin, "Snowball", included.length);
  if (!batch) return;
  const mailto = plugin.settings.openalexMailto;
  let done = 0;
  let failures = 0;
  try {
    const looked = await mapPool(
      included,
      WIDTH,
      async (e): Promise<SnowballRecord | null> => {
        let rec: SnowballRecord | null = null;
        try {
          // one call: citingWorks resolves the work (backward ids) and pages the citing works
          const r = await citingWorks(e.item, { mailto, limit: 100 });
          if (r)
            rec = {
              citekey: e.citekey,
              selfId: r.work.openalexId,
              referenced: r.work.referencedWorks,
              citing: r.works.map((w) => ({ id: w.openalexId, title: w.title, year: w.year, doi: w.doi, pmid: w.pmid })),
            };
        } catch {
          // counted below, never aborts the run
        }
        if (!rec) failures++;
        batch.tick(++done, failures);
        return rec;
      },
      batch.signal
    );
    const records = looked.filter((r): r is SnowballRecord => !!r);

    const known = (w: SnowballWork): boolean =>
      !!plugin.library.findDuplicate({ type: "article-journal", title: w.title ?? "", DOI: w.doi, PMID: w.pmid, openalex_id: w.id });
    let rows = aggregateSnowball(records, known).slice(0, TOP);
    // backward-only works have no title yet: fetch for the top ranked only, then re-check the library by title
    const untitled = rows.filter((c) => !c.title).map((c) => c.id);
    if (untitled.length) {
      const titles = await fetchTitles(untitled, mailto).catch(() => new Map<string, { title: string; citedByCount: number }>());
      for (const c of rows) c.title ||= titles.get(c.id)?.title || undefined;
      rows = rows.filter((c) => !known(c));
    }
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const scopeLabel = scope.kind === "all" ? "all included records" : `included records for ${scope.kq}`;
    const md = snowballMarkdown(
      { scope: scopeLabel, processed: records.length, failures, date: `${localDate(now)} ${hhmm.slice(0, 2)}:${hhmm.slice(2)}` },
      rows
    );
    batch.finish(`Snowball: ${rows.length} candidates`);
    await plugin.writeAndOpen(normalizePath(`Snowball ${localDate(now)} ${hhmm}.md`), md);
  } catch (err) {
    batch.finish("Snowball failed");
    new Notice(`Snowball failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
