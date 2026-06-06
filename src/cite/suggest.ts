import {
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
} from "obsidian";
import type ScholarRagPlugin from "../../main";
import { RefEntry } from "../data/library";

/** Type `@` in any note → autocomplete library citekeys → inserts `[@citekey]`. */
export class CitationSuggest extends EditorSuggest<RefEntry> {
  constructor(private plugin: ScholarRagPlugin) {
    super(plugin.app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line).slice(0, cursor.ch);
    const m = line.match(/(?:^|[\s([])@([^\s\]@;]*)$/);
    if (!m) return null;
    const query = m[1];
    return {
      start: { line: cursor.line, ch: cursor.ch - query.length - 1 },
      end: cursor,
      query,
    };
  }

  getSuggestions(ctx: EditorSuggestContext): RefEntry[] {
    const q = ctx.query.toLowerCase();
    return this.plugin.library
      .list()
      .filter((e) => `${e.citekey} ${e.title} ${e.authors}`.toLowerCase().includes(q))
      .slice(0, 20);
  }

  renderSuggestion(e: RefEntry, el: HTMLElement): void {
    el.addClass("srag-suggestion");
    el.createDiv({ cls: "srag-sug-key", text: e.citekey });
    el.createDiv({ cls: "srag-sug-meta", text: `${e.authors} · ${e.year} · ${e.title}` });
  }

  selectSuggestion(e: RefEntry): void {
    const ctx = this.context;
    if (!ctx) return;
    ctx.editor.replaceRange(`[@${e.citekey}]`, ctx.start, ctx.end);
  }
}
