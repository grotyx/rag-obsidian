import { Notice, TFile, normalizePath, requestUrl } from "obsidian";
import type ScholarRagPlugin from "../../main";
import type { Library } from "../data/library";
import type { CSLItem } from "../types";
import { findOpenAccess } from "../ingest/unpaywall";
import { checkRetraction } from "../ingest/retraction";
import { extractPdfHighlights, extractPdfText, isPdfMagic } from "../ingest/pdf";
import { appendStash, hasStashedText } from "../ingest/pdfStash";
import { mapPool } from "../util/pool";
import { startBatch } from "../ui/progress";
import { findPdfFile } from "./pdfs";

/** One row of `Library.entries()` — the shape the batch commands iterate and the single-note
 *  commands adapt `plugin.activeRef()` into, so both feed the same per-note core. */
type Entry = ReturnType<Library["entries"]>[number];

/** OpenAlex is a polite pool (not an LLM) — width matches `checkRetractionAll`'s Notice budget,
 *  not `POOL_WIDTH`. */
const RETRACTION_POOL_WIDTH = 8;
/** Unpaywall + a PDF download per item; a handful in flight, not the LLM pool's fifteen. */
const OA_DOWNLOAD_POOL_WIDTH = 4;

/** Look up an open-access PDF for the active reference note (Unpaywall) and store it. */
export async function findOpenAccessForActive(plugin: ScholarRagPlugin): Promise<void> {
  const file = plugin.app.workspace.getActiveFile();
  const fm = file ? plugin.app.metadataCache.getFileCache(file)?.frontmatter : null;
  const doi = fm?.DOI;
  if (!file || !doi) {
    new Notice("Open a reference note that has a DOI");
    return;
  }
  let oa: Awaited<ReturnType<typeof findOpenAccess>>;
  try {
    oa = await findOpenAccess(String(doi), plugin.settings.openalexMailto);
  } catch (e) {
    new Notice(`Unpaywall lookup failed: ${e instanceof Error ? e.message : e}`);
    return;
  }
  if (!oa || !oa.isOA) {
    new Notice("No open-access copy found");
    return;
  }
  // Keep the two apart: `oa_pdf` is what "Download open-access PDF" fetches, `oa_url` is the
  // record a human opens. Storing a landing page under `oa_url` made the download save HTML.
  const pdfUrl = oa.pdfUrl || "";
  const landing = oa.landingUrl || "";
  const version = oa.version;
  await plugin.app.fileManager.processFrontMatter(file, (f) => {
    // Overwrite unconditionally: a re-run that no longer finds a PDF must drop the stale one.
    if (landing) f.oa_url = landing;
    else delete f.oa_url;
    if (pdfUrl) f.oa_pdf = pdfUrl;
    else delete f.oa_pdf;
    if (version) f.oa_version = version;
    else delete f.oa_version;
  });
  new Notice(
    pdfUrl
      ? `Open access (${version || "OA"}) — PDF found, run "Download open-access PDF"`
      : `Open access (${version || "OA"}), but no direct PDF link: ${landing}`
  );
}

/** Result of looking up + downloading one entry's open-access PDF. No vault write, no Notice —
 *  `downloadOaPdf` and `downloadOaPdfsAll` save the bytes and report differently. */
export type OaCoreResult =
  | { status: "downloaded"; citekey: string; file: TFile; buffer: ArrayBuffer; oaUrl?: string; oaPdf?: string; oaVersion?: string }
  | { status: "not-oa"; citekey: string; file: TFile }
  | { status: "error"; citekey: string; file: TFile; stage: "unpaywall" | "blocked-url" | "download" | "bad-status" | "not-pdf"; message: string };

/** `oa_pdf`/`oa_url` frontmatter if already resolved, else a fresh Unpaywall lookup by DOI →
 *  download → %PDF- magic check. Mirrors `findOpenAccessForActive` + `downloadOaPdf`'s combined
 *  logic so a batch that has never run either command still gets the same result. */
export async function findAndDownloadOaPdf(plugin: ScholarRagPlugin, entry: Entry): Promise<OaCoreResult> {
  const { citekey, file, item } = entry;
  let url = String(item.oa_pdf || item.oa_url || "");
  let oaUrl = item.oa_url ? String(item.oa_url) : undefined;
  let oaPdf = item.oa_pdf ? String(item.oa_pdf) : undefined;
  let oaVersion = item.oa_version ? String(item.oa_version) : undefined;
  if (!url && item.DOI) {
    let oa: Awaited<ReturnType<typeof findOpenAccess>>;
    try {
      oa = await findOpenAccess(String(item.DOI), plugin.settings.openalexMailto);
    } catch (e) {
      return { status: "error", citekey, file, stage: "unpaywall", message: e instanceof Error ? e.message : String(e) };
    }
    url = oa?.pdfUrl || "";
    if (oa) {
      oaUrl = oa.landingUrl ?? oaUrl;
      oaPdf = oa.pdfUrl ?? oaPdf;
      oaVersion = oa.version ?? oaVersion;
    }
  }
  if (!url) return { status: "not-oa", citekey, file };
  if (!/^https?:\/\//i.test(url)) {
    return { status: "error", citekey, file, stage: "blocked-url", message: "Blocked non-http(s) URL" };
  }
  let res: Awaited<ReturnType<typeof requestUrl>>;
  try {
    res = await requestUrl({ url, throw: false }); // throw:false covers 4xx/5xx only, not network errors
  } catch (e) {
    return { status: "error", citekey, file, stage: "download", message: e instanceof Error ? e.message : String(e) };
  }
  if (res.status >= 400 || !res.arrayBuffer) {
    // Repositories often block non-browser requests (403) — point at the page that works.
    const landing = item.oa_url ? ` — open ${String(item.oa_url)} instead` : "";
    return { status: "error", citekey, file, stage: "bad-status", message: `Download failed (${res.status})${landing}` };
  }
  // `oa_url` may be a landing page (Unpaywall had no url_for_pdf) — don't save HTML as .pdf.
  if (!isPdfMagic(res.arrayBuffer)) {
    return {
      status: "error",
      citekey,
      file,
      stage: "not-pdf",
      message: "URL did not return a PDF (landing page?) — open it in the browser instead",
    };
  }
  return { status: "downloaded", citekey, file, buffer: res.arrayBuffer, oaUrl, oaPdf, oaVersion };
}

export async function downloadOaPdf(plugin: ScholarRagPlugin): Promise<void> {
  const r = plugin.activeRef();
  if (!r) return;
  const citekey = String(r.fm.citekey);
  const notice = new Notice("Downloading PDF…", 0);
  let res: OaCoreResult;
  try {
    res = await findAndDownloadOaPdf(plugin, {
      citekey,
      file: r.file,
      item: r.fm as unknown as CSLItem,
      year: "",
      authors: "",
      title: "",
    });
  } finally {
    notice.hide();
  }
  if (res.status === "not-oa") {
    new Notice("No open-access PDF found (try 'Find open-access PDF' first)");
    return;
  }
  if (res.status === "error") {
    new Notice(
      res.stage === "unpaywall"
        ? `Unpaywall lookup failed: ${res.message}`
        : res.stage === "download"
          ? `Download failed: ${res.message}`
          : res.message
    );
    return;
  }
  // Citekey comes from frontmatter — sanitize before using it as a vault filename.
  const safe = citekey.replace(/[^A-Za-z0-9._-]/g, "").replace(/^\.+/, "");
  if (!safe || safe.includes("..")) {
    new Notice("Invalid citekey for PDF filename");
    return;
  }
  const dir = normalizePath("PDFs");
  if (!plugin.app.vault.getAbstractFileByPath(dir)) await plugin.app.vault.createFolder(dir).catch(() => {});
  const path = normalizePath(`PDFs/${safe}.pdf`);
  const existing = plugin.app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) await plugin.app.vault.modifyBinary(existing, res.buffer);
  else await plugin.app.vault.createBinary(path, res.buffer);
  await plugin.app.fileManager.processFrontMatter(r.file, (fm) => (fm.pdf = `[[${safe}.pdf]]`));
  new Notice(`Saved PDFs/${safe}.pdf`);
  // Stash the text right away so the paper is searchable without a second command. Extraction
  // can still fail on malformed/scanned PDFs; the download stands either way, and "Index linked
  // PDFs" can pick the note up later.
  try {
    const { text } = await extractPdfText(res.buffer);
    await plugin.app.vault.process(r.file, (body) => appendStash(body, text));
  } catch (e) {
    new Notice(`PDF saved, but its text was not indexed: ${e instanceof Error ? e.message : e}`);
  }
}

/** Download an open-access PDF for every reference that has a DOI but no PDF yet (linked or at
 *  `PDFs/<citekey>.pdf`). Unlike the single-note command, it also persists the `oa_url`/`oa_pdf`/
 *  `oa_version` it resolves along the way (`findOpenAccessForActive`'s write), since a batch
 *  entry has typically never had either single command run on it. */
export async function downloadOaPdfsAll(plugin: ScholarRagPlugin): Promise<void> {
  const mailto = plugin.settings.openalexMailto?.trim();
  if (!mailto) {
    new Notice('Set "Contact e-mail" in Settings → Retrieval first — Unpaywall requires it');
    return;
  }
  const todo: Entry[] = [];
  let skipped = 0;
  for (const e of plugin.library.entries()) {
    if (!e.item.DOI || findPdfFile(plugin, e.item.pdf, e.file.path, e.citekey)) {
      skipped++;
      continue;
    }
    todo.push(e);
  }
  if (!todo.length) {
    new Notice(`Nothing to download · ${skipped} skipped (no DOI / already has a PDF)`);
    return;
  }

  const batch = startBatch(plugin, "Downloading OA PDFs", todo.length);
  if (!batch) return;
  let done = 0;
  let failed = 0;
  let downloaded = 0;
  let notOa = 0;
  let outcome = "Downloading OA PDFs failed (see console)";
  // Vault writes (binary + frontmatter + stash) stay sequential; the lookup/download above runs
  // in the pool.
  let writes: Promise<void> = Promise.resolve();
  try {
    await mapPool(
      todo,
      OA_DOWNLOAD_POOL_WIDTH,
      async (e) => {
        try {
          const res = await findAndDownloadOaPdf(plugin, e);
          writes = writes
            .catch(() => {}) // an earlier note's failed write must not fail this one
            .then(async () => {
              if (res.status === "not-oa") {
                notOa++;
                return;
              }
              if (res.status === "error") {
                failed++;
                console.error("[RAG Obsidian] OA PDF download failed", e.file.path, res.message);
                return;
              }
              const safe = e.citekey.replace(/[^A-Za-z0-9._-]/g, "").replace(/^\.+/, "");
              const path = normalizePath(`PDFs/${safe}.pdf`);
              if (!safe || safe.includes("..") || plugin.app.vault.getAbstractFileByPath(path)) {
                // A hit here means a bad citekey or a name collision — `findPdfFile` already
                // gated this entry on "no PDF", so an existing file at this path is never the
                // note's own PDF, and it must not be overwritten.
                failed++;
                console.error("[RAG Obsidian] OA PDF download: invalid citekey or existing file", e.citekey);
                return;
              }
              const dir = normalizePath("PDFs");
              if (!plugin.app.vault.getAbstractFileByPath(dir)) await plugin.app.vault.createFolder(dir).catch(() => {});
              await plugin.app.vault.createBinary(path, res.buffer);
              await plugin.app.fileManager.processFrontMatter(e.file, (fm) => {
                fm.pdf = `[[${safe}.pdf]]`;
                if (res.oaUrl) fm.oa_url = res.oaUrl;
                if (res.oaPdf) fm.oa_pdf = res.oaPdf;
                if (res.oaVersion) fm.oa_version = res.oaVersion;
              });
              downloaded++;
              if (!hasStashedText(await plugin.app.vault.cachedRead(e.file))) {
                try {
                  const { text } = await extractPdfText(res.buffer);
                  await plugin.app.vault.process(e.file, (body) => appendStash(body, text));
                } catch (err) {
                  console.error("[RAG Obsidian] OA PDF text stash failed", e.file.path, err);
                }
              }
            });
          await writes;
        } catch (err) {
          failed++;
          console.error("[RAG Obsidian] OA PDF download failed", e.file.path, err);
        } finally {
          batch.tick(++done, failed);
        }
      },
      batch.signal
    );
    const cancelled = todo.length - done; // never started — the user cancelled
    outcome =
      `${downloaded} downloaded · ${notOa} not OA · ${skipped} skipped · ${failed} failed` +
      (cancelled ? ` · ${cancelled} cancelled` : "");
  } finally {
    batch.finish(outcome);
  }
  new Notice(outcome);
}

/** Result of one retraction lookup. No frontmatter write, no Notice — `checkRetractionForActive`
 *  and `checkRetractionAll` write and report differently. */
export type RetractionCoreResult =
  | { ok: true; citekey: string; file: TFile; retracted: boolean }
  | { ok: false; citekey: string; file: TFile; reason: string };

/** Look up retraction status for one entry (OpenAlex `is_retracted`, by OpenAlex id / DOI / PMID). */
export async function checkRetractionCore(plugin: ScholarRagPlugin, entry: Entry): Promise<RetractionCoreResult> {
  const { citekey, file, item } = entry;
  if (!item.DOI && !item.PMID && !item.openalex_id) return { ok: false, citekey, file, reason: "no-id" };
  try {
    const res = await checkRetraction(item, plugin.settings.openalexMailto);
    if (!res) return { ok: false, citekey, file, reason: "lookup-failed" };
    return { ok: true, citekey, file, retracted: res.retracted };
  } catch (e) {
    return { ok: false, citekey, file, reason: e instanceof Error ? e.message : String(e) };
  }
}

export async function checkRetractionForActive(plugin: ScholarRagPlugin): Promise<void> {
  const r = plugin.activeRef();
  if (!r) return;
  const item = plugin.library.getItem(String(r.fm.citekey));
  if (!item || (!item.DOI && !item.PMID)) {
    new Notice("Need a DOI or PMID to check");
    return;
  }
  const citekey = String(r.fm.citekey);
  const res = await checkRetractionCore(plugin, { citekey, file: r.file, item, year: "", authors: "", title: "" });
  if (!res.ok) {
    new Notice(
      res.reason === "no-id"
        ? "Need a DOI or PMID to check"
        : res.reason === "lookup-failed"
          ? "Retraction lookup failed"
          : `Retraction lookup failed: ${res.reason}`
    );
    return;
  }
  await plugin.app.fileManager.processFrontMatter(r.file, (fm) => (fm.retracted = res.retracted));
  new Notice(res.retracted ? "⚠ RETRACTED — flagged in frontmatter" : "No retraction found");
}

/** Check every reference with a DOI, PMID or OpenAlex id for a retraction (OpenAlex
 *  `is_retracted`). `recheck` (the "…(re-check everything)" command) drops the "no `retracted:`
 *  key yet" filter and re-checks the whole library. On finish, any retracted reference is also
 *  listed in "Retracted references.md" at the vault root. */
export async function checkRetractionAll(plugin: ScholarRagPlugin, recheck = false): Promise<void> {
  const todo: Entry[] = [];
  let skipped = 0;
  for (const e of plugin.library.entries()) {
    const hasId = !!(e.item.DOI || e.item.PMID || e.item.openalex_id);
    if (hasId && (recheck || e.item.retracted === undefined)) todo.push(e);
    else skipped++;
  }
  if (!todo.length) {
    new Notice(`Nothing to check · ${skipped} skipped (no id / already checked)`);
    return;
  }

  const batch = startBatch(plugin, "Checking retractions", todo.length);
  if (!batch) return;
  let done = 0;
  let failed = 0;
  let retracted = 0;
  let clean = 0;
  const retractedEntries: Entry[] = [];
  let outcome = "Checking retractions failed (see console)";
  let writes: Promise<void> = Promise.resolve();
  try {
    await mapPool(
      todo,
      RETRACTION_POOL_WIDTH,
      async (e) => {
        try {
          const res = await checkRetractionCore(plugin, e);
          writes = writes
            .catch(() => {}) // an earlier note's failed write must not fail this one
            .then(async () => {
              if (!res.ok) {
                failed++;
                console.error("[RAG Obsidian] Retraction check failed", e.file.path, res.reason);
                return;
              }
              await plugin.app.fileManager.processFrontMatter(e.file, (fm) => (fm.retracted = res.retracted));
              if (res.retracted) {
                retracted++;
                retractedEntries.push(e);
              } else {
                clean++;
              }
            });
          await writes;
        } catch (err) {
          failed++;
          console.error("[RAG Obsidian] Retraction check failed", e.file.path, err);
        } finally {
          batch.tick(++done, failed);
        }
      },
      batch.signal
    );
    const cancelled = todo.length - done; // never started — the user cancelled
    outcome =
      `${retracted} retracted · ${clean} clean · ${skipped} skipped · ${failed} failed` +
      (cancelled ? ` · ${cancelled} cancelled` : "");
  } finally {
    batch.finish(outcome);
  }
  if (retractedEntries.length) {
    const report =
      `# Retracted references\n\n${retractedEntries.length} retracted:\n\n` +
      retractedEntries.map((e) => `- [[${e.file.basename}]] — ${e.title} (${e.year})`).join("\n") +
      "\n";
    await plugin.writeAndOpen(normalizePath("Retracted references.md"), report);
  }
  new Notice(outcome);
}

/** Read this reference's PDF annotations and write them into its ## Highlights section. */
export async function extractHighlights(plugin: ScholarRagPlugin): Promise<void> {
  const r = plugin.activeRef();
  if (!r) return;
  const key = String(r.fm.citekey);
  const pdf = findPdfFile(plugin, r.fm.pdf, r.file.path, key);
  if (!pdf) {
    new Notice("No PDF linked (download one first, or set `pdf:` in frontmatter)");
    return;
  }
  const notice = new Notice("Reading PDF annotations…", 0);
  let highlights;
  try {
    highlights = await extractPdfHighlights(await plugin.app.vault.readBinary(pdf));
  } catch (e) {
    notice.hide();
    new Notice(`Failed to read PDF: ${e instanceof Error ? e.message : e}`);
    return;
  }
  notice.hide();
  if (!highlights.length) {
    new Notice("No highlights/notes found in the PDF");
    return;
  }
  const block = highlights
    .map((h) => `- ${h.text}${h.type === "note" ? " _(note)_" : ""} _(p.${h.page})_`)
    .join("\n");
  const content = await plugin.app.vault.read(r.file);
  const re = /(##\s+Highlights\s*\n)[\s\S]*?(?=\n#{1,2}\s|$)/i;
  // Function replacement: `block` may contain `$` (e.g. "$5"), which a string
  // replacement would mis-read as a backreference.
  const next = re.test(content)
    ? content.replace(re, (_m, h1) => `${h1}\n${block}\n`)
    : `${content.replace(/\s*$/, "")}\n\n## Highlights\n\n${block}\n`;
  await plugin.app.vault.modify(r.file, next);
  new Notice(`Extracted ${highlights.length} highlight(s)/note(s)`);
}
