import { Notice, normalizePath } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { duplicateGroups } from "../data/library";
import { exportRefs, ExportFormat, ExportRef } from "../cite/export";
import { resolveWork, relatedWorks } from "../graph/openalex";
import { detectId, fetchMetadata } from "../ingest/metadata";

/** Write a Dataview-powered dashboard note (live, sortable). Falls back to a static table. */
export async function buildDashboard(plugin: ScholarRagPlugin): Promise<void> {
  const folder = plugin.settings.referencesFolder || "References";
  const hasDataview = !!(plugin.app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins
    ?.enabledPlugins?.has?.("dataview");
  let out: string;
  if (hasDataview) {
    // Plain DQL (not dataviewjs) so it renders WITHOUT Dataview's "Enable JavaScript
    // Queries" toggle. The note link already encodes year + author + journal.
    out =
      `# Library Dashboard\n\n` +
      "```dataview\n" +
      "TABLE WITHOUT ID\n" +
      "  file.link AS Reference,\n" +
      "  status AS Status,\n" +
      "  cited_by_count AS Cited,\n" +
      "  tags AS Tags\n" +
      `FROM "${folder}"\n` +
      "WHERE citekey\n" +
      "SORT cited_by_count DESC\n" +
      "```\n\n" +
      '> Edit the query to filter (e.g. add `WHERE status = "reading"`) or change `SORT`.\n';
  } else {
    const rows = plugin.library.entries();
    const header = "| Year | Authors | Title | Status | Cited | Tags |\n|---|---|---|---|---|---|";
    const body = rows
      .map((r) => {
        const it = r.item as Record<string, unknown>;
        const tags = Array.isArray(it.tags) ? (it.tags as string[]).slice(0, 4).join(", ") : "";
        const link = `[[${r.file.basename}\\|${r.title.replace(/\|/g, "/")}]]`;
        return `| ${r.year} | ${r.authors} | ${link} | ${it.status ?? ""} | ${it.cited_by_count ?? ""} | ${tags} |`;
      })
      .join("\n");
    out = `# Library Dashboard\n\n${rows.length} references. (Install Dataview for a live, sortable table.)\n\n${header}\n${body}\n`;
  }
  const path = normalizePath("Library Dashboard.md");
  await plugin.writeAndOpen(path, out);
}

/** Group library notes by DOI / PMID / normalized title and report duplicate clusters. */
export async function findDuplicates(plugin: ScholarRagPlugin): Promise<void> {
  const dups = duplicateGroups(plugin.library.entries()).map((g) => g.map((e) => e.file.basename));
  if (!dups.length) {
    new Notice("No duplicates found");
    return;
  }
  const report =
    `# Duplicate references\n\n${dups.length} group(s):\n\n` +
    dups.map((g) => "- " + g.map((name) => `[[${name}]]`).join(" · ")).join("\n") +
    "\n";
  const path = normalizePath("Duplicate references.md");
  await plugin.writeAndOpen(path, report);
  new Notice(`${dups.length} duplicate group(s) — see "Duplicate references.md"`);
}

/** Open a note listing references still to read (status reading first, then unread), by citations. */
export async function readingQueue(plugin: ScholarRagPlugin): Promise<void> {
  const rows = plugin.library
    .entries()
    .filter((r) => r.item.status === "reading" || r.item.status === "unread" || !r.item.status);
  const rank = (s: unknown) => (s === "reading" ? 0 : 1);
  rows.sort(
    (a, b) =>
      rank(a.item.status) - rank(b.item.status) ||
      Number(b.item.cited_by_count ?? 0) - Number(a.item.cited_by_count ?? 0)
  );
  const body = rows
    .map(
      (r) =>
        `- [[${r.file.basename}]] — ${r.authors} ${r.year} · _${r.item.status ?? "unread"}_${
          r.item.cited_by_count != null ? ` · ${r.item.cited_by_count} cites` : ""
        }`
    )
    .join("\n");
  const out = `# Reading queue\n\n${rows.length} to read:\n\n${body || "_(all caught up)_"}\n`;
  const path = normalizePath("Reading queue.md");
  await plugin.writeAndOpen(path, out);
}

export async function setStatus(
  plugin: ScholarRagPlugin,
  status: "unread" | "reading" | "read"
): Promise<void> {
  const r = plugin.activeRef();
  if (!r) return;
  await plugin.app.fileManager.processFrontMatter(r.file, (fm) => (fm.status = status));
  new Notice(`${r.fm.citekey} → ${status}`);
}

/** Resolve each reference on OpenAlex and write `cited_by_count` (+ `openalex_id`). */
export async function backfillCitationCounts(plugin: ScholarRagPlugin): Promise<void> {
  const entries = plugin.library.entries();
  const notice = new Notice(`Citation counts 0/${entries.length}…`, 0);
  let done = 0;
  let updated = 0;
  try {
    for (const { item, file } of entries) {
      const w = await resolveWork(item, plugin.settings.openalexMailto);
      if (w) {
        await plugin.app.fileManager.processFrontMatter(file, (fm) => {
          fm.cited_by_count = w.citedByCount;
          if (!fm.openalex_id) fm.openalex_id = w.openalexId;
        });
        updated++;
      }
      done++;
      notice.setMessage(`Citation counts ${done}/${entries.length}…`);
    }
    new Notice(`Updated citation counts for ${updated} reference(s).`);
  } catch (e) {
    new Notice(`Citation count backfill failed: ${e instanceof Error ? e.message : e}`);
  } finally {
    notice.hide();
  }
}

/** Re-fetch metadata for notes missing abstract / journal / authors and fill the gaps. */
export async function enrichMetadata(plugin: ScholarRagPlugin): Promise<void> {
  const entries = plugin.library.entries();
  const notice = new Notice(`Enriching 0/${entries.length}…`, 0);
  let done = 0;
  let filled = 0;
  for (const e of entries) {
    const item = e.item;
    const file = e.file;
    done++;
    notice.setMessage(`Enriching ${done}/${entries.length}…`);
    const needs = !item.abstract || !item["container-title"] || !item.author || !item.author.length;
    // Crossref usually omits abstracts — prefer PubMed when that is the gap.
    const pmid = item.PMID ? `pmid:${item.PMID}` : "";
    const idStr = !item.abstract && pmid ? pmid : item.DOI || pmid;
    if (!needs || !idStr) continue;
    try {
      const fresh = await fetchMetadata(detectId(idStr), plugin.settings.pubmedApiKey);
      let changed = false;
      await plugin.app.fileManager.processFrontMatter(file, (fm) => {
        const set = (k: string, v: unknown) => ((fm[k] = v), (changed = true));
        if (!fm.abstract && fresh.abstract) set("abstract", fresh.abstract);
        if (!fm["container-title"] && fresh["container-title"]) set("container-title", fresh["container-title"]);
        if ((!fm.author || (Array.isArray(fm.author) && !fm.author.length)) && fresh.author) set("author", fresh.author);
        if (!fm.volume && fresh.volume) set("volume", fresh.volume);
        if (!fm.issue && fresh.issue) set("issue", fresh.issue);
        if (!fm.page && fresh.page) set("page", fresh.page);
        if (!fm.DOI && fresh.DOI) set("DOI", fresh.DOI);
      });
      if (changed) filled++;
    } catch {
      /* skip on fetch error */
    }
  }
  notice.hide();
  new Notice(`Enriched ${filled} reference(s).`);
}

/** Rename (or delete, if newTag is empty) a tag across every reference note. */
export async function renameTag(
  plugin: ScholarRagPlugin,
  oldTag: string,
  newTag: string
): Promise<number> {
  let n = 0;
  for (const { file } of plugin.library.entries()) {
    const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm || !Array.isArray(fm.tags) || !fm.tags.includes(oldTag)) continue;
    await plugin.app.fileManager.processFrontMatter(file, (f) => {
      const t = new Set<string>(((f.tags as string[]) || []).filter(Boolean));
      t.delete(oldTag);
      if (newTag) t.add(newTag);
      f.tags = [...t];
    });
    n++;
  }
  return n;
}

/** Write the whole library to a bibliographic file at the vault root and open it. */
export async function exportLibrary(plugin: ScholarRagPlugin, format: ExportFormat): Promise<void> {
  const refs: ExportRef[] = plugin.library.entries().map((e) => ({ citekey: e.citekey, item: e.item }));
  if (!refs.length) {
    new Notice("Library is empty");
    return;
  }
  const ext = format === "bibtex" ? "bib" : format === "ris" ? "ris" : "json";
  const path = normalizePath(`library.${ext}`);
  await plugin.writeAndOpen(path, exportRefs(refs, format));
  new Notice(`Exported ${refs.length} references → ${path}`);
}

/** Export the in-library citation graph as a Mermaid diagram note. */
export async function exportCitationNetwork(plugin: ScholarRagPlugin): Promise<void> {
  const cks = plugin.library.list().map((e) => e.citekey);
  const edges: [string, string][] = [];
  for (const ck of cks) for (const ref of plugin.citationGraph.referencesInLibrary(ck)) edges.push([ck, ref]);
  if (!edges.length) {
    new Notice('No edges — run "Build citation graph" first');
    return;
  }
  const id = (k: string) => k.replace(/[^A-Za-z0-9]/g, "_");
  const seen = new Set<string>(edges.flat());
  const labels = [...seen].map((k) => `  ${id(k)}["${k}"]`).join("\n");
  const lines = edges.map(([a, b]) => `  ${id(a)} --> ${id(b)}`).join("\n");
  const out = `# Citation network\n\n${seen.size} papers, ${edges.length} citation edges.\n\n\`\`\`mermaid\ngraph LR\n${labels}\n${lines}\n\`\`\`\n`;
  const path = normalizePath("Citation network.md");
  await plugin.writeAndOpen(path, out);
}

/** List OpenAlex "related_works" for the active reference, flagging ones already in the library. */
export async function suggestRelated(plugin: ScholarRagPlugin): Promise<void> {
  const r = plugin.activeRef();
  if (!r) return;
  const item = plugin.library.getItem(String(r.fm.citekey));
  if (!item) return;
  const notice = new Notice("Finding related papers…", 0);
  let rel: Awaited<ReturnType<typeof relatedWorks>>;
  try {
    rel = await relatedWorks(item, plugin.settings.openalexMailto);
  } catch (e) {
    new Notice(`Related-papers lookup failed: ${e instanceof Error ? e.message : e}`);
    return;
  } finally {
    notice.hide();
  }
  if (!rel.length) {
    new Notice("No related works found on OpenAlex");
    return;
  }
  const lines = rel
    .sort((a, b) => b.citedByCount - a.citedByCount)
    .map((w) => {
      const have = w.title && plugin.library.findDuplicate({ type: "article-journal", title: w.title });
      return `- ${w.title || w.id} — _${w.citedByCount} citations_ · [OpenAlex](https://openalex.org/${w.id})${have ? `  ✓ already in library (${have})` : ""}`;
    });
  const out = `# Related to ${r.fm.citekey}\n\n${rel.length} related works (OpenAlex), most-cited first:\n\n${lines.join("\n")}\n`;
  await plugin.writeAndOpen(`Related to ${r.fm.citekey}.md`, out);
}
