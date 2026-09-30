import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ShelfResponse } from "@/lib/api-contract";
import { badRequest, chargeOpenOp, readJson, route, skuSchema } from "@/lib/server/http";
import { assertCanChange, authorizeShelf, isProtectedShop, readOnly, READ_ONLY_DEMO_SHELF } from "@/lib/server/protect";
import { withShelf } from "@/lib/server/session";
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
  heroes: z.record(skuSchema, z.string().regex(/^snap2shelf\/products\/[a-z0-9]{8}\/hero-[a-z0-9-]{1,80}$/)).optional(),
});

/**
 * POST /api/shelf → publish (or update) /shelf/<shop>: tags each product's current hero with s2s-shop-<shop>.
 * Without the access code a browser can publish only products it created, to a new shelf name
 * (up to SHELVES_MAX per session) or one it created earlier; the demo shelf, and any shelf holding
 * a sample / showcase product, is read-only (lib/server/protect.ts authorizeShelf).
 */
export const POST = route("shelf", async (req, session) => {
  const body = await readJson(req, schema);
  const shop = checkShop(body.shop);
  if (!shop.ok) throw badRequest(shop.reason);
  for (const [sku, id] of Object.entries(body.heroes ?? {})) {
    if (!id.startsWith(`snap2shelf/products/${sku}/hero-`)) throw badRequest("Each hero must belong to its product.");
  }
  if (!session.u && isProtectedShop(shop.shop)) throw readOnly(READ_ONLY_DEMO_SHELF);
  for (const sku of new Set(body.skus)) assertCanChange(session, sku);
  const charged = chargeOpenOp(session);
  const out = await publishShelf({ ...body, shop: shop.shop }, { authorize: (members) => authorizeShelf(session, shop.shop, members) });
  revalidatePath(shelfPath(shop.shop));
  return { body: out satisfies ShelfResponse, session: session.u ? charged : withShelf(charged, shop.shop) };
});
