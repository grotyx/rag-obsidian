/** Run `fn` over `items` with at most `limit` in flight, keeping results in input order.
 *
 *  Use it for the network and LLM half of a batch. Vault writes must stay sequential:
 *  `Library.createReference` derives the citekey and filename from what is already in the
 *  vault, so two concurrent creates can pick the same name.
 *
 *  `fn` is expected to handle its own failures — a rejection here aborts the whole batch.
 *
 *  Pass a `signal` to make the batch cancellable. Aborting stops *new* work only: whatever is
 *  already in flight finishes and the promise resolves normally, so the caller can still write
 *  what completed. Slots for items that never started are left empty — read the result with
 *  `if (!r) continue` and count the holes as skipped. */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal
): Promise<R[]> {
  const out = new Array<R>(items.length);
  if (!items.length) return out;
  const width = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) return;
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  return out;
}

/** How many papers to work on at once.
 *
 *  Sized for the LLM, which is what a paper actually waits on: the PubMed lookups take a moment,
 *  the summary takes seconds. It deliberately does NOT depend on the PubMed key — NCBI's own
 *  ceiling (3 requests/second, 10 with a key) is held by the request gate in
 *  `ingest/pubmedSearch.ts`, so extra workers queue there instead of drawing 429s. */
export const POOL_WIDTH = 15;
