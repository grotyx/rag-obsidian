import { replaceOutsideCode } from "../cite/bibliography";

/** Where Pandoc's own installer tends to put it. Obsidian launched from the Dock does not
 *  inherit the shell PATH, so a bare "pandoc" command name would fail — probe absolute paths
 *  instead, the same approach `llm/cli.ts`'s `cliCandidates` uses for codex/opencode.
 *  `localAppData` is `process.env.LOCALAPPDATA` on Windows ("" elsewhere / unset). */
export function pandocCandidates(home: string, platform: string, localAppData = ""): string[] {
  if (platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Pandoc\\pandoc.exe",
      "C:\\Program Files (x86)\\Pandoc\\pandoc.exe",
      "C:\\ProgramData\\chocolatey\\bin\\pandoc.exe",
      `${home}\\scoop\\shims\\pandoc.exe`,
    ];
    if (localAppData) {
      candidates.push(`${localAppData}\\Pandoc\\pandoc.exe`, `${localAppData}\\Microsoft\\WinGet\\Links\\pandoc.exe`);
    }
    return candidates;
  }
  return ["/opt/homebrew/bin/pandoc", "/usr/local/bin/pandoc", `${home}/.local/bin/pandoc`];
}

const IMAGE_EXT = /\.(?:png|jpe?g|gif|svg|webp|bmp|tiff?)$/i;

/** Compiled manuscript markdown → what Pandoc should read (never inside code):
 *  - `<sup>…</sup>`: Pandoc's Markdown reader keeps it as raw HTML, which the docx writer drops, so
 *    it becomes Pandoc `^…^` (spaces escaped, as it requires);
 *  - `![[fig.png|300]]` → `![](fig.png)` (image embeds only; a note embed stays as written);
 *  - `[[Note|label]]` → label, `[[Note#Heading]]` → Note. */
export function pandocPrepare(markdown: string): string {
  const re = /<sup>([^<^]*)<\/sup>|!\[\[([^\]|\n]+?)(?:\|[^\]\n]*)?\]\]|\[\[([^\]|\n]+?)(?:\|([^\]\n]*))?\]\]/gi;
  return replaceOutsideCode(markdown, re, (m) => {
    if (m[1] !== undefined) return `^${m[1].replace(/ /g, "\\ ")}^`;
    if (m[2] !== undefined) {
      const file = m[2].trim();
      return IMAGE_EXT.test(file) ? `![](${file.replace(/ /g, "%20")})` : null;
    }
    const target = m[3].trim();
    return m[4]?.trim() || target.split(/[#^]/)[0].trim() || target;
  });
}
