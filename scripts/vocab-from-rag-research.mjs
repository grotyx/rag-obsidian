// One-off: rag_research reference_vocab_v2.json -> user-vocabulary JSON for query expansion.
// Usage: node scripts/vocab-from-rag-research.mjs <out.json> <rag_research>/docs/redesign_v2/reference_vocab_v2.json
import { readFileSync, writeFileSync } from "node:fs";

const [out, IN] = process.argv.slice(2);
if (!out || !IN) { console.error("usage: node vocab-from-rag-research.mjs <out.json> <reference_vocab_v2.json>"); process.exit(1); }

const d = JSON.parse(readFileSync(IN, "utf8"));
const sections = ["interventions", "pathologies", "outcomes", "anatomy", "observables"];
const all = sections.flatMap((s) => d[s] ?? []).filter((c) => c && c.name && !c.off_domain);
const byId = new Map(all.map((c) => [c.reference_id, c]));
// ambiguous_terms collide across concepts (e.g. "asd"): never use them as aliases.
const ambiguous = new Set((d.ambiguous_terms ?? []).map((t) => String(t.surface).toLowerCase()));
const balanced = (s) => (s.match(/\(/g) ?? []).length === (s.match(/\)/g) ?? []).length; // truncated aliases like "(plsf"
const kids = new Map();
for (const c of all) if (c.parent_id && byId.has(c.parent_id)) kids.set(c.parent_id, [...(kids.get(c.parent_id) ?? []), c.name]);

const concepts = all.map((c) => ({
  name: c.name,
  aliases: [...new Set((c.aliases ?? []).map((a) => String(a).trim()))].filter(
    (a) => a.length > 1 && balanced(a) && !ambiguous.has(a.toLowerCase())
  ),
  broader: c.parent_id && byId.has(c.parent_id) ? [byId.get(c.parent_id).name] : [],
  narrower: (kids.get(c.reference_id) ?? []).sort(),
}));

writeFileSync(out, JSON.stringify({ version: 1, concepts }, null, 1));
const aliases = concepts.flatMap((c) => c.aliases);
console.log(`concepts ${concepts.length}, aliases ${aliases.length}, korean aliases ${aliases.filter((a) => /\p{Script=Hangul}/u.test(a)).length}`);
