// Injected into the running Obsidian (the OpenRouter key never leaves it).
// __speech(body) → { type, audio(base64) } via /audio/speech; __stt(b64, format) → transcript via an audio-input model.
window.__orKey = () => app.plugins.plugins["academic-paper-citation-manager"].settings.openaiApiKey;
window.__speech = async (body) => {
  const r = await fetch("https://openrouter.ai/api/v1/audio/speech", { method: "POST", headers: { Authorization: "Bearer " + __orKey(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) return { error: "HTTP " + r.status + " " + (await r.text()).slice(0, 300) };
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { type: r.headers.get("content-type") || "", audio: btoa(bin) };
};
window.__stt = async (b64, format, model) => {
  const body = { model: model || "google/gemini-3.8-flash", temperature: 0, messages: [{ role: "user", content: [
    { type: "text", text: "Transcribe this Korean speech verbatim. Write English words in Latin letters and numbers as digits. Output only the transcript." },
    { type: "input_audio", input_audio: { data: b64, format } },
  ] }] };
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { Authorization: "Bearer " + __orKey(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) return { error: "HTTP " + r.status + " " + (await r.text()).slice(0, 300) };
  const j = await r.json();
  return { text: j.choices?.[0]?.message?.content ?? "" };
};
window.__judge = async (b64, format, script, model) => {
  const prompt = [
    "You are checking a text-to-speech recording against its script (Korean, with some English terms).",
    "Listen to the audio. Decide whether it speaks the whole script, in order, with nothing missing, added or cut off.",
    "Accept Korean-style pronunciation of English words (Word → 워드, full text → 풀 텍스트, PRISMA → 프리즈마, OpenRouter → 오픈라우터) and numbers read as Korean words.",
    "Reject a mispronunciation that turns a word into a different word, a wrong number, a missing or repeated phrase, or audio that stops early.",
    'Answer with JSON only: {"match": true|false, "heard": "<your transcript>", "issues": ["..."]}.',
    "Script:", script,
  ].join("\n");
  const body = { model: model || "google/gemini-3.8-flash", temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "user", content: [
    { type: "text", text: prompt }, { type: "input_audio", input_audio: { data: b64, format } } ] }] };
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { Authorization: "Bearer " + __orKey(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) return { error: "HTTP " + r.status + " " + (await r.text()).slice(0, 300) };
  const txt = (await r.json()).choices?.[0]?.message?.content ?? "";
  try { return JSON.parse(txt.replace(/^```(json)?|```$/g, "").trim()); } catch (e) { return { error: "unparsable: " + txt.slice(0, 200) }; }
};
"ok";
