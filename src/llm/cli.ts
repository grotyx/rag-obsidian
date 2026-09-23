/* global process -- desktop CLI calls run in Electron's Node.js context */
import { Platform } from "obsidian";
import { ScholarRagSettings } from "../types";
import type { ChatMessage, ChatOpts } from "./client";
import {
  nodeRequire,
  type ChildProcessLike,
  type ChildProcessModuleLike,
  type FsPromisesLike,
  type FsSyncLike,
  type OsModuleLike,
  type PathModuleLike,
  type ProcessEnv,
} from "../util/nodeTypes";

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
      event = JSON.parse(trimmed) as {
        type?: string;
        error?: unknown;
        message?: unknown;
        part?: { text?: unknown };
      };
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

/** Quote one argument for cmd.exe: wrap in double quotes, double any inside. */
export function winQuote(arg: string): string {
  return `"${arg.replace(/"/g, '""')}"`;
}

function firstExisting(paths: string[], fs: FsSyncLike): string | undefined {
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
  if (!Platform.isDesktopApp) throw new Error("The codex/opencode provider needs Obsidian desktop");
  const provider = settings.llmProvider as "codex" | "opencode";
  const cp = nodeRequire<ChildProcessModuleLike>("node:child_process");
  const fs = nodeRequire<FsSyncLike>("node:fs");
  const fsp = nodeRequire<FsPromisesLike>("node:fs/promises");
  const os = nodeRequire<OsModuleLike>("node:os");
  const path = nodeRequire<PathModuleLike>("node:path");

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
    const env: ProcessEnv = {
      ...process.env,
      PATH: `${process.env.PATH ?? ""}${path.delimiter}${commonBinDirs.join(path.delimiter)}`,
    };
    if (provider === "opencode") {
      const cfg = path.join(tmp, "cfg");
      await fsp.mkdir(cfg, { recursive: true });
      env.XDG_CONFIG_HOME = cfg;
    }

    const stdout = await new Promise<string>((resolve, reject) => {
      let child: ChildProcessLike;
      try {
        // Node refuses to spawn a .cmd/.bat without a shell (EINVAL since the CVE-2024-27980
        // fix), and npm installs these CLIs as .cmd shims on Windows. With a shell, cmd.exe
        // re-parses the line, so every argument is quoted. ponytail: untested on Windows.
        const shim = process.platform === "win32" && /\.(cmd|bat)$/i.test(bin);
        child = shim
          ? cp.spawn(`"${bin}"`, args.map(winQuote), { cwd: tmp, env, shell: true, stdio: ["pipe", "pipe", "pipe"] })
          : cp.spawn(bin, args, { cwd: tmp, env, stdio: ["pipe", "pipe", "pipe"] });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      let out = "";
      let err = "";
      let settled = false;
      const timer = window.setTimeout(() => {
        settled = true;
        child.kill();
        reject(new Error(`${provider} timed out`));
      }, TIMEOUT_MS);
      child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (err += d.toString()));
      child.on("error", (e) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`${provider} exited ${code}: ${err.slice(-300)}`));
          return;
        }
        resolve(out);
      });
      // A CLI that exits before reading its stdin (bad flag, missing login) raises EPIPE on the
      // stream; unhandled, that would crash the renderer instead of surfacing the exit code.
      child.stdin?.on("error", () => {});
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
