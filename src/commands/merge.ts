import { TFile } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { planMerge, renameWikilinks, WikilinkRename } from "../data/merge";
import { renameCiteKeys } from "../cite/bibliography";

export interface MergeGroupPlan {
  keeperFile: TFile;
  loserFiles: TFile[];
  /** mtime of every file in the group (keeper + losers), captured when the modal was built. */
  expectedMtimes: Map<string, number>;
}

export interface MergeResult {
  groupsMerged: number;
  notesTrashed: number;
  notesRewritten: number;
  skipped: number;
}

function fmCitekey(fm: Record<string, unknown>): string {
  return typeof fm.citekey === "string" ? fm.citekey : "";
}

/** Merge every non-stale planned group's frontmatter + body (via `planMerge`, so a moved summary
 *  and its provenance can't disagree), then rewrite `[@loserKey]` citations and `[[loserFile]]`
 *  wikilinks across the WHOLE vault in one combined pass, then trash the losers last. Staleness
 *  (a group's files changed since the modal opened) is checked for every group up front, before
 *  any write, so one group's rewrite can never falsely stale another. A file counts as rewritten
 *  only when its content actually changed — a citekey/basename that is merely a prefix of
 *  another (`smith2020` vs. `smith2020a`) must not miscount. */
export async function mergeDuplicateGroups(
  plugin: ScholarRagPlugin,
  plans: MergeGroupPlan[]
): Promise<MergeResult> {
  // (a) staleness, up front, against the mtimes captured when the modal opened.
  const stale = new Set(
    plans
      .map((plan, i) => ({ plan, i }))
      .filter(({ plan }) =>
        [plan.keeperFile, ...plan.loserFiles].some((f) => {
          const cur = plugin.app.vault.getAbstractFileByPath(f.path);
          return !(cur instanceof TFile) || cur.stat.mtime !== plan.expectedMtimes.get(f.path);
        })
      )
      .map(({ i }) => i)
  );

  const citeMap: Record<string, string> = {};
  const wikiRenames: WikilinkRename[] = [];
  const allLoserFiles: TFile[] = [];
  let groupsMerged = 0;

  // (b) merge each non-stale group's frontmatter + body.
  for (let i = 0; i < plans.length; i++) {
    if (stale.has(i)) continue;
    const plan = plans[i];
    const losers = plan.loserFiles.map((file) => ({
      file,
      citekey: fmCitekey(plugin.app.metadataCache.getFileCache(file)?.frontmatter ?? {}),
    }));

    const keeperFm = plugin.app.metadataCache.getFileCache(plan.keeperFile)?.frontmatter ?? {};
    const keeperCitekey = fmCitekey(keeperFm);
    const keeperBody = await plugin.app.vault.read(plan.keeperFile);
    const others = await Promise.all(
      losers.map(async (l) => ({
        citekey: l.citekey,
        fm: plugin.app.metadataCache.getFileCache(l.file)?.frontmatter ?? {},
        body: await plugin.app.vault.read(l.file),
      }))
    );
    const { fm: mergedFm, body: mergedBody } = planMerge(
      { citekey: keeperCitekey, fm: keeperFm, body: keeperBody },
      others
    );

    await plugin.app.fileManager.processFrontMatter(plan.keeperFile, (fm) => {
      Object.assign(fm, mergedFm);
    });
    await plugin.app.vault.process(plan.keeperFile, () => mergedBody);

    // (c) one combined citekey map and one combined wikilink-rename list, across all groups.
    for (const l of losers) {
      if (l.citekey && keeperCitekey) citeMap[l.citekey] = keeperCitekey;
      wikiRenames.push({ path: l.file.path.replace(/\.md$/, ""), keeperBasename: plan.keeperFile.basename });
      allLoserFiles.push(l.file);
    }
    groupsMerged++;
  }

  // (d) one pass over the vault for citations + wikilinks, counting only real changes.
  let notesRewritten = 0;
  if (Object.keys(citeMap).length || wikiRenames.length) {
    const resolvedLinks = plugin.app.metadataCache.resolvedLinks;
    const loserPaths = new Set(allLoserFiles.map((f) => f.path));
    for (const file of plugin.app.vault.getMarkdownFiles()) {
      const text = await plugin.app.vault.cachedRead(file);
      const hasCiteCandidate = Object.keys(citeMap).some((k) => text.includes("@" + k));
      const linksHere = resolvedLinks[file.path] ?? {};
      const hasWikiCandidate = Object.keys(linksHere).some((t) => loserPaths.has(t));
      if (!hasCiteCandidate && !hasWikiCandidate) continue;

      let changed = false;
      await plugin.app.vault.process(file, (c) => {
        const next = renameWikilinks(renameCiteKeys(c, citeMap), wikiRenames);
        changed = next !== c;
        return next;
      });
      if (changed) notesRewritten++;
    }
  }

  // (e) trash the losers last.
  let notesTrashed = 0;
  for (const file of allLoserFiles) {
    await plugin.app.fileManager.trashFile(file);
    notesTrashed++;
  }

  return { groupsMerged, notesTrashed, notesRewritten, skipped: stale.size };
}
