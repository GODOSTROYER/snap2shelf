/**
 * Channel Pack: one approved hero → every format a seller needs, as
 * transformations (never new generations). Recipes proven in SPIKES.md §5 and
 * re-verified by scripts/dev/channel-check.mts. Pure and client-safe.
 */
import { PLATE, type BuiltUrl, type KitAsset, type SceneDNA, type XraySegment } from "../types";
import { deliveryBase, layerId, type Geometry } from "./composite";

/** Where the product sits on the 1080x1350 hero (composite.ts geometry()). */
export type ProductBox = Pick<Geometry, "pw" | "ph" | "px" | "py" | "baseY">;

export interface ChannelInput {
  heroPublicId: string; // saved 1080x1350 hero (non-transparent: gen_fill/recolor need that)
  cutoutPublicId: string; // transparent trimmed cutout (marketplace white image)
  alt: string; // caption-derived alt text
  recolorPart?: string; // from AI Vision, e.g. "bottle body" — a PART, not the whole product
  swatches?: string[]; // hex without '#', max 4
  offer?: { hindi?: string; english?: string };
  textZone?: SceneDNA["text_zone"];
  /** Product box on the hero, so crops centre on it and offer text never covers it. */
  productBox?: ProductBox;
  /** Use the s2s_* named transformations (created by the setup script) instead of inline chains. */
  named?: boolean;
  cloud?: string;
}

function built(publicId: string, parts: XraySegment[], cloud?: string): BuiltUrl {
  const transformation = parts.map((p) => p.text).join("/");
  return {
    url: `${deliveryBase(cloud)}/${transformation}/${publicId}`,
    transformation,
    segments: [...parts, { text: publicId, kind: "asset", label: "Source asset" }],
  };
}

const seg = (text: string, kind: XraySegment["kind"], label: string): XraySegment => ({ text, kind, label });
const FMT = seg("f_auto,q_auto", "format", "Best format and quality for the viewer's browser");

/** Devanagari-safe text for l_text: UTF-8 percent-encoded, with , / % double-encoded. */
export function encodeOverlayText(t: string) {
  // %25 first, otherwise the %252C / %252F we produce would be re-encoded
  return encodeURIComponent(t).replace(/%25/g, "%2525").replace(/%2C/gi, "%252C").replace(/%2F/gi, "%252F");
}

/**
 * Fixed-size channel chains. Also exported as named transformations
 * (named.ts); f_auto/q_auto are always appended outside the chain.
 */
export const CHANNEL_CHAINS = {
  // c_mpad, not c_pad: c_pad would scale the 1700px fit back up to fill 2000px
  marketplace: "c_fit,w_1700,h_1700/c_mpad,w_2000,h_2000,b_white",
  story: "ar_9:16,b_gen_fill,c_pad,w_1080",
  banner: "ar_16:9,b_gen_fill,c_pad,w_1920",
  whatsapp: "c_fill,w_600,h_600,g_auto",
} as const;

/** Square crop centred on the product (deterministic, no AI) when we know where it is. */
function whatsappCrop(box?: ProductBox): string {
  if (!box) return CHANNEL_CHAINS.whatsapp;
  // tight enough that the product reads at thumbnail size, loose enough to keep some scene
  const side = Math.round(Math.min(PLATE.width, Math.max(600, Math.max(box.pw, box.ph) * 1.5)));
  const cx = box.px + box.pw / 2;
  const cy = box.py + box.ph * 0.54; // a little extra room below for the contact shadow
  const x = Math.round(Math.min(PLATE.width - side, Math.max(0, cx - side / 2)));
  const y = Math.round(Math.min(PLATE.height - side, Math.max(0, cy - side / 2)));
  return `c_crop,g_north_west,x_${x},y_${y},w_${side},h_${side}/c_scale,w_600,h_600`;
}

// ── Festive offer layout ────────────────────────────────────────────────

export interface OfferLayout {
  band: "top" | "bottom";
  align: "center" | "left" | "right";
  scale: number; // 0.6..1, text + card shrink when the free band is tight
  card: { x: number; y: number; w: number; h: number }; // on the 1080x1350 hero
  overlapsProduct: boolean;
}

const CARD = { maxW: 900, minW: 420, sideW: 640, margin: 48, gap: 24, hindi: 84, english: 44, pad: 36 };

/** Rough rendered width of a line (px); c_limit on the text layer covers any underestimate. */
function lineWidth(text: string, size: number, devanagari: boolean) {
  // Devanagari vowel signs, viramas and nuktas take no advance of their own
  const chars = devanagari ? text.replace(/[ऀ-ःऺ-ॏ॑-ॗॢॣ]/g, "").length : text.length;
  return chars * size * (devanagari ? 0.62 : 0.54);
}

/**
 * Pick the band for the offer card so it never covers the product: Scene DNA's
 * text_zone is the preference, the product box is the constraint. Falls back
 * to the roomier band and shrinks the card to fit; only if even a 60% card
 * cannot fit does it overlap (and says so).
 */
export function offerLayout(zone: SceneDNA["text_zone"] | undefined, box: ProductBox | undefined, offer: { hindi?: string; english?: string }): OfferLayout {
  const lines = { hindi: Boolean(offer.hindi), english: Boolean(offer.english) };
  const H = PLATE.height;
  const W = PLATE.width;
  const cardH1 = CARD.pad * 2 + (lines.hindi ? CARD.hindi * 1.3 : 0) + (lines.english ? CARD.english * 1.35 : 0) + (lines.hindi && lines.english ? 8 : 0);
  // free vertical space above the product and below its contact shadow
  const top = box ? box.py - CARD.margin - CARD.gap : H * 0.3;
  const bottom = box ? H - (box.baseY + Math.round(box.pw * 0.06) + 16) - CARD.margin - CARD.gap : H * 0.2;
  const z = zone ?? "top";
  const prefer: "top" | "bottom" = z === "bottom" ? "bottom" : z === "none" ? (bottom > top ? "bottom" : "top") : "top";
  const other = prefer === "top" ? "bottom" : "top";
  const room = { top, bottom };
  let band: "top" | "bottom" = prefer;
  if (room[prefer] < cardH1 && room[other] > room[prefer]) band = other;
  const scale = Math.max(0.6, Math.min(1, room[band] / cardH1));
  const overlapsProduct = room[band] < cardH1 * 0.6;
  const align: OfferLayout["align"] = z === "top_left" || z === "left" ? "left" : z === "top_right" || z === "right" ? "right" : "center";
  const natural =
    Math.max(offer.hindi ? lineWidth(offer.hindi, CARD.hindi, true) : 0, offer.english ? lineWidth(offer.english, CARD.english, false) : 0) + CARD.pad * 2;
  const w = Math.round(Math.min(align === "center" ? CARD.maxW : CARD.sideW, Math.max(CARD.minW, natural)) * scale);
  const h = Math.round(cardH1 * scale);
  const x = align === "center" ? Math.round((W - w) / 2) : align === "left" ? CARD.margin : W - CARD.margin - w;
  const y = band === "top" ? CARD.margin : H - CARD.margin - h;
  return { band, align, scale: Math.round(scale * 100) / 100, card: { x, y, w, h }, overlapsProduct };
}

function offerSegments(heroPublicId: string, offer: { hindi?: string; english?: string }, zone: SceneDNA["text_zone"] | undefined, box?: ProductBox): XraySegment[] {
  const L = offerLayout(zone, box, offer);
  const hs = Math.round(CARD.hindi * L.scale);
  const es = Math.round(CARD.english * L.scale);
  const pad = Math.round(CARD.pad * L.scale);
  const textW = L.card.w - pad * 2;
  const parts: XraySegment[] = [];
  // the hero itself, blacked out, is the card: rounded, translucent, warm-dark (no extra asset)
  parts.push(
    seg(
      `l_${layerId(heroPublicId)}/c_scale,w_${L.card.w},h_${L.card.h}/co_rgb:1c130c,e_colorize:100/r_${Math.round(28 * L.scale)}/o_72/fl_layer_apply,g_north_west,x_${L.card.x},y_${L.card.y}`,
      "effect",
      `Offer card in the ${L.band} band, placed from Scene DNA's text zone so it never covers the product`,
    ),
  );
  // text anchored inside the card; c_limit keeps long offers on one line inside it
  const gx = L.align === "left" ? "g_north_west" : L.align === "right" ? "g_north_east" : "g_north";
  const tx = L.align === "left" ? L.card.x + pad : L.align === "right" ? PLATE.width - (L.card.x + L.card.w) + pad : 0;
  let ty = L.card.y + pad;
  if (offer.hindi) {
    parts.push(
      seg(
        `l_text:Noto%20Sans%20Devanagari@google_${hs}_700:${encodeOverlayText(offer.hindi)},co_white/c_limit,w_${textW}/fl_layer_apply,${gx},x_${tx},y_${ty}`,
        "text",
        "Hindi offer line (Google font, rendered by Cloudinary, conjuncts shaped correctly)",
      ),
    );
    ty += Math.round(hs * 1.3) + (offer.english ? Math.round(8 * L.scale) : 0);
  }
  if (offer.english) {
    parts.push(
      seg(
        `l_text:Noto%20Sans@google_${es}_600:${encodeOverlayText(offer.english)},co_rgb:ffc56b/c_limit,w_${textW}/fl_layer_apply,${gx},x_${tx},y_${ty}`,
        "text",
        "English offer line",
      ),
    );
  }
  return parts;
}

export function channelAssets(i: ChannelInput): KitAsset[] {
  const assets: KitAsset[] = [];
  const add = (id: string, format: KitAsset["format"], label: string, w: number, h: number, frame: KitAsset["frame"], b: BuiltUrl) =>
    assets.push({ id, format, label, width: w, height: h, frame, alt: i.alt, url: b.url, xray: b });
  const chain = (name: keyof typeof CHANNEL_CHAINS, kind: XraySegment["kind"], label: string) =>
    i.named ? seg(`t_s2s_${name}`, kind, `${label} (named transformation s2s_${name})`) : seg(CHANNEL_CHAINS[name], kind, label);

  add("feed", "feed", "Feed post 4:5", 1080, 1350, "feed-post", built(i.heroPublicId, [FMT], i.cloud));

  add(
    "marketplace",
    "marketplace",
    "Marketplace main 2000px",
    2000,
    2000,
    "listing-card",
    built(
      i.cutoutPublicId,
      [
        chain("marketplace", "crop", "Product fitted to 1700px (85% of the frame) on a pure white 2000×2000 canvas, as marketplaces require"),
        seg("f_jpg,q_auto:best", "format", "JPEG, best quality (transparency flattened onto white)"),
      ],
      i.cloud,
    ),
  );

  add("story", "story", "Story 9:16", 1080, 1920, "story",
    built(i.heroPublicId, [chain("story", "gen-ai", "Generative fill extends the scene to 9:16 (no new generation)"), FMT], i.cloud));

  add("banner", "banner", "Web banner 16:9", 1920, 1080, "web-banner",
    built(i.heroPublicId, [chain("banner", "gen-ai", "Generative fill extends the scene to 16:9"), FMT], i.cloud));

  add("whatsapp", "whatsapp", "WhatsApp catalog tile", 600, 600, "catalog-tile",
    built(i.heroPublicId, [
      i.productBox
        ? seg(whatsappCrop(i.productBox), "crop", "Square crop centred on the product, 600px")
        : chain("whatsapp", "crop", "Content-aware square crop, 600px"),
      seg("f_auto,q_auto:eco", "format", "Light enough for a catalog"),
    ], i.cloud));

  const part = i.recolorPart?.trim() || "product";
  for (const hex of (i.swatches ?? []).slice(0, 4)) {
    const clean = hex.replace(/^#/, "").toLowerCase();
    if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/.test(clean)) continue;
    add(`recolor-${clean}`, "recolor", `Colour #${clean}`, 1080, 1350, "feed-post",
      built(i.heroPublicId, [seg(`e_gen_recolor:prompt_${encodeURIComponent(part)};to-color_${clean}`, "gen-ai", `Generative recolor of the ${part} only (shading kept)`), FMT], i.cloud));
  }

  if (i.offer?.hindi || i.offer?.english) {
    add("offer", "offer", "Festive offer", 1080, 1350, "feed-post",
      built(i.heroPublicId, [...offerSegments(i.heroPublicId, i.offer, i.textZone, i.productBox), FMT], i.cloud));
  }
  return assets;
}

/** Tags applied to every materialised pack asset so the zip + shelf can find them. */
export const packTags = (sku: string) => ["s2s", "s2s-pack", `s2s-pack-${sku}`];
