import { TFile } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { joinNote, LinkRef, linkTargetsInText, moveLinks, planMerge, splitNote } from "../data/merge";
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
  /** Groups skipped because a file changed since the modal opened. */
  skipped: number;
  /** Groups abandoned because a file changed between reading it and writing the merge. */
  skippedChanged: number;
  /** Losers kept (not trashed): edited after their content was merged, or still linked from a spelling the merge could not rewrite. */
  losersKept: number;
}

function fmCitekey(fm: Record<string, unknown>): string {
  return typeof fm.citekey === "string" ? fm.citekey : "";
}

/** Merge every non-stale planned group's frontmatter + body (via `planMerge`, so a moved summary
 *  and its provenance can't disagree), then rewrite `[@loserKey]` citations and `[[loserFile]]`
 *  wikilinks across the WHOLE vault in one combined pass, then trash the losers last. Staleness
 *  (a group's files changed since the modal opened) is checked for every group up front, before
 *  any write, so one group's rewrite can never falsely stale another. A file counts as rewritten
 *  only when its content actually changed. Every write re-checks what it read: a keeper that
 *  changed before the merge landed is left alone (group skipped), a loser edited after its text
 *  was copied is kept instead of trashed — a citekey/basename that is merely a prefix of
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
  /** Each loser with the exact text that was merged into its keeper. */
  const allLosers: { file: TFile; keeper: TFile; snapshot: string }[] = [];
  let groupsMerged = 0;
  let skippedChanged = 0;

  // (b) merge each non-stale group's frontmatter + body.
  for (let i = 0; i < plans.length; i++) {
    if (stale.has(i)) continue;
    const plan = plans[i];
    // Everything below comes from the text captured here, never from the metadata cache (which
    // lags behind writes), so the single write at the end can be checked against exactly this.
    const keeperText = await plugin.app.vault.read(plan.keeperFile);
    const keeperNote = splitNote(keeperText);
    const loserTexts = await Promise.all(plan.loserFiles.map((file) => plugin.app.vault.read(file)));
    const loserNotes = loserTexts.map(splitNote);
    if (!keeperNote || loserNotes.some((n) => !n)) {
      skippedChanged++; // unparseable frontmatter: leave the group exactly as it is
      continue;
    }
    const keeperCitekey = fmCitekey(keeperNote.fm);
    const losers = plan.loserFiles.map((file, j) => ({ file, citekey: fmCitekey(loserNotes[j]!.fm) }));
    const others = losers.map((l, j) => ({ citekey: l.citekey, fm: loserNotes[j]!.fm, body: loserNotes[j]!.body }));
    const { fm: mergedFm, body: mergedBody } = planMerge(
      { citekey: keeperCitekey, fm: keeperNote.fm, body: keeperNote.body },
      others
    );

    // A loser edited since its text was copied would lose that edit: abandon the group.
    let loserChanged = false;
    for (let j = 0; j < losers.length; j++) {
      if ((await plugin.app.vault.read(losers[j].file)) !== loserTexts[j]) loserChanged = true;
    }
    if (loserChanged) {
      skippedChanged++;
      continue;
    }

    // One write: frontmatter and body together, only if the keeper is still the text that was
    // read. A title/screening edit made meanwhile (editor, sync, MCP) is never reverted.
    let keeperChanged = false;
    await plugin.app.vault.process(plan.keeperFile, (current) => {
      if (current !== keeperText) {
        keeperChanged = true;
        return current;
      }
      return joinNote(mergedFm, mergedBody);
    });
    if (keeperChanged) {
      skippedChanged++;
      continue;
    }

    // (c) one combined citekey map and one combined wikilink-rename list, across all groups.
    losers.forEach((l, j) => {
      if (l.citekey && keeperCitekey) citeMap[l.citekey] = keeperCitekey;
      allLosers.push({ file: l.file, keeper: plan.keeperFile, snapshot: loserTexts[j] });
    });
    groupsMerged++;
  }

  // (d) one pass over the vault for citations + links, counting only real changes. Links are
  // found through the metadata cache and resolved from the note that holds them (so `[[x]]`,
  // `[[x.md]]`, `[text](x.md)` and embeds all count, and a same-named note elsewhere does not);
  // a loser with a link that could not be moved is kept, never trashed into a dangling link.
  let notesRewritten = 0;
  const keepLosers = new Set<string>();
  if (Object.keys(citeMap).length || allLosers.length) {
    const { metadataCache } = plugin.app;
    const resolvedLinks = metadataCache.resolvedLinks;
    const keeperByLoser = new Map(allLosers.map((l) => [l.file.path, l.keeper]));
    for (const file of plugin.app.vault.getMarkdownFiles()) {
      if (keeperByLoser.has(file.path)) continue; // about to be trashed; rewriting would break its snapshot check
      const text = await plugin.app.vault.cachedRead(file);
      const hasCiteCandidate = Object.keys(citeMap).some((k) => text.includes("@" + k));
      const linksHere = Object.keys(resolvedLinks[file.path] ?? {}).filter((t) => keeperByLoser.has(t));
      if (!hasCiteCandidate && !linksHere.length) continue;

      const cache = metadataCache.getFileCache(file);
      const refs: LinkRef[] = [...(cache?.links ?? []), ...(cache?.embeds ?? [])].map((l) => ({
        link: l.link,
        original: l.original,
        start: l.position.start.offset,
      }));
      for (const l of cache?.frontmatterLinks ?? []) refs.push({ link: l.link, original: l.original, start: -1 });
      const loserOf = (target: string): string | null => {
        const dest = metadataCache.getFirstLinkpathDest(target, file.path);
        return dest && keeperByLoser.has(dest.path) ? dest.path : null;
      };
      const keeperOf = (loserPath: string) => {
        const k = keeperByLoser.get(loserPath)!;
        return { basename: k.basename, path: k.path };
      };
      let changed = false;
      await plugin.app.vault.process(file, (c) => {
        const r = linksHere.length ? moveLinks(c, refs, loserOf, keeperOf) : { text: c, moved: [], failed: [] };
        // A link the vault says exists but the cache could not show us is as unmoved as a failed one.
        for (const t of linksHere) if (!r.moved.includes(t)) keepLosers.add(t);
        for (const t of r.failed) keepLosers.add(t);
        const next = renameCiteKeys(r.text, citeMap);
        changed = next !== c;
        return next;
      });
      if (changed) notesRewritten++;
    }
  }

  // (d2) The cache can lag behind the files, so look at the text itself: any link spelling in any
  // note that still resolves to a loser keeps it. A kept loser is a note like any other, so what
  // it links to is kept too (repeat until nothing new is kept).
  const loserPaths = new Set(allLosers.map((l) => l.file.path));
  if (loserPaths.size) {
    const linkedFrom = new Map<string, Set<string>>();
    for (const file of plugin.app.vault.getMarkdownFiles()) {
      const dests = new Set<string>();
      for (const target of linkTargetsInText(await plugin.app.vault.read(file))) {
        const dest = plugin.app.metadataCache.getFirstLinkpathDest(target, file.path);
        if (dest && loserPaths.has(dest.path) && dest.path !== file.path) dests.add(dest.path);
      }
      if (dests.size) linkedFrom.set(file.path, dests);
    }
    for (let grew = true; grew; ) {
      grew = false;
      for (const [src, dests] of linkedFrom) {
        if (loserPaths.has(src) && !keepLosers.has(src)) continue; // will be trashed: its links go with it
        for (const d of dests) {
          if (!keepLosers.has(d)) {
            keepLosers.add(d);
            grew = true;
          }
        }
      }
    }
  }

  // (e) trash the losers last, each only if it still holds the text that was merged.
  let notesTrashed = 0;
  let losersKept = 0;
  for (const { file, snapshot } of allLosers) {
    const cur = plugin.app.vault.getAbstractFileByPath(file.path);
    if (!(cur instanceof TFile) || keepLosers.has(file.path) || (await plugin.app.vault.read(file)) !== snapshot) {
      losersKept++;
      continue;
    }
    await plugin.app.fileManager.trashFile(file);
    notesTrashed++;
  }

  return { groupsMerged, notesTrashed, notesRewritten, skipped: stale.size, skippedChanged, losersKept };
}
