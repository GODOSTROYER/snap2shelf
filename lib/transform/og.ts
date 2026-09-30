/**
 * Dynamic Open Graph image for /shelf/<shop>: 1200x630 JPEG built from up to
 * four saved hero images plus the shop name, as one transformation URL (no
 * generation, 1 tx per distinct shelf). Pure and client-safe; use it in
 * generateMetadata(). JPEG on purpose: some link scrapers reject WebP/AVIF.
 */
import type { BuiltUrl, XraySegment } from "../types";
import { deliveryBase, layerId } from "./composite";
import { encodeOverlayText } from "./channels";

export const OG = { width: 1200, height: 630 } as const;

export interface OgInput {
  heroes: string[]; // hero public ids, newest first; the first also becomes the blurred backdrop
  shopName: string;
  tagline?: string; // default "Shop the shelf"
  cloud?: string;
}

const DEVANAGARI = /[ऀ-ॿ]/;
const font = (t: string, size: number, weight: number) => `${DEVANAGARI.test(t) ? "Noto%20Sans%20Devanagari" : "Noto%20Sans"}@google_${size}_${weight}`;

export function ogImageUrl(i: OgInput): BuiltUrl {
  const heroes = i.heroes.filter(Boolean).slice(0, 4);
  if (!heroes.length) throw new Error("ogImageUrl needs at least one hero");
  const segs: XraySegment[] = [];
  const push = (text: string, kind: XraySegment["kind"], label: string) => segs.push({ text, kind, label });

  // backdrop: the newest hero, blurred and dimmed so tiles and text pop
  push(`c_fill,w_${OG.width},h_${OG.height},g_auto`, "crop", "Newest hero filled to the 1200×630 link-preview size");
  push("e_blur:1200/e_brightness:-35", "effect", "Blurred and dimmed into a backdrop");

  // tiles: 4:5 cards in a centred row along the bottom
  const tileH = 340;
  const tileW = 272;
  const gap = 24;
  const rowW = heroes.length * tileW + (heroes.length - 1) * gap;
  const x0 = Math.round((OG.width - rowW) / 2);
  const y = OG.height - 40 - tileH;
  heroes.forEach((h, n) => {
    push(
      `l_${layerId(h)}/c_fill,w_${tileW},h_${tileH},g_auto/r_18/fl_layer_apply,g_north_west,x_${x0 + n * (tileW + gap)},y_${y}`,
      "layer",
      `Product ${n + 1}: saved hero as a rounded 4:5 card`,
    );
  });

  const name = i.shopName.trim().slice(0, 40) || "Snap2Shelf";
  const tagline = (i.tagline ?? "Shop the shelf").trim().slice(0, 60);
  push(
    `l_text:${font(name, 64, 700)}:${encodeOverlayText(name)},co_white/c_limit,w_${OG.width - 120}/fl_layer_apply,g_north,y_52`,
    "text",
    "Shop name (Google font; Devanagari names use Noto Sans Devanagari)",
  );
  if (tagline) {
    push(
      `l_text:${font(tagline, 32, 500)}:${encodeOverlayText(tagline)},co_rgb:ffc56b/c_limit,w_${OG.width - 120}/fl_layer_apply,g_north,y_150`,
      "text",
      "Tagline",
    );
  }
  push("f_jpg,q_80", "format", "JPEG for link scrapers");

  const transformation = segs.map((s) => s.text).join("/");
  segs.push({ text: heroes[0], kind: "asset", label: "Newest hero (backdrop)" });
  return { url: `${deliveryBase(i.cloud)}/${transformation}/${heroes[0]}`, transformation, segments: segs };
}
