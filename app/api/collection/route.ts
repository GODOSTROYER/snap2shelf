import { z } from "zod";
import type { CollectionResponse } from "@/lib/api-contract";
import { chargeOpenOp, readJson, route, skuSchema } from "@/lib/server/http";
import { provenSkus } from "@/lib/server/proofs";
import { assertCanWrite } from "@/lib/server/protect";
import { SCENE_ID_RE, stageCollection } from "@/lib/shelf/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({
  skus: z.array(skuSchema).min(2).max(6),
  scenePublicId: z.string().regex(SCENE_ID_RE),
});

/**
 * POST /api/collection → Collection mode (U2): every product staged on the SAME
 * scene with the same light, shadow and visual weight, each saved as its hero.
 * One open operation per product. Staging re-points each product's current hero,
 * so every product must have been created in this browser (a sample / showcase
 * product needs the access code instead): otherwise 403 read_only.
 */
export const POST = route("collection", async (req, session) => {
  const body = await readJson(req, schema);
  const owned = provenSkus(req);
  for (const sku of new Set(body.skus)) assertCanWrite(session, sku, owned);
  let charged = session;
  for (let i = 0; i < new Set(body.skus).size; i++) charged = chargeOpenOp(charged);
  const out = await stageCollection(body);
  return { body: out satisfies CollectionResponse, session: charged };
});
