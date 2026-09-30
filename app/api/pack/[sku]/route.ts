import type { PackStatusResponse } from "@/lib/api-contract";
import { assertSku, routeWithParams } from "@/lib/server/http";
import { packStatus } from "@/lib/server/pack";
import { provenSkus } from "@/lib/server/proofs";
import { canWrite } from "@/lib/server/protect";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/pack/:sku → finishes pending formats; zipUrl (signed, ~1 h) once nothing is pending.
 * Sample / showcase products without the access code, and other browsers' products: read-only
 * (prebuilt / already saved formats only; nothing is materialised).
 */
export const GET = routeWithParams<{ sku: string }>("pack-status", async (req, session, { sku }) => {
  assertSku(sku);
  const out = await packStatus(sku, undefined, { readOnly: !canWrite(session, sku, provenSkus(req)) });
  return { body: out satisfies PackStatusResponse };
});
