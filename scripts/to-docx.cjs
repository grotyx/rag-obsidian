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

const pandoc = pandocBin();
const args = [input, "-o", output];
if (fs.existsSync(REF)) args.push(`--reference-doc=${REF}`);
else console.warn(`[warn] template missing (${REF}); using Pandoc default styling`);

try {
  execFileSync(pandoc, args, { stdio: "inherit" });
  console.log(`[done] ${output}`);
} catch (e) {
  console.error(`Pandoc failed: ${e.message}`);
  process.exit(1);
}
