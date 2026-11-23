// Pure helpers: no obsidian imports.

/** Neutralize embeds and raw HTML in model output before it is rendered or saved. Model output
 *  steered by an injected note must not load a resource or run markup, and attributes cannot be
 *  reliably regex-parsed, so every `<` that starts a tag, comment or processing instruction
 *  (`<` + letter, `/`, `!` or `?`) is escaped to `&lt;`; `![[x]]` → `[[x]]`, `![a](u)` → `[a](u)`.
 *  `a < b` and `x<y` are untouched. */
export function sanitizeModelMarkdown(text: string): string {
  let out = text.replace(/<(?=[A-Za-z/!?])/g, "&lt;");
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/!\[/g, "["); // `!![[x]]` would otherwise reassemble an embed
  }
  return out;
}

/** Replace characters Obsidian rejects in file names (and `[]#^|` that would break links to the
 *  note) in the basename of a vault path. Folders are left alone. */
export function safeFileName(rawPath: string): string {
  const slash = rawPath.lastIndexOf("/");
  const base = rawPath
    .slice(slash + 1)
    .replace(/[\\/:*?"<>|#^[\]]+/g, "-")
    .replace(/^\.+/, "");
  return rawPath.slice(0, slash + 1) + (base || "untitled.md");
}
