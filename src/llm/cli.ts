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

// child_process is required directly (not through nodeRequire) so static scanners, including the
// Community directory review, can see that this file runs external programs — it is disclosed.
declare const require: (id: string) => unknown;

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

/** Node refuses to spawn a `.cmd`/`.bat` without a shell (EINVAL since the CVE-2024-27980 fix),
 *  and npm installs codex/opencode as `.cmd` shims on Windows — everywhere else `bin` is run
 *  directly, no shell involved. Pure so it's unit-testable on every platform. */
export function shouldUseShell(platform: string, bin: string): boolean {
  return platform === "win32" && /\.(cmd|bat)$/i.test(bin);
}

/** The `[command, args]` `cp.spawn` receives for one CLI invocation. With a shell, cmd.exe
 *  re-parses the line, so both the binary and every argument need cmd.exe-safe quoting
 *  (`winQuote`); without one, argv reaches the child process untouched. Pure so the quoting
 *  itself is unit-testable without spawning anything. */
export function spawnInvocation(bin: string, args: string[], shell: boolean): { command: string; args: string[] } {
  return shell ? { command: winQuote(bin), args: args.map(winQuote) } : { command: bin, args };
}

/** `settings.cliPath` syncs between devices inside `data.json`, so it must not be able to name
 *  an arbitrary program: the file name has to be the selected provider's CLI. */
export function cliBinaryAllowed(provider: "codex" | "opencode", bin: string): boolean {
  const name = (bin.split(/[\\/]/).pop() ?? "").toLowerCase().replace(/\.(exe|cmd)$/, "");
  return name === provider;
}

/** `cliPath` syncs through `data.json` and a vault can arrive from someone else, so a binary that
 *  lives inside the vault (even behind a symlink) must not be executed. Pure string check on
 *  already-resolved paths; `caseInsensitive` is for Windows. */
export function cliInsideVault(bin: string, vaultRoot: string, caseInsensitive = false): boolean {
  const norm = (p: string): string => {
    const q = p.replace(/\\/g, "/").replace(/\/+$/, "");
    return caseInsensitive ? q.toLowerCase() : q;
  };
  const r = norm(vaultRoot);
  const b = norm(bin);
  return r !== "" && (b === r || b.startsWith(r + "/"));
}

let vaultRoot = "";
/** main.ts hands over the vault's folder so `runCli` can refuse a CLI that lives inside it. */
export function setCliVaultRoot(root: string): void {
  vaultRoot = root;
}

const ENV_EXACT = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TEMP", "TMP", "LANG",
  // Windows: profile folders, the shell for `.cmd` shims, and the system root Node needs.
  "SYSTEMROOT", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "COMSPEC", "PATHEXT", "WINDIR", "HOMEDRIVE", "HOMEPATH",
  // Corporate networks: a CLI behind a proxy or custom CA cannot log in or answer without these.
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
]);

/** The environment a CLI child gets: the login lives in files under HOME, so nothing else from
 *  the host process (API keys, cloud credentials…) needs to reach it. Names are matched
 *  case-insensitively (Windows spells it `Path`, `SystemRoot`). `CODEX_*` / `OPENCODE_*` and
 *  `XDG_*` pass through; PATH is replaced by `pathValue`. */
export function buildCliEnv(parent: ProcessEnv, pathValue: string): ProcessEnv {
  const env: ProcessEnv = {};
  for (const [key, value] of Object.entries(parent)) {
    const k = key.toUpperCase();
    if (k === "PATH" || value === undefined) continue;
    if (ENV_EXACT.has(k) || /^(LC_|XDG_|CODEX_|OPENCODE_)/.test(k)) env[key] = value;
  }
  env.PATH = pathValue;
  return env;
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
  const cp = require("node:child_process") as ChildProcessModuleLike;
  const fs = nodeRequire<FsSyncLike>("node:fs");
  const fsp = nodeRequire<FsPromisesLike>("node:fs/promises");
  const os = nodeRequire<OsModuleLike>("node:os");
  const path = nodeRequire<PathModuleLike>("node:path");

  const bin = settings.cliPath || firstExisting(cliCandidates(provider, os.homedir(), process.platform), fs);
  if (!bin) {
    throw new Error(
      `No ${provider} executable found — set "CLI executable" under Settings → Refwright.`
    );
  }

  if (!cliBinaryAllowed(provider, bin)) {
    throw new Error(
      `Refusing to run "${bin}": the "CLI executable" setting (Settings → Refwright) must point to a file named ${provider}.`
    );
  }

  if (vaultRoot) {
    const resolve = async (p: string): Promise<string> => {
      try { return await fsp.realpath(p); } catch { return p; }
    };
    const insensitive = process.platform === "win32";
    const root = await resolve(vaultRoot);
    if (cliInsideVault(bin, root, insensitive) || cliInsideVault(await resolve(bin), root, insensitive)) {
      throw new Error(
        `Refusing to run "${bin}": it is inside this vault. Point "CLI executable" (Settings → Refwright) at a ${provider} installed outside the vault.`
      );
    }
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
    const hostPath = Object.entries(process.env).find(([k]) => k.toUpperCase() === "PATH")?.[1] ?? "";
    const env = buildCliEnv(process.env, `${hostPath}${path.delimiter}${commonBinDirs.join(path.delimiter)}`);
    if (provider === "opencode") {
      const cfg = path.join(tmp, "cfg");
      await fsp.mkdir(cfg, { recursive: true });
      env.XDG_CONFIG_HOME = cfg;
    }

    const stdout = await new Promise<string>((resolve, reject) => {
      let child: ChildProcessLike;
      try {
        const shell = shouldUseShell(process.platform, bin);
        const invocation = spawnInvocation(bin, args, shell);
        child = cp.spawn(invocation.command, invocation.args, {
          cwd: tmp,
          env,
          shell,
          stdio: ["pipe", "pipe", "pipe"],
        });
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
      // setEncoding keeps a multibyte character split across two reads intact (Buffer#toString
      // per chunk would turn each half into U+FFFD).
      child.stdout?.setEncoding("utf8");
      child.stderr?.setEncoding("utf8");
      child.stdout?.on("data", (d: string) => (out += d));
      child.stderr?.on("data", (d: string) => (err += d));
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
