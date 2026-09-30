import type { CostResponse } from "@/lib/api-contract";
import { costForProduct, isScenePublicId } from "@/lib/server/cost";
import { assertSku, badRequest, routeWithParams } from "@/lib/server/http";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/cost/:sku?scene=<scene publicId> → cost meter numbers for one product:
 * generation credits, credits saved by scene reuse, AI Vision tokens, transformation
 * estimate, original vs delivered bytes (f_auto/q_auto hero as a browser gets it), seconds.
 */
export const GET = routeWithParams<{ sku: string }>("cost", async (req, _session, { sku }) => {
  assertSku(sku);
  const scene = req.nextUrl.searchParams.get("scene") ?? undefined;
  if (scene !== undefined && !isScenePublicId(scene)) throw badRequest("Invalid scene id.");
  const body: CostResponse = await costForProduct(sku, scene);
  return { body };
});
