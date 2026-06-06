import { App, TFile, normalizePath } from "obsidian";
import { CSLItem, ScholarRagSettings } from "../types";
import { buildNote, generateCitekey, generateFilename, BuildNoteOpts } from "./reference";

export interface RefEntry {
  file: TFile;
  citekey: string;
  title: string;
  authors: string;
  year: string;
}

export class Library {
  constructor(public app: App, public settings: ScholarRagSettings) {}

  folder(): string {
    return normalizePath(this.settings.referencesFolder || "References");
  }

  async ensureFolder(): Promise<void> {
    const f = this.folder();
    if (!this.app.vault.getAbstractFileByPath(f)) {
      await this.app.vault.createFolder(f);
    }
  }

  // Citekeys created this session, so a batch add (PubMed modal loop) stays unique
  // even before the metadata cache catches up.
  private createdCitekeys = new Set<string>();

  private knownCitekeys(): Set<string> {
    const s = new Set(this.createdCitekeys);
    for (const e of this.list()) s.add(e.citekey);
    return s;
  }

  citekeyExists(citekey: string): boolean {
    return this.knownCitekeys().has(citekey);
  }

  uniqueCitekey(base: string): string {
    const set = this.knownCitekeys();
    if (!set.has(base)) return base;
    for (const s of "abcdefghijklmnopqrstuvwxyz") {
      if (!set.has(base + s)) return base + s;
    }
    return base + Date.now();
  }

  private fileExists(name: string): boolean {
    const path = normalizePath(`${this.folder()}/${name}.md`);
    return this.app.vault.getAbstractFileByPath(path) instanceof TFile;
  }

  /** Unique note filename (decoupled from citekey); suffixes -2, -3, … on collision. */
  uniqueFilename(base: string): string {
    if (!this.fileExists(base)) return base;
    for (let i = 2; i < 100; i++) if (!this.fileExists(`${base}-${i}`)) return `${base}-${i}`;
    return `${base}-${Date.now()}`;
  }

  async createReference(item: CSLItem, opts: BuildNoteOpts = {}): Promise<TFile> {
    await this.ensureFolder();
    const citekey = this.uniqueCitekey(generateCitekey(item, this.settings));
    this.createdCitekeys.add(citekey);
    const filename = this.uniqueFilename(generateFilename(item));
    const content = buildNote(item, citekey, opts);
    const path = normalizePath(`${this.folder()}/${filename}.md`);
    return this.app.vault.create(path, content);
  }

  /** Read a reference's CSL-JSON item by its frontmatter citekey (filename may differ). */
  getItem(citekey: string): CSLItem | null {
    const f = this.getFile(citekey);
    if (!f) return null;
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
    return fm ? (fm as unknown as CSLItem) : null;
  }

  /** Find the note file whose frontmatter citekey matches (filename is decoupled from citekey). */
  getFile(citekey: string): TFile | null {
    const prefix = this.folder() + "/";
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(prefix)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm && String(fm.citekey) === citekey) return file;
    }
    return null;
  }

  /** Return the citekey of an existing note that matches by DOI, PMID, or normalized title. */
  findDuplicate(item: CSLItem): string | null {
    const doi = (item.DOI || "").toLowerCase();
    const pmid = String(item.PMID || "");
    const title = normTitle(item.title);
    const prefix = this.folder() + "/";
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(prefix)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) continue;
      const key = String(fm.citekey || file.basename);
      if (doi && String(fm.DOI || "").toLowerCase() === doi) return key;
      if (pmid && String(fm.PMID || "") === pmid) return key;
      if (title && title.length > 12 && normTitle(String(fm.title || "")) === title) return key;
    }
    return null;
  }

  list(): RefEntry[] {
    const prefix = this.folder() + "/";
    const out: RefEntry[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(prefix)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || !fm.citekey) continue;
      out.push({
        file,
        citekey: String(fm.citekey),
        title: String(fm.title ?? file.basename),
        authors: formatAuthors(fm.author),
        year: extractYear(fm.issued),
      });
    }
    out.sort((a, b) => b.year.localeCompare(a.year) || a.title.localeCompare(b.title));
    return out;
  }

  /** Single-pass scan returning each note's citekey, CSL item, and file together —
   *  avoids the O(n²) of calling getItem()/getFile() per citekey over the whole library. */
  entries(): { citekey: string; item: CSLItem; file: TFile; year: string; authors: string; title: string }[] {
    const prefix = this.folder() + "/";
    const out: { citekey: string; item: CSLItem; file: TFile; year: string; authors: string; title: string }[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(prefix)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || !fm.citekey) continue;
      out.push({
        citekey: String(fm.citekey),
        item: fm as unknown as CSLItem,
        file,
        year: extractYear(fm.issued),
        authors: formatAuthors(fm.author),
        title: String(fm.title ?? file.basename),
      });
    }
    out.sort((a, b) => b.year.localeCompare(a.year) || a.title.localeCompare(b.title));
    return out;
  }
}

function normTitle(t: unknown): string {
  return String(t || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function formatAuthors(author: unknown): string {
  if (!Array.isArray(author)) return "";
  const names = author
    .map((a) => {
      if (a && typeof a === "object") {
        const o = a as Record<string, unknown>;
        return String(o.family || o.literal || "");
      }
      return String(a);
    })
    .filter(Boolean);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]} et al.`;
}

function extractYear(issued: unknown): string {
  if (issued && typeof issued === "object") {
    const dp = (issued as Record<string, unknown>)["date-parts"];
    if (Array.isArray(dp) && Array.isArray(dp[0]) && dp[0][0]) return String(dp[0][0]);
  }
  return "";
}
