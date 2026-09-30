import type { UsageResponse } from "@/lib/api-contract";
import { poolSummary, usageIsStale } from "@/lib/cloudinary/pool";
import { txBudget } from "@/lib/server/budget";
import { liveGenMin } from "@/lib/server/config";
import { route } from "@/lib/server/http";
import { generationsLeft } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/usage → pool totals only (accounts are never listed) + this session's allowance
 * + main's transformation-credit floor. Never fails because Cloudinary's Admin API is rate
 * limited: the last numbers are served and marked `stale`.
 */
export const GET = route("usage", async (_req, session) => {
  const [gen, vision, tx] = await Promise.all([poolSummary("image_generation"), poolSummary("ai_vision"), txBudget()]);
  const body: UsageResponse = {
    generation: { remaining: gen.remaining, limit: gen.limit, usable: gen.usable },
    vision: { remaining: vision.remaining, limit: vision.limit, usable: vision.usable },
    liveGeneration: gen.known && gen.usable >= liveGenMin() && tx.livePipeline,
    session: { unlocked: session.u, generationsLeft: generationsLeft(session) },
    livePipeline: tx.livePipeline,
    transformations: { usedCredits: tx.usedCredits, limitCredits: tx.limitCredits, floorCredits: tx.maxUsedCredits },
    stale: usageIsStale() || tx.stale,
  };
  return { body };
});
