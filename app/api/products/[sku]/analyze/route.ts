import { assertSku, chargeOpenOp, routeWithParams } from "@/lib/server/http";
import { analyzeProduct } from "@/lib/server/products";
import { canWrite } from "@/lib/server/protect";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/products/:sku/analyze → caption + focus + AI Vision product JSON (cached in the raw asset's context).
 * Sample / showcase products without the access code: the stored analysis only (403 read_only if there is none).
 */
export const POST = routeWithParams<{ sku: string }>("analyze", async (_req, session, { sku }) => {
  assertSku(sku);
  const charged = chargeOpenOp(session);
  const { response, cached } = await analyzeProduct(sku, { readOnly: !canWrite(session, sku) });
  return { body: response, session: cached ? undefined : charged };
});
