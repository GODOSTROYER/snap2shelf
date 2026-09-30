import "server-only";
import { createHash } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import type { PackRequest, PackResponse, PackStatusResponse } from "../api-contract";
import { channelAssets, packTags } from "../transform/channels";
import { productId, type KitAsset, type SceneDNA, type Sku } from "../types";
import { addContext, listByPrefix, mainAuth, mainCloud, probe, removeTag, uploadToMain, type AssetInfo } from "./cld";
import { notFound } from "./http";
import { pinJpeg } from "./guard";
import { cutoutId, getCutout, requireRaw, skuTag } from "./products";

/**
 * Channel Pack: save the approved hero as its own asset, then materialise every
 * channel format (pure transformations from lib/transform/channels.ts) as a
 * tagged asset so one signed ZIP-by-tag URL downloads the whole pack.
 *
 * Stateless: the current pack spec lives in the raw asset's context
 * (hero, pack_hi, pack_en, pack_rc, pack_tz); GET /api/pack/:sku rebuilds the
 * asset list from it and finishes whatever is still pending (AI formats answer
 * 423 while Cloudinary is still generating them).
 */

export const packPrefix = (sku: Sku) => productId(sku, "pack/");
export const packId = (sku: Sku, id: string) => productId(sku, `pack/${id}`);
export const packTag = (sku: Sku) => `s2s-pack-${sku}`;

/** Hero ids carry a short hash of the source URL, so a re-staged hero never collides with cached derivatives of an older one. */
export function heroPublicId(sku: Sku, sceneSlug: string, heroUrl: string): string {
  const h = createHash("sha256").update(heroUrl).digest("hex").slice(0, 8);
  return productId(sku, `hero-${sceneSlug}-${h}`);
}

interface PackSpec {
  hero: string;
  offer?: { hindi?: string; english?: string };
  recolor?: string[];
  textZone?: SceneDNA["text_zone"];
}

function specFromContext(c: Record<string, string>): PackSpec | null {
  if (!c.hero) return null;
  const offer = c.pack_hi || c.pack_en ? { hindi: c.pack_hi || undefined, english: c.pack_en || undefined } : undefined;
  return {
    hero: c.hero,
    offer,
    recolor: c.pack_rc ? c.pack_rc.split(",").filter((h) => /^[0-9a-f]{6}$/.test(h)) : undefined,
    textZone: (c.pack_tz as SceneDNA["text_zone"]) || undefined,
  };
}

function buildAssets(sku: Sku, raw: AssetInfo, spec: PackSpec): KitAsset[] {
  return channelAssets({
    heroPublicId: spec.hero,
    cutoutPublicId: cutoutId(sku),
    alt: raw.context.caption || raw.context.u_name || "Product photo",
    recolorPart: raw.context.u_part,
    swatches: spec.recolor,
    offer: spec.offer,
    textZone: spec.textZone,
    cloud: mainCloud(),
  });
}

type Outcome = "done" | "pending" | "failed";

/**
 * Materialise what isn't saved yet, within a time budget. Assets already saved
 * for the current hero are skipped; assets from an older pack lose the pack tag
 * so they drop out of the ZIP.
 */
async function materialise(sku: Sku, hero: string, assets: KitAsset[], budgetMs: number): Promise<{ assets: KitAsset[]; pending: string[]; failed: string[] }> {
  const deadline = Date.now() + budgetMs;
  const existing = new Map((await listByPrefix(packPrefix(sku))).map((a) => [a.publicId.slice(packPrefix(sku).length), a]));
  const wanted = new Set(assets.map((a) => a.id));
  const stale = [...existing.values()].filter((a) => !wanted.has(a.publicId.slice(packPrefix(sku).length)) || a.context.hero !== hero);
  const staleTagged = stale.filter((a) => a.tags.includes(packTag(sku))).map((a) => a.publicId);
  if (staleTagged.length) await removeTag(staleTagged, packTag(sku));

  const results = await Promise.all(
    assets.map(async (asset): Promise<[KitAsset, Outcome]> => {
      const pid = packId(sku, asset.id);
      const have = existing.get(asset.id);
      if (have && have.context.hero === hero) {
        return [{ ...asset, publicId: pid }, "done"];
      }
      const src = pinJpeg(asset.url);
      const left = deadline - Date.now();
      if (left < 1500) return [asset, "pending"];
      const p = await probe(src, left - 1000);
      if (p.status === 423 || p.status === 420 || p.status === 0) return [asset, "pending"];
      if (p.status !== 200) {
        console.error(`[pack] ${asset.id}: HTTP ${p.status} ${p.error ?? ""}`.slice(0, 200));
        return [asset, "failed"];
      }
      const up = await uploadToMain(src, {
        public_id: pid,
        overwrite: true,
        invalidate: true,
        tags: [...packTags(sku), skuTag(sku)],
        context: { hero, format: asset.format, label: asset.label },
      });
      return [{ ...asset, publicId: up.publicId }, "done"];
    }),
  );
  return {
    assets: results.map(([a]) => a),
    pending: results.filter(([, o]) => o === "pending").map(([a]) => a.id),
    failed: results.filter(([, o]) => o === "failed").map(([a]) => a.id),
  };
}

export function zipUrl(sku: Sku): string {
  return cloudinary.utils.download_zip_url({
    ...mainAuth(),
    tags: [packTag(sku)],
    resource_type: "image",
    flatten_folders: true,
    target_public_id: `snap2shelf-${sku}-channel-pack`,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  });
}

export async function startPack(req: PackRequest & { textZone?: SceneDNA["text_zone"] }, budgetMs = 6000): Promise<PackResponse & { failed: string[] }> {
  const t0 = Date.now();
  const [raw, cutout] = await Promise.all([requireRaw(req.sku), getCutout(req.sku)]);
  if (!cutout) throw notFound("Cut out the product first.");

  const hero = heroPublicId(req.sku, req.sceneSlug, req.heroUrl);
  await uploadToMain(pinJpeg(req.heroUrl, "q_90"), {
    public_id: hero,
    overwrite: false,
    tags: ["s2s", "s2s-hero", skuTag(req.sku)],
    context: { scene: req.sceneSlug },
  });

  const spec: PackSpec = { hero, offer: req.offer, recolor: req.recolor?.map((h) => h.toLowerCase()), textZone: req.textZone };
  await addContext([raw.publicId], {
    hero,
    pack_hi: spec.offer?.hindi ?? "",
    pack_en: spec.offer?.english ?? "",
    pack_rc: (spec.recolor ?? []).join(","),
    pack_tz: spec.textZone ?? "",
  });

  const m = await materialise(req.sku, hero, buildAssets(req.sku, raw, spec), Math.max(1500, budgetMs - (Date.now() - t0)));
  return { sku: req.sku, heroPublicId: hero, assets: m.assets, pending: m.pending, failed: m.failed };
}

export async function packStatus(sku: Sku, budgetMs = 7000): Promise<PackStatusResponse & { failed: string[]; heroPublicId: string }> {
  const raw = await requireRaw(sku);
  const spec = specFromContext(raw.context);
  if (!spec) throw notFound("No channel pack has been started for this product.");
  const m = await materialise(sku, spec.hero, buildAssets(sku, raw, spec), budgetMs);
  return {
    heroPublicId: spec.hero,
    assets: m.assets,
    pending: m.pending,
    failed: m.failed,
    ...(m.pending.length === 0 ? { zipUrl: zipUrl(sku) } : {}),
  };
}
