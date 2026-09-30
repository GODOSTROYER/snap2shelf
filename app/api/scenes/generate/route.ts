import { z } from "zod";
import type { SceneGenerateResponse } from "@/lib/api-contract";
import { readJson, route, skuSchema } from "@/lib/server/http";
import { requestScene } from "@/lib/server/scene-jobs";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z
  .object({
    theme: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
    prompt: z.string().max(300).optional(),
    tier: z.enum(["draft", "final"]),
    view: z.enum(["eye-level", "top-down"]).optional(),
    sku: skuSchema.optional(),
  })
  .refine((b) => Boolean(b.theme || b.prompt?.trim()), { message: "theme or prompt required" });

/**
 * POST /api/scenes/generate { theme?, prompt?, tier, view?, sku? }
 * C2 first: the prompt-hash plate already exists → { reused: true, credits: 0, creditsSaved } at once.
 * Otherwise [gated] (access cookie + session cap + pool quota floor): starts a pinned-model job
 * → { reused: false, job }. Poll GET /api/scene-jobs/:job.
 */
export const POST = route("scenes-generate", async (req, session) => {
  const body = await readJson(req, schema, 4096);
  const { response, started } = await requestScene(body, session);
  return { body: response satisfies SceneGenerateResponse, session: started ? { ...session, g: session.g + 1 } : undefined };
});
