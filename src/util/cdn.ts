/** Shared error message for a blocked/failed runtime CDN import (pdfjs, Transformers.js — both
 *  loaded via `new Function("u","return import(u)")` to stay out of the bundle). A mobile
 *  webview can block or not support this; wrap the raw module-loader error in a message that's
 *  clear once a UI layer shows it as a Notice, instead of forwarding "Failed to fetch …" verbatim. */
export function wrapCdnImportError(feature: string, e: unknown): Error {
  return new Error(
    `${feature} is unavailable: could not load it from the CDN (network blocked, or dynamic import unsupported here). ${
      e instanceof Error ? e.message : String(e)
    }`
  );
}
