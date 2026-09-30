/**
 * Exact-mode composite: the real product cutout layered onto a scene plate,
 * as one Cloudinary delivery URL. Pure and client-safe, so sliders can rebuild
 * the URL on every change. Base recipe proven in SPIKES.md §4; realism tuning
 * notes live next to each layer below.
 *
 * Layer order (bottom → top), standing products on an eye-level plate:
 *   scene → cast shadow → reflection (glossy only) → contact shadows → product → light-match shading
 * Flat-lay products on a top-down plate:
 *   scene → soft lift shadow → tight lift shadow → product → light-match shading
 *
 * Rules that keep this cheap and deterministic:
 *  - every number in the URL is an integer computed from quantised controls, so
 *    the same slider position always yields the same (already billed) derived image;
 *  - x/y/w/h are never mixed int/float (Cloudinary rejects that);
 *  - every layer that can reach past the plate carries fl_no_overflow, so the
 *    canvas stays exactly 1080x1350;
 *  - effects on a layer are clipped to that layer's box, so anything blurred is
 *    padded with transparency first (c_mpad never upscales).
 */
import { PLATE, type BuiltUrl, type CompositeControls, type CutoutRecord, type Placement, type SceneDNA, type XraySegment } from "../types";

export const cloudName = () => process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? "";
export const deliveryBase = (cloud = cloudName()) => `https://res.cloudinary.com/${cloud}/image/upload`;

/** Folder slashes become colons inside l_ layer ids. */
export const layerId = (publicId: string) => publicId.replace(/\//g, ":");

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const r = Math.round;
const DEG = Math.PI / 180;

/** Product size range (fraction of the plate, see geometry()). */
export const SCALE_RANGE = { min: 0.2, max: 0.8, step: 0.02 } as const;
export const OFFSET_RANGE = { min: -300, max: 300, step: 10 } as const;

/**
 * Default product size from the cutout's aspect ratio (h / w). Measured on the
 * contact sheets: tall bottles read best at ~half the plate height, squat
 * pouches/boxes a little smaller, long shoes need more width to not look lost.
 */
export function defaultScale(placement: Placement, cutout?: Pick<CutoutRecord, "width" | "height">): number {
  if (placement === "flatlay") return 0.62;
  if (!cutout || !cutout.width || !cutout.height) return 0.46;
  const aspect = cutout.height / cutout.width;
  if (aspect >= 2) return 0.48; // bottle, candle, tall jar
  if (aspect <= 0.75) return 0.54; // shoe, bag lying sideways
  return 0.4; // pouch, box, jar
}

/**
 * Starting controls for a product on a scene. `cutout` is optional for
 * backwards compatibility; pass it so the default size fits the product's shape.
 */
export function defaultControls(placement: Placement, dna: SceneDNA, cutout?: Pick<CutoutRecord, "width" | "height">): CompositeControls {
  return {
    scale: defaultScale(placement, cutout),
    offsetX: 0,
    offsetY: 0,
    shadow: true, // standing: cast shadow on the surface; flat-lay: soft lift off the surface
    contact: placement !== "flatlay",
    reflection: dna.glossy ? "auto" : "off",
    harmonise: true,
  };
}

/** Quantise slider values so nearby positions reuse the same (already billed) derived image. */
export function quantise(c: CompositeControls): CompositeControls {
  return {
    ...c,
    scale: Math.round(clamp(c.scale, SCALE_RANGE.min, SCALE_RANGE.max) * 50) / 50,
    offsetX: Math.round(clamp(c.offsetX, OFFSET_RANGE.min, OFFSET_RANGE.max) / 10) * 10,
    offsetY: Math.round(clamp(c.offsetY, OFFSET_RANGE.min, OFFSET_RANGE.max) / 10) * 10,
  };
}

export interface Geometry {
  pw: number; // product width on the plate
  ph: number;
  px: number; // top-left of the product box
  py: number;
  baseY: number; // y where the product touches the surface
}

/**
 * Where the product sits on the 1080x1350 plate (all integers).
 *
 * `scale` sizes the product's fit box: the product fits inside a box that is
 * `scale` of the plate wide and `scale` of the plate high. For wide products
 * that is simply their width fraction; tall products are limited by height, so
 * the slider stays live for every shape (a width-only scale would pin a bottle
 * to its height cap).
 */
export function geometry(cutout: Pick<CutoutRecord, "width" | "height">, dna: SceneDNA, c: CompositeControls, placement: Placement): Geometry {
  const W = PLATE.width;
  const H = PLATE.height;
  const aspect = cutout.height / Math.max(1, cutout.width);
  let pw = Math.min(W * c.scale, (H * c.scale) / aspect);
  if (placement === "flatlay") {
    // top-down: centre the product on the anchor, keep it inside the plate
    pw = Math.min(pw, W - 40, (H - 40) / aspect);
    const w = r(pw);
    const h = r(w * aspect);
    const px = r(clamp(W * dna.anchor_x - w / 2 + c.offsetX, 20, W - w - 20));
    const py = r(clamp(H * dna.anchor_y - h / 2 + c.offsetY, 20, H - h - 20));
    return { pw: w, ph: h, px, py, baseY: py + h };
  }
  // the base sits on the surface anchor; room below for the contact shadow
  const baseY = r(clamp(H * dna.anchor_y + c.offsetY, 160, H - 24));
  // never poke out of the top of the plate: shrink instead of sliding off the surface
  pw = Math.min(pw, (baseY - 40) / aspect, W - 40);
  const w = r(pw);
  const h = r(w * aspect);
  const px = r(clamp(W * dna.anchor_x - w / 2 + c.offsetX, 20, W - w - 20));
  return { pw: w, ph: h, px, py: baseY - h, baseY };
}

/** Shadow tint per scene temperature (multiplied onto the surface, never pure black). */
const SHADOW_RGB: Record<SceneDNA["temperature"], string> = { warm: "3a2414", neutral: "262626", cool: "1e2533" };

/**
 * Light-match on the product itself (Q2): a gentle pull toward the scene's
 * light colour. Deliberately subtle, product colours must stay true.
 */
export function harmoniseTone(dna: SceneDNA): { tone: string; wash: { rgb: string; o: number } | null } {
  if (dna.temperature === "neutral") return { tone: "e_brightness:-3", wash: null };
  if (dna.temperature === "cool") return { tone: "e_tint:10:9ec3ff/e_brightness:-4", wash: { rgb: "cfe0ff", o: 15 } };
  // warm: low sun / lamp light (low elevation) is golden and dim → pull harder;
  // a bright warm kitchen only gets a hint, so a white shoe stays white
  const k = clamp((50 - dna.light_elevation) / 30, 0, 1);
  return {
    tone: `e_tint:${12 + r(8 * k)}:ffa04a/e_brightness:${-5 - r(4 * k)}`,
    wash: { rgb: "ffb45a", o: 16 + r(10 * k) },
  };
}

/** Light direction on the image plane: unit vector the shadow falls along (y down, +y = toward the camera). */
function shadowDirection(dna: SceneDNA) {
  const az = (((dna.light_azimuth % 360) + 360) % 360) * DEG;
  return { sx: -Math.sin(az), sy: Math.cos(az) };
}

type Push = (text: string, kind: XraySegment["kind"], label: string) => void;

/** Eye-level plates: depth on the table appears foreshortened to roughly this fraction. */
const FORESHORTEN = 0.3;

function castShadow(push: Push, L: string, g: Geometry, dna: SceneDNA) {
  const { sx } = shadowDirection(dna);
  let { sy } = shadowDirection(dna);
  // pure side light is ambiguous in depth: assume the key is slightly in front
  // (products are photographed front-lit), so the shadow slants back
  if (Math.abs(sy) < 0.25) sy = -0.45;
  const el = clamp(dna.light_elevation, 20, 75) * DEG;
  const len = g.ph * clamp(1 / Math.tan(el), 0.45, 1.1);
  const X = r(sx * len * 0.85);
  let Y = r(sy * len * FORESHORTEN);
  const tmin = Math.max(14, r(footprintDepth(g))); // real objects have depth: never a hairline
  if (Math.abs(Y) < tmin) Y = Y < 0 ? -tmin : tmin;
  const front = Y > 0;
  const dh = Math.abs(Y);
  const ox = Math.max(0, -X);
  const cw = ox + g.pw + Math.max(0, X);
  // corners TL, TR, BR, BL of the upright silhouette → the ground plane
  const pts = front
    ? [ox + X, dh, ox + g.pw + X, dh, ox + g.pw, 0, ox, 0] // falls toward the camera: flipped
    : [ox + X, 0, ox + g.pw + X, 0, ox + g.pw, dh, ox, dh]; // falls away: upright, squashed
  const m = r(clamp(Math.max(cw, dh) * 0.12, 24, 90));
  const blur = r(clamp(len * 0.9, 250, 900));
  const fade = front ? "y_-0.7" : "y_0.7";
  const x = g.px - ox - m;
  const y = front ? g.baseY - m : g.baseY - dh - m;
  push(
    `l_${L}/c_scale,w_${g.pw},h_${g.ph}/co_rgb:${SHADOW_RGB[dna.temperature]},e_colorize:100/e_distort:${pts.join(":")}` +
      `/c_crop,g_north_west,x_0,y_0,w_${cw},h_${dh}/c_mpad,w_${cw + 2 * m},h_${dh + 2 * m},b_transparent/e_blur:${blur}` +
      `/e_gradient_fade:40,${fade}/o_45/e_multiply,fl_layer_apply,fl_no_overflow,g_north_west,x_${x},y_${y}`,
    "shadow",
    `Cast shadow: the product's silhouette projected onto the surface, away from the light (azimuth ${Math.round(dna.light_azimuth)}°, elevation ${Math.round(dna.light_elevation)}°), softened and fading with distance`,
  );
}

/**
 * How deep the product's footprint is, as it appears on an eye-level plate (px).
 * Round/tall things (bottles) are as deep as they are wide; long things (shoes)
 * are much shallower than their width; pouches and boxes sit in between.
 */
function footprintDepth(g: Geometry) {
  const depthRatio = clamp((g.ph / g.pw) * 0.35, 0.3, 1);
  return depthRatio * g.pw * FORESHORTEN;
}

function contactShadows(push: Push, L: string, g: Geometry, cutout: Pick<CutoutRecord, "width" | "height">, dna: SceneDNA, glossy: boolean) {
  const col = SHADOW_RGB[dna.temperature];
  const fd = footprintDepth(g);
  // only the footprint (bottom slice) of the silhouette touches the surface
  const slice = Math.max(4, r(cutout.height * 0.12));
  const foot = `l_${L}/c_crop,g_south,w_${cutout.width},h_${slice}`;
  // soft ambient pool, a little wider than the product
  {
    const w = r(g.pw * 1.06);
    const h = Math.max(10, r(fd * 1.1));
    const m = Math.max(24, r(h * 1.2));
    const x = g.px + r((g.pw - w) / 2) - m;
    const y = g.baseY - r(h * 0.72) - m; // mostly hidden under the product, ~30% peeks out in front
    push(
      `${foot}/c_scale,w_${w},h_${h}/co_rgb:${col},e_colorize:100/c_mpad,w_${w + 2 * m},h_${h + 2 * m},b_transparent/e_blur:400/o_${glossy ? 30 : 50}/e_multiply,fl_layer_apply,fl_no_overflow,g_north_west,x_${x},y_${y}`,
      "shadow",
      "Ambient occlusion: a soft pool of shadow where the product meets the surface",
    );
  }
  // tight contact line, darkest right under the base
  {
    const w = r(g.pw * 0.96);
    const h = Math.max(5, r(fd * 0.45));
    const m = Math.max(16, h * 2);
    const x = g.px + r((g.pw - w) / 2) - m;
    const y = g.baseY - r(h * 0.62) - m;
    push(
      `${foot}/c_scale,w_${w},h_${h}/co_rgb:${col},e_colorize:100/c_mpad,w_${w + 2 * m},h_${h + 2 * m},b_transparent/e_blur:200/o_90/e_multiply,fl_layer_apply,fl_no_overflow,g_north_west,x_${x},y_${y}`,
      "shadow",
      "Contact shadow: the product's own footprint, squashed, darkened and blurred so it sits on the surface",
    );
  }
}

function reflection(push: Push, L: string, g: Geometry) {
  // mirror about the middle of the footprint, not its front edge: products shot from a little
  // above would otherwise show a gap between the sole and its reflection
  const lift = Math.max(3, r(footprintDepth(g) * 0.5));
  const m = 12;
  push(
    `l_${L}/c_scale,w_${g.pw},h_${g.ph}/a_vflip/e_gradient_fade:50,y_-0.75/c_mpad,w_${g.pw + 2 * m},h_${g.ph + 2 * m},b_transparent/e_blur:120/o_26` +
      `/fl_layer_apply,fl_no_overflow,g_north_west,x_${g.px - m},y_${g.baseY - lift - m}`,
    "reflection",
    "Surface reflection: the cutout mirrored, blurred and faded under the product (glossy scenes only)",
  );
}

function liftShadows(push: Push, L: string, g: Geometry, dna: SceneDNA) {
  const { sx, sy } = shadowDirection(dna);
  const col = SHADOW_RGB[dna.temperature];
  const soft = { d: Math.max(8, r(g.pw * 0.03)), m: 60, blur: 700, o: 45 };
  const tight = { d: Math.max(3, r(g.pw * 0.008)), m: 24, blur: 150, o: 40 };
  for (const [s, label] of [
    [soft, "Soft lift shadow: the garment floats a few millimetres off the surface, light from above"],
    [tight, "Tight lift shadow along the edges, so the product rests on the surface"],
  ] as const) {
    const x = g.px - s.m + r(sx * s.d);
    const y = g.py - s.m + r(sy * s.d);
    push(
      `l_${L}/c_scale,w_${g.pw},h_${g.ph}/co_rgb:${col},e_colorize:100/c_mpad,w_${g.pw + 2 * s.m},h_${g.ph + 2 * s.m},b_transparent/e_blur:${s.blur}/o_${s.o}` +
        `/e_multiply,fl_layer_apply,fl_no_overflow,g_north_west,x_${x},y_${y}`,
      "shadow",
      label,
    );
  }
}

/**
 * Light-match relighting: a warm/cool wash of the scene's key-light colour on
 * the lit side (screen blend) and a gentle falloff on the far side (multiply).
 * Both are the product's own silhouette, so nothing spills onto the scene.
 */
function relight(push: Push, L: string, g: Geometry, dna: SceneDNA) {
  const { sx } = shadowDirection(dna);
  const side = Math.abs(sx) >= 0.3;
  // gradient_fade: positive x fades from the left, negative from the right
  // shadow falls right (sx > 0) → light from the left
  const { wash } = harmoniseTone(dna);
  if (wash) {
    const from = side ? (sx > 0 ? "x_-0.9" : "x_0.9") : "y_-0.9"; // keep the lit side, fade the far side
    push(
      `l_${L}/c_scale,w_${g.pw},h_${g.ph}/co_rgb:${wash.rgb},e_colorize:100/e_gradient_fade:30,${from}/o_${wash.o}/e_screen,fl_layer_apply,g_north_west,x_${g.px},y_${g.py}`,
      "effect",
      `Light-match: the scene's ${dna.temperature} key light washes over the side of the product that faces it`,
    );
  }
  if (!side) return; // light from front/back: no side falloff to add
  push(
    `l_${L}/c_scale,w_${g.pw},h_${g.ph}/co_rgb:${SHADOW_RGB[dna.temperature]},e_colorize:100/e_gradient_fade:25,${sx > 0 ? "x_0.85" : "x_-0.85"}/o_30/e_multiply,fl_layer_apply,g_north_west,x_${g.px},y_${g.py}`,
    "effect",
    "Light-match: the side facing away from the scene's light falls off gently",
  );
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
  const dna = input.dna;
  const flat = input.placement === "flatlay";
  const segs: XraySegment[] = [];
  const push: Push = (text, kind, label) => segs.push({ text, kind, label });

  push(`c_fill,w_${PLATE.width},h_${PLATE.height}`, "crop", "Scene plate at the canonical 4:5 size");

  if (flat) {
    if (c.shadow) liftShadows(push, L, g, dna);
  } else {
    if (c.shadow) castShadow(push, L, g, dna);
    const reflect = c.reflection === "on" || (c.reflection === "auto" && dna.glossy);
    if (reflect) reflection(push, L, g);
    if (c.contact) contactShadows(push, L, g, input.cutout, dna, reflect);
  }

  const tone = c.harmonise ? `/${harmoniseTone(dna).tone}` : "";
  push(
    `l_${L}/c_scale,w_${g.pw},h_${g.ph}${tone}/fl_layer_apply,g_north_west,x_${g.px},y_${g.py}`,
    "layer",
    c.harmonise
      ? `Your real product, placed where Scene DNA says the surface is, with a subtle ${dna.temperature} light-match`
      : "Your real product, untouched, placed where Scene DNA says the surface is",
  );
  if (c.harmonise) relight(push, L, g, dna);

  if (input.width && input.width !== PLATE.width) push(`c_scale,w_${r(input.width)}`, "crop", "Resize for this view");
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
