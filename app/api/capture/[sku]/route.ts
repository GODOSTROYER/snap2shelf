import type { CaptureResponse } from "@/lib/api-contract";
import { captureProbeUrl } from "@/lib/capture";
import { mainCloud, probe } from "@/lib/server/cld";
import { loadProduct } from "@/lib/server/facts";
import { assertSku, routeWithParams } from "@/lib/server/http";
import { getCutout, productRecord } from "@/lib/server/products";
import { canClaimCapture } from "@/lib/server/protect";
import { ownsSku, withOwnedSku } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/capture/:sku → { ready } for the QR phone flow. The check is a HEAD on
 * the raw's delivery URL with a fresh version component (no Admin API call while
 * waiting); once it answers 200, the ProductRecord comes from the product's facts
 * (Upload-API explicit + CDN JSON, still no Admin API call).
 *
 * The laptop that shows the QR code polls here while the phone uploads, so when a
 * raw uploaded in the last 30 minutes lands, the polling browser records the sku
 * as one it created (the phone's own session did so when it signed the upload).
 */
export const GET = routeWithParams<{ sku: string }>("capture", async (_req, session, { sku }) => {
  assertSku(sku);
  const p = await probe(captureProbeUrl(mainCloud(), sku), 5000);
  if (p.status !== 200) return { body: { ready: false } satisfies CaptureResponse };
  const product = await loadProduct(sku);
  const cutout = await getCutout(sku, product);
  const claim = !ownsSku(session, sku) && canClaimCapture(sku, product.raw.version);
  return {
    body: { ready: true, product: productRecord(sku, product.raw, cutout) } satisfies CaptureResponse,
    session: claim ? withOwnedSku(session, sku) : undefined,
  };
});
