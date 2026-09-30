/**
 * Channel Pack: one approved hero → every format a seller needs, as
 * transformations (never new generations). Recipes proven in SPIKES.md §5.
 * Pure and client-safe. v0 — owned by the transformations workstream.
 */
import type { BuiltUrl, KitAsset, SceneDNA, XraySegment } from "../types";
import { deliveryBase } from "./composite";

export interface ChannelInput {
  heroPublicId: string; // saved 1080x1350 hero (non-transparent: gen_fill/recolor need that)
  cutoutPublicId: string; // transparent trimmed cutout (marketplace white image)
  alt: string; // caption-derived alt text
  recolorPart?: string; // from AI Vision, e.g. "bottle body"
  swatches?: string[]; // hex without '#', max 4
  offer?: { hindi?: string; english?: string };
  textZone?: SceneDNA["text_zone"];
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

export function channelAssets(i: ChannelInput): KitAsset[] {
  const assets: KitAsset[] = [];
  const add = (id: string, format: KitAsset["format"], label: string, w: number, h: number, frame: KitAsset["frame"], b: BuiltUrl) =>
    assets.push({ id, format, label, width: w, height: h, frame, alt: i.alt, url: b.url, xray: b });

  add("feed", "feed", "Feed post 4:5", 1080, 1350, "feed-post", built(i.heroPublicId, [FMT], i.cloud));

  add("marketplace", "marketplace", "Marketplace main 2000px", 2000, 2000, "listing-card",
    built(i.cutoutPublicId, [
      seg("b_white,c_fit,w_1700,h_1700", "crop", "Product fills ~85% of the frame"),
      seg("c_pad,w_2000,h_2000,b_white", "crop", "Pure white 2000×2000 canvas, as marketplaces require"),
      seg("f_jpg,q_auto:best", "format", "JPEG, best quality"),
    ], i.cloud));

  add("story", "story", "Story 9:16", 1080, 1920, "story",
    built(i.heroPublicId, [seg("ar_9:16,b_gen_fill,c_pad,w_1080", "gen-ai", "Generative fill extends the scene to 9:16 (no new generation)"), FMT], i.cloud));

  add("banner", "banner", "Web banner 16:9", 1920, 1080, "web-banner",
    built(i.heroPublicId, [seg("ar_16:9,b_gen_fill,c_pad,w_1920", "gen-ai", "Generative fill extends the scene to 16:9"), FMT], i.cloud));

  add("whatsapp", "whatsapp", "WhatsApp catalog tile", 600, 600, "catalog-tile",
    built(i.heroPublicId, [seg("c_fill,w_600,h_600,g_auto", "crop", "Content-aware square crop"), seg("f_auto,q_auto:eco", "format", "Light enough for a catalog")], i.cloud));

  const part = i.recolorPart?.trim() || "product";
  for (const hex of (i.swatches ?? []).slice(0, 4)) {
    const clean = hex.replace(/^#/, "").toLowerCase();
    add(`recolor-${clean}`, "recolor", `Colour #${clean}`, 1080, 1350, "feed-post",
      built(i.heroPublicId, [seg(`e_gen_recolor:prompt_${encodeURIComponent(part)};to-color_${clean}`, "gen-ai", `Generative recolor of the ${part}`), FMT], i.cloud));
  }

  if (i.offer?.hindi || i.offer?.english) {
    const top = i.textZone === "bottom" ? "g_south" : "g_north";
    const parts: XraySegment[] = [];
    if (i.offer.hindi) parts.push(seg(`l_text:Noto%20Sans%20Devanagari@google_88_700:${encodeOverlayText(i.offer.hindi)},co_white/fl_layer_apply,${top},y_70`, "text", "Hindi offer text (Google font, no upload)"));
    if (i.offer.english) parts.push(seg(`l_text:Noto%20Sans@google_56_700:${encodeOverlayText(i.offer.english)},co_rgb:f5a524/fl_layer_apply,${top},y_${i.offer.hindi ? 190 : 80}`, "text", "English offer line"));
    add("offer", "offer", "Festive offer", 1080, 1350, "feed-post", built(i.heroPublicId, [...parts, FMT], i.cloud));
  }
  return assets;
}

/** Tags applied to every materialised pack asset so the zip + shelf can find them. */
export const packTags = (sku: string) => ["s2s", "s2s-pack", `s2s-pack-${sku}`];
