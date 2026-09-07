/** Run `fn` over `items` with at most `limit` in flight, keeping results in input order.
 *
 *  Use it for the network and LLM half of a batch. Vault writes must stay sequential:
 *  `Library.createReference` derives the citekey and filename from what is already in the
 *  vault, so two concurrent creates can pick the same name.
 *
 *  `fn` is expected to handle its own failures — a rejection here aborts the whole batch. */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  if (!items.length) return out;
  const width = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: width }, worker));
  return out;
}

/** How many PubMed/LLM requests to keep in flight. NCBI allows 3 requests/second without an
 *  API key and 10 with one, and each item here spends most of its time in the LLM call. */
export function poolWidth(hasPubmedKey: boolean): number {
  return hasPubmedKey ? 6 : 3;
}
