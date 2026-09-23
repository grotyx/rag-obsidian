/* eslint-disable @typescript-eslint/no-require-imports -- Obsidian on Windows cannot dynamically import node: built-ins */
/* global process -- desktop CLI calls run in Electron's Node.js context */
import { Platform } from "obsidian";
import { ScholarRagSettings } from "../types";
import type { ChatMessage, ChatOpts } from "./client";

const TIMEOUT_MS = 10 * 60 * 1000;

/** Build the argv for one CLI round-trip. `lastMsgPath` (codex) is where the answer is written;
 *  opencode answers on stdout instead and ignores it. `noReasoning` only affects codex — opencode
 *  has no equivalent flag. */
export function buildCliArgs(
  provider: "codex" | "opencode",
  model: string,
  lastMsgPath: string,
  noReasoning: boolean
): string[] {
  if (provider === "opencode") {
    return ["run", "--pure", "--format", "json", ...(model ? ["--model", model] : [])];
  }
  return [
    "exec",
    "--ignore-user-config",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "-o",
    lastMsgPath,
    ...(model ? ["-m", model] : []),
    ...(noReasoning ? ["-c", 'model_reasoning_effort="low"'] : []),
    "-",
  ];
}

/** opencode's `--format json` output: one JSON event per line. The answer is every `type:
 *  "text"` event's `part.text`, concatenated in order; an unparsable line is ignored (opencode
 *  emits blank lines between events), and a `type: "error"` event throws instead of silently
 *  returning a partial answer. */
export function parseOpencodeOutput(stdout: string): string {
  let text = "";
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: { type?: string; error?: unknown; message?: unknown; part?: { text?: unknown } };
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (event?.type === "error") {
      const err = event.error as { message?: unknown } | string | undefined;
      const message =
        (typeof err === "object" && err && typeof err.message === "string" && err.message) ||
        (typeof err === "string" && err) ||
        (typeof event.message === "string" && event.message) ||
        "opencode returned an error";
      throw new Error(message);
    }
    if (event?.type === "text" && typeof event.part?.text === "string") text += event.part.text;
  }
  return text;
}

/** system first, then each turn labelled Role: content, ending with the last message
 *  (a chat turn's caller always ends on the user) — deliberately simple, no chat-template. */
export function promptFromMessages(messages: ChatMessage[], system: string): string {
  const parts = [system];
  for (const m of messages) parts.push(`${m.role === "user" ? "User" : "Assistant"}: ${m.content}`);
  return parts.join("\n\n");
}

/** Where each CLI's own installer / package manager tends to put it. Obsidian launched from the
 *  Dock does not inherit the shell PATH, so a bare command name would fail — probe absolute
 *  paths instead. `~/.opencode/bin/opencode` is checked first because the owner's npm-installed
 *  `~/.local/bin/opencode` wrapper is currently broken ("postinstall script was not run"). */
export function cliCandidates(provider: "codex" | "opencode", home: string, platform: string): string[] {
  const posix =
    provider === "opencode"
      ? [
          `${home}/.opencode/bin/opencode`,
          `${home}/.local/bin/opencode`,
          `/opt/homebrew/bin/opencode`,
          `/usr/local/bin/opencode`,
          `${home}/.npm-global/bin/opencode`,
        ]
      : [
          `${home}/.local/bin/codex`,
          `/opt/homebrew/bin/codex`,
          `/usr/local/bin/codex`,
          `${home}/.npm-global/bin/codex`,
        ];
  if (platform !== "win32") return posix;
  const npm = `${home}\\AppData\\Roaming\\npm`;
  return [...posix, `${npm}\\${provider}.cmd`, `${npm}\\${provider}.exe`];
}

function firstExisting(paths: string[], fs: typeof import("node:fs")): string | undefined {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      // unreadable parent dir etc — keep probing
    }
  }
  return undefined;
}

/** Run one prompt through the user's locally installed, logged-in Codex or OpenCode CLI. Desktop
 *  only: both CLIs are native processes reached through node:child_process. The prompt goes over
 *  stdin (a Windows command line caps out around 32k chars; prompts here carry ~90k chars of
 *  paper text), and the call runs from a throwaway temp dir that is always cleaned up. */
export async function runCli(
  settings: ScholarRagSettings,
  messages: ChatMessage[],
  system: string,
  opts: ChatOpts = {}
): Promise<string> {
  if (!Platform.isDesktopApp) throw new Error("The codex/opencode provider needs Obsidian Desktop");
  const provider = settings.llmProvider as "codex" | "opencode";
  const cp = require("node:child_process") as typeof import("node:child_process");
  const fs = require("node:fs") as typeof import("node:fs");
  const fsp = require("node:fs/promises") as typeof import("node:fs/promises");
  const os = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");

  const bin = settings.cliPath || firstExisting(cliCandidates(provider, os.homedir(), process.platform), fs);
  if (!bin) {
    throw new Error(
      `No ${provider} executable found — set "CLI executable" under Settings → Academic Paper Citation Manager.`
    );
  }

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "rag-obsidian-cli-"));
  try {
    const lastMsgPath = path.join(tmp, "last.txt");
    const args = buildCliArgs(provider, settings.llmModel, lastMsgPath, !!opts.noReasoning);
    const prompt = promptFromMessages(messages, system);

    const commonBinDirs = [
      path.dirname(bin),
      `${os.homedir()}/.local/bin`,
      `${os.homedir()}/.opencode/bin`,
      `${os.homedir()}/.npm-global/bin`,
      "/opt/homebrew/bin",
      "/usr/local/bin",
    ];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${process.env.PATH ?? ""}${path.delimiter}${commonBinDirs.join(path.delimiter)}`,
    };
    if (provider === "opencode") {
      const cfg = path.join(tmp, "cfg");
      await fsp.mkdir(cfg, { recursive: true });
      env.XDG_CONFIG_HOME = cfg;
    }

    const stdout = await new Promise<string>((resolve, reject) => {
      let child: import("node:child_process").ChildProcess;
      try {
        child = cp.spawn(bin, args, { cwd: tmp, env, stdio: ["pipe", "pipe", "pipe"] });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      let out = "";
      let err = "";
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        child.kill();
        reject(new Error(`${provider} timed out`));
      }, TIMEOUT_MS);
      child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (err += d.toString()));
      child.on("error", (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`${provider} exited ${code}: ${err.slice(-300)}`));
          return;
        }
        resolve(out);
      });
      child.stdin?.write(prompt);
      child.stdin?.end();
    });

    const answer = provider === "opencode" ? parseOpencodeOutput(stdout) : await fsp.readFile(lastMsgPath, "utf8");
    const trimmed = answer.trim();
    if (!trimmed) throw new Error(`${provider} returned no text`);
    return trimmed;
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}
/* eslint-enable @typescript-eslint/no-require-imports -- end desktop-only Node loader */
