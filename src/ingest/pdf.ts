/* PDF text extraction. pdfjs is loaded from a CDN at runtime (kept out of the
 * bundle to avoid a ~1MB main.js). The loader is injectable for testing. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PdfjsLike = {
  GlobalWorkerOptions: { workerSrc: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getDocument: (opts: any) => { promise: Promise<any> };
};

const PDFJS_VERSION = "4.6.82";
let _pdfjs: PdfjsLike | null = null;
let _loader: () => Promise<PdfjsLike> = defaultLoader;

/** Override the pdfjs loader (used by tests to inject the local Node build). */
export function setPdfjsLoader(fn: () => Promise<PdfjsLike>): void {
  _loader = fn;
  _pdfjs = null;
}

async function defaultLoader(): Promise<PdfjsLike> {
  // Hidden from esbuild so it stays a runtime dynamic import (CDN, not bundled).
  const dynamicImport = new Function("u", "return import(u)") as (u: string) => Promise<PdfjsLike>;
  const mod = await dynamicImport(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`);
  mod.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;
  return mod;
}

async function getPdfjs(): Promise<PdfjsLike> {
  if (!_pdfjs) _pdfjs = await _loader();
  return _pdfjs;
}

export async function extractPdfText(data: ArrayBuffer): Promise<{ text: string; pages: number }> {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  const pages: number = doc.numPages;
  let text = "";
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    text += content.items.map((it: any) => ("str" in it ? it.str : "")).join(" ") + "\n\n";
    if (text.length > 200000) break; // safety cap for huge PDFs
  }
  return { text: text.trim(), pages };
}

export interface PdfHighlight {
  page: number;
  type: "highlight" | "note";
  text: string; // highlighted text (for highlights) or the note body (for sticky notes)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function quadRects(ann: any): number[][] {
  const q = ann.quadPoints;
  const rects: number[][] = [];
  if (Array.isArray(q) && q.length) {
    if (typeof q[0] === "number") {
      for (let i = 0; i + 8 <= q.length; i += 8) {
        const xs = [q[i], q[i + 2], q[i + 4], q[i + 6]];
        const ys = [q[i + 1], q[i + 3], q[i + 5], q[i + 7]];
        rects.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
      }
    } else if (Array.isArray(q[0])) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const quad of q as any[]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const xs = quad.map((p: any) => p.x);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ys = quad.map((p: any) => p.y);
        rects.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
      }
    } else if (q[0] && typeof q[0] === "object") {
      for (let i = 0; i + 4 <= q.length; i += 4) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pts = q.slice(i, i + 4) as any[];
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        rects.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
      }
    }
  }
  if (!rects.length && Array.isArray(ann.rect)) rects.push(ann.rect);
  return rects;
}

/** Extract highlight/underline text and sticky-note contents from a PDF's annotations. */
export async function extractPdfHighlights(data: ArrayBuffer): Promise<PdfHighlight[]> {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  const out: PdfHighlight[] = [];
  const MARKUP = new Set(["Highlight", "Underline", "StrikeOut", "Squiggly"]);
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anns: any[] = await page.getAnnotations();
    if (!anns.some((a) => MARKUP.has(a.subtype) || a.subtype === "Text" || a.subtype === "FreeText")) continue;
    const content = await page.getTextContent();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = (content.items as any[])
      .filter((it) => "str" in it && it.str.trim())
      .map((it) => {
        const x = it.transform[4];
        const y = it.transform[5];
        return { str: it.str as string, cx: x + (it.width || 0) / 2, cy: y + (it.height || 0) / 2 };
      });
    for (const a of anns) {
      const note = (a.contentsObj?.str ?? a.contents ?? "").trim();
      if (MARKUP.has(a.subtype)) {
        const rects = quadRects(a);
        const picked = items
          .filter((t) => rects.some((r) => t.cx >= r[0] - 1 && t.cx <= r[2] + 1 && t.cy >= r[1] - 1 && t.cy <= r[3] + 1))
          .map((t) => t.str);
        const text = picked.join(" ").replace(/\s+/g, " ").trim();
        if (text) out.push({ page: p, type: "highlight", text: note ? `${text} — ${note}` : text });
        else if (note) out.push({ page: p, type: "note", text: note });
      } else if ((a.subtype === "Text" || a.subtype === "FreeText") && note) {
        out.push({ page: p, type: "note", text: note });
      }
    }
  }
  return out;
}

/** Find a DOI or arXiv id in the opening pages — preferred over LLM extraction. */
export function findIdentifier(text: string): { kind: "doi" | "arxiv"; value: string } | null {
  const head = text.slice(0, 6000);
  const doi = head.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
  if (doi) return { kind: "doi", value: doi[0].replace(/[.,;]+$/, "") };
  const arx = head.match(/arXiv:\s*(\d{4}\.\d{4,5})/i);
  if (arx) return { kind: "arxiv", value: arx[1] };
  return null;
}
