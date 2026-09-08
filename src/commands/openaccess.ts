import { Notice, TFile, normalizePath, requestUrl } from "obsidian";
import type ScholarRagPlugin from "../../main";
import { findOpenAccess } from "../ingest/unpaywall";
import { checkRetraction } from "../ingest/retraction";
import { extractPdfHighlights, extractPdfText } from "../ingest/pdf";
import { appendStash } from "../ingest/pdfStash";
import { findPdfFile } from "./pdfs";

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

export async function downloadOaPdf(plugin: ScholarRagPlugin): Promise<void> {
  const r = plugin.activeRef();
  if (!r) return;
  // `oa_pdf` is the direct link; fall back to `oa_url`, which held the PDF before 0.4.3 and
  // may be a landing page — the %PDF- check below rejects it if so.
  let url = String(r.fm.oa_pdf || r.fm.oa_url || "");
  if (!url && r.fm.DOI) {
    try {
      url = (await findOpenAccess(String(r.fm.DOI), plugin.settings.openalexMailto))?.pdfUrl || "";
    } catch (e) {
      new Notice(`Unpaywall lookup failed: ${e instanceof Error ? e.message : e}`);
      return;
    }
  }
  if (!url) {
    new Notice("No open-access PDF found (try 'Find open-access PDF' first)");
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    new Notice("Blocked non-http(s) URL");
    return;
  }
  // Citekey comes from frontmatter — sanitize before using it as a vault filename.
  const safe = String(r.fm.citekey).replace(/[^A-Za-z0-9._-]/g, "").replace(/^\.+/, "");
  if (!safe || safe.includes("..")) {
    new Notice("Invalid citekey for PDF filename");
    return;
  }
  const notice = new Notice("Downloading PDF…", 0);
  let res: Awaited<ReturnType<typeof requestUrl>>;
  try {
    res = await requestUrl({ url, throw: false }); // throw:false covers 4xx/5xx only, not network errors
  } catch (e) {
    new Notice(`Download failed: ${e instanceof Error ? e.message : e}`);
    return;
  } finally {
    notice.hide();
  }
  if (res.status >= 400 || !res.arrayBuffer) {
    // Repositories often block non-browser requests (403) — point at the page that works.
    const landing = r.fm.oa_url ? ` — open ${String(r.fm.oa_url)} instead` : "";
    new Notice(`Download failed (${res.status})${landing}`);
    return;
  }
  // `oa_url` may be a landing page (Unpaywall had no url_for_pdf) — don't save HTML as .pdf.
  const magic = String.fromCharCode(...new Uint8Array(res.arrayBuffer.slice(0, 5)));
  if (magic !== "%PDF-") {
    new Notice("URL did not return a PDF (landing page?) — open it in the browser instead");
    return;
  }
  const dir = normalizePath("PDFs");
  if (!plugin.app.vault.getAbstractFileByPath(dir)) await plugin.app.vault.createFolder(dir).catch(() => {});
  const path = normalizePath(`PDFs/${safe}.pdf`);
  const existing = plugin.app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) await plugin.app.vault.modifyBinary(existing, res.arrayBuffer);
  else await plugin.app.vault.createBinary(path, res.arrayBuffer);
  await plugin.app.fileManager.processFrontMatter(r.file, (fm) => (fm.pdf = `[[${safe}.pdf]]`));
  new Notice(`Saved PDFs/${safe}.pdf`);
  // Stash the text right away so the paper is searchable without a second command. pdfjs comes
  // from a CDN and may be unavailable (mobile webview, network blocked) — the download stands
  // either way, and "Index linked PDFs" can pick the note up later.
  try {
    const { text } = await extractPdfText(res.arrayBuffer);
    await plugin.app.vault.process(r.file, (body) => appendStash(body, text));
  } catch (e) {
    new Notice(`PDF saved, but its text was not indexed: ${e instanceof Error ? e.message : e}`);
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
  let res: Awaited<ReturnType<typeof checkRetraction>>;
  try {
    res = await checkRetraction(item, plugin.settings.openalexMailto);
  } catch (e) {
    new Notice(`Retraction lookup failed: ${e instanceof Error ? e.message : e}`);
    return;
  }
  if (!res) {
    new Notice("Retraction lookup failed");
    return;
  }
  const retracted = res.retracted;
  await plugin.app.fileManager.processFrontMatter(r.file, (fm) => (fm.retracted = retracted));
  new Notice(retracted ? "⚠ RETRACTED — flagged in frontmatter" : "No retraction found");
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
