/**
 * Shop slug rules and the names derived from a slug. Pure and client-safe.
 */

export const SHOP_RE = /^[a-z0-9-]{3,32}$/;

/** Slugs that would read as part of the product rather than a shop. */
const RESERVED = new Set(["api", "new", "edit", "admin", "shelf", "shelves", "studio", "kit", "null", "undefined"]);

export type ShopCheck = { ok: true; shop: string } | { ok: false; reason: string };

export function checkShop(raw: unknown): ShopCheck {
  if (typeof raw !== "string") return { ok: false, reason: "Shop name is required." };
  const shop = raw.trim();
  if (!SHOP_RE.test(shop)) return { ok: false, reason: "Use 3–32 lower-case letters, digits or hyphens." };
  if (!/[a-z0-9]/.test(shop) || /^-|-$/.test(shop) || shop.includes("--")) {
    return { ok: false, reason: "Start and end with a letter or digit, no double hyphens." };
  }
  if (RESERVED.has(shop)) return { ok: false, reason: "That name is reserved, pick another." };
  return { ok: true, shop };
}

export const isShop = (raw: unknown): raw is string => checkShop(raw).ok;

/** Turn a free-text shop name into a candidate slug ("Meera's Candles" → "meeras-candles"). */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
}

/** Cloudinary tag that makes a hero part of a shelf. */
export const shopTag = (shop: string) => `s2s-shop-${shop}`;

/** Context-key-safe form of the slug (hyphens → underscores; slugs never contain "_"). */
export const shopKey = (shop: string) => shop.replace(/-/g, "_");

export const shopContextKeys = (shop: string) => {
  const k = shopKey(shop);
  return { title: `st_${k}`, order: `so_${k}`, tagline: `sl_${k}` };
};

export const shelfPath = (shop: string) => `/shelf/${shop}`;

/** wa.me share link: no phone number, so WhatsApp lets the user pick a chat. */
export function whatsappShareUrl(text: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`;
}
