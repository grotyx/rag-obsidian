// Render the talk video: deck.html frames (headless Chrome, deterministic animation time) +
// per-slide narration (audio/NN.wav) → talk.mp4, captions.srt, chapters.txt, thumbnail.png.
//
//   node render.mjs            (THEME=dark for the dark palette)
//
// Each slide: LEAD s of silence, the narration, TAIL s of silence. The entrance animations are
// captured frame by frame for ANIM_MS by pausing every CSS transition and seeking it; after that
// the slide is still, so its last frame is held for the rest of the slide.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DECK = path.join(HERE, "..", "deck.html");
const SLIDES = JSON.parse(fs.readFileSync(path.join(HERE, "..", "slides.json"), "utf8")).filter((s) => s.section !== "부록").slice(0, Number(process.env.LIMIT || 1e9));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const W = 1920, H = 1080, FPS = 30, ANIM_MS = 1800, LEAD = 0.35, TAIL = 0.65;
const THEME = process.env.THEME === "dark" ? "dark" : "light";
const OUT = path.join(HERE, THEME === "dark" ? "talk-dark.mp4" : "talk.mp4");

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "ignore", "inherit"] });
const probe = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());

// ── Chrome over CDP ──────────────────────────────────────────────────────────
// A fresh port each run: a Chrome left over from a crashed run would otherwise answer on a fixed
// port, and the frames would come from its stale tab.
const port = 9400 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync("/tmp/deck-chrome-");
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--hide-scrollbars",
  "--disable-gpu", "--force-device-scale-factor=1", `--window-size=${W},${H}`, `file://${DECK}#s1`,
], { stdio: "ignore" });
const killChrome = () => { try { chrome.kill(); } catch {} };
process.on("exit", killChrome);
process.on("uncaughtException", (e) => { console.error(e); killChrome(); process.exit(1); });
let page;
for (let i = 0; i < 50 && !page; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((p) => p.type === "page"); } catch {}
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (m) => { const j = JSON.parse(m.data); if (pending.has(j.id)) { pending.get(j.id)(j); pending.delete(j.id); } });
const cdp = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expression) => {
  const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};

await cdp("Page.navigate", { url: `file://${DECK}#s1` });
let ready = false;
for (let i = 0; i < 100 && !ready; i++) {
  ready = await js(`document.readyState === "complete" && !!document.getElementById("app") && typeof go === "function"`);
  if (!ready) await new Promise((r) => setTimeout(r, 100));
}
if (!ready) throw new Error("deck did not load");
await cdp("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: THEME }] });
await js(`document.fonts.ready.then(() => true)`);
// Audience view, stage filling the frame, no controls.
await js(`(() => {
  const app = document.getElementById("app");
  app.dataset.view = "audience";
  document.getElementById("script").hidden = true;
  document.querySelector(".toolbar").hidden = true;
  app.style.padding = "0"; app.style.gap = "0";
  // The video has no appendix: count and tick only the main slides.
  SLIDES.splice(${SLIDES.length});
  [...document.querySelectorAll("#ruler .tick")].slice(${SLIDES.length}).forEach((t) => t.remove());
  const st = document.getElementById("stage");
  st.style.width = "${W}px"; st.style.cursor = "none";
  return true;
})()`);

// ── Frames ───────────────────────────────────────────────────────────────────
const framesDir = path.join(HERE, "frames", THEME);
const clipsDir = path.join(HERE, "clips", THEME);
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(clipsDir, { recursive: true });
const frameCount = Math.round((ANIM_MS / 1000) * FPS);
const timeline = [];
let t = 0;

for (const [i, s] of SLIDES.entries()) {
  const nn = String(s.id).padStart(2, "0");
  const wav = path.join(HERE, "audio", `${nn}.wav`);
  if (!fs.existsSync(wav)) throw new Error(`missing narration ${wav} — run narrate.sh`);
  const speech = probe(wav);
  // Whole frames, so the video clips and the audio segments add up to the same length (no drift).
  const dur = Math.round((LEAD + speech + TAIL) * FPS) / FPS;
  timeline.push({ s, start: t, lead: LEAD, speech, dur });
  t += dur;

  const dir = path.join(framesDir, nn);
  fs.mkdirSync(dir, { recursive: true });
  // Show the slide, let its transitions start, then freeze them and seek frame by frame.
  // The cover is already up: hide every slide and re-enter it so its entrance animation plays.
  if (i === 0) await js(`els.forEach((e) => { e.hidden = true; e.classList.remove("on", "enter"); }); cur = -1; true`);
  await js(`go(${i}); new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))))`);
  // Exactly one slide may be on screen — fail loudly instead of rendering overlapping frames.
  const shown = await js(`JSON.stringify([...document.querySelectorAll("#slides .slide")].map((e, k) => [k, getComputedStyle(e).display]).filter((x) => x[1] !== "none").map((x) => x[0]))`);
  if (shown !== `[${i}]`) throw new Error(`slide ${i}: visible slides ${shown}`);
  await js(`window.__anims = document.getAnimations(); window.__anims.forEach((a) => a.pause()); true`);
  for (let f = 0; f < frameCount; f++) {
    const ms = (f * 1000) / FPS;
    await js(`window.__anims.forEach((a) => { a.currentTime = ${ms}; }); true`);
    const shot = await cdp("Page.captureScreenshot", { format: "jpeg", quality: 92, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
    fs.writeFileSync(path.join(dir, `${String(f + 1).padStart(4, "0")}.jpg`), Buffer.from(shot.result.data, "base64"));
  }
  await js(`window.__anims.forEach((a) => a.finish()); true`);
  if (i === 0) {
    const shot = await cdp("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
    fs.writeFileSync(path.join(HERE, THEME === "dark" ? "thumbnail-dark.png" : "thumbnail.png"), Buffer.from(shot.result.data, "base64"));
  }

  // One video-only clip per slide: animated frames, then the last frame held. Audio is joined
  // separately as lossless WAV and encoded once — per-clip AAC made the joins overlap.
  const hold = Math.max(0, dur - ANIM_MS / 1000);
  run("ffmpeg", [
    "-loglevel", "error", "-y",
    "-framerate", String(FPS), "-i", path.join(dir, "%04d.jpg"),
    "-vf", `tpad=stop_mode=clone:stop_duration=${hold.toFixed(3)},format=yuv420p`,
    "-t", String(dur), "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", String(FPS),
    path.join(clipsDir, `${nn}.mp4`),
  ]);
  run("ffmpeg", [
    "-loglevel", "error", "-y", "-i", wav,
    "-af", `aresample=48000,adelay=${Math.round(LEAD * 1000)}:all=1,apad=whole_dur=${dur},atrim=0:${dur}`,
    "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", path.join(clipsDir, `${nn}.wav`),
  ]);
  process.stdout.write(`${nn} ${dur.toFixed(1)}s  `);
}
ws.close();
chrome.kill();
console.log();

// ── Join, then normalise loudness for YouTube (-14 LUFS) ─────────────────────
const list = (ext) => {
  const f = path.join(clipsDir, `list-${ext}.txt`);
  fs.writeFileSync(f, SLIDES.map((s) => `file '${String(s.id).padStart(2, "0")}.${ext}'`).join("\n") + "\n");
  return f;
};
const video = path.join(clipsDir, "video.mp4"), audio = path.join(clipsDir, "audio.wav");
run("ffmpeg", ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list("mp4"), "-c", "copy", video]);
run("ffmpeg", ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list("wav"), "-c", "copy", audio]);
run("ffmpeg", ["-loglevel", "error", "-y", "-i", video, "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
  "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", "-movflags", "+faststart", OUT]);

// ── Captions (one cue per sentence, timed by length within the narration) and chapters ──
const ts = (sec, sep = ",") => {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(ms % 1000).padStart(3, "0")}`;
};
const cues = [];
for (const seg of timeline) {
  const sentences = seg.s.say.split(/(?<=[.?!])\s+/).map((x) => x.trim()).filter(Boolean);
  const total = sentences.reduce((n, x) => n + x.length, 0);
  let at = seg.start + seg.lead;
  for (const sentence of sentences) {
    const len = (seg.speech * sentence.length) / total;
    cues.push({ from: at, to: at + len, text: sentence });
    at += len;
  }
}
fs.writeFileSync(path.join(HERE, "captions.srt"), cues.map((c, i) => `${i + 1}\n${ts(c.from)} --> ${ts(c.to)}\n${c.text}\n`).join("\n"));

const chapters = [];
for (const seg of timeline) {
  const name = seg.s.kind === "section" ? seg.s.title : seg.s.section === "표지" ? "들어가며" : null;
  const label = name ?? (seg.s.section === "마무리" && !chapters.some((c) => c.label === "마무리") ? "마무리" : null);
  if (label) chapters.push({ at: seg.start, label });
}
const yt = (sec) => { const s = Math.floor(sec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
fs.writeFileSync(path.join(HERE, "chapters.txt"), chapters.map((c) => `${yt(c.at)} ${c.label}`).join("\n") + "\n");

console.log(`${OUT}  ${(t / 60).toFixed(1)} min · ${SLIDES.length} slides · captions.srt · chapters.txt`);
