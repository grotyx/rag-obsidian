/**
 * Real-process check for `src/llm/cli.ts`'s Windows `.cmd` shim path (`shouldUseShell` +
 * `spawnInvocation` + `winQuote`). `test/unit.ts` already covers the pure quoting logic on every
 * platform; this is the one assertion that needs a real `cmd.exe` to mean anything, so it only
 * runs when `process.platform === "win32"` — everywhere else it's a no-op that prints why.
 *
 * A fake `.cmd` shim forwards its raw argv/stdin to a companion Node script exactly the way a
 * real npm-generated shim forwards to the wrapped CLI (`"<node>" "%~dp0<script>" %*`), so this
 * exercises the actual cmd.exe command-line re-parsing that `shell: true` + `winQuote` produce —
 * not just the string transform in isolation.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { shouldUseShell, spawnInvocation } from "../src/llm/cli";

let passed = 0;
function check(cond: boolean, label: string): void {
  assert.ok(cond, label);
  passed++;
}

export async function windowsCliShimChecks(): Promise<void> {
  if (process.platform !== "win32") {
    console.log("windows: skipped (not Windows)");
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rag-obsidian-win-cli-"));
  try {
    const helperPath = path.join(tmp, "helper.js");
    const binPath = path.join(tmp, "fake-cli.cmd");
    // Mirrors a real npm shim: forwards argv and stdin to a Node script, whose JSON output side-
    // steps batch's own quoting rules for the *verification* step (we're testing whether the
    // arguments survive cmd.exe's re-parsing on the way in, not whether we can parse batch back
    // out). `process.execPath` avoids depending on "node" being on the shim's PATH.
    fs.writeFileSync(
      helperPath,
      "process.stdout.write('ARGS_JSON:' + JSON.stringify(process.argv.slice(2)) + '\\n');" +
        "let d = '';" +
        "process.stdin.setEncoding('utf8');" +
        "process.stdin.on('data', (c) => { d += c; });" +
        "process.stdin.on('end', () => { process.stdout.write('STDIN_JSON:' + JSON.stringify(d) + '\\n'); });"
    );
    fs.writeFileSync(binPath, `@echo off\r\n"${process.execPath}" "%~dp0helper.js" %*\r\n`);

    check(shouldUseShell("win32", binPath), "shouldUseShell: true for a real .cmd path");

    const testArgs = ["value with spaces", 'model_reasoning_effort="low"'];
    const shell = shouldUseShell(process.platform, binPath);
    const invocation = spawnInvocation(binPath, testArgs, shell);
    const prompt = "prompt text\nwith a newline";

    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        cwd: tmp,
        env: process.env,
        shell,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`fake-cli.cmd timed out; stderr so far: ${err}`));
      }, 15_000);
      child.stdout.on("data", (d) => (out += d.toString()));
      child.stderr.on("data", (d) => (err += d.toString()));
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error(`fake-cli.cmd exited ${code}: ${err}`));
        else resolve(out);
      });
      child.stdin.on("error", () => {});
      child.stdin.write(prompt);
      child.stdin.end();
    });

    const argsLine = stdout.split("\n").find((l) => l.startsWith("ARGS_JSON:"));
    const stdinLine = stdout.split("\n").find((l) => l.startsWith("STDIN_JSON:"));
    assert.ok(argsLine, `fake-cli.cmd produced no ARGS_JSON line; full stdout: ${stdout}`);
    assert.ok(stdinLine, `fake-cli.cmd produced no STDIN_JSON line; full stdout: ${stdout}`);
    const gotArgs = JSON.parse(argsLine!.slice("ARGS_JSON:".length)) as string[];
    const gotStdin = JSON.parse(stdinLine!.slice("STDIN_JSON:".length)) as string;

    check(
      JSON.stringify(gotArgs) === JSON.stringify(testArgs),
      `spawn through the .cmd shim: argv survives cmd.exe re-parsing intact (got ${JSON.stringify(gotArgs)}, want ${JSON.stringify(testArgs)})`
    );
    check(gotStdin === prompt, "spawn through the .cmd shim: stdin survives intact");

    console.log(`windows: all ${passed} assertions passed`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
