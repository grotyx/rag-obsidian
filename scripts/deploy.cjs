#!/usr/bin/env node
/**
 * deploy.cjs — copy built plugin files into the Obsidian vault plugin folder.
 *
 *   npm run deploy     # runs build first, then this (see package.json)
 *   node scripts/deploy.cjs
 *
 * Destination comes from .env `VAULT_PLUGIN_DIR`. If unset, it is derived from
 * `VAULT_REFERENCES_DIR` (…/<vault>/References → …/<vault>/.obsidian/plugins/rag-obsidian).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function loadEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

function destDir() {
  if (process.env.VAULT_PLUGIN_DIR) return process.env.VAULT_PLUGIN_DIR;
  const refs = process.env.VAULT_REFERENCES_DIR;
  if (refs) {
    const vault = refs.replace(/[/\\]References\/?$/, "");
    return path.join(vault, ".obsidian", "plugins", "rag-obsidian");
  }
  console.error("ERROR: set VAULT_PLUGIN_DIR (or VAULT_REFERENCES_DIR) in .env");
  process.exit(1);
}

const dest = destDir();
const files = ["main.js", "manifest.json", "styles.css"];

fs.mkdirSync(dest, { recursive: true });
let copied = 0;
for (const f of files) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) {
    console.warn(`[skip] ${f} not found (run "npm run build" first?)`);
    continue;
  }
  fs.copyFileSync(src, path.join(dest, f));
  console.log(`[copy] ${f} -> ${path.join(dest, f)}`);
  copied++;
}

// Bundled CSL styles + locale (read at runtime by the citeproc engine).
const stylesSrc = path.join(ROOT, "styles");
if (fs.existsSync(stylesSrc)) {
  const stylesDest = path.join(dest, "styles");
  fs.mkdirSync(stylesDest, { recursive: true });
  let n = 0;
  for (const f of fs.readdirSync(stylesSrc)) {
    if (!/\.(csl|xml)$/i.test(f)) continue;
    fs.copyFileSync(path.join(stylesSrc, f), path.join(stylesDest, f));
    n++;
  }
  console.log(`[copy] styles/ (${n} CSL/locale files) -> ${stylesDest}`);
}

console.log(`Done. ${copied}/${files.length} core file(s) + styles deployed. Reload Obsidian (Ctrl+R).`);
