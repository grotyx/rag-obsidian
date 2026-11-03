import { App, FuzzySuggestModal, Notice, normalizePath } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { BackfillScope, inScope } from "../data/library";
import { Finding, parseFindings } from "../data/findings";
import { localDate } from "../data/reference";
import { authorNames, yearFromIssued } from "../index/chunker";
import { text } from "../util/json";

/** One CSV row: the reference's columns plus one parsed finding. */
export interface EvidenceRow {
  citekey: string;
  author: string;
  year: string;
  title: string;
  doi: string;
  pmid: string;
  study_id: string;
  kq: string;
  include: string;
  design: string;
  level: string;
  finding: Finding;
}

const REF_COLUMNS = ["citekey", "first_author", "year", "title", "doi", "pmid", "study_id", "kq", "include", "design", "level"];

/** RFC 4180 field: quoted when it holds a comma, quote or line break; quotes doubled. */
function cell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Evidence table as CSV (BOM + CRLF rows). Columns: the reference columns, then the union of
 *  finding field keys in first-seen order, then `quote`. Values are copied verbatim. */
export function evidenceCsv(rows: EvidenceRow[]): string {
  const keys: string[] = [];
  for (const r of rows) for (const k of Object.keys(r.finding)) if (k !== "quote" && !keys.includes(k)) keys.push(k);
  const lines = [[...REF_COLUMNS, ...keys, "quote"]];
  for (const r of rows) {
    const f = r.finding as unknown as Record<string, string | undefined>;
    lines.push([
      r.citekey, r.author, r.year, r.title, r.doi, r.pmid, r.study_id, r.kq, r.include, r.design, r.level,
      ...keys.map((k) => f[k] ?? ""),
      r.finding.quote,
    ]);
  }
  return "\uFEFF" + lines.map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Every finding of the in-scope references, one row each. */
export async function collectEvidenceRows(plugin: ScholarRagPlugin, scope: BackfillScope): Promise<{ rows: EvidenceRow[]; papers: number }> {
  const rows: EvidenceRow[] = [];
  let papers = 0;
  for (const e of plugin.library.entries()) {
    if (!inScope(e, scope)) continue;
    const findings = parseFindings(await plugin.app.vault.cachedRead(e.file));
    if (!findings.length) continue;
    papers++;
    const it: Record<string, unknown> = e.item;
    const year = yearFromIssued(it.issued);
    const kq = Array.isArray(it.kq) ? it.kq.map(text).filter(Boolean).join("; ") : text(it.kq);
    for (const finding of findings) {
      rows.push({
        citekey: e.citekey,
        author: authorNames(it.author)[0] ?? "",
        year: year ? String(year) : "",
        title: text(it.title),
        doi: text(it.DOI),
        pmid: text(it.PMID),
        study_id: text(it.study_id),
        kq,
        include: text(it.include),
        design: text(it.design),
        level: text(it.level),
        finding,
      });
    }
  }
  return { rows, papers };
}

export async function exportEvidenceTable(plugin: ScholarRagPlugin, scope: BackfillScope): Promise<void> {
  const { rows, papers } = await collectEvidenceRows(plugin, scope);
  if (!rows.length) {
    new Notice("No extracted findings in this scope; nothing exported.");
    return;
  }
  const vault = plugin.app.vault;
  if (!vault.getAbstractFileByPath("Exports")) await vault.createFolder("Exports").catch(() => {});
  const d = new Date();
  const hm = String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0");
  const path = normalizePath(`Exports/Evidence table ${localDate(d)} ${hm}.csv`);
  await vault.create(path, evidenceCsv(rows));
  new Notice(`Exported ${rows.length} findings from ${papers} papers to ${path}`);
}

type Item = { kind: "all" } | { kind: "folder"; path: string } | { kind: "tag"; tag: string };

/** Pick all references, a folder or a tag to export the evidence table for. */
export class EvidenceScopeModal extends FuzzySuggestModal<Item> {
  constructor(app: App, private plugin: ScholarRagPlugin) {
    super(app);
    this.setPlaceholder("Export evidence for all references, a folder or a tag…");
  }

  getItems(): Item[] {
    const folders = new Set<string>();
    const tags = new Set<string>();
    for (const e of this.plugin.library.entries()) {
      folders.add(e.file.path.slice(0, e.file.path.lastIndexOf("/")));
      const raw = e.item.tags;
      for (const t of Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? [raw] : []) tags.add(t);
    }
    return [
      { kind: "all" },
      ...[...folders].sort().map((path): Item => ({ kind: "folder", path })),
      ...[...tags].sort().map((tag): Item => ({ kind: "tag", tag })),
    ];
  }

  getItemText(item: Item): string {
    return item.kind === "all" ? "All references" : item.kind === "folder" ? item.path : `#${item.tag}`;
  }

  onChooseItem(item: Item): void {
    const scope: BackfillScope =
      item.kind === "all" ? { kind: "all" } : item.kind === "folder" ? { kind: "folder", folder: item.path } : { kind: "tag", tag: item.tag };
    void exportEvidenceTable(this.plugin, scope);
  }
}
