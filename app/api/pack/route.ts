import { z } from "zod";
import type { PackResponse } from "@/lib/api-contract";
import { mainCloud } from "@/lib/server/cld";
import { checkMainImageUrl } from "@/lib/server/guard";
import { badRequest, chargeOpenOp, readJson, route, skuSchema } from "@/lib/server/http";
import { startPack } from "@/lib/server/pack";
import { prebuiltPackFor } from "@/lib/server/prebuilt";
import { canWrite, readOnly } from "@/lib/server/protect";

export const runtime = "nodejs";
export const maxDuration = 30;

const offerText = z
  .string()
  .trim()
  .max(40)
  .regex(/^[^\u0000-\u001f<>]*$/)
  .optional();
const schema = z.object({
  sku: skuSchema,
  heroUrl: z.string().min(1).max(2048),
  sceneSlug: z.string().regex(/^[a-z0-9-]{1,40}$/),
  offer: z.object({ hindi: offerText, english: offerText }).optional(),
  recolor: z
    .array(z.string().regex(/^#?[0-9a-fA-F]{6}$/).transform((h) => h.replace(/^#/, "").toLowerCase()))
    .max(4)
    .optional(),
  textZone: z.enum(["top", "bottom", "left", "right", "top_left", "top_right", "none"]).optional(),
  productBox: z.object({ pw: z.number().int().min(1).max(4000), ph: z.number().int().min(1).max(4000), px: z.number().int().min(-2000).max(4000), py: z.number().int().min(-2000).max(4000), baseY: z.number().int().min(-2000).max(4000) }).optional(),
});

/**
 * POST /api/pack → save the hero and start materialising the Channel Pack. Poll GET /api/pack/:sku.
 * Sample / showcase products without the access code: the prebuilt pack when the hero is the
 * composite it was built from (no Cloudinary call), anything else 403 read_only — a live pack
 * would re-point the showcase product's hero and overwrite its stored formats.
 */
export const POST = route("pack", async (req, session) => {
  const body = await readJson(req, schema);
  const check = checkMainImageUrl(body.heroUrl, mainCloud());
  if (!check.ok) throw badRequest("The hero image must be one made in this app.");
  if (!canWrite(session, body.sku)) {
    const pre = prebuiltPackFor(body.sku, body.heroUrl);
    if (!pre) throw readOnly();
    return { body: { sku: body.sku, heroPublicId: pre.heroPublicId, assets: pre.assets, pending: [], failed: pre.failed } satisfies PackResponse };
  }
  const charged = chargeOpenOp(session);
  const out = await startPack(body);
  return { body: out satisfies PackResponse, session: charged };
});
