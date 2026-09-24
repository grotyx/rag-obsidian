// Narrate every main slide with an OpenRouter speech model through the running Obsidian, then have
// an audio model judge each clip against the script (nothing missing, added, cut off, or turned into
// a different word). A clip that fails, or is far shorter than the script, is regenerated (up to 3
// tries) and reported if it still fails. The transcript similarity is recorded for reference only.
//   MODEL=minimax/speech-2.8-hd VOICE=Korean_CalmGentleman node narrate.mjs [--force]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const MODEL = process.env.MODEL || "minimax/speech-2.8-hd";
const VOICE = process.env.VOICE || "Korean_CalmGentleman";
const FORCE = process.argv.includes("--force");
const SLIDES = JSON.parse(fs.readFileSync(path.join(HERE, "..", "slides.json"), "utf8")).filter((s) => s.section !== "부록");
fs.mkdirSync(path.join(HERE, "audio"), { recursive: true });

const list = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = list.find((p) => p.type === "page" && !/설정|Settings/.test(p.title));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0; const pending = new Map();
ws.addEventListener("message", (m) => { const j = JSON.parse(m.data); if (pending.has(j.id)) { pending.get(j.id)(j.result?.result?.value); pending.delete(j.id); } });
const js = (expression) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true, timeout: 300000 } })); });
await js(fs.readFileSync(path.join(HERE, "speech-page.js"), "utf8"));

// What the TTS reads: numbers spelled out in Korean (a digit string like 1,139 was read as "139").
// The script, the captions and the slides keep the digits.
const SPOKEN = [["1,605편", "천육백오 편"], ["1,139편", "천백삼십구 편"], ["830편", "팔백삼십 편"], ["609편", "육백구 편"],
  ["1,366줄", "천삼백육십육 줄"], ["33개", "서른세 개"],
  // MiniMax sometimes spells "PubMed" out ("팝 엠이디"); with a space it reads it as two words.
  ["PubMed", "Pub Med"], ["OpenRouter", "Open Router"], ["Community plugins", "커뮤니티 플러그인"], ["MeSH", "메쉬"], ["Biportal", "바이포탈"], ["endoscopy", "엔도스코피"]];
const spoken = (say) => SPOKEN.reduce((t, [a, b]) => t.split(a).join(b), say);
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean).map(Number);

const norm = (s) => s.toLowerCase().replace(/[\s.,·!?—()"'~:;-]/g, "");
function similarity(a, b) {
  a = norm(a); b = norm(b);
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length, 1);
}

const report = [];
async function narrate(s) {
  const nn = String(s.id).padStart(2, "0");
  const wav = path.join(HERE, "audio", `${nn}.wav`);
  if (ONLY.length && !ONLY.includes(s.id)) return;
  if (!FORCE && !ONLY.length && fs.existsSync(wav) && fs.existsSync(wav + ".ok")) return;
  const text = spoken(s.say);
  const expectSec = text.replace(/\s/g, "").length / 7; // generous: a clip far shorter than this was cut off
  let best = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await js(`window.__speech(${JSON.stringify({ model: MODEL, voice: VOICE, input: text, response_format: "mp3" })})`);
    if (!r || r.error) { console.log(nn, "speech error", r && r.error); continue; }
    const tmp = path.join(HERE, "audio", `${nn}.try.mp3`);
    fs.writeFileSync(tmp, Buffer.from(r.audio, "base64"));
    const sec = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", tmp]).toString());
    const j = await js(`window.__judge(${JSON.stringify(r.audio)}, "mp3", ${JSON.stringify(s.say)})`);
    const ok = j && !j.error && j.match === true && sec >= expectSec * 0.6;
    const sim = j && j.heard ? similarity(text, j.heard) : 0; // against what the TTS was given
    const score = (ok ? 1 : 0) + sim; // prefer a judged match, then the closest transcript
    if (!best || score > best.score) best = { score, ok, sim, sec, audio: r.audio, text: j?.heard ?? j?.error, issues: j?.issues ?? [] };
    fs.rmSync(tmp, { force: true });
    if (ok) break;
    console.log(nn, `try ${attempt} ${sec.toFixed(1)}s/${expectSec.toFixed(1)}s judge=${j?.match} ${JSON.stringify(j?.issues ?? j?.error).slice(0, 140)}`);
  }
  if (!best) { report.push({ id: s.id, sim: 0, text: "no audio" }); return; }
  const mp3 = path.join(HERE, "audio", `${nn}.mp3`);
  fs.writeFileSync(mp3, Buffer.from(best.audio, "base64"));
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", mp3, "-ar", "48000", "-ac", "1", wav]);
  if (best.ok) fs.writeFileSync(wav + ".ok", `${best.sim.toFixed(3)}\n${best.text}\n`); else fs.rmSync(wav + ".ok", { force: true });
  report.push({ id: s.id, ok: best.ok, sim: +best.sim.toFixed(3), sec: +best.sec.toFixed(2), heard: best.text, issues: best.issues });
}

const queue = [...SLIDES];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await narrate(queue.shift()); }));
ws.close();
report.sort((a, b) => a.id - b.id);
const checkFile = path.join(HERE, "narration-check.json");
const prev = fs.existsSync(checkFile) ? JSON.parse(fs.readFileSync(checkFile, "utf8")).clips ?? [] : [];
const merged = [...prev.filter((p) => !report.some((r) => r.id === p.id)), ...report].sort((a, b) => a.id - b.id);
fs.writeFileSync(checkFile, JSON.stringify({ model: MODEL, voice: VOICE, judge: "google/gemini-3.8-flash", clips: merged }, null, 1));
const bad = report.filter((r) => !r.ok);
console.log(`${report.length} clips checked · voice ${VOICE} · not accepted: ${bad.map((r) => `${r.id} ${JSON.stringify(r.issues)}`).join(" | ") || "none"}`);
