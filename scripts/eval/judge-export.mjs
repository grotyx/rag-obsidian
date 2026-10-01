// Pool the top-10 papers of every run per question, skip pairs already judged, write one judge prompt
// per question:  VAULT=… QUESTIONS=… node scripts/eval/judge-export.mjs
import fs from "fs"; import path from "path";
const V = path.join(process.env.VAULT, "References");
const qs = JSON.parse(fs.readFileSync(process.env.QUESTIONS, "utf8")).questions;
const qrels = fs.existsSync("_eval/qrels.json") ? JSON.parse(fs.readFileSync("_eval/qrels.json", "utf8")) : {};
const runs = fs.readdirSync("_eval/runs").map((f) => JSON.parse(fs.readFileSync(path.join("_eval/runs", f), "utf8")));
const need = new Map();
for (const q of qs) {
  const pool = new Set();
  for (const r of runs) for (const lang of ["en", "ko"]) for (const k of (r[`${q.id}|${lang}`] || []).slice(0, 10)) pool.add(k);
  const todo = [...pool].filter((k) => qrels[q.id]?.[k] === undefined);
  if (todo.length) need.set(q.id, todo);
}
const wanted = new Set([...need.values()].flat());
const info = {};
for (const f of fs.readdirSync(V)) {
  const t = fs.readFileSync(path.join(V, f), "utf8").slice(0, 12000);
  const ck = t.match(/^citekey:\s*"?([^"\n]+)/m)?.[1]; if (!ck || !wanted.has(ck)) continue;
  const title = t.match(/^title:\s*"?(.+?)"?$/m)?.[1] ?? "";
  const abs = (t.match(/^abstract:\s*([\s\S]*?)\n[a-z_]+:/m)?.[1] ?? "").replace(/\s+/g, " ").replace(/^["'>|-]\s*/, "").slice(0, 900);
  info[ck] = { title, abs };
}
fs.mkdirSync("_eval/judge/prompts", { recursive: true });
for (const [qid, keys] of need) {
  const q = qs.find((x) => x.id === qid);
  const list = keys.map((k) => `[${k}] ${info[k]?.title ?? "(missing)"}\n${info[k]?.abs ?? ""}`).join("\n\n");
  fs.writeFileSync(`_eval/judge/prompts/${qid}.txt`,
`You judge literature-search relevance for a clinical evidence question. Do not use any tools.
Question: ${q.question}

Grade every paper below:
2 = directly studies this question (population AND intervention/exposure AND outcome match) — it would be cited as evidence;
1 = partially relevant (same topic, but different population, comparator or outcome; or background/review that discusses it);
0 = not relevant.
Reply with ONLY a JSON object mapping each bracketed citekey to its grade, e.g. {"smith2020x": 2, "lee2019y": 0}.

${list}
`);
}
console.log(`questions to judge: ${need.size}, pairs: ${[...need.values()].flat().length}`);
