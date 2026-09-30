import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ShelfResponse } from "@/lib/api-contract";
import { badRequest, chargeOpenOp, readJson, route, skuSchema } from "@/lib/server/http";
import { claimLock, holdsLock } from "@/lib/server/locks";
import { grantProof, provenShops, provenSkus } from "@/lib/server/proofs";
import { assertCanWrite, authorizeShelf, isProtectedShop, readOnly, READ_ONLY_DEMO_SHELF, READ_ONLY_SHELF_TAKEN, type ShelfPlan } from "@/lib/server/protect";
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
 * Every product must have been created in this browser (a sample / showcase product needs the access
 * code). Without the access code a browser can publish to a new shelf name (up to SHELVES_MAX) or one
 * it created earlier; the demo shelf, and any shelf holding a sample / showcase product, is read-only
 * (lib/server/protect.ts authorizeShelf).
 *
 * Who created a shelf is decided by Cloudinary, not by the (cached) tag list: a new name is claimed
 * right before the first write with an atomic lock upload (snap2shelf/locks/shelf-<shop>.json,
 * overwrite: false, lib/server/locks.ts). Of two browsers publishing the same new name at once,
 * exactly one wins; the other gets 403 read_only "already taken" before anything is written. The
 * winner gets a shelf proof cookie (s2s_s_<shop>) for later updates.
 */
export const POST = route("shelf", async (req, session) => {
  const body = await readJson(req, schema);
  const shop = checkShop(body.shop);
  if (!shop.ok) throw badRequest(shop.reason);
  for (const [sku, id] of Object.entries(body.heroes ?? {})) {
    if (!id.startsWith(`snap2shelf/products/${sku}/hero-`)) throw badRequest("Each hero must belong to its product.");
  }
  if (!session.u && isProtectedShop(shop.shop)) throw readOnly(READ_ONLY_DEMO_SHELF);
  const owned = provenSkus(req);
  for (const sku of new Set(body.skus)) assertCanWrite(session, sku, owned);
  const charged = chargeOpenOp(session);

  const shops = provenShops(req);
  const proof = { owned: shops.has(shop.shop) || Boolean(session.sp?.includes(shop.shop)), held: new Set([...shops, ...(session.sp ?? [])]).size };
  let plan: ShelfPlan = "owned";
  let granted = proof.owned;
  const out = await publishShelf(
    { ...body, shop: shop.shop },
    {
      authorize: async (members) => {
        plan = authorizeShelf(session, shop.shop, members, proof);
        // A shelf with heroes and no proof in this browser: only the session its lock names
        // (e.g. a publish whose response was lost) may continue. No lock = created before locks.
        if (plan === "verify") {
          if ((await holdsLock("shelf", shop.shop, session.sid)) !== true) throw readOnly(READ_ONLY_SHELF_TAKEN);
          granted = true;
        }
      },
      beforeWrite: async () => {
        if (plan !== "claim") return;
        const mine = await claimLock("shelf", shop.shop, session.sid);
        if (!mine && !session.u) throw readOnly(READ_ONLY_SHELF_TAKEN);
        granted = mine;
      },
    },
  );
  try {
    revalidatePath(shelfPath(shop.shop));
  } catch (err) {
    // The shelf is already written: a failed cache purge must not turn it into an error (the page revalidates within 60 s).
    console.warn(`[shelf] revalidatePath failed: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
  }
  return {
    body: out satisfies ShelfResponse,
    session: charged,
    cookies: granted && !shops.has(shop.shop) ? grantProof(req, "shelf", shop.shop, session.sid) : undefined,
  };
});
