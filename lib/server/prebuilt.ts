import "server-only";
import { SAMPLES, getShowcaseKit as sampleKitFor } from "../showcase";
import { SHOWCASE } from "../showcase-data";
import type { KitAsset, QaResult, Sku } from "../types";
import { pinJpeg } from "./guard";

/**
 * Answers for the sample / showcase products straight from the prebuilt data
 * (lib/showcase.ts, data/showcase.json): zero Cloudinary API calls, zero new
 * transformations, zero AI Vision tokens. Every URL in there is already
 * derived on the main cloud.
 *
 *  - sample products without a raw upload (lib/showcase SAMPLES, e.g. sneaker1)
 *    always get their prebuilt pack: a live pack is impossible for them anyway
 *    (it used to answer 404 "No upload found").
 *  - showcase kits (data/showcase.json) get their prebuilt pack / QA verdict when
 *    the request is for the composite they were built from; anything the visitor
 *    changed runs live like any other product.
 */

/** Same composite, whatever format/quality the caller asked for (f_auto vs f_jpg,q_90). */
const norm = (url: string) => pinJpeg(url, "q_90");

export interface PrebuiltPack {
  heroPublicId: string;
  assets: KitAsset[];
  failed: string[];
}

/**
 * Sample product with no raw upload (live pipeline impossible). SAMPLES also lists the seeded
 * showcase kits, which DO have raw uploads — those only short-circuit for their own composite.
 */
export const isRawlessSample = (sku: Sku) =>
  SAMPLES.some((s) => s.sku === sku) && !SHOWCASE.kits.some((k) => k.sku === sku);

function samplePack(sku: Sku): PrebuiltPack | null {
  const kit = isRawlessSample(sku) ? sampleKitFor(sku) : undefined;
  if (!kit?.hero.publicId) return null;
  return { heroPublicId: kit.hero.publicId, assets: kit.assets.filter((a) => a.format !== "hero"), failed: [] };
}

const showcaseKit = (sku: Sku) => SHOWCASE.kits.find((k) => k.sku === sku);

/** POST /api/pack: the prebuilt pack when the hero is the one it was built from (always, for raw-less samples). */
export function prebuiltPackFor(sku: Sku, heroUrl: string): PrebuiltPack | null {
  const sample = samplePack(sku);
  if (sample) return sample;
  const kit = showcaseKit(sku);
  if (!kit?.hero.publicId) return null;
  const approved = kit.attempts.filter((a) => a.qa.status === "approved").map((a) => norm(a.url));
  if (!approved.includes(norm(heroUrl))) return null;
  return { heroPublicId: kit.hero.publicId, assets: kit.assets.filter((a) => a.format !== "hero"), failed: kit.packFailed ?? [] };
}

/** GET /api/pack/:sku: raw-less samples always; showcase kits when their current pack is still the prebuilt one. */
export function prebuiltPackStatus(sku: Sku, currentHero?: string): PrebuiltPack | null {
  const sample = samplePack(sku);
  if (sample) return sample;
  const kit = showcaseKit(sku);
  if (!kit?.hero.publicId || (currentHero !== undefined && currentHero !== kit.hero.publicId)) return null;
  return { heroPublicId: kit.hero.publicId, assets: kit.assets.filter((a) => a.format !== "hero"), failed: kit.packFailed ?? [] };
}

/** The real AI Vision verdict recorded when the showcase was built, for exactly this composite. */
export function prebuiltQa(url: string): QaResult | null {
  const n = norm(url);
  for (const kit of SHOWCASE.kits) {
    for (const a of kit.attempts) if (norm(a.url) === n) return a.qa;
  }
  return null;
}
