/**
 * View-model helpers for showing a Kit: shelf grouping, X-ray colours, the
 * mock storefront copy inside frames. Pure and server-safe.
 */
import type { Kit, KitAsset, XraySegment } from "../types";
import { reelPoster } from "./reel";

export const KIND_META: Record<XraySegment["kind"], { label: string; color: string }> = {
  crop: { label: "Crop", color: "var(--color-x-crop)" },
  layer: { label: "Layer", color: "var(--color-x-layer)" },
  placement: { label: "Placement", color: "var(--color-x-placement)" },
  shadow: { label: "Shadow", color: "var(--color-x-shadow)" },
  reflection: { label: "Reflection", color: "var(--color-x-reflection)" },
  effect: { label: "Effect", color: "var(--color-x-effect)" },
  "gen-ai": { label: "Generative AI", color: "var(--color-x-gen)" },
  text: { label: "Text", color: "var(--color-x-text)" },
  format: { label: "Format", color: "var(--color-x-format)" },
  asset: { label: "Source", color: "var(--color-x-asset)" },
  video: { label: "Video", color: "var(--color-x-video)" },
};

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

/** Pseudo-asset for the reel so it can sit in a frame like everything else. */
export function reelAsset(kit: Kit): ShelfItem | null {
  if (!kit.reel) return null;
  const heroId = kit.hero.publicId ?? kit.product.rawPublicId;
  return {
    kind: "reel",
    key: "reel",
    src: kit.reel.url,
    poster: reelPoster(heroId),
    asset: {
      id: "reel",
      format: "story",
      label: `Kit Reel ${Math.round(kit.reel.seconds)} s`,
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
