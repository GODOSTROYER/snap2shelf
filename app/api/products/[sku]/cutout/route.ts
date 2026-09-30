import { assertSku, chargeOpenOp, routeWithParams } from "@/lib/server/http";
import { ensureCutout } from "@/lib/server/products";
import { canWrite } from "@/lib/server/protect";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/products/:sku/cutout → background removal + trim, saved once as
 * snap2shelf/products/<sku>/cutout. 202 {code:"pending", retryAfterMs} while Cloudinary derives.
 * Sample / showcase products without the access code: the saved cutout only (403 read_only if there is none).
 */
export const POST = routeWithParams<{ sku: string }>("cutout", async (_req, session, { sku }) => {
  assertSku(sku);
  const charged = chargeOpenOp(session);
  const { response, created } = await ensureCutout(sku, undefined, { readOnly: !canWrite(session, sku) });
  return { body: response, session: created ? charged : undefined };
}, { retriable: true });
