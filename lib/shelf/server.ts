import "server-only";
import { v2 as cloudinary, type ResourceApiResponse } from "cloudinary";
import { sceneFromListResource, SCENE_TAG } from "../scenes";
import { heroPublicId } from "../server/pack";
import { addContext, addTags, getResource, listByPrefix, mainAuth, mainCloud, removeTag, toAssetInfo, uploadToMain, type AssetInfo } from "../server/cld";
import { pinJpeg } from "../server/guard";
import { badRequest, HttpError, notFound } from "../server/http";
import { cutoutRecord, skuTag, understandingFromContext } from "../server/products";
import { compositeUrl, defaultControls, geometry, quantise, type CompositeInput, type Geometry } from "../transform/composite";
import { PLATE, productId, type BuiltUrl, type CompositeControls, type KitAsset, type Placement, type Scene, type SceneDNA, type Sku } from "../types";
import { adminSafe, listByTag } from "./cloud";
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

const isRateLimited = (err: unknown) => err instanceof HttpError && err.status === 503;

/**
 * Everything under snap2shelf/products/<sku>/ in one call.
 *   "admin" (writes: collection, publish): fresh Admin API listing; falls back to the CDN list when rate-limited.
 *   "list"  (reads: readiness): CDN list of tag s2s-sku-<sku> (<=60 s old, no Admin quota); Admin API when it's missing.
 */
export async function productAssets(sku: Sku, source: "admin" | "list" = "admin"): Promise<ProductAssets> {
  const leaf = (a: AssetInfo) => a.publicId.slice(productId(sku, "").length);
  const fromList = async () => (await listByTag(skuTag(sku), 0).catch(() => null))?.filter((a) => a.publicId.startsWith(productId(sku, ""))) ?? null;
  const fromAdmin = () => adminSafe(() => listByPrefix(productId(sku, "")));
  let all: AssetInfo[] | null = null;
  if (source === "list") {
    all = await fromList();
    if (!all?.some((a) => leaf(a) === "raw")) all = await fromAdmin();
  } else {
    try {
      all = await fromAdmin();
    } catch (err) {
      if (!isRateLimited(err)) throw err;
      all = await fromList();
      if (!all) throw err;
    }
  }
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
  // the scene library is on the CDN list (same source as GET /api/scenes); Admin API only if it's missing there
  const listed = (await listByTag(SCENE_TAG).catch(() => null))?.find((s) => s.publicId === scenePublicId);
  const a = listed ? { ...listed, tags: [SCENE_TAG] } : await adminSafe(() => getResource(scenePublicId));
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
      let p = await productAssets(sku, "list");
      if (!p.cutout) p = await productAssets(sku, "admin"); // a cutout made seconds ago may not be listed yet
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
        url: heroUrl(hero, PLATE.width, { version: saved.version, cloud }),
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

/** "silver", "stainless steel" → "Silver · stainless steel" (drops a colour the material already says). */
export function productFacts(color: string, material: string): string {
  const c = color.trim().toLowerCase();
  const m = material.trim().toLowerCase();
  const parts = [c && !m.includes(c) ? c : "", m].filter(Boolean);
  const s = parts.join(" · ");
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

async function heroesByTag(tag: string): Promise<AssetInfo[]> {
  const res = (await adminSafe(() =>
    cloudinary.api.resources_by_tag(tag, {
      ...mainAuth(),
      resource_type: "image",
      context: true,
      tags: true,
      max_results: 100,
    }),
  )) as ResourceApiResponse;
  return (res.resources as unknown as Parameters<typeof toAssetInfo>[0][]).map(toAssetInfo);
}

/** A hero already on a shelf: its public id and the product it belongs to. */
export interface ShelfMember {
  publicId: string;
  sku: string;
}

export const memberSku = (a: Pick<AssetInfo, "publicId" | "context">) => a.context.sku || a.publicId.split("/")[2] || "";

export interface PublishOptions {
  /**
   * Called with the shelf's current members once they are read and before anything
   * is written; throw to refuse (POST /api/shelf: reserved / taken shelves, lib/server/protect.ts).
   */
  authorize?: (members: ShelfMember[]) => void | Promise<void>;
  /**
   * Called once the publish has something to write (at least one hero), right before the
   * first write; throw to refuse. POST /api/shelf claims a new shelf name here (atomic lock,
   * lib/server/locks.ts), so a publish that would write nothing never reserves a name.
   */
  beforeWrite?: () => Promise<void>;
}

export async function publishShelf(req: ShelfRequest, opts: PublishOptions = {}): Promise<ShelfResponse> {
  const shopCheck = checkShop(req.shop);
  if (!shopCheck.ok) throw badRequest(shopCheck.reason);
  const shop = shopCheck.shop;
  const title = clean(req.title, 60);
  if (!title) throw badRequest("Give the shelf a title.");
  const tagline = req.tagline ? clean(req.tagline, 90) : "";
  const skus = [...new Set(req.skus)];
  if (skus.length < 1 || skus.length > 12) throw badRequest("A shelf holds 1 to 12 products.");

  // Reads come from the CDN lists (no Admin API quota). Tags and context are written with the Upload API.
  const [products, members] = await Promise.all([
    Promise.all(skus.map((s) => productAssets(s, "list"))),
    listByTag(shopTag(shop), 0)
      .then((l) => l ?? [])
      .catch(() => heroesByTag(shopTag(shop))),
  ]);
  await opts.authorize?.(members.map((m) => ({ publicId: m.publicId, sku: memberSku(m) })));

  const keys = shopContextKeys(shop);
  const items: ShelfResponse["items"] = [];
  const skipped: ShelfResponse["skipped"] = [];
  const writes: (() => Promise<unknown>)[] = [];
  let order = 0;
  for (const p of products) {
    if (!p.raw) {
      skipped.push({ sku: p.sku, reason: "No upload found for this product." });
      continue;
    }
    const explicit = req.heroes?.[p.sku];
    const hero: AssetInfo | null = explicit
      ? (p.heroes.find((h) => h.publicId === explicit) ?? { ...(currentHero(p) ?? p.raw), publicId: explicit, context: {} })
      : currentHero(p);
    if (!hero) {
      skipped.push({ sku: p.sku, reason: "Stage and save a hero first." });
      continue;
    }
    const u = understandingFromContext(p.raw.context);
    const geo = hero.context.geo || (p.raw.context.hero === hero.publicId ? p.raw.context.pack_box?.split(",").slice(0, 4).join(",") : "");
    const ctx = {
      sku: p.sku,
      name: u?.name ?? hero.context.name ?? "Product",
      caption: p.raw.context.caption ?? "",
      facts: u ? productFacts(u.primary_color, u.material) : "",
      ...(geo ? { geo } : {}),
      [keys.title]: title,
      [keys.order]: String(order++),
      [keys.tagline]: tagline,
    };
    writes.push(() => addContext([hero.publicId], ctx));
    items.push({ sku: p.sku, heroPublicId: hero.publicId });
  }
  if (!items.length) throw badRequest("None of these products has a saved hero yet.");
  await opts.beforeWrite?.();

  const keep = new Set(items.map((i) => i.heroPublicId));
  const removed = members.map((m) => m.publicId).filter((id) => !keep.has(id));
  await Promise.all([...writes.map((w) => w()), addTags([...keep], [shopTag(shop)]), removeTag(removed, shopTag(shop))]);

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
      sku: memberSku(a),
      heroPublicId: a.publicId,
      version: a.version,
      width: a.width || PLATE.width,
      height: a.height || PLATE.height,
      name: a.context.name || "Product",
      caption: a.context.caption || "",
      facts: a.context.facts || undefined,
      scene: a.context.scene || undefined,
      order: Number(a.context[keys.order] ?? 99),
      geo: boxFromString(a.context.geo),
    }))
    .sort((a, b) => a.order - b.order || a.heroPublicId.localeCompare(b.heroPublicId));
  if (!items.length) return null;
  const first = assets.find((a) => a.publicId === items[0].heroPublicId)!;
  return { shop, title: first.context[keys.title], tagline: first.context[keys.tagline] || undefined, items };
}

/**
 * The shelf as the storefront renders it; null when nothing carries the tag.
 * Reads the CDN list (no Admin API quota, so visitors can never exhaust it);
 * the Admin API is only a fallback when the list itself fails.
 */
export async function getShelf(shop: string): Promise<Shelf | null> {
  if (!checkShop(shop).ok) return null;
  let assets: AssetInfo[];
  try {
    assets = (await listByTag(shopTag(shop))) ?? [];
  } catch (err) {
    console.error(`[shelf] list JSON failed, using the Admin API: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
    assets = await heroesByTag(shopTag(shop));
  }
  return shelfFromAssets(shop, assets);
}

/** Tiny blurred JPEG as a data URI (immutable per version, so cache it hard). */
export async function lqipDataUri(publicId: string, version?: number, geo?: PlateBox): Promise<string | undefined> {
  try {
    const res = await fetch(lqipUrl(publicId, { version, geo, cloud: mainCloud() }), { next: { revalidate: 86_400 } });
    if (!res.ok) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length < 4096 ? `data:image/jpeg;base64,${buf.toString("base64")}` : undefined;
  } catch {
    return undefined;
  }
}

export function shelfOgImage(shelf: Shelf): string {
  return shelfOg(shelf).url;
}

export function shelfOg(shelf: Shelf) {
  return ogCollageUrl({
    title: shelf.title,
    tagline: shelf.tagline,
    heroes: shelf.items.slice(0, 4).map((i) => ({ publicId: i.heroPublicId, geo: i.geo })),
    count: shelf.items.length,
    cloud: mainCloud(),
  });
}
