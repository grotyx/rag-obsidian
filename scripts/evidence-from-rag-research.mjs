// One-off: add "## Evidence (extracted)" to reference notes from rag_research extraction JSONs.
// node scripts/evidence-from-rag-research.mjs <References folder> <extracted dir> [--dry-run] [--limit N]
import { readdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const li = args.indexOf("--limit");
const limit = li >= 0 ? Number(args[li + 1]) : Infinity;
const pos = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--limit");
if (pos.length < 2) { console.error("usage: <References folder> <extracted dir> [--dry-run] [--limit N]"); process.exit(1); }
const [refDir, exDir] = pos;

const HEAD = "## Evidence (extracted)";
const cap = (s, n) => (s.length > n ? s.slice(0, n) : s);
const one = (v) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
// Backtick runs would close the ```text fence the findings sit in.
const noFence = (s) => s.replace(/`{3,}/g, "'''");
const val = (v) => cap(noFence(one(v)).replace(/\[/g, "(").replace(/\]/g, ")"), 300);
const quoteOf = (v) => cap(noFence(one(v)).replace(/"/g, "'"), 600);

// --- notes: PMID / DOI from frontmatter
const byPmid = new Map(), byDoi = new Map();
for (const f of readdirSync(refDir).filter((f) => f.endsWith(".md"))) {
  const m = readFileSync(join(refDir, f), "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) continue;
  const pm = m[1].match(/^PMID:\s*["']?(\d+)/im)?.[1];
  const dm = m[1].match(/^DOI:\s*["']?(10\.[^\s"']+)/im)?.[1];
  if (pm) byPmid.set(pm, f);
  if (dm) byDoi.set(dm.toLowerCase(), f);
}

// --- JSONs -> findings per note
const perNote = new Map(); // file -> {model, items: Map(quote -> line)}
const st = { json: 0, noMatch: 0, nonVerbatim: 0, lowConf: 0, empty: 0 };
const dirs = {};
for (const jf of readdirSync(exDir).filter((f) => f.endsWith(".json") && !f.includes("superseded")).sort()) {
  let d;
  try { d = JSON.parse(readFileSync(join(exDir, jf), "utf8")); } catch { continue; }
  st.json++;
  const b = d.biblio ?? d.metadata ?? {};
  const pm = /^\d+$/.test(String(b.pmid ?? "").trim()) ? String(b.pmid).trim() : null;
  const doi = String(b.doi ?? "").trim().toLowerCase();
  const note = (pm && byPmid.get(pm)) || (doi.startsWith("10.") && byDoi.get(doi)) || null;
  if (!note) { st.noMatch++; continue; }
  const e = perNote.get(note) ?? { model: d.extraction_model || "unknown", items: new Map() };
  perNote.set(note, e);
  for (const c of d.chunks ?? []) {
    for (const [key, kind] of [["statements", "comparative"], ["prognostic_statements", "prognostic"]]) {
      for (const s of c[key] ?? []) {
        if (s.quote_kind !== "verbatim") { st.nonVerbatim++; continue; }
        if (!(Number(s.confidence) >= 0.7)) { st.lowConf++; continue; }
        const outcome = one(s.outcome_raw), quote = quoteOf(s.source_quote);
        if (!outcome || !quote) { st.empty++; continue; }
        if (e.items.has(quote)) continue;
        const mod = one(s.outcome_modifier);
        const f = [["kind", kind], ["outcome", mod ? `${outcome} (${mod})` : outcome],
          ["intervention", s.intervention_raw], ["comparator", s.comparator_raw], ["predictor", s.predictor_raw],
          ["subgroup", s.subgroup], ["timepoint", s.timepoint], ["n", s.n_participants], ["studies", s.n_studies],
          ["effect", s.effect_size], ["ci", s.confidence_interval], ["p", s.p_value],
          ["direction", s.effect_direction], ["heterogeneity", s.heterogeneity]];
        if (s.effect_direction) dirs[s.effect_direction] = (dirs[s.effect_direction] || 0) + 1;
        const fields = f.filter(([, v]) => val(v)).map(([k, v]) => `[${k}:: ${val(v)}]`).join(" ");
        e.items.set(quote, { kind, text: `> ${fields}\n>   "${quote}"` });
      }
    }
  }
}

const render = (e) => {
  const items = [...e.items.values()].slice(0, 40);
  return { items, text: `${HEAD}\n\n> [!quote]- ${items.length} findings · verbatim quotes from the full text · extracted by rag_research (${val(e.model)}) — verify before citing\n> \`\`\`text\n${items.map((i) => i.text).join("\n")}\n> \`\`\`\n` };
};

let matched = 0, written = 0, tot = 0, cmp = 0, prog = 0, shown = 0;
for (const [file, e] of perNote) {
  const { items, text } = render(e);
  if (!items.length) continue;
  if (matched >= limit) break;
  matched++;
  tot += items.length;
  cmp += items.filter((i) => i.kind === "comparative").length;
  prog += items.filter((i) => i.kind === "prognostic").length;
  const p = join(refDir, file), old = readFileSync(p, "utf8");
  const lines = old.split("\n");
  const s = lines.findIndex((l) => l.trimEnd() === HEAD);
  let out;
  if (s >= 0) {
    let n = lines.findIndex((l, i) => i > s && /^##[ \t]/.test(l));
    if (n < 0) n = lines.length;
    const tail = lines.slice(n).join("\n");
    out = lines.slice(0, s).join("\n") + (s ? "\n" : "") + text + (n < lines.length ? "\n" + tail : "");
  } else {
    out = old.replace(/\s*$/, "") + "\n\n" + text;
  }
  if (dry) { if (shown++ < 2) console.log(`--- ${file}\n${text}`); continue; }
  if (out === old) continue;
  const tmp = p + ".evtmp";
  writeFileSync(tmp, out);
  renameSync(tmp, p);
  written++;
}
console.log(`${dry ? "[dry-run] " : ""}JSONs read ${st.json}; notes matched ${matched}; notes written ${written}`);
console.log(`findings ${tot} (comparative ${cmp}, prognostic ${prog})`);
console.log(`skipped: non-verbatim ${st.nonVerbatim}, low confidence ${st.lowConf}, empty ${st.empty}`);
console.log(`JSONs without matching note: ${st.noMatch}`);
console.log("effect_direction seen:", JSON.stringify(dirs));
