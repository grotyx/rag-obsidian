// Merge judgments into _eval/qrels.json and score every run: paper-level nDCG@10, R@10 (vs. all
// pooled papers graded ≥1), P@10 (grade 2), and judged coverage of each top-10.
//   node scripts/eval/score.mjs
import fs from "fs"; import path from "path";
const qrels = fs.existsSync("_eval/qrels.json") ? JSON.parse(fs.readFileSync("_eval/qrels.json", "utf8")) : {};
const dir = "_eval/judge/out";
if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const q = f.slice(0, -5); qrels[q] = { ...(qrels[q] || {}), ...JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) };
}
fs.writeFileSync("_eval/qrels.json", JSON.stringify(qrels));
const dcg = (gs) => gs.reduce((a, g, i) => a + (2 ** g - 1) / Math.log2(i + 2), 0);
const rows = [];
for (const f of fs.readdirSync("_eval/runs").sort()) {
  const run = JSON.parse(fs.readFileSync(path.join("_eval/runs", f), "utf8"));
  for (const lang of ["en", "ko", "all"]) {
    let n = 0, nd = 0, rec = 0, p = 0, cov = 0;
    for (const [key, list] of Object.entries(run)) {
      const [qid, l] = key.split("|"); if (lang !== "all" && l !== lang) continue;
      const qr = qrels[qid]; if (!qr) continue;
      const top = list.slice(0, 10); const gs = top.map((k) => qr[k] ?? 0);
      const ideal = Object.values(qr).sort((a, b) => b - a).slice(0, 10);
      const rel = Object.values(qr).filter((g) => g >= 1).length;
      nd += dcg(ideal) ? dcg(gs) / dcg(ideal) : 0;
      rec += rel ? gs.filter((g) => g >= 1).length / Math.min(rel, 10) : 0;
      p += gs.filter((g) => g === 2).length / 10;
      cov += top.filter((k) => qr[k] !== undefined).length / Math.max(top.length, 1);
      n++;
    }
    if (n) rows.push({ run: f.replace(/\.json$/, ""), lang, n, "nDCG@10": +(nd / n).toFixed(3), "R@10": +(rec / n).toFixed(3), "P@10(2)": +(p / n).toFixed(3), judged: +(cov / n).toFixed(2) });
  }
}
console.table(rows);
