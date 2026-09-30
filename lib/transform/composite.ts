/**
 * Exact-mode composite: the real product cutout layered onto a scene plate,
 * as one Cloudinary delivery URL. Pure and client-safe, so sliders can rebuild
 * the URL on every change. Recipe proven in SPIKES.md §4.
 *
 * Order of layers (bottom → top): scene, reflection, contact shadow, product (+ cast shadow).
 */
import { PLATE, type BuiltUrl, type CompositeControls, type CutoutRecord, type Placement, type SceneDNA, type XraySegment } from "../types";

export const cloudName = () => process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? "";
export const deliveryBase = (cloud = cloudName()) => `https://res.cloudinary.com/${cloud}/image/upload`;

/** Folder slashes become colons inside l_ layer ids. */
export const layerId = (publicId: string) => publicId.replace(/\//g, ":");

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function defaultControls(placement: Placement, dna: SceneDNA): CompositeControls {
  return {
    scale: placement === "flatlay" ? 0.62 : 0.46,
    offsetX: 0,
    offsetY: 0,
    shadow: true, // standing: cast shadow; flat-lay: soft lift off the surface
    contact: placement !== "flatlay",
    reflection: dna.glossy ? "auto" : "off",
    harmonise: false,
  };
}

/** Quantise slider values so nearby positions reuse the same (already billed) derived image. */
export function quantise(c: CompositeControls): CompositeControls {
  return {
    ...c,
    scale: Math.round(clamp(c.scale, 0.2, 0.8) * 50) / 50,
    offsetX: Math.round(clamp(c.offsetX, -300, 300) / 10) * 10,
    offsetY: Math.round(clamp(c.offsetY, -300, 300) / 10) * 10,
  };
}

export interface Geometry {
  pw: number; // product width on the plate
  ph: number;
  px: number; // top-left of the product box
  py: number;
  baseY: number; // y where the product touches the surface
}

export function geometry(cutout: Pick<CutoutRecord, "width" | "height">, dna: SceneDNA, c: CompositeControls, placement: Placement): Geometry {
  const W = PLATE.width;
  const H = PLATE.height;
  const aspect = cutout.height / cutout.width;
  const maxW = W * c.scale;
  const maxH = H * (placement === "flatlay" ? 0.8 : 0.6);
  const pw = Math.round(Math.min(maxW, maxH / aspect));
  const ph = Math.round(pw * aspect);
  if (placement === "flatlay") {
    // top-down: centre the product on the anchor
    const px = Math.round(W * dna.anchor_x - pw / 2 + c.offsetX);
    const py = Math.round(H * dna.anchor_y - ph / 2 + c.offsetY);
    return { pw, ph, px, py, baseY: py + ph };
  }
  const baseY = Math.round(clamp(H * dna.anchor_y + c.offsetY, ph + 40, H - 20));
  const px = Math.round(W * dna.anchor_x - pw / 2 + c.offsetX);
  return { pw, ph, px, py: baseY - ph, baseY };
}

export interface CompositeInput {
  scenePublicId: string;
  dna: SceneDNA;
  cutout: Pick<CutoutRecord, "publicId" | "width" | "height">;
  placement: Placement;
  controls: CompositeControls;
  /** Output width (plate is 1080 wide). Omit for full size. Previews should pass 720. */
  width?: number;
  /** Final delivery component. Default f_auto,q_auto. Use "f_jpg,q_90" when saving as an asset. */
  format?: string;
  cloud?: string;
}

export function compositeUrl(input: CompositeInput): BuiltUrl {
  const c = quantise(input.controls);
  const g = geometry(input.cutout, input.dna, c, input.placement);
  const L = layerId(input.cutout.publicId);
  const segs: XraySegment[] = [];
  const push = (text: string, kind: XraySegment["kind"], label: string) => segs.push({ text, kind, label });

  push(`c_fill,w_${PLATE.width},h_${PLATE.height}`, "crop", "Scene plate at the canonical 4:5 size");

  const reflect = c.reflection === "on" || (c.reflection === "auto" && input.dna.glossy);
  if (reflect && input.placement !== "flatlay") {
    push(
      `l_${L}/c_scale,w_${g.pw}/a_vflip/e_gradient_fade:60,y_-0.7/o_22/fl_layer_apply,g_north_west,x_${g.px},y_${g.baseY - 2}`,
      "reflection",
      "Studio reflection: the cutout flipped, faded and placed under the product",
    );
  }

  if (c.contact && input.placement !== "flatlay") {
    const cw = Math.round(g.pw * 0.88);
    const ch = Math.max(10, Math.round(g.pw * 0.055));
    push(
      `l_${L}/c_scale,w_${cw},h_${ch}/co_black,e_colorize:100/e_blur:150/o_70/fl_layer_apply,g_north_west,x_${g.px + Math.round((g.pw - cw) / 2)},y_${g.baseY - Math.round(ch / 2)}`,
      "shadow",
      "Contact shadow: the product's own silhouette, squashed, blackened and blurred",
    );
  }

  let product = `l_${L}/c_scale,w_${g.pw}`;
  let x = g.px;
  if (c.shadow) {
    // e_dropshadow is clipped to the layer box, so pad with transparency first (c_mpad never upscales)
    const padX = Math.max(40, Math.round(g.pw * 0.18));
    const padB = Math.max(40, Math.round(g.ph * 0.3));
    const az = Math.round(input.dna.light_azimuth) % 360;
    const el = Math.round(clamp(input.dna.light_elevation, 30, 70));
    product += `/c_mpad,w_${g.pw + padX * 2},h_${g.ph + padB},g_north,b_rgb:00000000/e_dropshadow:azimuth_${az};elevation_${el};spread_45`;
    x = g.px - padX;
  }
  push(`${product}/fl_layer_apply,g_north_west,x_${x},y_${g.py}`, "layer", "Your real product, untouched, placed where Scene DNA says the surface is");

  if (input.width && input.width !== PLATE.width) push(`c_scale,w_${input.width}`, "crop", "Resize for this view");
  push(input.format ?? "f_auto,q_auto", "format", "Best format and quality for the viewer's browser");

  const transformation = segs.map((s) => s.text).join("/");
  push(input.scenePublicId, "asset", "Scene plate from the shared library");
  return {
    url: `${deliveryBase(input.cloud)}/${transformation}/${input.scenePublicId}`,
    transformation,
    segments: segs,
  };
}

/** Tiny blurred placeholder for any delivery URL (never show a blank box). */
export function lqip(publicId: string, cloud?: string) {
  return `${deliveryBase(cloud)}/e_blur:2000,q_1,w_50/f_auto/${publicId}`;
}
