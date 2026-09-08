import { Notice } from "obsidian";
import type ScholarRagPlugin from "../../main";

/** Handle on a running batch: report progress, cancel it, and say how it ended. */
export interface Batch {
  /** Update the status bar. `done` counts finished items, `failed` the ones that errored. */
  tick(done: number, failed?: number): void;
  /** Last line of the batch — shown in the status bar for a few seconds, then cleared. */
  finish(summary: string): void;
  /** Pass to `mapPool`: aborts when the user clicks ✕ or runs "Cancel current batch". */
  signal: AbortSignal;
}

// ponytail: one batch at a time, tracked in a module global. If two ever need to run at once,
// key this by batch and give each its own status-bar item.
let active: AbortController | null = null;

/** Cancel the running batch. No-op (returns false) when nothing is running. */
export function cancelBatch(): boolean {
  if (!active) return false;
  active.abort();
  new Notice("Cancelling — papers already in flight will finish.");
  return true;
}

/** Show `label 3/50 · 1 failed` in the status bar with a clickable ✕ that cancels.
 *  Returns null (and warns) if another batch is already running. */
export function startBatch(plugin: ScholarRagPlugin, label: string, total: number): Batch | null {
  if (active) {
    new Notice("Another batch is already running — cancel that one first.");
    return null;
  }
  const controller = new AbortController();
  active = controller;
  const el = plugin.addStatusBarItem();
  const text = el.createSpan({ text: `${label} 0/${total}` });
  const cancel = el.createSpan({ text: " ✕", cls: "srag-batch-cancel" });
  cancel.setAttr("aria-label", "Cancel batch");
  cancel.onclick = () => void cancelBatch();
  return {
    signal: controller.signal,
    tick: (done, failed = 0) => {
      text.setText(
        `${label} ${done}/${total}` +
          (failed ? ` · ${failed} failed` : "") +
          (controller.signal.aborted ? " · cancelling" : "")
      );
    },
    finish: (summary) => {
      if (active === controller) active = null;
      cancel.remove();
      text.setText(summary);
      window.setTimeout(() => el.remove(), 6000);
    },
  };
}
