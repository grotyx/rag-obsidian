import { requestUrl } from "obsidian";

/** Providers answer 429 when too many requests land at once — and the batch paths deliberately
 *  run 15 papers in parallel. Retry those (and transient 5xx) with exponential backoff, honouring
 *  Retry-After when the provider sends one, so a burst degrades into a wait instead of a row of
 *  "summary failed" notices. */
export const RETRY_STATUS: ReadonlySet<number> = new Set([408, 409, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
/** A server may ask for an hour; waiting that long inside one request would freeze a batch. */
const MAX_RETRY_AFTER_MS = 120_000;

/** `Retry-After` as milliseconds: delta-seconds or an HTTP-date. null when absent or unreadable. */
export function retryAfterMs(raw: unknown, now = Date.now()): number | null {
  const s = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) * 1000;
  const at = Date.parse(s);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/** How long to sleep before the next attempt. A server's Retry-After is the *earliest* retry time,
 *  so it is honoured as a floor (capped at `MAX_RETRY_AFTER_MS`) with only a little added spread so
 *  parallel workers do not wake in lockstep; the fallback backoff is jittered both ways. */
export function retryDelayMs(wait: number, headers?: Record<string, unknown>, now = Date.now()): number {
  const key = headers ? Object.keys(headers).find((k) => k.toLowerCase() === "retry-after") : undefined;
  const asked = key ? retryAfterMs(headers?.[key], now) : null;
  if (asked !== null) return Math.min(asked, MAX_RETRY_AFTER_MS) + Math.random() * 500;
  return wait * (0.5 + Math.random());
}

async function backoff(wait: number, res?: { headers?: Record<string, unknown> }): Promise<number> {
  await new Promise((r) => window.setTimeout(r, retryDelayMs(wait, res?.headers)));
  return wait * 2;
}

/** Retried request, with the transport injectable so tests can fake failures. `statuses` are the
 *  HTTP statuses worth another attempt (network errors are always retried). */
export async function requestWithRetry(
  opts: Parameters<typeof requestUrl>[0],
  call: typeof requestUrl = requestUrl,
  statuses: ReadonlySet<number> = RETRY_STATUS
): Promise<Awaited<ReturnType<typeof requestUrl>>> {
  let wait = 1000;
  for (let attempt = 1; ; attempt++) {
    let res: Awaited<ReturnType<typeof requestUrl>>;
    try {
      res = await call(opts);
    } catch (e) {
      // Connection reset / timeout / DNS: same degraded-wait treatment as a 429.
      if (attempt >= MAX_ATTEMPTS) throw e;
      wait = await backoff(wait);
      continue;
    }
    if (!statuses.has(res.status) || attempt >= MAX_ATTEMPTS) return res;
    wait = await backoff(wait, res);
  }
}
