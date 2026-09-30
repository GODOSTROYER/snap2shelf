import { z } from "zod";
import type { GenerateResponse } from "@/lib/api-contract";
import { GENERATION_MODELS } from "@/lib/server/config";
import { startCreative } from "@/lib/server/creative";
import { HttpError, badRequest, readJson, route, skuSchema } from "@/lib/server/http";
import { generationsLeft, liveGenerationEnabled } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({
  sku: skuSchema,
  kind: z.literal("creative"),
  model: z.string().min(1).max(64),
  seed: z.number().int().min(0).max(2_147_483_647),
  prompt: z.string().max(300).optional(),
});

/** POST /api/generate [gated] → start image_to_image on the key pool; returns an opaque job token. */
export const POST = route("generate", async (req, session) => {
  const body = await readJson(req, schema);
  if (!session.u) throw new HttpError(403, "locked", "Enter the demo access code to generate live.");
  if (generationsLeft(session) <= 0) throw new HttpError(429, "cap_reached", "You've used this session's live generations. Try the saved examples.");
  if (!GENERATION_MODELS[body.model]) throw badRequest("Unsupported model.");
  const live = await liveGenerationEnabled();
  if (!live.enabled) throw new HttpError(503, "quota_low", "Live generation is paused to save quota. Showing saved examples instead.");

  const job = await startCreative({ sku: body.sku, model: body.model, seed: body.seed, prompt: body.prompt, sid: session.sid });
  return { body: { job } satisfies GenerateResponse, session: { ...session, g: session.g + 1 } };
});
