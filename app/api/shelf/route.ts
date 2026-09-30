import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ShelfResponse } from "@/lib/api-contract";
import { badRequest, chargeOpenOp, readJson, route, skuSchema } from "@/lib/server/http";
import { publishShelf } from "@/lib/shelf/server";
import { checkShop, shelfPath } from "@/lib/shelf/slug";

export const runtime = "nodejs";
export const maxDuration = 30;

const text = (max: number) => z.string().trim().max(max).regex(/^[^\u0000-\u001f<>]*$/);
const schema = z.object({
  shop: z.string().trim().toLowerCase(),
  title: text(60).min(1),
  tagline: text(90).optional(),
  skus: z.array(skuSchema).min(1).max(12),
});

/** POST /api/shelf → publish (or update) /shelf/<shop>: tags each product's current hero with s2s-shop-<shop>. */
export const POST = route("shelf", async (req, session) => {
  const body = await readJson(req, schema);
  const shop = checkShop(body.shop);
  if (!shop.ok) throw badRequest(shop.reason);
  const charged = chargeOpenOp(session);
  const out = await publishShelf({ ...body, shop: shop.shop });
  revalidatePath(shelfPath(shop.shop));
  return { body: out satisfies ShelfResponse, session: charged };
});
