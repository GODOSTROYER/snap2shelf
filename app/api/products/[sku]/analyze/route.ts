import { assertSku, chargeOpenOp, routeWithParams } from "@/lib/server/http";
import { analyzeProduct } from "@/lib/server/products";

export const runtime = "nodejs";
export const maxDuration = 30;

/** POST /api/products/:sku/analyze → caption + focus + AI Vision product JSON (cached in the raw asset's context). */
export const POST = routeWithParams<{ sku: string }>("analyze", async (_req, session, { sku }) => {
  assertSku(sku);
  const charged = chargeOpenOp(session);
  const { response, cached } = await analyzeProduct(sku);
  return { body: response, session: cached ? undefined : charged };
});
