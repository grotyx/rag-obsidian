/** Where Pandoc's own installer tends to put it. Obsidian launched from the Dock does not
 *  inherit the shell PATH, so a bare "pandoc" command name would fail — probe absolute paths
 *  instead, the same approach `llm/cli.ts`'s `cliCandidates` uses for codex/opencode.
 *  `localAppData` is `process.env.LOCALAPPDATA` on Windows ("" elsewhere / unset). */
export function pandocCandidates(home: string, platform: string, localAppData = ""): string[] {
  if (platform === "win32") {
    const candidates = ["C:\\Program Files\\Pandoc\\pandoc.exe"];
    if (localAppData) candidates.push(`${localAppData}\\Pandoc\\pandoc.exe`);
    return candidates;
  }
  return ["/opt/homebrew/bin/pandoc", "/usr/local/bin/pandoc", `${home}/.local/bin/pandoc`];
}

/** Pandoc's Markdown reader keeps inline `<sup>` as raw HTML, which the docx writer drops —
 *  rewrite compiled superscript citations as Pandoc `^…^` (spaces escaped, as it requires). */
export function pandocSuperscripts(markdown: string): string {
  return markdown.replace(/<sup>([^<^]*)<\/sup>/gi, (_m: string, s: string) => `^${s.replace(/ /g, "\\ ")}^`);
}
