#!/usr/bin/env node
/**
 * fetch-refs.js — PubMed search -> metadata -> (PMC full text if open access)
 *                 -> Gemini summary -> Obsidian reference note.
 *
 * Usage:
 *   node scripts/fetch-refs.js "biportal endoscopic discectomy outcomes" --n 8
 *   node scripts/fetch-refs.js "lumbar fusion" --n 5 --from 2020 --to 2025 --dry
 *
 * Flags:
 *   --n <N>        max results (default 8)
 *   --from <YYYY>  pubdate lower bound
 *   --to <YYYY>    pubdate upper bound
 *   --dry          fetch + summarize but DON'T write notes (preview to stdout)
 *   --force        overwrite existing notes (default: skip if file exists)
 *
 * Keys come from .env (GEMINI_API_KEY required; NCBI_API_KEY / NCBI_EMAIL optional).
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = path.resolve(__dirname, "..");

// ---------- .env loader (tiny, zero-dep) ----------
function loadEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const k = m[1];
    let v = m[2].replace(/^["']|["']$/g, "");
    if (!(k in process.env) || !process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const NCBI_KEY = process.env.NCBI_API_KEY || "";
const NCBI_EMAIL = process.env.NCBI_EMAIL || "";
const REFS = process.env.VAULT_REFERENCES_DIR || "C:/path/to/YourVault/References";

// ---------- args ----------
function parseArgs(argv) {
  const a = { n: 8, from: "", to: "", dry: false, force: false, query: "" };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--n") a.n = parseInt(argv[++i], 10) || 8;
    else if (t === "--from") a.from = argv[++i] || "";
    else if (t === "--to") a.to = argv[++i] || "";
    else if (t === "--dry") a.dry = true;
    else if (t === "--force") a.force = true;
    else rest.push(t);
  }
  a.query = rest.join(" ").trim();
  return a;
}

// ---------- http helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NCBI = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const ncbiThrottle = NCBI_KEY ? 120 : 360; // ms between NCBI calls (rate limit)

function ncbiAuth() {
  const parts = [];
  if (NCBI_KEY) parts.push(`api_key=${encodeURIComponent(NCBI_KEY)}`);
  if (NCBI_EMAIL) parts.push(`email=${encodeURIComponent(NCBI_EMAIL)}`);
  if (NCBI_EMAIL) parts.push(`tool=rag-obsidian`);
  return parts.length ? "&" + parts.join("&") : "";
}

async function getText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "rag-obsidian/0.1" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
async function getJson(url) {
  return JSON.parse(await getText(url));
}

// ---------- PubMed ----------
async function esearch(query, n, from, to) {
  let url = `${NCBI}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance` +
    `&retmax=${n}&term=${encodeURIComponent(query)}${ncbiAuth()}`;
  if (from) url += `&mindate=${from}&datetype=pdat`;
  if (to) url += `&maxdate=${to}&datetype=pdat`;
  const j = await getJson(url);
  return j.esearchresult?.idlist || [];
}

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
function parsePubDate(s) {
  if (!s) return undefined;
  const ym = s.match(/(\d{4})\s*([A-Za-z]{3})?\s*(\d{1,2})?/);
  if (!ym) return undefined;
  const dp = [parseInt(ym[1], 10)];
  if (ym[2] && MONTHS[ym[2]]) dp.push(MONTHS[ym[2]]);
  if (ym[3]) dp.push(parseInt(ym[3], 10));
  return { "date-parts": [dp] };
}
function splitAuthor(name) {
  // esummary gives "Park SM" -> family "Park", given "SM"
  const parts = (name || "").trim().split(/\s+/);
  if (parts.length === 1) return { family: parts[0] };
  const given = parts.pop();
  return { family: parts.join(" "), given };
}

async function esummary(pmids) {
  const url = `${NCBI}/esummary.fcgi?db=pubmed&retmode=json&id=${pmids.join(",")}${ncbiAuth()}`;
  const j = await getJson(url);
  const r = j.result || {};
  return (r.uids || []).map((uid) => {
    const d = r[uid];
    const ids = d.articleids || [];
    const doi = ids.find((x) => x.idtype === "doi")?.value || "";
    const pmcRaw = ids.find((x) => x.idtype === "pmc")?.value || "";
    const item = {
      type: "article-journal",
      title: (d.title || "").replace(/\.$/, "") + ".",
      author: (d.authors || []).filter((a) => a.authtype === "Author").map((a) => splitAuthor(a.name)),
      issued: parsePubDate(d.pubdate),
      "container-title": d.fulljournalname || d.source || "",
      "container-title-short": d.source || "",
      volume: d.volume || "",
      issue: d.issue || "",
      page: d.pages || "",
      DOI: doi,
      PMID: uid,
    };
    return { item, pmid: uid, pmc: pmcRaw };
  });
}

async function efetchAbstract(pmid) {
  // XML so we can pull clean <AbstractText> (with section labels) instead of the
  // text dump that includes citation header + author affiliations.
  const url = `${NCBI}/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=xml${ncbiAuth()}`;
  try {
    const xml = await getText(url);
    const parts = [];
    const re = /<AbstractText\b([^>]*)>([\s\S]*?)<\/AbstractText>/gi;
    let m;
    while ((m = re.exec(xml))) {
      const label = (m[1].match(/Label="([^"]+)"/i) || [])[1];
      const body = stripXml(m[2]);
      if (body) parts.push(label ? `${label}: ${body}` : body);
    }
    if (parts.length) return parts.join("\n\n");
    // fallback: plain-text mode, strip the leading citation/author block
    const txt = await getText(`${NCBI}/efetch.fcgi?db=pubmed&id=${pmid}&rettype=abstract&retmode=text${ncbiAuth()}`);
    return txt.split(/\n\s*\n/).filter((p) => !/Author information:|^\d+\.\s|@/.test(p)).join("\n\n").trim();
  } catch { return ""; }
}

function stripXml(xml) {
  // crude: drop xml/refs tables, strip tags, collapse whitespace. Good enough to feed an LLM.
  return xml
    .replace(/<ref-list[\s\S]*?<\/ref-list>/gi, "")
    .replace(/<table-wrap[\s\S]*?<\/table-wrap>/gi, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x[0-9a-f]+;|&#\d+;|&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function efetchPmcFullText(pmcId) {
  const numeric = String(pmcId).replace(/^PMC/i, "");
  const url = `${NCBI}/efetch.fcgi?db=pmc&id=${numeric}&retmode=xml${ncbiAuth()}`;
  try {
    const xml = await getText(url);
    const body = xml.match(/<body[\s\S]*?<\/body>/i)?.[0] || xml;
    const text = stripXml(body);
    return text.length > 400 ? text : ""; // PMC sometimes returns only a stub
  } catch { return ""; }
}

// ---------- Gemini summarization ----------
// Delimiter format (not JSON): JSON string-escaping mangles multibyte Korean when the
// model emits stray/invalid \u escapes. Plain ===MARKERS=== are language-safe.
const SYS_PROMPT = `You are a meticulous biomedical research summarizer for a citation manager.
Given a paper's source text (abstract, or full text when available), produce a faithful, detailed summary.
Rules:
- Do NOT invent facts. Use only what the source states.
- Preserve ALL quantitative results: sample sizes, p-values, confidence intervals, means, SDs, ranges, percentages, follow-up durations.
- Write in complete sentences, never bullet fragments or single keywords.
- The English sections must be THOROUGH and detailed: do not omit secondary outcomes, subgroup or per-timepoint results, comparator arms, effect sizes, adverse events, or the authors' stated limitations. When the full text is available, draw specifics from it (design details, inclusion/exclusion criteria, surgical/technical steps, statistical methods). Length is not constrained — prioritize completeness over brevity for the English sections.
- Korean summary must stay concise (4-7 sentences) and cover the main findings in sentence form.
Output EXACTLY this layout with these six markers, nothing before or after. Put the prose on the lines under each marker:
===BACKGROUND===
<Background / Objective, full sentences>
===METHODS===
<Study design, population, interventions, outcome measures, statistics>
===RESULTS===
<All key numeric results in sentences>
===CONCLUSIONS===
<Authors' conclusions plus any noted limitations>
===KR===
<Concise Korean summary in sentence form>
===MESH===
<5-10 indexing terms, comma-separated. Use official NLM MeSH Descriptor headings where one applies (e.g. "Diskectomy", "Lumbar Vertebrae", "Intervertebral Disc Displacement", "Endoscopy"); otherwise a precise topical noun phrase. Terms only.>`;

function parseSections(text) {
  const keys = { BACKGROUND: "background", METHODS: "methods", RESULTS: "results", CONCLUSIONS: "conclusions", KR: "kr", MESH: "mesh" };
  const out = {};
  const re = /===\s*(BACKGROUND|METHODS|RESULTS|CONCLUSIONS|KR|MESH)\s*===/gi;
  const marks = [];
  let m;
  while ((m = re.exec(text))) marks.push({ key: keys[m[1].toUpperCase()], start: m.index, end: re.lastIndex });
  for (let i = 0; i < marks.length; i++) {
    const body = text.slice(marks[i].end, i + 1 < marks.length ? marks[i + 1].start : text.length).trim();
    out[marks[i].key] = body;
  }
  return out;
}

async function summarize(item, sourceText, sourceLabel) {
  const header = `Title: ${item.title}\nJournal: ${item["container-title"]} (${item.issued?.["date-parts"]?.[0]?.[0] || "n.d."})\nSource type: ${sourceLabel}\n\n`;
  const user = header + sourceText.slice(0, 120000);
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GEMINI_KEY}`,
      },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        temperature: 0.2,
        reasoning_effort: "high", // Gemini 3.x: maps to thinking_level high
        messages: [
          { role: "system", content: SYS_PROMPT },
          { role: "user", content: user },
        ],
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const content = j.choices?.[0]?.message?.content || "";
  const out = parseSections(content);
  if (!out.background && !out.results && !out.kr) throw new Error("could not parse summary sections");
  return out;
}

// ---------- note builder (matches src/data/reference.ts) ----------
const STOP = new Set(["the", "a", "an", "on", "of", "in", "for", "and", "to", "with", "at", "by"]);
const slug = (s) => (s || "").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().toLowerCase();
function firstTitleWord(t) { const w = slug(t).split(/\s+/).filter(Boolean); for (const x of w) if (!STOP.has(x)) return x; return w[0] || "untitled"; }
function citekey(it) { const fam = slug(it.author?.[0]?.family || "anon").replace(/\s+/g, ""); const yr = String(it.issued?.["date-parts"]?.[0]?.[0] || "nd"); return `${fam}${yr}${firstTitleWord(it.title)}`; }

// Readable filename `YYYY-JournalAbbr-AuthorInitials-TitleWord` (matches src/data/reference.ts).
const JDROP = new Set(["the", "of", "and", "for", "in", "a", "an", "on", "official", "journal"]);
function journalAbbr(it) {
  const raw = it["container-title-short"] || it["container-title"] || "";
  const words = raw.split(/[^A-Za-z0-9]+/).filter((w) => w && !JDROP.has(w.toLowerCase()));
  return words.map((w) => (/^[A-Z0-9]+$/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join("") || "NA";
}
function authorTag(it) {
  const a = it.author?.[0];
  if (!a) return "Anon";
  const fam = (a.family || a.given || "Anon").replace(/[^A-Za-z0-9]/g, "") || "Anon";
  const given = a.given || "";
  const inits = /^[A-Z]{1,4}$/.test(given) ? given : given.split(/[\s.-]+/).map((w) => w[0] || "").join("").toUpperCase();
  return (fam[0]?.toUpperCase() || "") + fam.slice(1) + inits;
}
function generateFilename(it) {
  const yr = String(it.issued?.["date-parts"]?.[0]?.[0] || "nd");
  const tw = firstTitleWord(it.title);
  const titleCap = tw ? tw[0].toUpperCase() + tw.slice(1) : "untitled";
  return [yr, journalAbbr(it), authorTag(it), titleCap].join("-").replace(/[\\/:*?"<>|]/g, "");
}

// Topic tags (mirrors src/data/reference.ts keywordsToTags).
const TAG_STOP = new Set(["humans","animals","male","female","adult","aged","aged-80-and-over","middle-aged","young-adult","adolescent","child","child-preschool","infant","retrospective-studies","prospective-studies","follow-up-studies","time-factors","reproducibility-of-results","cohort-studies","treatment-outcome","risk-factors","cross-sectional-studies"]);
const TAG_SYNONYM = { discectomy: "diskectomy", "discectomy-percutaneous": "diskectomy-percutaneous", "lumbar-disc-herniation": "intervertebral-disc-displacement", "lumbar-disk-herniation": "intervertebral-disc-displacement", "herniated-disc": "intervertebral-disc-displacement", "lumbar-herniated-disc": "intervertebral-disc-displacement" };
const tagSlug = (s) => (s || "").toLowerCase().replace(/['"().,]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
function keywordsToTags(terms) {
  const out = new Set();
  for (const t of terms || []) { let s = tagSlug(t); if (!s) continue; s = TAG_SYNONYM[s] || s; if (TAG_STOP.has(s)) continue; out.add(s); }
  return [...out];
}
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
  await sleep(ncbiThrottle);
  const su = await getJson(`${NCBI}/esummary.fcgi?db=mesh&id=${id}&retmode=json${ncbiAuth()}`);
  return su.result?.[id]?.ds_meshterms?.[0] || null;
}
async function canonicalizeMesh(terms) {
  const out = [];
  for (const raw of terms) {
    const term = (raw || "").trim();
    if (!term) continue;
    await sleep(ncbiThrottle);
    try { out.push((await meshLookup(term)) || term); } catch { out.push(term); }
  }
  return out;
}

function enBlock(s) {
  const order = [["Background / Objective", s.background], ["Methods", s.methods], ["Results", s.results], ["Conclusions", s.conclusions]];
  return order.filter(([, v]) => v).map(([h, v]) => `**${h}**\n${v}`).join("\n\n");
}

function buildNote(it, summary, source, abstract, tags) {
  const fm = { citekey: citekey(it), type: it.type, title: it.title };
  if (it.author?.length) fm.author = it.author;
  if (it.issued) fm.issued = it.issued;
  if (it["container-title"]) fm["container-title"] = it["container-title"];
  if (it["container-title-short"]) fm["container-title-short"] = it["container-title-short"];
  if (it.volume) fm.volume = it.volume;
  if (it.issue) fm.issue = it.issue;
  if (it.page) fm.page = it.page;
  if (it.DOI) fm.DOI = it.DOI;
  if (it.PMID) fm.PMID = it.PMID;
  if (abstract) fm.abstract = abstract;
  fm.status = "unread";
  fm.added = new Date().toISOString().slice(0, 10);
  fm.summary_source = source.tag;
  if (tags && tags.length) fm.tags = tags;
  const y = yaml.dump(fm, { lineWidth: -1 }).trimEnd();
  const doiLink = it.DOI ? `  ·  [DOI](https://doi.org/${it.DOI})` : "";
  const body = [
    "",
    `# ${it.title}`,
    "",
    `> **Summary source**: ${source.label}${doiLink}`,
    "",
    "## Summary (EN)",
    "",
    enBlock(summary),
    "",
    "## 요약 (KR)",
    "",
    summary.kr || "",
    "",
    "## Notes",
    "",
    "## Highlights",
    "",
  ].join("\n");
  return { key: fm.citekey, text: `---\n${y}\n---\n${body}` };
}

// ---------- main ----------
async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.query) { console.error('Usage: node scripts/fetch-refs.js "<query>" [--n N] [--from YYYY] [--to YYYY] [--dry] [--force]'); process.exit(1); }
  if (!GEMINI_KEY) { console.error("ERROR: GEMINI_API_KEY missing. Paste it into .env"); process.exit(1); }

  if (!a.dry) fs.mkdirSync(REFS, { recursive: true });
  console.log(`[search] "${a.query}"  (n=${a.n}${a.from ? `, from ${a.from}` : ""}${a.to ? `, to ${a.to}` : ""})`);
  const pmids = await esearch(a.query, a.n, a.from, a.to);
  if (!pmids.length) { console.log("No results."); return; }
  console.log(`[search] ${pmids.length} PMIDs: ${pmids.join(", ")}`);

  await sleep(ncbiThrottle);
  const metas = await esummary(pmids);

  for (const { item, pmid, pmc } of metas) {
    const key = citekey(item);
    const fname = generateFilename(item);
    const fp = path.join(REFS, `${fname}.md`);
    if (!a.dry && !a.force && fs.existsSync(fp)) { console.log(`[skip] ${fname} (exists)`); continue; }

    await sleep(ncbiThrottle);
    const abstract = await efetchAbstract(pmid);

    let sourceText = abstract;
    let source = { tag: "pubmed-abstract", label: "PubMed abstract (not open access — full text not retrieved)" };
    if (pmc) {
      await sleep(ncbiThrottle);
      const full = await efetchPmcFullText(pmc);
      if (full) {
        sourceText = full;
        source = { tag: "pmc-fulltext", label: `PMC full text (${pmc}) — summarized from the complete article body` };
      }
    }
    if (!sourceText) { console.log(`[warn] ${key}: no abstract/full text, skipping`); continue; }

    process.stdout.write(`[summarize] ${key} (${source.tag}) ... `);
    let summary;
    try { summary = await summarize(item, sourceText, source.label); }
    catch (e) { console.log(`FAILED: ${e.message}`); continue; }
    console.log("ok");

    // Tags: real MeSH descriptors when indexed; else snap the LLM's terms to official
    // MeSH headings (db=mesh). Author keywords are always added on top.
    await sleep(ncbiThrottle);
    const { descriptors, keywords } = await efetchMesh(pmid);
    let tagTerms;
    if (descriptors.length) {
      tagTerms = [...descriptors, ...keywords];
    } else {
      const llmMesh = (summary.mesh || "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
      tagTerms = [...(await canonicalizeMesh(llmMesh)), ...keywords];
    }
    const tags = keywordsToTags(tagTerms);

    const note = buildNote(item, summary, source, abstract, tags);
    if (a.dry) {
      console.log("\n===== " + fname + " (citekey: " + key + ") =====\n" + note.text.slice(0, 1500) + "\n... [truncated in --dry]\n");
    } else {
      fs.writeFileSync(fp, note.text, "utf8");
      console.log(`[write] References/${fname}.md`);
    }
  }
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
