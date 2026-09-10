import esbuild from "esbuild";
import process from "process";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import builtins from "builtin-modules";

const prod = process.argv[2] === "production";
const require = createRequire(import.meta.url);
const pdfjsLicense = fs.readFileSync(
  path.join(path.dirname(require.resolve("pdfjs-dist/build/pdf.mjs")), "..", "LICENSE"),
  "utf8"
);
const pdfjsNotice = `/*!
PDF.js 4.6.82, Copyright 2024 Mozilla Foundation.
Modified for Academic Paper Citation Manager: dynamic-code feature tests and PostScript JIT
compilation are disabled during bundling. The interpreter fallback remains enabled.

${pdfjsLicense}
*/`;

const safePdfjs = {
  name: "safe-pdfjs",
  setup(build) {
    build.onLoad({ filter: /[/\\]pdfjs-dist[/\\]build[/\\]pdf(?:\.worker)?\.mjs$/ }, async ({ path }) => ({
      contents: (await fs.promises.readFile(path, "utf8"))
        .replaceAll('new Function("");', 'throw new Error("Dynamic code is disabled.");')
        .replace(
          'return new Function("src", "srcOffset", "dest", "destOffset", compiled);',
          'throw new Error("Dynamic code is disabled.");'
        ),
      loader: "js",
    }));
  },
};

const ctx = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
    ...builtins.map((name) => `node:${name}`),
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  banner: { js: pdfjsNotice },
  legalComments: "inline",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  plugins: [safePdfjs],
});

if (prod) {
  await ctx.rebuild();
  const bundle = await fs.promises.readFile("main.js", "utf8");
  if (
    /\b(?:new\s+Function|eval)\s*\(/.test(bundle) ||
    /https:\/\/(?:cdn\.jsdelivr\.net|esm\.sh)/.test(bundle) ||
    !bundle.includes("Apache License\n                           Version 2.0") ||
    !bundle.includes("Modified for Academic Paper Citation Manager")
  ) {
    throw new Error("Production bundle contains runtime code loading or evaluation");
  }
  process.exit(0);
} else {
  await ctx.watch();
  console.log("[esbuild] watching for changes…");
}
