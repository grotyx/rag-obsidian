// Run the held-out questions through MCP search_library and save a paper-level ranking per question.
//   VAULT=<vault path> QUESTIONS=<heldout json> node scripts/eval/run.mjs <variant> [extra search_library args as JSON]
// Output: _eval/runs/<variant>.json  { "<qid>|en": [citekey…], "<qid>|ko": [...] }
import fs from "fs"; import path from "path";
import { connect } from "./mcp.mjs";
const [variant, extra = "{}"] = process.argv.slice(2);
if (!variant) throw new Error("usage: run.mjs <variant> [json args]");
const call = connect(process.env.VAULT);
const qs = JSON.parse(fs.readFileSync(process.env.QUESTIONS, "utf8")).questions;
const out = {}; const ms = [];
for (const q of qs) {
  for (const [lang, text] of [["en", q.question], ["ko", q.question_kr]]) {
    if (!text) continue;
    const t = Date.now();
    const r = await call("search_library", { query: text, limit: 30, ...JSON.parse(extra) });
    ms.push(Date.now() - t);
    out[`${q.id}|${lang}`] = [...new Set(r.results.map((h) => h.citekey))];
  }
  process.stdout.write(".");
}
fs.mkdirSync("_eval/runs", { recursive: true });
fs.writeFileSync(path.join("_eval/runs", `${variant}.json`), JSON.stringify(out, null, 1));
ms.sort((a, b) => a - b);
console.log(`\n${variant}: ${Object.keys(out).length} queries, p50 ${ms[ms.length >> 1]} ms, p95 ${ms[Math.floor(ms.length * 0.95)]} ms`);
