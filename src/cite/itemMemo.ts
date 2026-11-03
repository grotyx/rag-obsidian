import type { CSLItem } from "../types";

/** Per-citekey item lookup with a memo, for renderers that only need the keys a note cites.
 *  `library.getItem` is O(1) (citekey→path cache); the old `entries()` map scanned every note
 *  (21k) on each render. Misses are memoized too; `clear()` when the references change. */
export function itemMemo(getItem: (citekey: string) => CSLItem | null): {
  get(citekey: string): CSLItem | null;
  clear(): void;
} {
  const memo = new Map<string, CSLItem | null>();
  return {
    get(citekey) {
      if (!memo.has(citekey)) memo.set(citekey, getItem(citekey));
      return memo.get(citekey) ?? null;
    },
    clear: () => memo.clear(),
  };
}
