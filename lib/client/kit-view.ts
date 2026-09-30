/**
 * View-model helpers for showing a Kit: shelf grouping, X-ray colours, the
 * mock storefront copy inside frames. Pure and server-safe.
 */
import { deliveryBase } from "../transform/composite";
import { XRAY_KINDS } from "../transform/xray";
import type { Kit, KitAsset, XraySegment } from "../types";

/** CSS colour for an X-ray segment kind: the theme token, with the module's swatch as fallback. */
export const xrayColor = (kind: XraySegment["kind"]) => `var(${XRAY_KINDS[kind].token}, ${XRAY_KINDS[kind].swatch})`;

export type ShelfItem =
  | { kind: "asset"; key: string; asset: KitAsset }
  | { kind: "reel"; key: string; asset: KitAsset; src: string; poster: string };

export interface ShelfGroup {
  id: string;
  title: string;
  items: ShelfItem[];
}

const SOCIAL = new Set(["story", "feed", "offer"]);
const SHOP = new Set(["marketplace", "whatsapp", "banner"]);

/** First clip of a reel (the asset its .mp4 leaf names), as a poster frame. */
export function reelPoster(kit: Kit, w = 360) {
  const leaf = kit.reel?.xray.segments.find((s) => s.kind === "asset")?.text.replace(/\.mp4$/, "");
  const id = leaf ?? kit.hero.publicId ?? kit.product.rawPublicId;
  const cloud = /res\.cloudinary\.com\/([^/]+)\//.exec(kit.reel?.url ?? kit.hero.url)?.[1];
  return `${deliveryBase(cloud)}/c_fill,w_720,h_1280,g_center/c_scale,w_${w}/f_auto,q_auto/${id}`;
}

/** Pseudo-asset for the reel so it can sit in a frame like everything else. */
export function reelAsset(kit: Kit): ShelfItem | null {
  if (!kit.reel) return null;
  return {
    kind: "reel",
    key: "reel",
    src: kit.reel.url,
    poster: reelPoster(kit),
    asset: {
      id: "reel",
      format: "story",
      label: `Kit Reel, ${Math.round(kit.reel.seconds)} s`,
      url: kit.reel.url,
      width: 720,
      height: 1280,
      frame: "story",
      alt: `Short video of ${kit.hero.alt.charAt(0).toLowerCase()}${kit.hero.alt.slice(1)}`,
      xray: kit.reel.xray,
    },
  };
}

export function shelvesFor(kit: Kit): ShelfGroup[] {
  const social: ShelfItem[] = [];
  const shop: ShelfItem[] = [];
  const variants: ShelfItem[] = [];
  const reel = reelAsset(kit);
  if (reel) social.push(reel);
  for (const a of kit.assets) {
    const item: ShelfItem = { kind: "asset", key: a.id, asset: a };
    if (SOCIAL.has(a.format) && !a.id.startsWith("creative")) social.push(item);
    else if (SHOP.has(a.format)) shop.push(item);
    else variants.push(item);
  }
  // story next to the reel, then the posts
  social.sort((x, y) => rank(x) - rank(y));
  shop.sort((x, y) => rank(x) - rank(y));
  return [
    { id: "social", title: "For social", items: social },
    { id: "shop", title: "For shops and chats", items: shop },
    { id: "variants", title: "Colour and creative variants", items: variants },
  ].filter((g) => g.items.length > 0);
}

const ORDER = ["reel", "story", "feed", "offer", "marketplace", "whatsapp", "banner"];
const rank = (i: ShelfItem) => {
  const k = ORDER.indexOf(i.kind === "reel" ? "reel" : i.asset.format);
  return k < 0 ? 99 : k;
};

export const countAssets = (kit: Kit) => kit.assets.length + (kit.reel ? 1 : 0);

/** Copy for the mock storefronts inside frames. */
export function frameProduct(kit: Kit) {
  return {
    name: kit.product.understanding?.name ?? "Your product",
    price: "₹2,499",
    mrp: "₹3,999",
  };
}

export function dims(a: Pick<KitAsset, "width" | "height">) {
  return `${a.width} × ${a.height}`;
}
