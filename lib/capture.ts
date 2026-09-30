/**
 * QR phone capture: how the laptop notices that the phone has uploaded
 * snap2shelf/products/<sku>/raw. Client-safe (no secrets, no server imports).
 *
 * Measured live (scripts/spikes/10-capture-poll.mts, 30 Sep 2026), with every
 * probe already polling (404) before the upload:
 *   delivery URL + version buster  /image/upload/v<n>/<public_id>   → 200 on the first poll, 0.8 s after upload
 *   Admin API resource lookup                                       → 1.6 s (but 500 calls/hour limit)
 *   delivery URL, no buster or ?cb=<n> query buster                 → 3.7 s: the CDN caches the 404 and ignores the query
 *   client list JSON (plain or ?cb=)                                → 24 s: list JSON is cached, query ignored
 * So the laptop polls the delivery URL with a fresh version component. It costs
 * no Admin API calls and no transformations, and res.cloudinary.com answers
 * with `Access-Control-Allow-Origin: *`, so the browser can HEAD it directly.
 */
import { SKU_RE, productId } from "./types";

let counter = 0;

/** Original (untransformed) raw upload with a unique version component, so no cache layer can answer with a stale 404. */
export function captureProbeUrl(cloud: string, sku: string, n = Date.now() * 10 + (counter++ % 10)): string {
  if (!SKU_RE.test(sku)) throw new Error("invalid sku");
  return `https://res.cloudinary.com/${cloud}/image/upload/v${n}/${productId(sku, "raw")}`;
}

/** One check: has the raw upload for this sku arrived yet? */
export async function isCaptured(cloud: string, sku: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(captureProbeUrl(cloud, sku), { method: "HEAD", cache: "no-store" });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Poll until the phone's upload lands (resolves true) or the signal aborts /
 * timeout passes (resolves false). Default cadence 1.5 s → noticed within ~2 s.
 */
export async function waitForCapture(
  cloud: string,
  sku: string,
  opts: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<boolean> {
  const interval = opts.intervalMs ?? 1500;
  const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
  while (Date.now() < deadline && !opts.signal?.aborted) {
    if (await isCaptured(cloud, sku)) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}
