// Pure helpers: no obsidian imports.

/** Tags that load a resource or run code. Model output steered by an injected note must not carry them. */
const ACTIVE_TAGS =
  "img|iframe|video|audio|source|object|embed|svg|script|style|link|meta|base|form|picture|track";
const TAG_RE = new RegExp(`</?(?:${ACTIVE_TAGS})\\b[^>]*(?:>|$)`, "gi");
/** Any other tag carrying a `style` attribute (`background:url(...)` loads a remote resource too). */
const STYLED_RE = /<[a-z][\w:-]*\b[^<>]*\bstyle\s*=[^>]*>/gi;

/** Neutralize embeds and loading/active HTML in model output before it is rendered or saved
 *  (`![[x]]` → `[[x]]`, `![a](u)` → `[a](u)`, `<img …>` / `<iframe …>` etc. removed). */
export function sanitizeModelMarkdown(text: string): string {
  let out = text;
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/!\[/g, "[").replace(TAG_RE, "").replace(STYLED_RE, "");
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
