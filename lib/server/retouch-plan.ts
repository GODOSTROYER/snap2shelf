import "server-only";
import type { TagDefinition } from "../cloudinary/vision";
import type { BuiltUrl, RetouchFix, XraySegment } from "../types";

/**
 * Q4 auto-retouch decision logic. Pure (no I/O) so it is unit-tested; the
 * orchestration lives in retouch.ts.
 *
 * Signals:
 *  - AI Vision tagging on the analysis JPEG (tags below; ~730 tokens per photo)
 *  - pixel size of the raw (Admin API / upload response)
 *  - bytes per pixel of a JPEG raw (heavy compression)
 *  - mean luma of a 16x16 BMP thumbnail of the raw (1 tx), because AI Vision
 *    only flags *obviously* dark photos: the dim "messy" trail-mix photo
 *    measured L=105 (vs 148 for a well-lit one) but matched no too-dark tag.
 *  - quality_analysis focus (0..1) from analyze, when present
 *
 * Measured live 30 Sep on the dim trail-mix photo (16x16 mean luma):
 *   original L 105.0 · e_improve L 113.7 (1 tx, visibly clearer, more contrast)
 *   · e_enhance L 104.8 (100 tx, subtler: white balance, shadows lifted, highlights pulled)
 * so dim photos get e_improve; e_enhance is kept for blown-out (too bright) photos,
 * where its documented exposure reduction is the thing that helps.
 */

export const RETOUCH_TAGS: TagDefinition[] = [
  { name: "too-dark", description: "The photo is underexposed: the product looks dim, dull or murky, with muddy shadows, as if shot in poor indoor light." },
  { name: "too-bright", description: "The photo is overexposed: bright areas of the product are blown out to flat white and detail is lost." },
  { name: "color-cast", description: "The whole photo has a strong unnatural colour tint, e.g. everything looks too yellow/orange or too blue/green." },
  { name: "blurry", description: "The product itself is out of focus or motion-blurred: its edges and any printed text are soft or smeared." },
  { name: "compression-artifacts", description: "Heavy JPEG compression damage is visible: blocky 8x8 squares, colour banding, ringing halos or smeared, low-detail textures." },
  { name: "hand-in-frame", description: "A human hand or fingers are visible in the photo, e.g. holding or touching the product." },
  { name: "price-tag-visible", description: "A price tag, price sticker, barcode sticker or shop label is stuck on or hanging from the product." },
  { name: "clutter-in-frame", description: "Unrelated objects clutter the frame around the product, e.g. cables, papers, food, bottles or other items." },
];

export const RETOUCH_TAG_NAMES = new Set(RETOUCH_TAGS.map((t) => t.name));

/** Thresholds (documented so the UI can explain a decision). */
export const RETOUCH_LIMITS = {
  /** long side below this → e_upscale (4x per side) */
  minLongSide: 1000,
  /** e_upscale refuses inputs of 4.2 MP or more */
  upscaleMaxPixels: 4_200_000,
  /** e_upscale is 10 tx below 0.25 MP, 100 tx up to 4.2 MP */
  upscaleCheapPixels: 250_000,
  /** mean luma (0..255) of the whole frame below this → brighten */
  darkLuma: 115,
  /** mean luma above this → pull exposure down */
  brightLuma: 215,
  /** JPEG bytes per pixel below this → heavy compression damage */
  jpegMinBytesPerPixel: 0.04,
  /** quality_analysis focus below this → blurry (only used as a second opinion) */
  minFocus: 0.12,
  /** output cap after an upscale, so the cutout stays a sensible size */
  maxOutput: 2000,
} as const;

export interface RetouchInput {
  width: number;
  height: number;
  bytes: number;
  format: string; // raw format as stored, e.g. "jpg", "png"
  focus: number | null; // quality_analysis focus, when analyze ran
  luma: number | null; // mean luma 0..255 of the whole frame, when measured
  tags: string[]; // AI Vision tags that matched (RETOUCH_TAGS names)
}

export interface RetouchStep {
  fix: RetouchFix[];
  component: string; // one URL component
  tx: number; // documented special-effect count on top of the derivation's standard 1 tx
  label: string;
}

export interface RetouchPlan {
  fixes: RetouchFix[]; // in chain order, de-duplicated
  detected: string[]; // tags + measured signals, e.g. ["clutter-in-frame", "dim"]
  steps: RetouchStep[];
  notes: string[]; // plain-language, one per decision (including "no fix needed")
  tx: number; // 1 standard tx for the derivation + the special effect counts
}

const unique = <T,>(xs: T[]) => [...new Set(xs)];

/** Decide which fixes a photo needs. Only applies a fix when a signal asks for it. */
export function planRetouch(i: RetouchInput): RetouchPlan {
  const tags = i.tags.filter((t) => RETOUCH_TAG_NAMES.has(t));
  const has = (t: string) => tags.includes(t);
  const detected = [...tags];
  const steps: RetouchStep[] = [];
  const notes: string[] = [];

  // 1. cleanup: remove a hand / price tag first, on the untouched pixels.
  const remove: string[] = [];
  if (has("hand-in-frame")) remove.push("hand");
  if (has("price-tag-visible")) remove.push("price tag");
  if (remove.length) {
    steps.push({
      fix: ["cleanup"],
      component: `e_gen_remove:prompt_(${remove.map((r) => encodeURIComponent(r)).join(";")})`,
      tx: 50,
      label: `Generative remove: ${remove.join(" and ")}`,
    });
    notes.push(`Removed the ${remove.join(" and ")} with generative remove.`);
  }

  // 2. restore: JPEG damage or blur (one e_gen_restore handles both).
  const pixels = Math.max(1, i.width * i.height);
  const isJpeg = /^jpe?g$/i.test(i.format);
  const lowBpp = isJpeg && i.bytes > 0 && i.bytes / pixels < RETOUCH_LIMITS.jpegMinBytesPerPixel;
  if (lowBpp) detected.push("heavy-compression");
  const blurByFocus = i.focus !== null && i.focus < RETOUCH_LIMITS.minFocus;
  if (blurByFocus) detected.push("low-focus");
  const restoreWhy: string[] = [];
  if (has("compression-artifacts") || lowBpp) restoreWhy.push("compression damage");
  if (has("blurry") || blurByFocus) restoreWhy.push("blur");
  if (restoreWhy.length) {
    steps.push({ fix: ["restore"], component: "e_gen_restore", tx: 100, label: `Generative restore (${restoreWhy.join(", ")})` });
    notes.push(`Restored detail lost to ${restoreWhy.join(" and ")}.`);
  }

  // 3. light: dim → e_improve (1 tx); blown out → e_enhance (100 tx); colour cast → e_improve.
  const dim = has("too-dark") || (i.luma !== null && i.luma < RETOUCH_LIMITS.darkLuma);
  const bright = !dim && (has("too-bright") || (i.luma !== null && i.luma > RETOUCH_LIMITS.brightLuma));
  const cast = has("color-cast");
  if (i.luma !== null && i.luma < RETOUCH_LIMITS.darkLuma && !has("too-dark")) detected.push("dim");
  if (i.luma !== null && i.luma > RETOUCH_LIMITS.brightLuma && !has("too-bright")) detected.push("overexposed");
  if (bright) {
    steps.push({ fix: cast ? ["brightness", "color"] : ["brightness"], component: "e_enhance", tx: 100, label: "AI enhance (exposure and white balance)" });
    notes.push("Pulled back an overexposed photo with AI enhance.");
  } else if (dim || cast) {
    const fix: RetouchFix[] = [...(dim ? (["brightness"] as const) : []), ...(cast ? (["color"] as const) : [])];
    // e_improve has no special count: it rides on the derivation's standard 1 tx
    steps.push({ fix, component: "e_improve", tx: 0, label: `Auto-improve (${[dim && "brightness", cast && "colour"].filter(Boolean).join(", ")})` });
    notes.push(dim ? "Brightened a dim photo with auto-improve." : "Corrected a colour cast with auto-improve.");
  }

  // 4. resolution: small photo → e_upscale (4x per side), then cap the output.
  const longSide = Math.max(i.width, i.height);
  if (longSide > 0 && longSide < RETOUCH_LIMITS.minLongSide && pixels < RETOUCH_LIMITS.upscaleMaxPixels) {
    detected.push("small");
    steps.push({
      fix: ["resolution"],
      component: "e_upscale",
      tx: pixels < RETOUCH_LIMITS.upscaleCheapPixels ? 10 : 100,
      label: `AI upscale (${i.width}×${i.height} → up to 4x)`,
    });
    notes.push(`Upscaled a small ${i.width}×${i.height} photo.`);
  }

  if (has("clutter-in-frame")) notes.push("Background clutter needs no fix: the cutout removes it.");
  if (!steps.length) notes.unshift("The photo is good to go; no fix needed.");

  const fixes = unique(steps.flatMap((s) => s.fix));
  const base = steps.length ? 1 : 0;
  return { fixes, detected: unique(detected), steps, notes, tx: base + steps.reduce((n, s) => n + s.tx, 0) };
}

/** Delivery options appended to every retouch chain (a JPEG snapshot the cutout starts from). */
export const RETOUCH_OUTPUT = `c_limit,w_${RETOUCH_LIMITS.maxOutput},h_${RETOUCH_LIMITS.maxOutput}/f_jpg,q_95`;

/** The derived transformation for a plan ("" when nothing needs fixing). */
export function retouchChain(plan: Pick<RetouchPlan, "steps">): string {
  if (!plan.steps.length) return "";
  return [...plan.steps.map((s) => s.component), RETOUCH_OUTPUT].join("/");
}

/** X-ray segments for the retouch URL. */
export function retouchXray(url: string, plan: Pick<RetouchPlan, "steps">, sourcePublicId: string): BuiltUrl {
  const segments: XraySegment[] = plan.steps.map((s) => ({
    text: s.component,
    kind: s.component.startsWith("e_gen_") || s.component === "e_upscale" || s.component === "e_enhance" ? "gen-ai" : "effect",
    label: `${s.label} · ${s.tx ? `${s.tx} tx` : "no extra tx"}`,
  }));
  segments.push({ text: RETOUCH_OUTPUT, kind: "format", label: "Cap at 2000 px, JPEG q95 snapshot for the cutout" });
  segments.push({ text: sourcePublicId, kind: "asset", label: "Original upload" });
  return { url, transformation: retouchChain(plan), segments };
}

/**
 * Mean luma (Rec. 709, 0..255) of an uncompressed BMP (24 or 32 bpp), e.g. the
 * `c_scale,w_16,h_16/f_bmp` thumbnail of a photo. Returns null for anything else.
 */
export function bmpMeanLuma(buf: Uint8Array): number | null {
  if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const offset = view.getUint32(10, true);
  const width = view.getInt32(18, true);
  const height = Math.abs(view.getInt32(22, true));
  const bpp = view.getUint16(28, true);
  const compression = view.getUint32(30, true);
  if ((bpp !== 24 && bpp !== 32) || (compression !== 0 && compression !== 3) || width <= 0 || height <= 0) return null;
  const px = bpp / 8;
  const row = Math.ceil((width * px) / 4) * 4;
  if (offset + row * (height - 1) + width * px > buf.length) return null;
  let sum = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = offset + y * row + x * px;
      sum += 0.0722 * buf[i] + 0.7152 * buf[i + 1] + 0.2126 * buf[i + 2]; // BGR
    }
  }
  return sum / (width * height);
}

// ------------------------------------------------------------------ context codec (on the raw asset)

/**
 * Keys written on snap2shelf/products/<sku>/raw:
 *   fix_tags  AI Vision tags that matched ("-" when none)
 *   fix_luma  measured mean luma
 *   fix_plan  planned fixes, comma list ("none" when the photo is fine)
 *   fix_chain the derived transformation
 *   fix_tx    documented transformation estimate
 *   fix_id    retouched public id, once saved
 *   fix_err   "1" when Cloudinary refused the chain (the cutout then uses the raw)
 *   t_fix / ms_fix  AI Vision tokens / server ms spent planning
 */
export interface RetouchState {
  planned: boolean;
  tags: string[];
  luma: number | null;
  fixes: RetouchFix[];
  chain: string;
  tx: number;
  retouchedPublicId?: string;
  failed: boolean;
}

const FIX_NAMES: RetouchFix[] = ["cleanup", "restore", "brightness", "color", "resolution"];

export function retouchStateFromContext(c: Record<string, string>): RetouchState {
  const fixes = (c.fix_plan ?? "")
    .split(",")
    .filter((f): f is RetouchFix => (FIX_NAMES as string[]).includes(f));
  const luma = Number(c.fix_luma);
  return {
    planned: typeof c.fix_plan === "string" && c.fix_plan.length > 0,
    tags: c.fix_tags && c.fix_tags !== "-" ? c.fix_tags.split(",").filter((t) => RETOUCH_TAG_NAMES.has(t)) : [],
    luma: c.fix_luma && Number.isFinite(luma) ? luma : null,
    fixes,
    chain: c.fix_chain ?? "",
    tx: Number(c.fix_tx) || 0,
    retouchedPublicId: c.fix_id || undefined,
    failed: c.fix_err === "1",
  };
}

/** AnalyzeResponse.fixes from the raw asset's context. */
export function fixesFromContext(c: Record<string, string>, expectedRetouchedId?: string): { applied: RetouchFix[]; retouchedPublicId?: string } {
  const s = retouchStateFromContext(c);
  if (!s.retouchedPublicId || s.failed || (expectedRetouchedId && s.retouchedPublicId !== expectedRetouchedId)) return { applied: [] };
  return { applied: s.fixes, retouchedPublicId: s.retouchedPublicId };
}
