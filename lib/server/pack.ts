import "server-only";
import { createHash } from "node:crypto";
import { v2 as cloudinary } from "cloudinary";
import type { PackRequest, PackResponse, PackStatusResponse } from "../api-contract";
import { channelAssets, packTags, type ProductBox } from "../transform/channels";
import { productId, type KitAsset, type SceneDNA, type Sku } from "../types";
import { assertLivePipeline } from "./budget";
import { deliveryBase, deliveryUrl, mainAuth, mainCloud, probe, removeTag, uploadToMain, type Ctx } from "./cld";
import { loadProduct, updateProduct, type PackDone, type ProductFacts } from "./facts";
import { notFound } from "./http";
import { pinJpeg } from "./guard";
import { isRawlessSample, prebuiltPackFor, prebuiltPackStatus } from "./prebuilt";
import { cutoutId, getCutout, skuTag } from "./products";

/**
 * Channel Pack: save the approved hero as its own asset, then materialise every
 * channel format (pure transformations from lib/transform/channels.ts) as a
 * tagged asset so one signed ZIP-by-tag URL downloads the whole pack.
 *
 * Stateless per request: the current pack spec lives in the product's facts
 * (ctx: hero, pack_hi, pack_en, pack_rc, pack_tz, pack_box; mirrored on the raw's
 * context) and so does the list of formats already materialised for that hero
 * (facts.pack.done, with a hash of each recipe). GET /api/pack/:sku rebuilds the
 * asset list from it and finishes whatever is still pending (AI formats answer
 * 423 while Cloudinary is still generating them). No Admin API call: this used
 * to be 2-3 Admin calls per request (resource + resources listing).
 *
 * Transformation savings, invisible to the user:
 *  - a finished format is returned by its materialised URL
 *    (f_auto,q_auto/v<version>/<pack id>, the exact URL the kit page uses), so the
 *    studio and /kit/<sku> share one set of display derivatives and a generative
 *    chain is never re-requested in a second format;
 *  - "feed" is the hero itself: it is copied from the stored hero (no derivation)
 *    instead of re-encoding it through f_jpg,q_auto;
 *  - a format whose recipe didn't change is never re-rendered (before, only the
 *    hero was compared, so an edited offer line kept the old text in the ZIP).
 */

export const packPrefix = (sku: Sku) => productId(sku, "pack/");
export const packId = (sku: Sku, id: string) => productId(sku, `pack/${id}`);
export const packTag = (sku: Sku) => `s2s-pack-${sku}`;

/** Hero ids carry a short hash of the source URL, so a re-staged hero never collides with cached derivatives of an older one. */
export function heroPublicId(sku: Sku, sceneSlug: string, heroUrl: string): string {
  const h = createHash("sha256").update(heroUrl).digest("hex").slice(0, 8);
  return productId(sku, `hero-${sceneSlug}-${h}`);
}

/** Short hash of a format's recipe URL: a changed offer line / swatch / crop means a different asset. */
export const recipeHash = (url: string) => createHash("sha256").update(url).digest("hex").slice(0, 10);

/** Delivery URL of a materialised format; identical to what lib/client/kit-loader builds for /kit/<sku>. */
export const materialisedUrl = (publicId: string, version: number) => `${deliveryBase()}/f_auto,q_auto/v${version}/${publicId}`;

interface PackSpec {
  hero: string;
  offer?: { hindi?: string; english?: string };
  recolor?: string[];
  textZone?: SceneDNA["text_zone"];
  productBox?: ProductBox;
}

function parseBox(s: string | undefined): ProductBox | undefined {
  const n = (s ?? "").split(",").map(Number);
  if (n.length !== 5 || n.some((v) => !Number.isInteger(v) || v < -2000 || v > 4000)) return undefined;
  const [px, py, pw, ph, baseY] = n;
  return { px, py, pw, ph, baseY };
}

function specFromContext(c: Ctx): PackSpec | null {
  if (!c.hero) return null;
  const offer = c.pack_hi || c.pack_en ? { hindi: c.pack_hi || undefined, english: c.pack_en || undefined } : undefined;
  return {
    hero: c.hero,
    offer,
    recolor: c.pack_rc ? c.pack_rc.split(",").filter((h) => /^[0-9a-f]{6}$/.test(h)) : undefined,
    textZone: (c.pack_tz as SceneDNA["text_zone"]) || undefined,
    productBox: parseBox(c.pack_box),
  };
}

function buildAssets(sku: Sku, ctx: Ctx, spec: PackSpec): KitAsset[] {
  return channelAssets({
    heroPublicId: spec.hero,
    cutoutPublicId: cutoutId(sku),
    alt: ctx.caption || ctx.u_name || "Product photo",
    recolorPart: ctx.u_part,
    swatches: spec.recolor,
    offer: spec.offer,
    textZone: spec.textZone,
    productBox: spec.productBox,
    cloud: mainCloud(),
  });
}

type Outcome = "done" | "pending" | "failed";

/** What the materialiser fetches: the stored hero itself for "feed", else the recipe pinned to JPEG. */
export function materialiseSource(asset: KitAsset, hero: string): string {
  return asset.id === "feed" ? deliveryUrl(hero) : pinJpeg(asset.url);
}

/**
 * The asset as the client should show it once saved. Formats delivered with
 * f_auto switch to the materialised copy; the rest (marketplace: f_jpg) keep the
 * recipe URL, which is exactly the derivative the materialiser fetched.
 */
export function finishedAsset(asset: KitAsset, publicId: string, version: number): KitAsset {
  return /(^|[/,])f_auto(?=[,/])/.test(asset.url) && version > 0 ? { ...asset, publicId, url: materialisedUrl(publicId, version) } : { ...asset, publicId };
}

/** Formats already materialised for this hero whose recipe is unchanged (pure; unit-tested). */
export function reusableDone(facts: Pick<ProductFacts, "pack">, hero: string, assets: KitAsset[]): { done: Record<string, PackDone>; stale: string[] } {
  const prev = facts.pack;
  const wanted = new Map(assets.map((a) => [a.id, recipeHash(a.url)]));
  const done: Record<string, PackDone> = {};
  const stale: string[] = [];
  if (!prev) return { done, stale };
  for (const [id, d] of Object.entries(prev.done)) {
    const same = prev.hero === hero && wanted.has(id) && (!d.h || d.h === wanted.get(id));
    if (same) done[id] = d;
    else stale.push(id);
  }
  return { done, stale };
}

/**
 * Materialise what isn't saved yet, within a time budget. Formats already saved
 * for the current hero + recipe are skipped; formats from an older pack lose
 * the pack tag so they drop out of the ZIP.
 */
async function materialise(
  sku: Sku,
  hero: string,
  assets: KitAsset[],
  budgetMs: number,
  facts: ProductFacts,
): Promise<{ assets: KitAsset[]; pending: string[]; failed: string[] }> {
  const deadline = Date.now() + budgetMs;
  const { done, stale } = reusableDone(facts, hero, assets);
  if (stale.length) {
    await removeTag(
      stale.map((id) => packId(sku, id)),
      packTag(sku),
    ).catch((err: unknown) => console.warn(`[pack] ${sku}: stale tag removal failed: ${String((err as Error)?.message ?? err).slice(0, 120)}`));
  }

  const fresh: Record<string, PackDone> = {};
  const results = await Promise.all(
    assets.map(async (asset): Promise<[KitAsset, Outcome]> => {
      const pid = packId(sku, asset.id);
      const have = done[asset.id];
      if (have) return [finishedAsset(asset, pid, have.v), "done"];
      const src = materialiseSource(asset, hero);
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
      fresh[asset.id] = { v: up.version, at: Date.now(), h: recipeHash(asset.url) };
      return [finishedAsset(asset, up.publicId, up.version), "done"];
    }),
  );

  if (Object.keys(fresh).length || stale.length) {
    await updateProduct(
      sku,
      {
        mutate: (f) => {
          const keep = f.pack?.hero === hero ? f.pack.done : {};
          for (const id of stale) delete keep[id];
          f.pack = { hero, done: { ...keep, ...done, ...fresh } };
        },
      },
      { critical: false }, // worst case a later poll re-uploads an already-derived format
    );
  }
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
  const prebuilt = prebuiltPackFor(req.sku, req.heroUrl);
  if (prebuilt) return { sku: req.sku, heroPublicId: prebuilt.heroPublicId, assets: prebuilt.assets, pending: [], failed: prebuilt.failed };

  const p = await loadProduct(req.sku);
  const cutout = await getCutout(req.sku, p);
  if (!cutout) throw notFound("Cut out the product first.");

  const hero = heroPublicId(req.sku, req.sceneSlug, req.heroUrl);
  const spec: PackSpec = { hero, offer: req.offer, recolor: req.recolor?.map((h) => h.toLowerCase()), textZone: req.textZone, productBox: req.productBox };
  const assets = buildAssets(req.sku, p.facts.ctx, spec);
  const { done } = reusableDone(p.facts, hero, assets);
  const known = p.facts.heroes?.[hero];
  // New derivatives ahead (hero composite, gen fill, recolor…): respect the credit floor.
  if (!known || assets.some((a) => !done[a.id])) await assertLivePipeline();

  let heroFacts = known;
  if (!heroFacts) {
    const up = await uploadToMain(pinJpeg(req.heroUrl, "q_90"), {
      public_id: hero,
      overwrite: false,
      tags: ["s2s", "s2s-hero", skuTag(req.sku)],
      context: { scene: req.sceneSlug },
    });
    heroFacts = { publicId: hero, width: up.width, height: up.height, version: up.version, bytes: up.bytes, at: Date.now() };
  }

  // Critical: GET /api/pack/:sku reads the spec back from here.
  const facts = await updateProduct(req.sku, {
    ctx: {
      hero,
      pack_hi: spec.offer?.hindi ?? "",
      pack_en: spec.offer?.english ?? "",
      pack_rc: (spec.recolor ?? []).join(","),
      pack_tz: spec.textZone ?? "",
      pack_box: spec.productBox ? [spec.productBox.px, spec.productBox.py, spec.productBox.pw, spec.productBox.ph, spec.productBox.baseY].join(",") : "",
    },
    mutate: (f) => void ((f.heroes ??= {})[hero] ??= heroFacts),
  });

  const m = await materialise(req.sku, hero, assets, Math.max(1500, budgetMs - (Date.now() - t0)), facts ?? p.facts);
  return { sku: req.sku, heroPublicId: hero, assets: m.assets, pending: m.pending, failed: m.failed };
}

export async function packStatus(sku: Sku, budgetMs = 7000): Promise<PackStatusResponse & { failed: string[]; heroPublicId: string }> {
  if (isRawlessSample(sku)) {
    // Prebuilt sample without a raw upload: nothing is (or can be) materialised under its sku, so no ZIP link.
    const s = prebuiltPackStatus(sku);
    if (s) return { heroPublicId: s.heroPublicId, assets: s.assets, pending: [], failed: s.failed };
  }
  const p = await loadProduct(sku);
  const spec = specFromContext(p.facts.ctx);
  if (!spec) throw notFound("No channel pack has been started for this product.");
  const shown = prebuiltPackStatus(sku, spec.hero); // showcase kit whose pack is still the prebuilt one
  if (shown) return { heroPublicId: shown.heroPublicId, assets: shown.assets, pending: [], failed: shown.failed, zipUrl: zipUrl(sku) };

  const m = await materialise(sku, spec.hero, buildAssets(sku, p.facts.ctx, spec), budgetMs, p.facts);
  return {
    heroPublicId: spec.hero,
    assets: m.assets,
    pending: m.pending,
    failed: m.failed,
    ...(m.pending.length === 0 ? { zipUrl: zipUrl(sku) } : {}),
  };
}
