import { editorInfoField, editorLivePreviewField } from "obsidian";
import { EditorState, Extension, Range, StateEffect } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType, hoverTooltip } from "@codemirror/view";
import type { Library } from "../data/library";
import { CSLItem } from "../types";
import { decodeEntities, inTextLabel } from "./bibliography";
import { citeClusters } from "./clusters";
import { citeTooltip } from "./format";

/** What the editor needs from the plugin (structural, so this file never imports main.ts). */
export interface CiteHost {
  settings: { renderCitations: boolean };
  library: Library;
  citeMapFor(sourcePath: string): Promise<Record<string, string>>;
  openCitekey(citekey: string): Promise<void>;
}

/** Render a citeproc in-text label (e.g. `<sup>1</sup>`, `[1]`, `(Park et al., 2022)`) into a span. */
export function setCiteLabel(span: HTMLElement, html: string): void {
  const sup = html.match(/^\s*<sup>([\s\S]*?)<\/sup>\s*$/i);
  if (sup) {
    const s = createEl("sup", { text: decodeEntities(sup[1].replace(/<[^>]+>/g, "")) });
    span.appendChild(s);
    return;
  }
  span.textContent = decodeEntities(html.replace(/<[^>]+>/g, ""));
}

interface Part {
  key: string;
  label: string; // citeproc HTML, or a plain fallback (no tags)
}

class CiteWidget extends WidgetType {
  constructor(readonly parts: Part[], readonly host: CiteHost) {
    super();
  }
  eq(o: CiteWidget): boolean {
    return JSON.stringify(o.parts) === JSON.stringify(this.parts);
  }
  toDOM(): HTMLElement {
    const wrap = createSpan();
    this.parts.forEach(({ key, label }, i) => {
      if (i) wrap.appendChild(document.createTextNode("; "));
      const span = createSpan({ cls: "srag-cite" });
      setCiteLabel(span, label);
      span.onclick = () => void this.host.openCitekey(key);
      wrap.appendChild(span);
    });
    return wrap;
  }
  ignoreEvent(): boolean {
    // Keep mouse events from the editor: otherwise mousedown moves the cursor onto the citation,
    // the widget is swapped for its source, and the click never reaches the span.
    return true;
  }
}

const refresh = StateEffect.define<null>();

/** Spaces/tabs directly before `at` (walked back, not a prefix slice: this runs per citation). */
function leadingBlanks(text: string, at: number): number {
  let i = at;
  while (i > 0 && (text[i - 1] === " " || text[i - 1] === "\t")) i--;
  return at - i;
}

function itemsByKey(host: CiteHost): Map<string, CSLItem> {
  return new Map(host.library.entries().map((e) => [e.citekey, e.item]));
}

function filePath(state: EditorState): string | undefined {
  return state.field(editorInfoField, false)?.file?.path;
}

/** Live Preview: show `[@key]` as its rendered label (same as reading view) unless the cursor is
 *  on it. Every mode: hover a citation for the full reference. */
export function citationEditorExtension(host: CiteHost): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      private map: Record<string, string> | null = null; // null until the note's labels resolved
      private items = new Map<string, CSLItem>();
      private promise: Promise<Record<string, string>> | null = null;
      private dead = false;

      constructor(private view: EditorView) {
        this.sync();
      }

      update(u: ViewUpdate): void {
        this.sync();
        const poked = u.transactions.some((t) => t.reconfigured || t.effects.some((e) => e.is(refresh)));
        if (u.docChanged || u.viewportChanged || u.selectionSet || poked) this.decorations = this.build();
      }

      destroy(): void {
        this.dead = true;
      }

      /** A different promise = the plugin dropped its cache (style, numbering or references changed):
       *  wait for it, then rebuild. Never dispatch from inside update(). */
      private sync(): void {
        const path = filePath(this.view.state);
        if (!path || !host.settings.renderCitations) return;
        const p = host.citeMapFor(path);
        if (p === this.promise) return;
        this.promise = p;
        void p.then((map) => {
          if (this.dead || p !== this.promise) return;
          this.map = map;
          this.items = itemsByKey(host);
          this.view.dispatch({ effects: refresh.of(null) });
        });
      }

      private build(): DecorationSet {
        const { state } = this.view;
        if (!this.map || !host.settings.renderCitations || !state.field(editorLivePreviewField, false)) return Decoration.none;
        const text = state.doc.toString();
        const sel = state.selection.ranges;
        const vis = this.view.visibleRanges;
        const decos: Range<Decoration>[] = [];
        for (const c of citeClusters(text)) {
          if (!vis.some((r) => c.from <= r.to && c.to >= r.from)) continue;
          if (text.slice(c.from, c.to).includes("\n")) continue; // plugins may not replace line breaks
          if (sel.some((r) => r.from <= c.to && r.to >= c.from)) continue; // editing it: show the source
          const parts = c.keys.map((k) => {
            const item = this.items.get(k) ?? null;
            const label = this.map?.[k] || (item ? inTextLabel(item) : null);
            return label ? { key: k, label } : null;
          });
          if (parts.some((p) => !p)) continue; // unknown key stays raw
          // A superscript citation sits on the word, so hide the space typed before it too.
          const sup = /^\s*<sup>/i.test(parts[0]?.label ?? "");
          const from = sup ? c.from - leadingBlanks(text, c.from) : c.from;
          decos.push(Decoration.replace({ widget: new CiteWidget(parts as Part[], host) }).range(from, c.to));
        }
        return Decoration.set(decos, true);
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );

  const hover = hoverTooltip((view, pos) => {
    if (!host.settings.renderCitations) return null;
    // Whole-note scan so fences and wrapped citations count; a superscript widget also covers the
    // spaces typed before the bracket, so those count as part of it.
    const text = view.state.doc.toString();
    const c = citeClusters(text).find((x) => pos >= x.from - leadingBlanks(text, x.from) && pos <= x.to);
    if (!c) return null;
    const items = itemsByKey(host);
    const tips = c.keys.map((k) => items.get(k)).filter((i): i is CSLItem => !!i).map(citeTooltip);
    if (!tips.length) return null;
    return {
      pos: c.from,
      end: c.to,
      above: true,
      create() {
        const dom = createDiv({ cls: "srag-cite-tip" });
        tips.forEach((t) => dom.createDiv({ cls: "srag-cite-tip-item", text: t }));
        return { dom };
      },
    };
  });

  return [plugin, hover];
}
