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

/** One file-name component: characters Obsidian rejects (and `[]#^|` that would break links to
 *  the note) become `-`, so a `/` can never open a sub-folder. */
export function safeFileComponent(name: string): string {
  return name.replace(/[\\/:*?"<>|#^[\]]+/g, "-").replace(/^\.+/, "");
}

/** Replace characters Obsidian rejects in file names (and `[]#^|` that would break links to the
 *  note) in the basename of a vault path. Folders are left alone. */
export function safeFileName(rawPath: string): string {
  const slash = rawPath.lastIndexOf("/");
  const base = safeFileComponent(rawPath.slice(slash + 1));
  return rawPath.slice(0, slash + 1) + (base || "untitled.md");
}

/** `<folder>/<date> <question>.md` for "Save as note": the question is one file-name component,
 *  so "L4/5 stenosis?" stays in `folder` instead of becoming `folder/<date> L4/5 stenosis-.md`. */
export function chatNotePath(folder: string, date: string, question: string): string {
  const stem = question.replace(/\s+/g, " ").trim().slice(0, 40).trim() || "answer";
  return `${folder}/${safeFileComponent(`${date} ${stem}`)}.md`;
}
