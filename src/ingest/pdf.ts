/* PDF text extraction. The pinned pdfjs main/worker modules are bundled so the plugin never
 * executes downloaded JavaScript. The loader remains injectable for tests. */
/*! pdfjs-dist 4.6.82, Copyright 2024 Mozilla Foundation, Apache-2.0
 * https://www.apache.org/licenses/LICENSE-2.0 */

// @ts-expect-error pdfjs-dist does not expose declarations for its browser bundle subpaths.
import * as bundledPdfjs from "pdfjs-dist/build/pdf.mjs";
import "pdfjs-dist/build/pdf.worker.mjs";

import { cleanDoi } from "./metadata";
import { STASH_MAX_CHARS } from "./pdfStash";
import { num, rec, str, isNumberArray } from "../util/json";

/** The pdfjs types below describe only the fields this file actually reads off the library's
 *  (untyped) return values — not the full pdfjs API. */
interface PdfTextContent {
  items: unknown[];
}

interface PdfAnnotation {
  subtype?: unknown;
  quadPoints?: unknown;
  rect?: unknown;
  contentsObj?: unknown;
  contents?: unknown;
}

interface PdfPage {
  getTextContent(): Promise<PdfTextContent>;
  getAnnotations(): Promise<unknown[]>;
}

interface PdfDocument {
  numPages: unknown;
  getPage(n: number): Promise<PdfPage>;
}

export type PdfjsLike = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (opts: { data: Uint8Array; isEvalSupported: boolean }) => { promise: Promise<PdfDocument> };
};

let _pdfjs: PdfjsLike | null = null;
let _loader: () => Promise<PdfjsLike> = async () => bundledPdfjs as PdfjsLike;

/** Override the pdfjs loader (used by tests to inject the local Node build). */
export function setPdfjsLoader(fn: () => Promise<PdfjsLike>): void {
  _loader = fn;
  _pdfjs = null;
}

async function getPdfjs(): Promise<PdfjsLike> {
  if (!_pdfjs) _pdfjs = await _loader();
  return _pdfjs;
}

export async function extractPdfText(data: ArrayBuffer): Promise<{ text: string; pages: number }> {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  const pages = num(doc.numPages) ?? 0;
  let text = "";
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => str(rec(it).str)).join(" ") + "\n\n";
    if (text.length > STASH_MAX_CHARS) break; // safety cap for huge PDFs
  }
  const trimmed = text.trim();
  // One check for every caller: a scanned/image PDF yields nothing worth stashing.
  if (!trimmed) throw new Error("No extractable text (scanned/image PDF?)");
  return { text: trimmed, pages };
}

export interface PdfHighlight {
  page: number;
  type: "highlight" | "note";
  text: string; // highlighted text (for highlights) or the note body (for sticky notes)
}

function quadPoint(v: unknown): { x: number; y: number } {
  const p = rec(v);
  // NaN, not 0: a malformed point must match nothing rather than stretch the box to the origin.
  return { x: num(p.x) ?? NaN, y: num(p.y) ?? NaN };
}

function bbox(xs: number[], ys: number[]): number[] {
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Push `box` only if every coordinate is finite — a malformed quad point (NaN) must not yield
 *  a NaN rectangle that silently blocks the `ann.rect` fallback below (rects.length > 0 would
 *  skip it even though every rect in it is garbage). */
function pushFiniteBox(rects: number[][], box: number[]): void {
  if (box.every(Number.isFinite)) rects.push(box);
}

function quadRects(ann: PdfAnnotation): number[][] {
  // pdfjs ≥ 4 hands quadPoints over as a Float32Array (flat x/y octets); older builds as an Array.
  const raw = ann.quadPoints;
  const q: unknown = ArrayBuffer.isView(raw) ? Array.from(raw as unknown as ArrayLike<number>) : raw;
  const rects: number[][] = [];
  if (Array.isArray(q) && q.length) {
    if (typeof q[0] === "number") {
      const nums = q as number[];
      for (let i = 0; i + 8 <= nums.length; i += 8) {
        pushFiniteBox(rects, bbox([nums[i], nums[i + 2], nums[i + 4], nums[i + 6]], [nums[i + 1], nums[i + 3], nums[i + 5], nums[i + 7]]));
      }
    } else if (Array.isArray(q[0])) {
      for (const quad of q as unknown[][]) {
        const pts = quad.map(quadPoint);
        pushFiniteBox(rects, bbox(pts.map((p) => p.x), pts.map((p) => p.y)));
      }
    } else if (q[0] && typeof q[0] === "object") {
      const pts = (q as unknown[]).map(quadPoint);
      for (let i = 0; i + 4 <= pts.length; i += 4) {
        const slice = pts.slice(i, i + 4);
        pushFiniteBox(rects, bbox(slice.map((p) => p.x), slice.map((p) => p.y)));
      }
    }
  }
  if (!rects.length) {
    const rect = ann.rect;
    if (isNumberArray(rect)) rects.push(rect);
  }
  return rects;
}

/** Extract highlight/underline text and sticky-note contents from a PDF's annotations. */
export async function extractPdfHighlights(data: ArrayBuffer): Promise<PdfHighlight[]> {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  const out: PdfHighlight[] = [];
  const MARKUP = new Set(["Highlight", "Underline", "StrikeOut", "Squiggly"]);
  const numPages = num(doc.numPages) ?? 0;
  for (let p = 1; p <= numPages; p++) {
    const page = await doc.getPage(p);
    const anns = (await page.getAnnotations()).map(rec) as PdfAnnotation[];
    const markupOrNote = (a: PdfAnnotation) => {
      const s = str(a.subtype);
      return MARKUP.has(s) || s === "Text" || s === "FreeText";
    };
    if (!anns.some(markupOrNote)) continue;
    const content = await page.getTextContent();
    const items = content.items
      .map(rec)
      .filter((it) => str(it.str).trim())
      .map((it) => {
        const transform = Array.isArray(it.transform) ? (it.transform as unknown[]) : [];
        const x = num(transform[4]) ?? 0;
        const y = num(transform[5]) ?? 0;
        return { str: str(it.str), cx: x + (num(it.width) ?? 0) / 2, cy: y + (num(it.height) ?? 0) / 2 };
      });
    for (const a of anns) {
      const contentsObj = rec(a.contentsObj);
      const note = str(contentsObj.str ?? a.contents).trim();
      const subtype = str(a.subtype);
      if (MARKUP.has(subtype)) {
        const rects = quadRects(a);
        const picked = items
          .filter((t) => rects.some((r) => t.cx >= r[0] - 1 && t.cx <= r[2] + 1 && t.cy >= r[1] - 1 && t.cy <= r[3] + 1))
          .map((t) => t.str);
        const text = picked.join(" ").replace(/\s+/g, " ").trim();
        if (text) out.push({ page: p, type: "highlight", text: note ? `${text} — ${note}` : text });
        else if (note) out.push({ page: p, type: "note", text: note });
      } else if ((subtype === "Text" || subtype === "FreeText") && note) {
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
  if (doi) return { kind: "doi", value: cleanDoi(doi[0]) };
  const arx = head.match(/arXiv:\s*(\d{4}\.\d{4,5})/i);
  if (arx) return { kind: "arxiv", value: arx[1] };
  return null;
}

/** True when `data` starts with the PDF magic number. A repository can 200 with an HTML landing
 *  page instead of the file it links to — this is the guard against saving that as a `.pdf`. */
export function isPdfMagic(data: ArrayBuffer): boolean {
  return String.fromCharCode(...new Uint8Array(data.slice(0, 5))) === "%PDF-";
}
