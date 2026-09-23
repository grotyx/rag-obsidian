import { TFile } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { mergeFrontmatter, mergeBodies } from "../data/merge";
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

/** Merge each planned group: keeper's frontmatter + body absorb the others', every `[@loserKey]`
 *  in the vault becomes `[@keeperKey]`, then the losers are trashed. Sequential across groups —
 *  index/graph updates ride the existing modify/delete vault events, no new plumbing needed. A
 *  group whose files changed since the modal opened (mtime mismatch) is skipped, not merged. */
export async function mergeDuplicateGroups(
  plugin: ScholarRagPlugin,
  plans: MergeGroupPlan[]
): Promise<MergeResult> {
  let groupsMerged = 0;
  let notesTrashed = 0;
  let skipped = 0;
  const rewritten = new Set<string>();

  for (const plan of plans) {
    const files = [plan.keeperFile, ...plan.loserFiles];
    const stale = files.some((f) => {
      const cur = plugin.app.vault.getAbstractFileByPath(f.path);
      return !(cur instanceof TFile) || cur.stat.mtime !== plan.expectedMtimes.get(f.path);
    });
    if (stale) {
      skipped++;
      continue;
    }

    const losers = plan.loserFiles.map((file) => ({
      file,
      citekey: String(plugin.app.metadataCache.getFileCache(file)?.frontmatter?.citekey ?? ""),
    }));

    await plugin.app.fileManager.processFrontMatter(plan.keeperFile, (fm) => {
      const otherFm = losers.map((l) => (plugin.app.metadataCache.getFileCache(l.file)?.frontmatter ?? {}) as Record<string, unknown>);
      Object.assign(fm, mergeFrontmatter(fm, otherFm));
    });
    const keeperCitekey = String(
      plugin.app.metadataCache.getFileCache(plan.keeperFile)?.frontmatter?.citekey ?? ""
    );

    const otherBodies = await Promise.all(
      losers.map(async (l) => ({ citekey: l.citekey, body: await plugin.app.vault.read(l.file) }))
    );
    await plugin.app.vault.process(plan.keeperFile, (content) => mergeBodies(content, otherBodies));

    const map: Record<string, string> = {};
    for (const l of losers) if (l.citekey) map[l.citekey] = keeperCitekey;
    if (Object.keys(map).length) {
      for (const file of plugin.app.vault.getMarkdownFiles()) {
        const text = await plugin.app.vault.cachedRead(file);
        if (!Object.keys(map).some((k) => text.includes("@" + k))) continue;
        await plugin.app.vault.process(file, (c) => renameCiteKeys(c, map));
        rewritten.add(file.path);
      }
    }

    for (const l of losers) {
      await plugin.app.fileManager.trashFile(l.file);
      notesTrashed++;
    }
    groupsMerged++;
  }

  return { groupsMerged, notesTrashed, notesRewritten: rewritten.size, skipped };
}
