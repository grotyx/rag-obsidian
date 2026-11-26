#!/usr/bin/env node
/**
 * to-docx.cjs — convert a compiled manuscript markdown to a styled .docx via Pandoc.
 *
 *   node scripts/to-docx.cjs "path/to/Manuscript (compiled).md"
 *   node scripts/to-docx.cjs input.md output.docx
 *
 * Applies the academic reference template (Times New Roman 12pt, double-spaced, black)
 * in styles/manuscript-reference.docx. Requires Pandoc (https://pandoc.org).
 * Run "Compile manuscript" in the plugin first so [@citekey] are already resolved.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const REF = path.join(ROOT, "styles", "manuscript-reference.docx");

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/to-docx.cjs "<input.md>" [output.docx]');
  process.exit(1);
}
if (!fs.existsSync(input)) {
  console.error(`Not found: ${input}`);
  process.exit(1);
}
const output = process.argv[3] || input.replace(/\.md$/i, "") + ".docx";

function pandocBin() {
  const candidates = ["pandoc", "C:/Program Files/Pandoc/pandoc.exe", "C:/Program Files (x86)/Pandoc/pandoc.exe"];
  for (const c of candidates) {
    try {
      execFileSync(c, ["--version"], { stdio: "ignore" });
      return c;
    } catch {
      /* try next */
    }
  }
  console.error("Pandoc not found. Install from https://pandoc.org/install.html");
  process.exit(1);
}

/** Same preparation the plugin does (src/write/pandoc.ts `pandocPrepare` + `stripFrontmatter`), outside
 *  code: `<sup>` -> `^...^`, `![[fig.png]]` -> `![](fig.png)`, `[[Note|label]]` -> label. */
function prepare(md) {
  md = md.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");
  const IMG = /\.(?:png|jpe?g|gif|svg|webp|bmp|tiff?)$/i;
  const re = /<sup>([^<^]*)<\/sup>|!\[\[([^\]|\n]+?)(?:\|[^\]\n]*)?\]\]|\[\[([^\]|\n]+?)(?:\|([^\]\n]*))?\]\]/gi;
  const fix = (s) =>
    s.replace(re, (m, sup, img, link, alias) => {
      if (sup !== undefined) return `^${sup.replace(/ /g, "\\ ")}^`;
      if (img !== undefined) return IMG.test(img.trim()) ? `![](${img.trim().replace(/ /g, "%20")})` : m;
      const t = link.trim();
      return (alias && alias.trim()) || t.split(/[#^]/)[0].trim() || t;
    });
  let fence = null;
  return md
    .split("\n")
    .map((line) => {
      const f = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fence) {
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
        return line;
      }
      if (f) {
        fence = f[1];
        return line;
      }
      return line.split(/(`[^`]*`)/).map((p, i) => (i % 2 ? p : fix(p))).join("");
    })
    .join("\n");
}

const pandoc = pandocBin();
const inDir = path.dirname(path.resolve(input));
const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "to-docx-"));
const prepared = path.join(tmp, "in.md");
fs.writeFileSync(prepared, prepare(fs.readFileSync(input, "utf8")), "utf8");
// markdown-subscript: "L4~5 and L5~S1" must not become subscript (clinical ranges)
const args = [prepared, "-f", "markdown-subscript", "-t", "docx", "--resource-path", inDir, "-o", path.resolve(output)];
if (fs.existsSync(REF)) args.push(`--reference-doc=${REF}`);
else console.warn(`[warn] template missing (${REF}); using Pandoc default styling`);

try {
  execFileSync(pandoc, args, { stdio: "inherit", cwd: inDir });
  console.log(`[done] ${output}`);
} catch (e) {
  console.error(`Pandoc failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
