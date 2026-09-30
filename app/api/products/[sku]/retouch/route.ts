import type { RetouchPendingResponse, RetouchResponse } from "@/lib/api-contract";
import { assertSku, chargeOpenOp, routeWithParams } from "@/lib/server/http";
import { retouchProduct } from "@/lib/server/retouch";
import type { Session } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/products/:sku/retouch → Q4 auto-retouch (call after analyze, before cutout).
 * First call: AI Vision tagging + measurements decide the fixes (one open paid operation).
 * 202 {code:"pending", retryAfterMs, planned, notes} while Cloudinary derives; then 200
 * with the fixes applied and snap2shelf/products/<sku>/retouched saved (or status "none").
 */
export const POST = routeWithParams<{ sku: string }>("retouch", async (_req, session, { sku }) => {
  assertSku(sku);
  let charged: Session | undefined;
  const out = await retouchProduct(sku, { beforeSpend: () => void (charged = chargeOpenOp(session)) });
  if (out.kind === "pending") {
    const body: RetouchPendingResponse = out.response;
    return { status: 202, body, session: charged, headers: { "Retry-After": String(Math.ceil((body.retryAfterMs ?? 2000) / 1000)) } };
  }
  return { body: out.response satisfies RetouchResponse, session: charged };
}, { retriable: true });
