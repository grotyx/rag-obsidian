import { Notice, normalizePath } from "obsidian";
import type ScholarRagPlugin from "../../main";
import {
  extractCitekeys,
  buildBibliography,
  inTextLabel,
  replaceCitations,
  resolveCluster,
  splitAtReferences,
  decodeEntities,
} from "../cite/bibliography";
import { formatCitation } from "../cite/format";

/** Scan the active note for [@citekey] and insert/refresh a "## References" section. */
export async function updateBibliography(plugin: ScholarRagPlugin): Promise<void> {
  const file = plugin.app.workspace.getActiveFile();
  if (!file) {
    new Notice("No active note");
    return;
  }
  const content = await plugin.app.vault.read(file);
  const keys = extractCitekeys(content);
  if (keys.length === 0) {
    new Notice("No [@citekey] citations found in this note");
    return;
  }
  const styleId = plugin.styleForNote(file);
  let bib: string;
  if (styleId) {
    try {
      const { bibliography } = await plugin.citeEngine.renderNote(
        styleId,
        keys,
        (k) => plugin.library.getItem(k)
      );
      bib = bibliography.join("\n\n");
    } catch (e) {
      new Notice(
        `Citation style "${styleId}" failed; using ${plugin.settings.citeStyle}. ${
          e instanceof Error ? e.message : ""
        }`
      );
      bib = buildBibliography(keys, plugin.library, plugin.settings.citeStyle);
    }
  } else {
    bib = buildBibliography(keys, plugin.library, plugin.settings.citeStyle);
  }
  const section = `## References\n\n${bib}\n`;
  const { base, tail } = splitAtReferences(content);
  await plugin.app.vault.modify(file, `${base ? base + "\n\n" : ""}${section}${tail}`);
  new Notice(`Bibliography updated: ${keys.length} reference(s)`);
}

/** Produce a sibling "(compiled)" note: [@citekey] resolved to in-text labels + a References list. */
export async function compileManuscript(plugin: ScholarRagPlugin): Promise<void> {
  const file = plugin.app.workspace.getActiveFile();
  if (!file) {
    new Notice("No active note");
    return;
  }
  const content = await plugin.app.vault.read(file);
  const keys = extractCitekeys(content);
  if (!keys.length) {
    new Notice("No [@citekey] citations in this note");
    return;
  }
  const styleId = plugin.styleForNote(file);
  let body = content;
  let refsBlock = "";
  // Code spans / fenced blocks keep their literal [@citekey] — a manuscript documenting the
  // syntax must compile unchanged, and extractCitekeys ignores those brackets too.
  const replaceKey = (text: string, render: (k: string) => string | null): string =>
    replaceCitations(text, (keys) => resolveCluster(keys, render)?.join("; ") ?? null);
  if (styleId) {
    try {
      const { bibliography, inText } = await plugin.citeEngine.renderNote(
        styleId,
        keys,
        (k) => plugin.library.getItem(k)
      );
      body = replaceKey(content, (k) => (inText[k] ? plainText(inText[k]) : null));
      refsBlock = bibliography.join("\n\n");
    } catch (e) {
      new Notice(`Style "${styleId}" failed; using lightweight. ${e instanceof Error ? e.message : ""}`);
    }
  }
  if (!refsBlock) {
    body = replaceKey(content, (k) => {
      const it = plugin.library.getItem(k);
      return it ? inTextLabel(it) : null;
    });
    refsBlock = buildBibliography(keys, plugin.library, plugin.settings.citeStyle);
  }
  const { base, tail } = splitAtReferences(body);
  const out = `${base ? base + "\n\n" : ""}## References\n\n${refsBlock}\n${tail}`;
  const outPath = normalizePath(file.path.replace(/\.md$/i, "") + " (compiled).md");
  await plugin.writeAndOpen(outPath, out);
  new Notice(`Compiled → ${outPath}`);
}

export async function copyCitation(plugin: ScholarRagPlugin): Promise<void> {
  const r = plugin.activeRef();
  if (!r) return;
  const key = String(r.fm.citekey);
  const styleId = plugin.styleForNote(r.file);
  let text = "";
  if (styleId) {
    try {
      const { bibliography } = await plugin.citeEngine.renderNote(styleId, [key], (k) => plugin.library.getItem(k));
      // A one-item render under a numeric style is prefixed "1. " — anything else is the
      // entry's own text (e.g. an author named "3. Bundesliga …") and must survive.
      text = (bibliography[0] || "").replace(/^1[.)]\s+/, "");
    } catch {
      /* fall back below */
    }
  }
  if (!text) {
    const it = plugin.library.getItem(key);
    if (it) text = formatCitation(it, plugin.settings.citeStyle);
  }
  if (!text) {
    new Notice("Could not format citation");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    new Notice("Citation copied to clipboard");
  } catch {
    new Notice(text); // clipboard unavailable (e.g. mobile) — show it instead
  }
}

/** Export a styled citation + its summary for each reference (active note's citations, else whole library). */
export async function annotatedBibliography(plugin: ScholarRagPlugin): Promise<void> {
  const active = plugin.app.workspace.getActiveFile();
  let keys: string[] = [];
  if (active) keys = extractCitekeys(await plugin.app.vault.cachedRead(active));
  const wholeLib = keys.length === 0;
  if (wholeLib) keys = plugin.library.list().map((e) => e.citekey);
  if (!keys.length) {
    new Notice("No references found");
    return;
  }
  const styleId = active ? plugin.styleForNote(active) : plugin.settings.cslStyleId;
  const notice = new Notice(`Building annotated bibliography (${keys.length})…`, 0);
  const blocks: string[] = [];
  try {
    // One citeproc pass for the whole list (an engine per key froze the UI on big libraries);
    // entries come back in the style's own order, so numbered styles read 1..N.
    let ordered: { key: string; cite: string }[] = [];
    if (styleId) {
      try {
        const r = await plugin.citeEngine.renderNote(styleId, keys, (x) => plugin.library.getItem(x));
        ordered = r.entryIds.map((key, i) => ({ key, cite: r.bibliography[i] }));
      } catch (e) {
        new Notice(`Style "${styleId}" failed; using ${plugin.settings.citeStyle}. ${e instanceof Error ? e.message : ""}`);
      }
    }
    // Fill in any key citeproc skipped (or all of them, if the style failed).
    const rendered = new Set(ordered.map((e) => e.key));
    for (const key of keys) {
      if (rendered.has(key)) continue;
      const item = plugin.library.getItem(key);
      if (item) ordered.push({ key, cite: formatCitation(item, plugin.settings.citeStyle) });
    }
    for (const { key, cite } of ordered) {
      const file = plugin.library.getFile(key);
      const summary = file ? extractSummary(await plugin.app.vault.cachedRead(file)) : "";
      blocks.push(`### ${cite}\n\n${summary || "_(no summary)_"}\n`);
    }
  } finally {
    notice.hide();
  }
  const title = wholeLib ? "Annotated bibliography (library)" : `Annotated bibliography — ${active?.basename}`;
  await plugin.writeAndOpen(`${title}.md`, `# ${title}\n\n${blocks.join("\n")}`);
}

/** citeproc in-text HTML → plain text (for the compiled manuscript). */
function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ""));
}

/** Pull the EN summary (else KR) section body out of a reference note. */
function extractSummary(content: string): string {
  const en = content.match(/##\s+Summary \(EN\)\s*\n([\s\S]*?)(?=\n#{1,2}\s|$)/i);
  if (en && en[1].trim()) return en[1].trim();
  const kr = content.match(/##\s+요약 \(KR\)\s*\n([\s\S]*?)(?=\n#{1,2}\s|$)/);
  return kr ? kr[1].trim() : "";
}
