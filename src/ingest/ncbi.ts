/** One queue for every NCBI E-utilities request the plugin makes.
 *
 *  NCBI allows 3 requests/second per IP, 10 with an API key. The batch paths run 15 papers at
 *  once and a single paper can fire a dozen MeSH lookups, so without a shared queue a wide
 *  worker pool just turns into HTTP 429s. It lives in its own module because both
 *  `ingest/metadata.ts` and `ingest/pubmedSearch.ts` route through it, and pubmedSearch already
 *  imports metadata — a gate owned by either one would be a cycle. */
let chain: Promise<void> = Promise.resolve();
let lastRelease = 0;

/** Milliseconds between consecutive requests, a little under the published ceiling. */
export function ncbiGapMs(hasApiKey: boolean): number {
  return hasApiKey ? 110 : 350;
}

/** Take a turn on the queue. Sleeps only for the remainder of the gap since the previous
 *  request, so an idle plugin issues its first call immediately instead of stalling. */
export function ncbiGate(hasApiKey: boolean): Promise<void> {
  const gap = ncbiGapMs(hasApiKey);
  const turn = chain.then(async () => {
    const owed = gap - (Date.now() - lastRelease);
    if (owed > 0) await new Promise((r) => setTimeout(r, owed));
    lastRelease = Date.now();
  });
  chain = turn.catch(() => undefined);
  return turn;
}

/** Test seam: forget the queue's history so timing checks start from a known state. */
export function resetNcbiGate(): void {
  chain = Promise.resolve();
  lastRelease = 0;
}
