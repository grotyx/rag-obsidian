import { Notice, TFile, normalizePath } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { localDate } from "../data/reference";
import { digestNote, newRecords, newWatchId, runWatch, validWatches, WatchDeps, WatchRecord, WatchResult, WATCH_FOLDER } from "../data/watches";
import { searchPubmedPage } from "../ingest/pubmedSearch";
import { citingWorks, resolveWork, shortId } from "../graph/openalex";
import { startBatch } from "../ui/progress";
import { mapPool } from "../util/pool";
import { str } from "../util/json";
import type { Watch } from "../types";

const MAX_NEW = 200; // per watch and check: PubMed retmax / OpenAlex page, newest first

async function saveWatch(plugin: ScholarRagPlugin, w: Omit<Watch, "id" | "lastChecked">): Promise<void> {
  const list = validWatches(plugin.settings.watches);
  const same = (x: Watch) => x.kind === w.kind && (x.query ?? "").toLowerCase() === (w.query ?? "").toLowerCase() && x.openalexId === w.openalexId;
  if (list.some(same)) {
    new Notice("Already watching that.");
    return;
  }
  plugin.settings.watches = [...list, { ...w, id: newWatchId(), lastChecked: localDate() }]; // new array: DEFAULT_SETTINGS.watches is shared
  await plugin.saveSettings();
  new Notice(`Watching: ${w.label}. Run "Check literature watches" to see what is new.`);
}

/** Save a PubMed query as a watch (year and sort are not kept: a watch always wants the newest records). */
export function addPubmedWatch(plugin: ScholarRagPlugin, query: string): Promise<void> {
  const q = query.trim();
  return saveWatch(plugin, { kind: "pubmed", label: q.length > 60 ? `${q.slice(0, 57)}…` : q, query: q });
}

/** Watch for new papers citing the active reference. */
export async function watchCitingActive(plugin: ScholarRagPlugin): Promise<void> {
  const r = plugin.activeRef();
  if (!r) return;
  const citekey = str(r.fm.citekey);
  let openalexId = shortId(str(r.fm.openalex_id));
  if (!openalexId) {
    const item = plugin.library.getItem(citekey);
    try {
      openalexId = (item && (await resolveWork(item, plugin.settings.openalexMailto)))?.openalexId ?? "";
    } catch (e) {
      new Notice(`OpenAlex lookup failed: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
  }
  if (!openalexId) {
    new Notice("This reference was not found on OpenAlex.");
    return;
  }
  await saveWatch(plugin, { kind: "cites", label: `Citing ${citekey}`, citekey, openalexId });
}

/** Look up every watch, write `Watches/Digest <date>.md`, advance `lastChecked` of the ones that worked. */
export async function checkWatches(plugin: ScholarRagPlugin): Promise<void> {
  const watches = validWatches(plugin.settings.watches);
  if (!watches.length) {
    new Notice("No literature watches yet. Save one from Search PubMed, or run \"Watch new papers citing this reference\".");
    return;
  }
  const batch = startBatch(plugin, "Watches", watches.length);
  if (!batch) return;
  const { pubmedApiKey: apiKey, openalexMailto: mailto } = plugin.settings;
  const deps: WatchDeps = {
    pubmed: async (query, since, until) =>
      (await searchPubmedPage(query, { n: MAX_NEW, since, until, sort: "pub_date", apiKey, email: mailto })).hits.map((h) => h.item),
    citing: async (openalexId, since) => {
      const r = await citingWorks({ type: "article-journal", title: "", openalex_id: openalexId }, { mailto, limit: MAX_NEW, fromDate: since });
      if (!r) throw new Error("work not found on OpenAlex");
      return r.works.map((w): WatchRecord => ({ title: w.title || "(untitled)", year: w.year, journal: w.journal, pmid: w.pmid, doi: w.doi }));
    },
  };
  const today = localDate();
  let done = 0;
  try {
    const ran = await mapPool(
      watches,
      2,
      async (w) => {
        const res = await runWatch(w, today, deps);
        batch.tick(++done);
        return res;
      },
      batch.signal
    );
    const results: WatchResult[] = [];
    const ok = new Set<string>();
    ran.forEach((res, i) => {
      if (!res) return; // cancelled before it started
      if (res.error === undefined) {
        ok.add(watches[i].id);
        res.records = newRecords(res.records, (r) => !!plugin.library.findDuplicate({ type: "article-journal", title: r.title, DOI: r.doi, PMID: r.pmid }));
      }
      results.push(res);
    });
    if (!results.length) {
      batch.finish("Watches: cancelled");
      return;
    }
    await writeDigest(plugin, today, results);
    // Re-read: the user may have deleted a watch while the check ran.
    plugin.settings.watches = validWatches(plugin.settings.watches).map((w) => (ok.has(w.id) ? { ...w, lastChecked: today } : w));
    await plugin.saveSettings();
    const failed = results.filter((r) => r.error !== undefined).map((r) => r.watch.label);
    const found = results.reduce((n, r) => n + r.records.length, 0);
    batch.finish(`Watches: ${found} new`);
    new Notice(`${found} new paper${found === 1 ? "" : "s"} in ${results.length} watch${results.length === 1 ? "" : "es"}.` + (failed.length ? ` Failed: ${failed.join(", ")}.` : ""));
  } catch (e) {
    batch.finish("Watches failed");
    new Notice(`Watch check failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function writeDigest(plugin: ScholarRagPlugin, date: string, results: WatchResult[]): Promise<void> {
  const vault = plugin.app.vault;
  const path = normalizePath(`${WATCH_FOLDER}/Digest ${date}.md`);
  if (!vault.getAbstractFileByPath(WATCH_FOLDER)) await vault.createFolder(WATCH_FOLDER);
  const existing = vault.getAbstractFileByPath(path);
  let file: TFile;
  if (existing instanceof TFile) {
    await vault.process(existing, (data) => digestNote(data, date, results));
    file = existing;
  } else {
    file = await vault.create(path, digestNote(null, date, results));
  }
  await plugin.app.workspace.getLeaf(true).openFile(file);
}
