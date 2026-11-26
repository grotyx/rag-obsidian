import { App, TFile, normalizePath } from "obsidian";
import { tagsOf, text } from "../util/json";
import { CSLItem, ScholarRagSettings, effective } from "../types";
import { buildNote, generateCitekey, generateFilename, BuildNoteOpts } from "./reference";
import { resolvePdfLink } from "../ingest/pdfStash";

export interface RefEntry {
  file: TFile;
  citekey: string;
  title: string;
  authors: string;
  year: string;
  /** container-title (journal/venue). */
  journal?: string;
  /** `added` frontmatter, ISO-ish string. */
  added?: string;
  status?: string;
  /** `cited_by_count` frontmatter. */
  citedBy?: number;
  /** `pdf:` frontmatter non-empty, or a `PDFs/<citekey>.pdf` file exists. */
  hasPdf?: boolean;
  retracted?: boolean;
  /** Screening decision (`include` frontmatter: include/exclude/pending). */
  include?: string;
}

/** Citekey as used in a PDF file name: what the download commands write to `PDFs/`. */
export function safePdfName(citekey: string): string {
  return citekey.replace(/[^A-Za-z0-9._-]/g, "").replace(/^\.+/, "");
}

export class Library {
  constructor(public app: App, public settings: ScholarRagSettings) {}

  /** The one way a reference's PDF is located: the `pdf:` link if it resolves, then
   *  `PDFs/<citekey>.pdf` as the download commands name it. The Library badge, PRISMA and every
   *  PDF command go through here so they agree. */
  pdfFile(pdfValue: unknown, notePath: string, citekey: string): TFile | null {
    const link = resolvePdfLink(pdfValue);
    const linked = link ? this.app.metadataCache.getFirstLinkpathDest(link, notePath) : null;
    if (linked) return linked;
    for (const name of new Set([citekey, safePdfName(citekey)])) {
      if (!name) continue;
      const f = this.app.vault.getAbstractFileByPath(normalizePath(`PDFs/${name}.pdf`));
      if (f instanceof TFile) return f;
    }
    return null;
  }

  folder(): string {
    return normalizePath(effective(this.settings, "referencesFolder"));
  }

  async ensureFolder(): Promise<void> {
    const f = this.folder();
    if (!this.app.vault.getAbstractFileByPath(f)) {
      await this.app.vault.createFolder(f);
    }
  }

  // Citekeys created this session (citekey → note path), so a batch add (PubMed modal loop)
  // stays unique even before the metadata cache catches up.
  private createdCitekeys = new Map<string, { path: string; item: CSLItem }>();

  // Identifiers (normalized DOI / PMID / normalized title → created note) of references created
  // this session — metadataCache lags vault.create, so rapid double-adds or DOI-then-PMID
  // adds of the same work would slip past the cache scan in findDuplicate.
  // Entries whose note is gone (deleted this session) are ignored, so a re-add after a
  // delete is not reported as a duplicate of a note that no longer exists.
  private createdIds = new Map<string, { citekey: string; path: string; item: CSLItem }>();

  private rememberIds(item: CSLItem, citekey: string, path: string): void {
    const hit = { citekey, path, item };
    const doi = normDoi(item.DOI);
    if (doi) this.createdIds.set(`doi:${doi}`, hit);
    for (const k of matchKeys(item)) this.createdIds.set(k, hit);
  }

  /** The file of a session-registry entry, or null once it no longer applies: the note is gone, or
   *  its parsed frontmatter has since been corrected so `carries` is false (a renamed citekey, a
   *  fixed DOI). With no parsed frontmatter yet — the note was just created — the entry stands;
   *  that early window is why the registry exists. Returns the frontmatter too (undefined then). */
  private liveCreated(
    path: string,
    carries: (fm: Record<string, unknown>) => boolean
  ): { file: TFile; fm: Record<string, unknown> | undefined } | null {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    const fm: Record<string, unknown> | undefined = this.app.metadataCache.getFileCache(file)?.frontmatter;
    return !fm || carries(fm) ? { file, fm } : null;
  }

  private knownCitekeys(): Set<string> {
    const s = new Set<string>();
    for (const [ck, created] of this.createdCitekeys) {
      if (this.liveCreated(created.path, (fm) => String(fm.citekey) === ck)) s.add(ck);
    }
    for (const e of this.list()) s.add(e.citekey);
    return s;
  }

  citekeyExists(citekey: string): boolean {
    return this.knownCitekeys().has(citekey);
  }

  uniqueCitekey(base: string, also: Iterable<string> = []): string {
    const set = this.knownCitekeys();
    for (const k of also) set.add(k);
    return pickKey(base, set);
  }

  /** Every known citekey (parsed notes, this session's creates, notes the cache has not parsed),
   *  built once and then grown by each create. `createReference` used to rebuild it per insert —
   *  a full scan, sort and file read per note, so a 24k-record import was quadratic. Dropped by
   *  `invalidateKeyCache()` on any change that is not the first parse of a note created here. */
  private keySet: Set<string> | null = null;
  private keyEpoch = 0;

  private async knownKeysForCreate(): Promise<Set<string>> {
    if (this.keySet) return this.keySet;
    // An invalidation during the read (a note synced in meanwhile) means the scan may have missed
    // it: scan again before a key is allocated. ponytail: five tries, then use the last scan once.
    let set = new Set<string>();
    for (let attempt = 0; attempt < 5; attempt++) {
      const epoch = this.keyEpoch;
      set = this.knownCitekeys();
      for (const k of await this.unparsedCitekeys()) set.add(k);
      if (epoch === this.keyEpoch) {
        this.keySet = set;
        break;
      }
    }
    return set;
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

  /** Citekeys of reference notes the metadata cache has not parsed yet (right after start-up, or
   *  a note synced in from elsewhere): `list()` cannot see them, so a new key could repeat one. */
  private async unparsedCitekeys(): Promise<string[]> {
    const prefix = this.folder() + "/";
    const keys: string[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(prefix) || this.app.metadataCache.getFileCache(file)?.frontmatter) continue;
      const m = /^citekey:\s*["']?([^"'\s]+)/m.exec(await this.app.vault.cachedRead(file));
      if (m) keys.push(m[1]);
    }
    return keys;
  }

  // Creates run one at a time: a key is picked from what exists, so two overlapping creates
  // (MCP add_reference + a modal batch) could otherwise pick the same one.
  private createChain: Promise<unknown> = Promise.resolve();

  createReference(item: CSLItem, opts: BuildNoteOpts = {}): Promise<TFile> {
    const run = this.createChain.then(() => this.createReferenceNow(item, opts));
    this.createChain = run.catch(() => undefined);
    return run;
  }

  private async createReferenceNow(item: CSLItem, opts: BuildNoteOpts): Promise<TFile> {
    await this.ensureFolder();
    const known = await this.knownKeysForCreate();
    // The caller's own findDuplicate ran before it waited for earlier creates in the chain; one of
    // them may have added this very work since. Hand back that note instead of a second copy.
    const dup = this.findDuplicate(item);
    const existing = dup ? this.getFile(dup) : null;
    if (existing) return existing;
    const citekey = pickKey(generateCitekey(item, this.settings), known);
    known.add(citekey);
    const filename = this.uniqueFilename(generateFilename(item));
    const path = normalizePath(`${this.folder()}/${filename}.md`);
    this.createdCitekeys.set(citekey, { path, item });
    this.rememberIds(item, citekey, path);
    this.createdPaths.add(path); // its first metadata-cache parse is expected, not an outside change
    const content = buildNote(item, citekey, opts);
    // No cache drop: `known` already holds the key, and findDuplicate finds this note through the
    // session registry until the identifier map is next rebuilt.
    return this.app.vault.create(path, content);
  }

  /** Read a reference's CSL-JSON item by its frontmatter citekey (filename may differ). */
  getItem(citekey: string): CSLItem | null {
    const f = this.getFile(citekey);
    if (!f) return null;
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
    if (fm) return fm as unknown as CSLItem;
    const created = this.createdCitekeys.get(citekey);
    return created?.path === f.path ? created.item : null;
  }

  /** citekey → note path, rebuilt lazily and cleared by `invalidateKeyCache()`.
   *  `getFile` used to scan the whole vault on every call — and `buildBibliography`
   *  calls it once per cited key. */
  private citekeyPathCache: Map<string, string> | null = null;

  /** Notes created here whose first metadata-cache parse has not been seen yet. */
  private createdPaths = new Set<string>();

  /** A markdown file appeared in the vault ('create' event). One this library made is already in
   *  every cache; any other (synced in, pasted) may hold a citekey the next create must not repeat,
   *  and the metadata cache has not parsed it yet. */
  noteFileCreated(path: string): void {
    if (!path.endsWith(".md") || !path.startsWith(this.folder() + "/") || this.createdPaths.has(path)) return;
    this.invalidateKeyCache();
  }

  /** Drop the `getFile`, identifier and citekey caches; call when notes are changed, moved, or
   *  deleted. Pass the changed note's `path` from the metadata-cache event: the first parse of a
   *  note this library just created changes nothing the caches do not already know. */
  invalidateKeyCache(path?: string): void {
    if (path && this.createdPaths.delete(path)) return;
    this.citekeyPathCache = null;
    this.idMap = null;
    this.keySet = null;
    this.keyEpoch++;
  }

  /** match key → first note (in vault scan order, `order`) carrying it; built lazily in one pass
   *  and cleared with the citekey cache. `findDuplicate` used to rescan every note per call. */
  private idMap: Map<string, { citekey: string; path: string; order: number }> | null = null;

  private buildIdMap(): Map<string, { citekey: string; path: string; order: number }> {
    const m = new Map<string, { citekey: string; path: string; order: number }>();
    const prefix = this.folder() + "/";
    let order = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(prefix)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || !fm.citekey) continue;
      const hit = { citekey: String(fm.citekey), path: file.path, order: order++ };
      for (const k of matchKeys(fm)) if (!m.has(k)) m.set(k, hit);
    }
    return m;
  }

  /** The note the scan would have returned (earliest in scan order across `keys`), checked against
   *  its current frontmatter; a stale entry drops the map and retries once on a fresh one. */
  private mapDuplicate(keys: string[], item: CSLItem): string | null {
    for (let attempt = 0; attempt < 2; attempt++) {
      const map = (this.idMap ??= this.buildIdMap());
      const hits = keys.flatMap((k) => {
        const h = map.get(k);
        return h ? [{ k, h }] : [];
      });
      hits.sort((a, b) => a.h.order - b.h.order);
      let stale = false;
      for (const { k, h } of hits) {
        const file = this.app.vault.getAbstractFileByPath(h.path);
        const fm = file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
        if (!fm || !fm.citekey || String(fm.citekey) !== h.citekey || !matchKeys(fm).includes(k)) {
          stale = true;
          break;
        }
        // A title alone never outweighs a differing DOI / PMID.
        // ponytail: the map keeps one note per title, so a compatible second note behind a conflicting first one is missed.
        if (k.startsWith("title:") && idsConflict(item, fm)) continue;
        return h.citekey;
      }
      if (!stale) return null;
      this.idMap = null;
    }
    return null;
  }

  private keyCache(): Map<string, string> {
    if (!this.citekeyPathCache) {
      const m = new Map<string, string>();
      const prefix = this.folder() + "/";
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (!file.path.startsWith(prefix)) continue;
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        if (fm && fm.citekey && !m.has(String(fm.citekey))) m.set(String(fm.citekey), file.path);
      }
      this.citekeyPathCache = m;
    }
    return this.citekeyPathCache;
  }

  /** Find the note file whose frontmatter citekey matches (filename is decoupled from citekey). */
  getFile(citekey: string): TFile | null {
    const created = this.createdCitekeys.get(citekey);
    const live = created && this.liveCreated(created.path, (fm) => String(fm.citekey) === citekey);
    if (live) return live.file;
    const cached = this.keyCache().get(citekey);
    if (cached) {
      const file = this.app.vault.getAbstractFileByPath(cached);
      if (file instanceof TFile) return file;
      // Stale entry (rename/delete beat the invalidation) — fall through and rescan.
      this.citekeyPathCache?.delete(citekey);
    }
    const prefix = this.folder() + "/";
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(prefix)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm && String(fm.citekey) === citekey) {
        this.keyCache().set(citekey, file.path);
        return file;
      }
    }
    return null;
  }

  /** Return the citekey of an existing note that matches by DOI, PMID, OpenAlex id, or normalized
   *  title. Only notes with a frontmatter citekey count (as in `entries()`): `getFile` could not
   *  find any other. */
  findDuplicate(item: CSLItem): string | null {
    const keys = matchKeys(item);
    // Session registry first: covers notes created moments ago that metadataCache
    // hasn't indexed yet (rapid double-add, DOI-then-PMID of the same work).
    for (const k of keys) {
      const hit = this.createdIds.get(k);
      const live = hit && this.liveCreated(hit.path, (fm) => !!fm.citekey && matchKeys(fm).includes(k));
      if (!hit || !live) continue;
      if (k.startsWith("title:") && idsConflict(item, live.fm ?? hit.item)) continue;
      return live.fm ? String(live.fm.citekey) : hit.citekey;
    }
    return this.mapDuplicate(keys, item);
  }

  /** Same scan as `entries()`, without the parsed CSL item. */
  list(): RefEntry[] {
    return this.entries();
  }

  /** Single-pass scan returning each note's citekey, CSL item, and file together —
   *  avoids the O(n²) of calling getItem()/getFile() per citekey over the whole library. */
  entries(): (RefEntry & { item: CSLItem })[] {
    const prefix = this.folder() + "/";
    const out: (RefEntry & { item: CSLItem })[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(prefix)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm || !fm.citekey) continue;
      const citekey = String(fm.citekey);
      const citedByRaw: unknown = fm.cited_by_count;
      const citedBy =
        citedByRaw === undefined || citedByRaw === null || citedByRaw === "" ? undefined : Number(citedByRaw);
      const hasPdf = this.pdfFile(fm.pdf, file.path, citekey) !== null;
      out.push({
        citekey,
        item: fm as unknown as CSLItem,
        file,
        year: extractYear(fm.issued),
        authors: formatAuthors(fm.author),
        title: String(fm.title ?? file.basename),
        journal: fm["container-title"] ? String(fm["container-title"]) : undefined,
        added: fm.added ? String(fm.added) : undefined,
        status: fm.status ? String(fm.status) : undefined,
        citedBy: citedBy !== undefined && !Number.isNaN(citedBy) ? citedBy : undefined,
        hasPdf,
        retracted: fm.retracted === true,
        include: fm.include ? String(fm.include) : undefined,
      });
    }
    out.sort((a, b) => b.year.localeCompare(a.year) || a.title.localeCompare(b.title));
    return out;
  }
}

/** `base`, or `base` + the first free letter (then number), not in `taken`. */
function pickKey(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (const s of "abcdefghijklmnopqrstuvwxyz") {
    if (!taken.has(base + s)) return base + s;
  }
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** Identifiers a note can be matched on — the ones `findDuplicate` compares, in the same
 *  normalized form. A short title is not an identifier ("Editorial" would group unrelated notes). */
export function matchKeys(item: { DOI?: unknown; PMID?: unknown; title?: unknown; openalex_id?: unknown }): string[] {
  const keys: string[] = [];
  const doi = normDoi(item.DOI);
  if (doi) keys.push(`doi:${doi}`);
  if (item.PMID) keys.push(`pmid:${text(item.PMID)}`);
  const oa = normOpenAlex(item.openalex_id);
  if (oa) keys.push(`oa:${oa}`);
  const title = normTitle(item.title);
  if (title.length > 12) keys.push(`title:${title}`);
  return keys;
}

/** Two works that each carry a DOI (or a PMID, or an OpenAlex id) and the values differ are
 *  different works, whatever their titles say. Only a title match consults this; a shared
 *  identifier still wins. */
export function idsConflict(
  a: { DOI?: unknown; PMID?: unknown; openalex_id?: unknown },
  b: { DOI?: unknown; PMID?: unknown; openalex_id?: unknown }
): boolean {
  const da = normDoi(a.DOI);
  const db = normDoi(b.DOI);
  if (da && db && da !== db) return true;
  const pa = text(a.PMID);
  const pb = text(b.PMID);
  if (pa && pb && pa !== pb) return true;
  const oa = normOpenAlex(a.openalex_id);
  const ob = normOpenAlex(b.openalex_id);
  return !!oa && !!ob && oa !== ob;
}

/** True when the whole group is one connected set through shared DOI / PMID / OpenAlex ids
 *  (A-B by DOI, B-C by PMID is fine). Two separate id-linked pairs joined only by a title are
 *  two papers, so the merge dialog leaves such a group unchecked. */
export function sharesStrongId(group: { item: { DOI?: unknown; PMID?: unknown; openalex_id?: unknown } }[]): boolean {
  const parent = group.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const first = new Map<string, number>();
  group.forEach((e, i) => {
    for (const k of matchKeys(e.item).filter((k) => !k.startsWith("title:"))) {
      const j = first.get(k);
      if (j === undefined) first.set(k, i);
      else parent[find(i)] = find(j);
    }
  });
  return new Set(group.map((_, i) => find(i))).size === 1;
}

/** Group notes that are the same work. Two notes belong together when they share **any**
 *  identifier — the rule `findDuplicate` applies on add. Comparing one signature per note
 *  instead (DOI else PMID else title) missed the ordinary case: the same paper added once by
 *  DOI, whose note also carries a PMID, and once from PubMed, whose note carries only the PMID.
 *  Sharing is transitive, so A-B by DOI and B-C by PMID is one group of three. */
export function duplicateGroups<
  T extends { item: { DOI?: unknown; PMID?: unknown; title?: unknown; openalex_id?: unknown } }
>(entries: T[]): T[][] {
  const parent = entries.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const members = new Map<number, number[]>(); // root → its entries, for the title check
  const membersOf = (r: number): number[] => members.get(r) ?? [r];
  const seen = new Map<string, number[]>();
  const identified = new Set<number>();
  entries.forEach((e, i) => {
    for (const k of matchKeys(e.item)) {
      identified.add(i);
      const prevs = seen.get(k);
      if (!prevs) {
        seen.set(k, [i]);
        continue;
      }
      prevs.push(i);
      for (const prev of prevs.slice(0, -1)) {
        const ra = find(prev);
        const rb = find(i);
        if (ra === rb) continue;
        // A shared title joins two groups only when no member of one conflicts with a member of
        // the other (differing DOI / PMID), so a generic title cannot chain different works.
        const ma = membersOf(ra);
        const mb = membersOf(rb);
        if (k.startsWith("title:") && ma.some((x) => mb.some((y) => idsConflict(entries[x].item, entries[y].item)))) continue;
        union(prev, i);
        members.set(find(i), [...ma, ...mb]);
      }
    }
  });
  const byRoot = new Map<number, T[]>();
  entries.forEach((e, i) => {
    if (!identified.has(i)) return; // nothing to match on — never a duplicate
    const r = find(i);
    (byRoot.get(r) ?? byRoot.set(r, []).get(r)!).push(e);
  });
  return [...byRoot.values()].filter((g) => g.length > 1);
}

/** Duplicate groups for PRISMA, as note paths: `duplicateGroups`, plus notes that share a
 *  citekey (a sync conflict leaves two copies of one note, often without any DOI / PMID). Two
 *  copies whose identifiers conflict are different papers and stay apart. */
export function prismaDuplicateGroups<
  T extends { citekey: string; file: { path: string }; item: { DOI?: unknown; PMID?: unknown; title?: unknown; openalex_id?: unknown } }
>(entries: T[]): string[][] {
  const parent = new Map<string, string>(entries.map((e) => [e.file.path, e.file.path]));
  const find = (p: string): string => (parent.get(p) === p ? p : find(parent.get(p)!));
  const union = (a: string, b: string): void => void parent.set(find(a), find(b));
  for (const g of duplicateGroups(entries)) for (const e of g.slice(1)) union(g[0].file.path, e.file.path);
  const byKey = new Map<string, T[]>();
  for (const e of entries) if (e.citekey) (byKey.get(e.citekey) ?? byKey.set(e.citekey, []).get(e.citekey)!).push(e);
  // Copies of one citekey join only when the WHOLE of both groups is compatible, and a group that
  // fits two incompatible groups (a sparse copy beside DOI A and DOI B) stays alone — so the
  // outcome never depends on input order and two different DOIs never end in one group.
  for (const same of byKey.values()) {
    const roots = new Set(same.map((e) => find(e.file.path)));
    if (roots.size < 2) continue;
    // Whole groups (they may hold notes of other citekeys, joined by DOI / PMID / title).
    const cs = [...roots].map((r) => entries.filter((e) => find(e.file.path) === r));
    const fits = (x: T[], y: T[]): boolean => !x.some((a) => y.some((b) => idsConflict(a.item, b.item)));
    const mates = cs.map((x, i) => cs.filter((y, j) => j !== i && fits(x, y)));
    const clean = mates.map((m) => m.every((p, a) => m.every((q, b) => a >= b || fits(p, q))));
    cs.forEach((x, i) => {
      if (!clean[i]) return;
      for (const y of mates[i]) if (clean[cs.indexOf(y)]) union(x[0].file.path, y[0].file.path);
    });
  }
  const groups = new Map<string, string[]>();
  for (const e of entries) {
    const r = find(e.file.path);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(e.file.path);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

/** What "Summarize and tag references (fill gaps)" should run over. */
export type BackfillScope =
  | { kind: "all" }
  | { kind: "note"; path: string }
  | { kind: "folder"; folder: string }
  | { kind: "tag"; tag: string };

/** Does this `entries()` row fall inside the given scope? Folder match requires the note path
 *  to sit strictly under `folder` (so "References/Spine2" never matches a "References/Spine"
 *  scope). Tag match is case-insensitive and tolerant of a leading "#" on either side. */
export function inScope(
  entry: { file: { path: string }; item: Record<string, unknown> },
  scope: BackfillScope
): boolean {
  switch (scope.kind) {
    case "all":
      return true;
    case "note":
      return entry.file.path === scope.path;
    case "folder":
      return entry.file.path.startsWith(scope.folder.replace(/\/+$/, "") + "/");
    case "tag": {
      const want = scope.tag.replace(/^#/, "").toLowerCase();
      return tagsOf(entry.item.tags).some((t) => t.toLowerCase() === want);
    }
  }
}

/** Normalize a DOI for comparison: lowercase, strip doi.org URL / "doi:" prefixes
 *  (CSL DOI casing and prefixing vary by source — Crossref vs PubMed vs pasted URLs). */
export function normDoi(d: unknown): string {
  return text(d || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:\s*/, "");
}

/** OpenAlex id for comparison: lowercase, without the `https://openalex.org/` prefix. */
export function normOpenAlex(v: unknown): string {
  return text(v || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/openalex\.org\//, "");
}

export function normTitle(t: unknown): string {
  return text(t || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function formatAuthors(author: unknown): string {
  if (!Array.isArray(author)) return "";
  const names = author
    .map((a) => {
      if (a && typeof a === "object") {
        const o = a as Record<string, unknown>;
        return text(o.family) || text(o.literal);
      }
      return text(a);
    })
    .filter(Boolean);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names[0]} et al.`;
}

export function extractYear(issued: unknown): string {
  if (issued && typeof issued === "object") {
    const dp = (issued as Record<string, unknown>)["date-parts"];
    if (Array.isArray(dp) && Array.isArray(dp[0]) && dp[0][0]) return String(dp[0][0]);
  }
  return "";
}
