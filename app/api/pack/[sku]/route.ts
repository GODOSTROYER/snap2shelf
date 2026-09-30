import type { PackStatusResponse } from "@/lib/api-contract";
import { assertSku, routeWithParams } from "@/lib/server/http";
import { packStatus } from "@/lib/server/pack";

export const runtime = "nodejs";
export const maxDuration = 30;

/** GET /api/pack/:sku → finishes pending formats; zipUrl (signed, ~1 h) once nothing is pending. */
export const GET = routeWithParams<{ sku: string }>("pack-status", async (_req, _session, { sku }) => {
  assertSku(sku);
  const out = await packStatus(sku);
  return { body: out satisfies PackStatusResponse };
});
