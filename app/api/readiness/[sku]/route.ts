import { z } from "zod";
import type { ReadinessResponse } from "@/lib/api-contract";
import { APPLICABLE_FIXES } from "@/lib/readiness";
import { assertSku, chargeOpenOp, readJson, routeWithParams } from "@/lib/server/http";
import { assertCanChange, canChange, canWrite, READ_ONLY_FIX } from "@/lib/server/protect";
import type { Session } from "@/lib/server/session";
import { applyReadinessFix, measureReadiness } from "@/lib/shelf/measure";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/readiness/:sku[?vision=0] → 0–100 marketplace/social readiness + checklist.
 * The AI Vision text/watermark check runs once per marketplace image (cached in
 * the raw's context); it counts as one open operation only when it actually runs.
 * Sample / showcase products without the access code are scored from what is stored
 * (no AI Vision call, no write). `canFix` says whether this browser may POST fixes.
 */
export const GET = routeWithParams<{ sku: string }>("readiness", async (req, session, { sku }) => {
  assertSku(sku);
  let charged: Session | null = null;
  try {
    charged = chargeOpenOp(session);
  } catch {
    charged = null; // at the cap: still score, just without a fresh AI Vision call
  }
  const vision = req.nextUrl.searchParams.get("vision") !== "0" && charged !== null && canWrite(session, sku);
  const out = await measureReadiness(sku, { vision });
  return {
    body: { report: out.report, tokens: out.tokens, canFix: canChange(session, sku) } satisfies ReadinessResponse,
    session: out.visionCalled && charged ? charged : undefined,
  };
});

const fixSchema = z.object({ fixes: z.array(z.enum(Object.keys(APPLICABLE_FIXES) as [keyof typeof APPLICABLE_FIXES])).min(1).max(2) });

/**
 * POST /api/readiness/:sku { fixes: ["repad" | "sharpen"] } → apply one-click fixes, then re-score.
 * A fix overwrites the product's saved marketplace image (invalidate: true), so it needs the access
 * code, or a product created in this browser (session.k, see lib/server/protect.ts). Samples and
 * showcase products answer 403 {code:"read_only"} without the code.
 */
export const POST = routeWithParams<{ sku: string }>("readiness-fix", async (req, session, { sku }) => {
  assertSku(sku);
  const body = await readJson(req, fixSchema);
  assertCanChange(session, sku, READ_ONLY_FIX);
  const charged = chargeOpenOp(session);
  const { asset, ...applied } = await applyReadinessFix(sku, body.fixes);
  const out = await measureReadiness(sku, { vision: true, marketplace: asset });
  return { body: { report: out.report, tokens: out.tokens, applied, canFix: true } satisfies ReadinessResponse, session: charged };
});
