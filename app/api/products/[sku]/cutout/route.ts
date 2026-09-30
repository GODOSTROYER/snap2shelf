import { assertSku, chargeOpenOp, routeWithParams } from "@/lib/server/http";
import { ensureCutout } from "@/lib/server/products";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/products/:sku/cutout → background removal + trim, saved once as
 * snap2shelf/products/<sku>/cutout. 202 {code:"pending", retryAfterMs} while Cloudinary derives.
 */
export const POST = routeWithParams<{ sku: string }>("cutout", async (_req, session, { sku }) => {
  assertSku(sku);
  const charged = chargeOpenOp(session);
  const { response, created } = await ensureCutout(sku);
  return { body: response, session: created ? charged : undefined };
});
