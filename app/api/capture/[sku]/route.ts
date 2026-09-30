import type { CaptureResponse } from "@/lib/api-contract";
import { captureProbeUrl } from "@/lib/capture";
import { mainCloud, probe } from "@/lib/server/cld";
import { loadProduct } from "@/lib/server/facts";
import { assertSku, routeWithParams } from "@/lib/server/http";
import { claimLock } from "@/lib/server/locks";
import { grantProof, proofFor, provenSkus, revokeProof, type CookieWrite } from "@/lib/server/proofs";
import { getCutout, productRecord } from "@/lib/server/products";
import { canClaimCapture, canWrite, isProtectedSku, ownsProduct } from "@/lib/server/protect";
import { sessionEstablished } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/capture/:sku → { ready } for the QR phone flow. The check is a HEAD on
 * the raw's delivery URL with a fresh version component (no Admin API call while
 * waiting); once it answers 200, the ProductRecord comes from the product's facts
 * (Upload-API explicit + CDN JSON, still no Admin API call).
 *
 * Handing the phone's photo to the laptop (the phone's own session got its product
 * proof when it signed the upload):
 *  1. The laptop that shows the QR code polls here from the moment the code appears,
 *     before the sku exists. On its first such poll its session claims the capture
 *     lock snap2shelf/locks/capture-<sku>.json (atomic, first writer wins: one Upload
 *     API call, lib/server/locks.ts) and gets a capture ticket: an httpOnly cookie
 *     s2s_c_<sku> bound to its session id, valid 10 minutes. No other session can get
 *     a ticket for that sku afterwards.
 *  2. When the raw lands, the ticket is exchanged ONCE for a product proof (s2s_p_<sku>):
 *     same session, ticket unexpired, raw uploaded after the ticket and < 10 minutes ago.
 *     The ticket is deleted in the same response and no ticket is issued once the raw
 *     exists, so the claim is single-use.
 * Knowing a sku is therefore not enough to take over someone's phone upload.
 */
export const GET = routeWithParams<{ sku: string }>("capture", async (req, session, { sku }) => {
  assertSku(sku);
  const proven = provenSkus(req);
  const owned = ownsProduct(session, sku, proven);
  const ticket = owned ? null : proofFor(req, "capture", sku, { sid: session.sid });
  const p = await probe(captureProbeUrl(mainCloud(), sku), 5000);

  if (p.status !== 200) {
    // Still waiting for the phone: register this session as the one waiting, once per sku.
    // Not on a visitor's very first request: its new session id may still be replaced by a
    // concurrent first request, and the lock would then name a session that no longer exists.
    let cookies: CookieWrite[] | undefined;
    if (!owned && !isProtectedSku(sku) && ticket?.sid !== session.sid && sessionEstablished(req, session)) {
      try {
        if (await claimLock("capture", sku, session.sid)) cookies = grantProof(req, "capture", sku, session.sid);
      } catch (err) {
        console.warn(`[capture] lock claim failed, no ticket this poll: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
      }
    }
    return { body: { ready: false } satisfies CaptureResponse, cookies };
  }

  const product = await loadProduct(sku);
  const claim = !owned && canClaimCapture(sku, ticket, session.sid, product.raw.version);
  // Recording a found cutout in the facts is bookkeeping: only for a browser that may write.
  const cutout = await getCutout(sku, product, claim || canWrite(session, sku, proven));
  return {
    body: { ready: true, product: productRecord(sku, product.raw, cutout) } satisfies CaptureResponse,
    cookies: claim ? [...grantProof(req, "product", sku, session.sid), revokeProof("capture", sku)] : undefined,
  };
});
