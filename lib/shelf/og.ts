/**
 * Shelf OG image: a 1200x630 collage of up to 4 product heroes plus the shop
 * title, built as ONE Cloudinary transformation URL (no upload, no generation).
 * Pure and client-safe. Verified live 2026-09-30: Google fonts via
 * `l_text:<Family>@google_<size>_<weight>`, rounded + bordered + rotated card
 * layers with `e_shadow`, blurred-hero backdrop.
 *
 *   backdrop   first hero, c_fill 1200x630, heavily blurred and darkened
 *   eyebrow    "SNAP2SHELF · SHOP" (Inter, marigold, tracked)
 *   title      shop title (Fraunces), wrapped with c_fit, size by length
 *   footer     tagline / product count (muted) + a marigold "Open the shelf" pill
 *   cards      up to 4 heroes, cropped on the product when its plate box is known
 */
import { encodeOverlayText } from "../transform/channels";
import { deliveryBase, layerId } from "../transform/composite";
import { PLATE, type BuiltUrl, type XraySegment } from "../types";
import type { PlateBox } from "./types";

export const OG = { width: 1200, height: 630 } as const;

export const OG_COLORS = {
  ink: "f4efe7",
  muted: "a89f92",
  marigold: "f5a524",
  studio: "0e0c0a",
} as const;

export const OG_FONTS = { display: "Fraunces", sans: "Inter" } as const;

export interface OgHero {
  publicId: string;
  /** Product box on the 1080x1350 plate: the card zooms in on it. Omit to show the whole hero. */
  geo?: PlateBox;
}

export interface OgInput {
  title: string;
  heroes: OgHero[];
  tagline?: string;
  /** Total products on the shelf (the collage shows at most 4). Defaults to heroes.length. */
  count?: number;
  cloud?: string;
  /** Final format component. Default f_jpg,q_auto: social scrapers want a plain JPEG. */
  format?: string;
}

interface Card {
  w: number;
  h: number;
  dx: number; // offset from the canvas centre (g_center)
  dy: number;
  angle: number;
}

/** Card layouts by count, tuned by eye on the rendered collage (text column is x 72..572). */
export const CARD_LAYOUTS: Record<1 | 2 | 3 | 4, Card[]> = {
  1: [{ w: 300, h: 375, dx: 300, dy: 0, angle: -3 }],
  2: [
    { w: 250, h: 312, dx: 185, dy: 16, angle: -4 },
    { w: 250, h: 312, dx: 435, dy: -14, angle: 4 },
  ],
  3: [
    { w: 240, h: 300, dx: 185, dy: 0, angle: -3 },
    { w: 190, h: 238, dx: 425, dy: -130, angle: 3 },
    { w: 190, h: 238, dx: 425, dy: 135, angle: -2 },
  ],
  4: [
    { w: 200, h: 250, dx: 190, dy: -125, angle: -3 },
    { w: 200, h: 250, dx: 420, dy: -150, angle: 3 },
    { w: 200, h: 250, dx: 190, dy: 140, angle: 2 },
    { w: 200, h: 250, dx: 420, dy: 115, angle: -2 },
  ],
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * A 4:5 crop of the plate around the product so it reads at thumbnail size:
 * the product takes ~62% of the crop height (or ~72% of its width), never
 * zooming in further than a 540x675 window (keeps the crop sharp).
 */
export function productCrop(geo: PlateBox): string {
  const W = PLATE.width;
  const H = PLATE.height;
  let ch = Math.max(geo.ph / 0.62, (geo.pw / 0.72) * 1.25, 675);
  ch = Math.min(ch, H);
  let cw = ch * 0.8;
  if (cw > W) {
    cw = W;
    ch = W * 1.25;
  }
  const cx = geo.px + geo.pw / 2;
  const cy = geo.py + geo.ph * 0.56; // a little low: keep the contact shadow and surface in frame
  const x = clamp(Math.round(cx - cw / 2), 0, Math.round(W - cw));
  const y = clamp(Math.round(cy - ch / 2), 0, Math.round(H - ch));
  return `c_crop,w_${Math.round(cw)},h_${Math.round(ch)},x_${x},y_${y}`;
}

/** Title size steps: the column is 500 px wide; long names wrap onto two or three lines. */
export function titleSize(title: string): number {
  const n = [...title].length;
  if (n <= 14) return 80;
  if (n <= 22) return 66;
  if (n <= 36) return 54;
  return 44;
}

/**
 * Estimated rendered height of the wrapped title (Fraunces 600 capitals run ~0.64 em per
 * character; over-estimating only adds a little air above the tagline).
 */
export function titleHeight(title: string, size = titleSize(title)): number {
  const perLine = Math.max(1, Math.floor(500 / (size * 0.64)));
  const words = title.trim().split(/\s+/);
  let lines = 1;
  let used = 0;
  for (const w of words) {
    const len = [...w].length;
    if (used && used + 1 + len > perLine) {
      lines++;
      used = len;
    } else used += (used ? 1 : 0) + len;
  }
  return Math.round(lines * size * 1.12);
}

const text = (s: string, max: number) => encodeOverlayText([...s.trim()].slice(0, max).join(""));

export function ogCollageUrl(input: OgInput): BuiltUrl {
  const heroes = input.heroes.slice(0, 4);
  const count = input.count ?? input.heroes.length;
  const C = OG_COLORS;
  const segs: XraySegment[] = [];
  const push = (t: string, kind: XraySegment["kind"], label: string) => segs.push({ text: t, kind, label });

  push(`c_fill,w_${OG.width},h_${OG.height},g_auto`, "crop", "Social card canvas, 1200×630");
  push("e_blur:1500/e_brightness:-70", "effect", "The first hero, blurred and dimmed into a warm backdrop");

  push(
    `co_rgb:${C.marigold},l_text:${OG_FONTS.sans}@google_22_700_letter_spacing_6:${text("SNAP2SHELF · SHOP", 40)}/fl_layer_apply,g_north_west,x_72,y_104`,
    "text",
    "Eyebrow in Inter (Google font, no upload)",
  );
  push(
    `co_rgb:${C.ink},c_fit,w_500,l_text:${OG_FONTS.display}@google_${titleSize(input.title)}_600_line_spacing_-6:${text(input.title, 60)}/fl_layer_apply,g_north_west,x_72,y_146`,
    "text",
    "Shop title in Fraunces, wrapped to a 500 px column",
  );

  const size = titleSize(input.title);
  const footer = input.tagline?.trim() || `${count} ${count === 1 ? "product" : "products"} · real photos, AI-built stage`;
  push(
    `co_rgb:${C.muted},c_fit,w_480,l_text:${OG_FONTS.sans}@google_26_500_line_spacing_6:${text(footer, 90)}/fl_layer_apply,g_north_west,x_74,y_${146 + titleHeight(input.title, size) + 22}`,
    "text",
    "Tagline or product count, under the title",
  );

  const base = heroes[0]?.publicId;
  if (base) {
    // Text layers can't be rounded, so the pill is the base image itself, colorized solid
    // marigold and rounded, with the label nested inside it (verified live).
    push(
      `l_${layerId(base)}/c_scale,w_252,h_58/co_rgb:${C.marigold},e_colorize:100/co_rgb:${C.studio},l_text:${OG_FONTS.sans}@google_24_700:${text("Open the shelf  →", 30)}/fl_layer_apply,g_center/r_29/fl_layer_apply,g_south_west,x_72,y_64`,
      "layer",
      "Call-to-action pill: a colorized, rounded layer with the label nested inside",
    );
  }

  const layout = heroes.length ? CARD_LAYOUTS[heroes.length as 1 | 2 | 3 | 4] : [];
  heroes.forEach((h, i) => {
    const card = layout[i];
    const crop = h.geo ? `${productCrop(h.geo)}/` : "";
    push(
      `l_${layerId(h.publicId)}/${crop}c_fill,w_${card.w},h_${card.h},g_auto/bo_5px_solid_rgb:${C.ink}/r_20/a_${card.angle}/co_black,e_shadow:60,x_8,y_14/fl_layer_apply,g_center,x_${card.dx},y_${card.dy}`,
      "layer",
      h.geo ? "Hero card, cropped on the product using its stored plate box" : "Hero card",
    );
  });

  push(input.format ?? "f_jpg,q_auto", "format", "Plain JPEG for social scrapers");

  const transformation = segs.map((s) => s.text).join("/");
  if (base) push(base, "asset", "First hero on the shelf");
  return {
    url: base ? `${deliveryBase(input.cloud)}/${transformation}/${base}` : "",
    transformation,
    segments: segs,
  };
}
