import type { CaptureResponse } from "@/lib/api-contract";
import { captureProbeUrl } from "@/lib/capture";
import { mainCloud, probe } from "@/lib/server/cld";
import { assertSku, routeWithParams } from "@/lib/server/http";
import { getCutout, productRecord, requireRaw } from "@/lib/server/products";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/capture/:sku → { ready } for the QR phone flow. The check is a HEAD on
 * the raw's delivery URL with a fresh version component (no Admin API call while
 * waiting); once it answers 200, one Admin lookup returns the ProductRecord.
 */
export const GET = routeWithParams<{ sku: string }>("capture", async (_req, _session, { sku }) => {
  assertSku(sku);
  const p = await probe(captureProbeUrl(mainCloud(), sku), 5000);
  if (p.status !== 200) return { body: { ready: false } satisfies CaptureResponse };
  const [raw, cutout] = await Promise.all([requireRaw(sku), getCutout(sku)]);
  return { body: { ready: true, product: productRecord(sku, raw, cutout) } satisfies CaptureResponse };
});
