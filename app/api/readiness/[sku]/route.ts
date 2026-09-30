import { z } from "zod";
import type { ReadinessResponse } from "@/lib/api-contract";
import { APPLICABLE_FIXES } from "@/lib/readiness";
import { assertSku, chargeOpenOp, readJson, routeWithParams } from "@/lib/server/http";
import type { Session } from "@/lib/server/session";
import { applyReadinessFix, measureReadiness } from "@/lib/shelf/measure";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/readiness/:sku[?vision=0] → 0–100 marketplace/social readiness + checklist.
 * The AI Vision text/watermark check runs once per marketplace image (cached in
 * the raw's context); it counts as one open operation only when it actually runs.
 */
export const GET = routeWithParams<{ sku: string }>("readiness", async (req, session, { sku }) => {
  assertSku(sku);
  let charged: Session | null = null;
  try {
    charged = chargeOpenOp(session);
  } catch {
    charged = null; // at the cap: still score, just without a fresh AI Vision call
  }
  const vision = req.nextUrl.searchParams.get("vision") !== "0" && charged !== null;
  const out = await measureReadiness(sku, { vision });
  return { body: { report: out.report, tokens: out.tokens } satisfies ReadinessResponse, session: out.visionCalled && charged ? charged : undefined };
});

const fixSchema = z.object({ fixes: z.array(z.enum(Object.keys(APPLICABLE_FIXES) as [keyof typeof APPLICABLE_FIXES])).min(1).max(2) });

/** POST /api/readiness/:sku { fixes: ["repad" | "sharpen"] } → apply one-click fixes, then re-score. */
export const POST = routeWithParams<{ sku: string }>("readiness-fix", async (req, session, { sku }) => {
  assertSku(sku);
  const body = await readJson(req, fixSchema);
  const charged = chargeOpenOp(session);
  const { asset, ...applied } = await applyReadinessFix(sku, body.fixes);
  const out = await measureReadiness(sku, { vision: true, marketplace: asset });
  return { body: { report: out.report, tokens: out.tokens, applied } satisfies ReadinessResponse, session: charged };
});
