import { normalizePath } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { duplicateGroups, inScope, BackfillScope } from "../data/library";
import { prismaCounts, prismaMarkdown, PrismaRecord } from "../data/prisma";
import { localDate } from "../data/reference";
import { findPdfFile } from "./pdfs";
import { str } from "../util/json";

/** "Full text" agrees with `commands/summaries.ts`' `sourceName`: a resolvable PDF, or a summary
 *  sourced from one (`pdf-fulltext`) or from PMC (`pmc-fulltext`). */
function hasFullText(plugin: ScholarRagPlugin, e: ReturnType<ScholarRagPlugin["library"]["entries"]>[number]): boolean {
  if (findPdfFile(plugin, e.item.pdf, e.file.path, e.citekey)) return true;
  const source = str(e.item.summary_source);
  return source === "pdf-fulltext" || source === "pmc-fulltext";
}

function scopeLabel(scope: BackfillScope): string {
  return scope.kind === "all" ? "all references" : scope.kind === "tag" ? `#${scope.tag}` : scope.kind;
}

/** Build "PRISMA flow (<scope label>).md" at the vault root and open it. */
export async function buildPrismaDiagram(plugin: ScholarRagPlugin, scope: BackfillScope): Promise<void> {
  const scoped = plugin.library.entries().filter((e) => inScope(e, scope));
  const groups = duplicateGroups(scoped).map((g) => g.map((e) => e.citekey));
  const records: PrismaRecord[] = scoped.map((e) => ({
    citekey: e.citekey,
    include: typeof e.item.include === "string" ? e.item.include : null,
    screening_note: typeof e.item.screening_note === "string" ? e.item.screening_note : null,
  }));
  const fullTextSet = new Set(scoped.filter((e) => hasFullText(plugin, e)).map((e) => e.citekey));
  const counts = prismaCounts(records, groups, (r) => fullTextSet.has(r.citekey));
  const label = scopeLabel(scope);
  const md = prismaMarkdown(counts, label, localDate());
  await plugin.writeAndOpen(normalizePath(`PRISMA flow (${label.replace(/^#/, "").replace(/[\\/:*?"<>|#^[\]]/g, "-")}).md`), md);
}
