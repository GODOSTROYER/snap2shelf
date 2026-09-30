import "server-only";
import { v2 as cloudinary, type ResourceApiResponse } from "cloudinary";
import { sceneFromListResource, SCENE_TAG } from "../scenes";
import { heroPublicId } from "../server/pack";
import { addContext, addTags, getResource, listByPrefix, mainAuth, mainCloud, removeTag, toAssetInfo, uploadToMain, type AssetInfo } from "../server/cld";
import { pinJpeg } from "../server/guard";
import { badRequest, notFound } from "../server/http";
import { cutoutRecord, skuTag, understandingFromContext } from "../server/products";
import { compositeUrl, defaultControls, geometry, quantise, type CompositeInput, type Geometry } from "../transform/composite";
import { PLATE, productId, type BuiltUrl, type CompositeControls, type KitAsset, type Placement, type Scene, type SceneDNA, type Sku } from "../types";
import { heroUrl, lqipUrl } from "./images";
import { ogCollageUrl } from "./og";
import { checkShop, shelfPath, shopContextKeys, shopTag } from "./slug";
import type { CollectionItem, CollectionRequest, CollectionResponse, PlateBox, Shelf, ShelfItem, ShelfRequest, ShelfResponse } from "./types";

/**
 * Collection mode + Shelf, on the existing pipeline helpers (lib/server/*).
 * No database: a shelf is a tag on heroes; its facts live in hero context.
 */

export const SCENE_ID_RE = /^snap2shelf\/scenes\/[a-z0-9-]{1,40}\/[a-z0-9-]{1,60}$/;

type ListResource = Parameters<typeof sceneFromListResource>[0];

// ------------------------------------------------------------------ product lookup

interface ProductAssets {
  sku: Sku;
  raw: AssetInfo | null;
  cutout: AssetInfo | null;
  heroes: AssetInfo[]; // newest first
  all: AssetInfo[];
}

/** Everything under snap2shelf/products/<sku>/ in ONE Admin API call. */
export async function productAssets(sku: Sku): Promise<ProductAssets> {
  const all = await listByPrefix(productId(sku, ""));
  const leaf = (a: AssetInfo) => a.publicId.slice(productId(sku, "").length);
  return {
    sku,
    all,
    raw: all.find((a) => leaf(a) === "raw") ?? null,
    cutout: all.find((a) => leaf(a) === "cutout") ?? null,
    heroes: all.filter((a) => leaf(a).startsWith("hero-")).sort((a, b) => b.version - a.version),
  };
}

/** The product's current hero: the one named in the raw asset's context, else the newest saved one. */
export function currentHero(p: ProductAssets): AssetInfo | null {
  const named = p.raw?.context.hero;
  return (named && p.heroes.find((h) => h.publicId === named)) || p.heroes[0] || null;
}

export const boxToString = (b: PlateBox) => [b.px, b.py, b.pw, b.ph].join(",");

export function boxFromString(s: string | undefined): PlateBox | undefined {
  const n = (s ?? "").split(",").map(Number);
  if (n.length < 4 || n.slice(0, 4).some((v) => !Number.isFinite(v))) return undefined;
  const [px, py, pw, ph] = n;
  return pw > 0 && ph > 0 ? { px, py, pw, ph } : undefined;
}

// ------------------------------------------------------------------ collection mode

/**
 * The Exact-mode builder collection mode stages with. Injectable so a script can
 * render with another builder version; defaults to lib/transform/composite.ts.
 * defaultControls takes the cutout as an optional 3rd argument (newer builders size by shape).
 */
export interface CompositeKit {
  compositeUrl: (input: CompositeInput) => BuiltUrl;
  defaultControls: (placement: Placement, dna: SceneDNA, cutout?: { width: number; height: number }) => CompositeControls;
  geometry: (cutout: { width: number; height: number }, dna: SceneDNA, c: CompositeControls, placement: Placement) => Geometry;
  quantise: (c: CompositeControls) => CompositeControls;
}
export const defaultKit: CompositeKit = { compositeUrl, defaultControls, geometry, quantise };

/** Visual weight every product gets on the plate, as a share of the plate area. */
export const COLLECTION_AREA = { standing: 0.13, flatlay: 0.2 } as const;
/** Caps on the product box, as a share of the plate side. */
export const COLLECTION_MAX = { height: 0.52, width: 0.6 } as const;

/**
 * Pick the scale that gives this product the collection's target area (so a
 * tall bottle and a long shoe read as the same size on the shelf). Searches the
 * slider's own steps through geometry(), so it stays true to whatever
 * geometry() the composite builder uses.
 */
export function collectionScale(
  cutout: { width: number; height: number },
  dna: Scene["dna"],
  placement: Placement,
  base: CompositeControls,
  targetArea: number,
  kit: CompositeKit = defaultKit,
): number {
  let best = base.scale;
  let bestErr = Infinity;
  const maxH = PLATE.height * COLLECTION_MAX.height;
  const maxW = PLATE.width * COLLECTION_MAX.width;
  for (let s = 0.2; s <= 0.8001; s += 0.02) {
    const c = kit.quantise({ ...base, scale: s });
    const g = kit.geometry(cutout, dna, c, placement);
    // very tall or very long products stop at the caps instead of towering over the set
    const over = Math.max(0, g.ph - maxH) + Math.max(0, g.pw - maxW);
    const err = Math.abs(g.pw * g.ph - targetArea) + over * 10_000;
    if (err < bestErr) {
      bestErr = err;
      best = c.scale;
    }
  }
  return best;
}

async function loadScene(scenePublicId: string): Promise<Scene> {
  if (!SCENE_ID_RE.test(scenePublicId)) throw badRequest("Pick a scene from the library.");
  const a = await getResource(scenePublicId);
  if (!a || !a.tags.includes(SCENE_TAG)) throw notFound("That scene isn't in the library.");
  const scene = sceneFromListResource({ public_id: a.publicId, context: { custom: a.context } } as ListResource);
  if (!scene) throw notFound("That scene has no Scene DNA yet.");
  return scene;
}

const sceneSlugOf = (scenePublicId: string) => scenePublicId.replace(/^snap2shelf\/scenes\//, "").replace(/\//g, "-").slice(0, 40);

export async function stageCollection(req: CollectionRequest, kit: CompositeKit = defaultKit): Promise<CollectionResponse> {
  const t0 = Date.now();
  const skus = [...new Set(req.skus)];
  if (skus.length < 2 || skus.length > 6) throw badRequest("A collection needs 2 to 6 products.");
  const scene = await loadScene(req.scenePublicId);
  const placement: Placement = scene.view === "top-down" ? "flatlay" : "standing";
  const targetArea = Math.round(PLATE.width * PLATE.height * COLLECTION_AREA[placement]);
  const sceneSlug = sceneSlugOf(scene.publicId);
  const cloud = mainCloud();

  const results = await Promise.allSettled(
    skus.map(async (sku): Promise<CollectionItem> => {
      const p = await productAssets(sku);
      if (!p.raw) throw notFound("No upload found for this product.");
      if (!p.cutout) throw notFound("Cut out this product first.");
      const cutout = cutoutRecord(p.cutout);
      const u = understandingFromContext(p.raw.context);
      const base = kit.defaultControls(placement, scene.dna, cutout);
      const controls = { ...base, scale: collectionScale(cutout, scene.dna, placement, base, targetArea, kit) };
      const built = kit.compositeUrl({ scenePublicId: scene.publicId, dna: scene.dna, cutout, placement, controls, cloud });
      const g = kit.geometry(cutout, scene.dna, kit.quantise(controls), placement);
      const geo: PlateBox = { px: g.px, py: g.py, pw: g.pw, ph: g.ph };

      const hero = heroPublicId(sku, sceneSlug, built.url);
      const saved = await uploadToMain(pinJpeg(built.url, "q_90"), {
        public_id: hero,
        overwrite: false,
        tags: ["s2s", "s2s-hero", "s2s-collection", skuTag(sku)],
        context: { scene: sceneSlug, geo: boxToString(geo), name: u?.name ?? "", caption: p.raw.context.caption ?? "", sku },
      });
      // The collection hero becomes the product's current hero (what the shelf and GET /api/pack use).
      // pack_box uses the pack's "px,py,pw,ph,baseY" format so offer text and crops avoid the product.
      await addContext([p.raw.publicId], { hero, pack_box: [g.px, g.py, g.pw, g.ph, g.baseY].join(",") });

      const asset: KitAsset = {
        id: "hero",
        format: "hero",
        label: u?.name ?? "Hero",
        url: heroUrl(hero, PLATE.width, saved.version, cloud),
        width: PLATE.width,
        height: PLATE.height,
        frame: "feed-post",
        alt: p.raw.context.caption || u?.name || "Product photo",
        xray: built,
        publicId: hero,
      };
      return { sku, name: u?.name ?? "Product", hero: asset, geo };
    }),
  );

  const items: CollectionItem[] = [];
  const failed: CollectionResponse["failed"] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(r.value);
    else {
      const e = r.reason as { publicMessage?: string; message?: string };
      console.error(`[collection] ${skus[i]}: ${String(e?.message ?? r.reason).slice(0, 200)}`);
      failed.push({ sku: skus[i], error: e?.publicMessage ?? "Couldn't stage this product." });
    }
  });
  return {
    scene: { publicId: scene.publicId, title: scene.title, theme: scene.theme, dna: scene.dna },
    consistency: {
      lightAzimuth: Math.round(scene.dna.light_azimuth),
      lightElevation: Math.round(scene.dna.light_elevation),
      baselineY: Math.round(scene.dna.anchor_y * PLATE.height),
      targetArea,
    },
    items,
    failed,
    ms: Date.now() - t0,
  };
}

// ------------------------------------------------------------------ shelf

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

async function heroesByTag(tag: string): Promise<AssetInfo[]> {
  const res = (await cloudinary.api.resources_by_tag(tag, {
    ...mainAuth(),
    resource_type: "image",
    context: true,
    tags: true,
    max_results: 100,
  })) as ResourceApiResponse;
  return (res.resources as unknown as Parameters<typeof toAssetInfo>[0][]).map(toAssetInfo);
}

export async function publishShelf(req: ShelfRequest): Promise<ShelfResponse> {
  const shopCheck = checkShop(req.shop);
  if (!shopCheck.ok) throw badRequest(shopCheck.reason);
  const shop = shopCheck.shop;
  const title = clean(req.title, 60);
  if (!title) throw badRequest("Give the shelf a title.");
  const tagline = req.tagline ? clean(req.tagline, 90) : "";
  const skus = [...new Set(req.skus)];
  if (skus.length < 1 || skus.length > 12) throw badRequest("A shelf holds 1 to 12 products.");

  const [products, members] = await Promise.all([Promise.all(skus.map(productAssets)), heroesByTag(shopTag(shop)).catch(() => [] as AssetInfo[])]);

  const keys = shopContextKeys(shop);
  const items: ShelfResponse["items"] = [];
  const skipped: ShelfResponse["skipped"] = [];
  const writes: Promise<unknown>[] = [];
  let order = 0;
  for (const p of products) {
    if (!p.raw) {
      skipped.push({ sku: p.sku, reason: "No upload found for this product." });
      continue;
    }
    const hero = currentHero(p);
    if (!hero) {
      skipped.push({ sku: p.sku, reason: "Stage and save a hero first." });
      continue;
    }
    const u = understandingFromContext(p.raw.context);
    const geo = hero.context.geo || (p.raw.context.hero === hero.publicId ? p.raw.context.pack_box?.split(",").slice(0, 4).join(",") : "");
    writes.push(
      addContext([hero.publicId], {
        sku: p.sku,
        name: u?.name ?? hero.context.name ?? "Product",
        caption: p.raw.context.caption ?? "",
        ...(geo ? { geo } : {}),
        [keys.title]: title,
        [keys.order]: String(order++),
        [keys.tagline]: tagline,
      }),
    );
    items.push({ sku: p.sku, heroPublicId: hero.publicId });
  }
  if (!items.length) throw badRequest("None of these products has a saved hero yet.");

  const keep = new Set(items.map((i) => i.heroPublicId));
  const removed = members.map((m) => m.publicId).filter((id) => !keep.has(id));
  await Promise.all([...writes, addTags([...keep], [shopTag(shop)]), removeTag(removed, shopTag(shop))]);

  const heroes = items.slice(0, 4).map((i) => {
    const h = products.find((p) => p.sku === i.sku)?.heroes.find((x) => x.publicId === i.heroPublicId);
    return { publicId: i.heroPublicId, geo: boxFromString(h?.context.geo || undefined) };
  });
  const og = ogCollageUrl({ title, tagline: tagline || undefined, heroes, count: items.length, cloud: mainCloud() });
  return { shop, url: shelfPath(shop), ogImage: og.url, items, skipped, removed };
}

function shelfFromAssets(shop: string, assets: AssetInfo[]): Shelf | null {
  const keys = shopContextKeys(shop);
  const items: ShelfItem[] = assets
    .filter((a) => a.context[keys.title])
    .map((a) => ({
      sku: a.context.sku || a.publicId.split("/")[2] || "",
      heroPublicId: a.publicId,
      version: a.version,
      width: a.width || PLATE.width,
      height: a.height || PLATE.height,
      name: a.context.name || "Product",
      caption: a.context.caption || "",
      order: Number(a.context[keys.order] ?? 99),
      geo: boxFromString(a.context.geo),
    }))
    .sort((a, b) => a.order - b.order || a.heroPublicId.localeCompare(b.heroPublicId));
  if (!items.length) return null;
  const first = assets.find((a) => a.publicId === items[0].heroPublicId)!;
  return { shop, title: first.context[keys.title], tagline: first.context[keys.tagline] || undefined, items };
}

/** Fallback when the Admin API is rate-limited: the public list JSON (CDN-cached ~60 s). */
async function heroesFromListJson(shop: string): Promise<AssetInfo[]> {
  const res = await fetch(`https://res.cloudinary.com/${mainCloud()}/image/list/${shopTag(shop)}.json`, { next: { revalidate: 60 } });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`shelf list HTTP ${res.status}`);
  const json = (await res.json()) as { resources?: { public_id: string; version?: number; width?: number; height?: number; format?: string; context?: { custom?: Record<string, string> } }[] };
  return (json.resources ?? []).map((r) => toAssetInfo(r));
}

/** The shelf as the storefront renders it; null when nothing carries the tag. */
export async function getShelf(shop: string): Promise<Shelf | null> {
  if (!checkShop(shop).ok) return null;
  let assets: AssetInfo[];
  try {
    assets = await heroesByTag(shopTag(shop));
  } catch (err) {
    console.error(`[shelf] admin lookup failed, using list JSON: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
    assets = await heroesFromListJson(shop);
  }
  return shelfFromAssets(shop, assets);
}

/** Tiny blurred JPEG as a data URI (immutable per version, so cache it hard). */
export async function lqipDataUri(publicId: string, version?: number): Promise<string | undefined> {
  try {
    const res = await fetch(lqipUrl(publicId, version, mainCloud()), { next: { revalidate: 86_400 } });
    if (!res.ok) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length < 4096 ? `data:image/jpeg;base64,${buf.toString("base64")}` : undefined;
  } catch {
    return undefined;
  }
}

export function shelfOgImage(shelf: Shelf): string {
  return ogCollageUrl({
    title: shelf.title,
    tagline: shelf.tagline,
    heroes: shelf.items.slice(0, 4).map((i) => ({ publicId: i.heroPublicId, geo: i.geo })),
    count: shelf.items.length,
    cloud: mainCloud(),
  }).url;
}
