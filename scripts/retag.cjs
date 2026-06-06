#!/usr/bin/env node
/**
 * retag.cjs — (re)assign topic tags to existing reference notes.
 *
 *   node scripts/retag.cjs            # tag notes missing tags
 *   node scripts/retag.cjs --force    # re-tag every note (overwrite existing tags)
 *
 * For each note: use real PubMed MeSH (by PMID) when the article is indexed;
 * otherwise ask Gemini for MeSH-style terms and snap them to official NLM MeSH
 * headings via the MeSH database. Non-MeSH terms are kept as plain tags.
 * Keys/paths come from .env (GEMINI_API_KEY, NCBI_API_KEY/EMAIL, VAULT_REFERENCES_DIR).
 */
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = path.resolve(__dirname, "..");
const env = fs.existsSync(path.join(ROOT, ".env")) ? fs.readFileSync(path.join(ROOT, ".env"), "utf8") : "";
const getEnv = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim() || "";
const GEMINI_KEY = getEnv("GEMINI_API_KEY");
const GEMINI_MODEL = getEnv("GEMINI_MODEL") || "gemini-3.5-flash";
const NCBI_KEY = getEnv("NCBI_API_KEY");
const NCBI_EMAIL = getEnv("NCBI_EMAIL");
const REFS = getEnv("VAULT_REFERENCES_DIR") || "C:/path/to/YourVault/References";
const FORCE = process.argv.includes("--force");

const NCBI = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const ncbiAuth = () => (NCBI_KEY ? `&api_key=${NCBI_KEY}` : "") + (NCBI_EMAIL ? `&email=${encodeURIComponent(NCBI_EMAIL)}&tool=rag-obsidian` : "");
const throttle = NCBI_KEY ? 120 : 360;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (u) => (await fetch(u)).json();
const getText = async (u) => (await fetch(u)).text();

const TAG_STOP = new Set(["humans","animals","male","female","adult","aged","aged-80-and-over","middle-aged","young-adult","adolescent","child","child-preschool","infant","retrospective-studies","prospective-studies","follow-up-studies","time-factors","reproducibility-of-results","cohort-studies","treatment-outcome","risk-factors","cross-sectional-studies"]);
const TAG_SYNONYM = { discectomy: "diskectomy", "discectomy-percutaneous": "diskectomy-percutaneous", "lumbar-disc-herniation": "intervertebral-disc-displacement", "lumbar-disk-herniation": "intervertebral-disc-displacement", "herniated-disc": "intervertebral-disc-displacement", "lumbar-herniated-disc": "intervertebral-disc-displacement" };
const tagSlug = (s) => (s || "").toLowerCase().replace(/['"().,]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
function keywordsToTags(terms) { const out = new Set(); for (const t of terms || []) { let s = tagSlug(t); if (!s) continue; s = TAG_SYNONYM[s] || s; if (TAG_STOP.has(s)) continue; out.add(s); } return [...out]; }

async function efetchMesh(pmid) {
  try {
    const xml = await getText(`${NCBI}/efetch.fcgi?db=pubmed&id=${pmid}&retmode=xml&rettype=abstract${ncbiAuth()}`);
    const descriptors = [...xml.matchAll(/<DescriptorName[^>]*>([^<]+)<\/DescriptorName>/g)].map((m) => m[1]).filter(Boolean);
    const keywords = [...xml.matchAll(/<Keyword[^>]*>([^<]+)<\/Keyword>/g)].map((m) => m[1]).filter(Boolean);
    return { descriptors, keywords };
  } catch { return { descriptors: [], keywords: [] }; }
}
async function meshLookup(term) {
  // Exact MeSH-heading match only (a free-text fallback mis-snaps fragments like
  // "percutaneous" → "Percutaneous Coronary Intervention"). Non-headings stay verbatim.
  const sr = await getJson(`${NCBI}/esearch.fcgi?db=mesh&retmode=json&term=${encodeURIComponent(`${term}[MeSH Terms]`)}${ncbiAuth()}`);
  const id = sr.esearchresult?.idlist?.[0];
  if (!id) return null;
  await sleep(throttle);
  const su = await getJson(`${NCBI}/esummary.fcgi?db=mesh&id=${id}&retmode=json${ncbiAuth()}`);
  return su.result?.[id]?.ds_meshterms?.[0] || null;
}
async function canonicalize(terms) {
  const out = [];
  for (const raw of terms) { const t = (raw || "").trim(); if (!t) continue; await sleep(throttle); try { out.push((await meshLookup(t)) || t); } catch { out.push(t); } }
  return out;
}
async function geminiMesh(text) {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${GEMINI_KEY}` },
    body: JSON.stringify({ model: GEMINI_MODEL, temperature: 0.2, messages: [
      { role: "system", content: 'Output 5-10 indexing terms for the paper, comma-separated, official NLM MeSH Descriptor headings where one applies; otherwise precise topical noun phrases. Terms only.' },
      { role: "user", content: text.slice(0, 12000) },
    ] }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const j = await res.json();
  return (j.choices?.[0]?.message?.content || "").split(/[,;\n]+/);
}

function parseNote(text) { const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/); if (!m) return null; return { fm: yaml.load(m[1]), fmRaw: m[1], body: m[2] }; }

async function main() {
  if (!GEMINI_KEY) { console.error("ERROR: GEMINI_API_KEY missing in .env"); process.exit(1); }
  const files = fs.readdirSync(REFS).filter((f) => f.endsWith(".md"));
  for (const f of files) {
    const full = path.join(REFS, f);
    const p = parseNote(fs.readFileSync(full, "utf8"));
    if (!p || !p.fm?.citekey) continue;
    if (!FORCE && Array.isArray(p.fm.tags) && p.fm.tags.length) { console.log(`[skip] ${f} (has tags)`); continue; }

    let descriptors = [], keywords = [];
    if (p.fm.PMID) { await sleep(throttle); ({ descriptors, keywords } = await efetchMesh(String(p.fm.PMID))); }
    let terms, how;
    if (descriptors.length) {
      terms = [...descriptors, ...keywords];
      how = "mesh";
    } else {
      const src = [p.fm.title, p.fm.abstract || "", p.body].join("\n\n");
      try { terms = [...(await canonicalize(await geminiMesh(src))), ...keywords]; how = "llm+canon"; }
      catch (e) { console.log(`[fail] ${f}: ${e.message}`); continue; }
    }
    const tags = keywordsToTags(terms);
    if (!tags.length) { console.log(`[none] ${f}`); continue; }
    const fmRaw = p.fmRaw.replace(/\ntags:\n(?:\s*-\s.*\n?)*/g, "\n").trimEnd();
    const tagYaml = "tags:\n" + tags.map((x) => `  - ${x}`).join("\n");
    fs.writeFileSync(full, `---\n${fmRaw}\n${tagYaml}\n---\n${p.body}`, "utf8");
    console.log(`[tag:${how}] ${f}  +${tags.length}: ${tags.slice(0, 6).join(", ")}${tags.length > 6 ? " …" : ""}`);
  }
  console.log("Done.");
}
main().catch((e) => { console.error(e); process.exit(1); });
