import type { UsageResponse } from "@/lib/api-contract";
import { poolSummary } from "@/lib/cloudinary/pool";
import { liveGenMin } from "@/lib/server/config";
import { route } from "@/lib/server/http";
import { generationsLeft } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 30;

/** GET /api/usage → pool totals only (accounts are never listed) + this session's allowance. */
export const GET = route("usage", async (_req, session) => {
  const [gen, vision] = await Promise.all([poolSummary("image_generation"), poolSummary("ai_vision")]);
  const body: UsageResponse = {
    generation: { remaining: gen.remaining, limit: gen.limit, usable: gen.usable },
    vision: { remaining: vision.remaining, limit: vision.limit, usable: vision.usable },
    liveGeneration: gen.known && gen.usable >= liveGenMin(),
    session: { unlocked: session.u, generationsLeft: generationsLeft(session) },
  };
  return { body };
});
