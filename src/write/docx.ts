/* global process -- desktop-only, runs in Electron's Node.js context */
import { Platform } from "obsidian";
import template from "../../styles/manuscript-reference.docx";
import { pandocCandidates } from "./pandoc";
import {
  nodeRequire,
  type ChildProcessModuleLike,
  type FsPromisesLike,
  type FsSyncLike,
  type OsModuleLike,
  type PathModuleLike,
} from "../util/nodeTypes";

// child_process is required directly (not through nodeRequire) so static scanners, including the
// Community directory review, can see that this file runs external programs — it is disclosed.
declare const require: (id: string) => unknown;

/** Load Node built-ins only after the desktop guard, like `mcp/http.ts`'s `loadDesktopNode`. */
function loadDesktopNode(): {
  cp: ChildProcessModuleLike;
  fs: FsPromisesLike;
  fsSync: FsSyncLike;
  os: OsModuleLike;
  pathApi: PathModuleLike;
} {
  return {
      cp: require("node:child_process") as ChildProcessModuleLike,
    fs: nodeRequire<FsPromisesLike>("node:fs/promises"),
    fsSync: nodeRequire<FsSyncLike>("node:fs"),
    os: nodeRequire<OsModuleLike>("node:os"),
    pathApi: nodeRequire<PathModuleLike>("node:path"),
  };
}

/** The Pandoc executable to run: the user's explicit setting, else the first of the usual
 *  install locations that exists. Desktop only; returns undefined off-desktop or if none found. */
export function findPandoc(cliPathSetting?: string): string | undefined {
  if (!Platform.isDesktopApp) return undefined;
  if (cliPathSetting) return cliPathSetting;
  const { fsSync, os } = loadDesktopNode();
  for (const c of pandocCandidates(os.homedir(), process.platform, process.env.LOCALAPPDATA)) {
    if (fsSync.existsSync(c)) return c;
  }
  return undefined;
}

/** Convert already-compiled manuscript markdown to a styled .docx via Pandoc, using the bundled
 *  academic reference template (Times New Roman 12pt, double-spaced — styles/manuscript-reference.docx).
 *  Same flags as the old scripts/to-docx.cjs. Writes the markdown + template to a throwaway temp
 *  dir (stdin isn't needed) and always cleans it up. */
/** `resourceDir` is the manuscript's own folder, so relative image paths resolve there. */
export async function exportDocx(
  markdown: string,
  outAbsPath: string,
  pandocPath: string,
  resourceDir?: string
): Promise<void> {
  if (!Platform.isDesktopApp) throw new Error("Export to Word needs Obsidian desktop");
  const { cp, fs, os, pathApi } = loadDesktopNode();
  const tmp = await fs.mkdtemp(pathApi.join(os.tmpdir(), "rag-obsidian-docx-"));
  try {
    const inPath = pathApi.join(tmp, "in.md");
    const templatePath = pathApi.join(tmp, "reference.docx");
    await fs.writeFile(inPath, markdown, "utf8");
    await fs.writeFile(templatePath, template);
    await new Promise<void>((resolve, reject) => {
      cp.execFile(
        pandocPath,
        [
          inPath, "-f", "markdown", "-t", "docx", "--reference-doc", templatePath, "-o", outAbsPath,
          ...(resourceDir ? ["--resource-path", resourceDir] : []),
        ],
        { timeout: 2 * 60 * 1000, ...(resourceDir ? { cwd: resourceDir } : {}) },
        (error, _stdout, stderr) => {
          if (error) reject(new Error(stderr.toString().trim().slice(-500) || error.message));
          else resolve();
        }
      );
    });
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
