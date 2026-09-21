/**
 * Minimal DOMParser polyfill, `text/xml` only, for testing `src/ingest/pubmedSearch.ts`'s
 * `DOMParser` usage under plain Node — Electron (where the plugin actually runs) has a real one
 * as a browser global; Node has none. Not a general XML library: supports exactly what that file
 * needs (`querySelectorAll` with a bare tag name or a `>`-separated child-combinator chain,
 * `getAttribute`, `textContent`) against NCBI's efetch XML, which is always well-formed with no
 * CDATA in the fields read here. Importing this module for its side effect (setting
 * `globalThis.DOMParser`) is what lets `fetchPubmedRecord`'s real XML-parsing logic — not just
 * its network call or its catch-all fallback — run under `npm test`.
 */

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  parent: XmlNode | null;
  text: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

function parseXml(xml: string): XmlNode {
  const root: XmlNode = { tag: "#root", attrs: {}, children: [], parent: null, text: "" };
  let current = root;
  // Tag/text tokens: opening (with optional self-close), closing, or a text run before the next `<`.
  const re = /<([a-zA-Z_][\w.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>|<\/([a-zA-Z_][\w.-]*)\s*>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const [, openTag, attrText, selfClose, closeTag, text] = m;
    if (openTag) {
      const attrs: Record<string, string> = {};
      const attrRe = /([\w:.-]+)="([^"]*)"/g;
      let am: RegExpExecArray | null;
      while ((am = attrRe.exec(attrText))) attrs[am[1]] = decodeEntities(am[2]);
      const node: XmlNode = { tag: openTag, attrs, children: [], parent: current, text: "" };
      current.children.push(node);
      if (!selfClose) current = node;
    } else if (closeTag) {
      if (current.parent) current = current.parent;
    } else if (text) {
      current.text += decodeEntities(text);
    }
  }
  return root;
}

/** Depth-first text of a node and all its descendants, matching DOM `.textContent`. */
function textContent(node: XmlNode): string {
  let out = node.text;
  for (const c of node.children) out += textContent(c);
  return out;
}

/** Every descendant (not the node itself), depth-first — matches `Element.querySelectorAll`'s
 *  document-order traversal, which is what let the original bug's unscoped `<ArticleId>` query
 *  return a nested reference's id before the fix scoped it. */
function descendants(node: XmlNode): XmlNode[] {
  const out: XmlNode[] = [];
  for (const c of node.children) {
    out.push(c);
    out.push(...descendants(c));
  }
  return out;
}

/** `A`, or `A > B`, or `A > B > C` — the only shapes `pubmedSearch.ts` uses. Each step matches
 *  against nodes already found: a bare tag name searches ALL descendants of the previous match
 *  (or the whole tree for the first step); a `>` step requires a direct child. */
function querySelectorAll(root: XmlNode, selector: string): XmlNode[] {
  const steps = selector.split(">").map((s) => s.trim());
  let candidates = [root];
  let first = true;
  for (const tag of steps) {
    const next: XmlNode[] = [];
    for (const c of candidates) {
      const pool = first ? descendants(c) : c.children;
      for (const n of pool) if (n.tag === tag) next.push(n);
    }
    candidates = next;
    first = false;
  }
  return candidates;
}

class FakeElement {
  constructor(private node: XmlNode) {}
  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.node.attrs, name) ? this.node.attrs[name] : null;
  }
  get textContent(): string {
    return textContent(this.node);
  }
}

class FakeDocument {
  constructor(private root: XmlNode) {}
  querySelectorAll(selector: string): FakeElement[] {
    return querySelectorAll(this.root, selector).map((n) => new FakeElement(n));
  }
}

class FakeDOMParser {
  parseFromString(text: string, _type: string): FakeDocument {
    return new FakeDocument(parseXml(text));
  }
}

(globalThis as unknown as { DOMParser: typeof FakeDOMParser }).DOMParser = FakeDOMParser;
