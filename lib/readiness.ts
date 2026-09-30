/**
 * Marketplace & social Readiness Score (U5). Pure and client-safe: the server
 * measures (lib/shelf/measure.ts), this file decides and explains.
 *
 * Six checks, weighted to 100 points:
 *   white-bg    25  border of the marketplace main image is pure white (sampled pixels, not assumed)
 *   fill        15  product's longest side fills ≈85% of the square (80–90% passes)
 *   resolution  20  ≥1000 px product pixels (zoom threshold); 2000 px canvas is the target
 *   no-text     15  no watermark / overlay text / extra objects (AI Vision tagging)
 *   sharpness   15  quality_analysis focus stored at analyze time
 *   safe-zone   10  product stays clear of story UI bands and the offer-text band
 * pass = full points, warn = half, fail = 0, unknown = left out (score is rescaled).
 * Every non-passing check carries a one-click fix descriptor.
 */
import type { CompositeControls, SceneDNA, Sku } from "./types";

export type CheckId = "white-bg" | "fill" | "resolution" | "no-text" | "sharpness" | "safe-zone";
export type CheckStatus = "pass" | "warn" | "fail" | "unknown";
export type Grade = "ready" | "almost" | "not-ready";

export type ReadinessFix =
  | {
      kind: "transformation";
      label: string;
      /** Transformation that produces the fixed image (between /upload/ and the public id). */
      transformation: string;
      /** Delivery URL of the fixed image, so the UI can preview it before saving. */
      previewUrl?: string;
      /** Paid AI effect (e_upscale, e_gen_remove …): the UI should confirm first. */
      paid?: boolean;
      /** Set when POST /api/readiness/:sku {fix} can apply it to the saved marketplace image in one click. */
      apply?: ApplicableFix;
    }
  | { kind: "restage"; label: string; controls: Partial<CompositeControls> }
  | { kind: "repack"; label: string; textZone: SceneDNA["text_zone"] }
  | { kind: "retake"; label: string; tip: string };

export interface ReadinessCheck {
  id: CheckId;
  label: string;
  status: CheckStatus;
  weight: number;
  points: number;
  /** One line, plain language, with the measured value. */
  detail: string;
  measured?: number | string;
  fix?: ReadinessFix;
}

export interface ReadinessReport {
  sku: Sku;
  score: number; // 0..100
  grade: Grade;
  checks: ReadinessCheck[];
  /** The marketplace image that was measured. */
  image: { url: string; width: number; height: number; materialised: boolean };
  /** Same objective checks on the original phone photo, for the before → after story. */
  baseline?: { score: number; grade: Grade; checks: ReadinessCheck[] };
  measuredAt: string;
}

export const WEIGHTS: Record<CheckId, number> = {
  "white-bg": 25,
  fill: 15,
  resolution: 20,
  "no-text": 15,
  sharpness: 15,
  "safe-zone": 10,
};

export const LABELS: Record<CheckId, string> = {
  "white-bg": "Pure white background",
  fill: "Product fills ~85% of the frame",
  resolution: "Resolution for zoom",
  "no-text": "No text, watermark or props",
  sharpness: "Sharp focus",
  "safe-zone": "Clear of social text zones",
};

// ------------------------------------------------------------------ pixel sampling

export interface Pixels {
  width: number;
  height: number;
  /** RGB triplets, row-major from the TOP-left, already composited over white when the source had alpha. */
  rgb: Uint8Array;
}

/**
 * Decode an uncompressed BMP (what Cloudinary returns for `f_bmp`: 24-bit BI_RGB,
 * or 32-bit BI_BITFIELDS with alpha for transparent sources). Transparent pixels
 * are composited over white, which is what the marketplace JPEG gets.
 */
export function decodeBmp(buf: Uint8Array): Pixels {
  if (buf.length < 54 || buf[0] !== 0x42 || buf[1] !== 0x4d) throw new Error("not a BMP");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const dataOffset = dv.getUint32(10, true);
  const headerSize = dv.getUint32(14, true);
  const width = dv.getInt32(18, true);
  const rawHeight = dv.getInt32(22, true);
  const bpp = dv.getUint16(28, true);
  const compression = dv.getUint32(30, true);
  if (width <= 0 || width > 4096 || rawHeight === 0 || Math.abs(rawHeight) > 4096) throw new Error("bad BMP size");
  if (bpp !== 24 && bpp !== 32) throw new Error(`unsupported BMP depth ${bpp}`);
  if (compression !== 0 && compression !== 3) throw new Error(`unsupported BMP compression ${compression}`);
  const height = Math.abs(rawHeight);
  const bottomUp = rawHeight > 0;

  // channel masks: BI_BITFIELDS stores them after the 40-byte header (V4/V5 headers include them)
  let masks = { r: 0x00ff0000, g: 0x0000ff00, b: 0x000000ff, a: bpp === 32 ? 0xff000000 : 0 };
  if (compression === 3) {
    masks = {
      r: dv.getUint32(54, true),
      g: dv.getUint32(58, true),
      b: dv.getUint32(62, true),
      a: headerSize >= 56 ? dv.getUint32(66, true) : 0,
    };
  }
  const shiftOf = (m: number) => (m ? 31 - Math.clz32(m & -m) : 0);
  const chan = (v: number, m: number) => {
    if (!m) return 255;
    const s = shiftOf(m);
    const max = m >>> s;
    return Math.round((((v & m) >>> s) / max) * 255);
  };

  const stride = Math.ceil((bpp * width) / 32) * 4;
  if (dataOffset + stride * height > buf.length) throw new Error("truncated BMP");
  const rgb = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const row = dataOffset + (bottomUp ? height - 1 - y : y) * stride;
    for (let x = 0; x < width; x++) {
      let r: number, g: number, b: number, a = 255;
      if (bpp === 24) {
        const o = row + x * 3;
        b = buf[o];
        g = buf[o + 1];
        r = buf[o + 2];
      } else {
        const v = dv.getUint32(row + x * 4, true);
        r = chan(v, masks.r);
        g = chan(v, masks.g);
        b = chan(v, masks.b);
        a = masks.a ? chan(v, masks.a) : 255;
      }
      const t = a / 255;
      const o = (y * width + x) * 3;
      rgb[o] = Math.round(r * t + 255 * (1 - t));
      rgb[o + 1] = Math.round(g * t + 255 * (1 - t));
      rgb[o + 2] = Math.round(b * t + 255 * (1 - t));
    }
  }
  return { width, height, rgb };
}

export interface BorderStats {
  samples: number;
  /** Share of border samples that are pure white (every channel ≥ WHITE_MIN). */
  whiteShare: number;
  /** Darkest channel value seen on the border. */
  minChannel: number;
  /** Mean colour of the border, as hex without '#'. */
  meanHex: string;
}

/** A JPEG of pure white decodes to 253–255 per channel; 250 leaves room for q_auto, never for grey. */
export const WHITE_MIN = 250;

/** Measure the outer `ring` pixels of a small downscaled sample (e.g. 48x48 of the 2000x2000 image). */
export function borderStats(p: Pixels, ring = 1): BorderStats {
  let n = 0;
  let white = 0;
  let min = 255;
  const sum = [0, 0, 0];
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      const onBorder = x < ring || y < ring || x >= p.width - ring || y >= p.height - ring;
      if (!onBorder) continue;
      const o = (y * p.width + x) * 3;
      const r = p.rgb[o];
      const g = p.rgb[o + 1];
      const b = p.rgb[o + 2];
      n++;
      sum[0] += r;
      sum[1] += g;
      sum[2] += b;
      const lo = Math.min(r, g, b);
      if (lo < min) min = lo;
      if (lo >= WHITE_MIN) white++;
    }
  }
  const hex = sum.map((s) => Math.round(s / Math.max(1, n)).toString(16).padStart(2, "0")).join("");
  return { samples: n, whiteShare: n ? white / n : 0, minChannel: n ? min : 0, meanHex: hex };
}

/**
 * Bounding box of non-white pixels in the sample, as a fraction of each side.
 * Coarse (one sample pixel ≈ 2% of a 48 px sample) — a cross-check, not the source of truth.
 */
export function contentBox(p: Pixels, threshold = 245): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = p.width;
  let y0 = p.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < p.height; y++) {
    for (let x = 0; x < p.width; x++) {
      const o = (y * p.width + x) * 3;
      if (Math.min(p.rgb[o], p.rgb[o + 1], p.rgb[o + 2]) < threshold) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { x0: x0 / p.width, y0: y0 / p.height, x1: (x1 + 1) / p.width, y1: (y1 + 1) / p.height };
}

// ------------------------------------------------------------------ checks

const pct = (n: number) => `${Math.round(n * 100)}%`;

function check(id: CheckId, status: CheckStatus, detail: string, extra: Partial<ReadinessCheck> = {}): ReadinessCheck {
  const weight = WEIGHTS[id];
  const points = status === "pass" ? weight : status === "warn" ? Math.round(weight / 2) : 0;
  return { id, label: LABELS[id], status, weight, points, detail, ...extra };
}

/**
 * Transformation that re-pads a transparent cutout to 85% on a 2000 px pure-white square.
 * c_mpad, not c_pad: c_pad scales the 1700 px fit back up to 2000 (product touches the edges);
 * verified live 2026-09-30 → bbox 1700/2000 = 0.85, border 255.
 */
export const REPAD_85 = "c_fit,w_1700,h_1700/c_mpad,w_2000,h_2000,b_white/f_jpg,q_auto:best";

/** Named fixes the server may apply to the marketplace asset (POST /api/readiness/:sku). */
export const APPLICABLE_FIXES = {
  repad: REPAD_85,
  sharpen: `e_sharpen:80/${REPAD_85}`,
} as const;
export type ApplicableFix = keyof typeof APPLICABLE_FIXES;

export function checkWhiteBackground(border: BorderStats | null, fixUrl?: string): ReadinessCheck {
  const fix: ReadinessFix = { kind: "transformation", label: "Re-pad on pure white", transformation: REPAD_85, previewUrl: fixUrl, apply: "repad" };
  if (!border) return check("white-bg", "unknown", "Couldn't sample the image border.");
  const measured = `#${border.meanHex}`;
  if (border.whiteShare >= 0.98 && border.minChannel >= WHITE_MIN - 5) {
    return check("white-bg", "pass", `Border measures ${measured}, ${pct(border.whiteShare)} pure white.`, { measured });
  }
  if (border.whiteShare >= 0.85) {
    return check("white-bg", "warn", `Mostly white (${pct(border.whiteShare)}), but some edge pixels are off-white.`, { measured, fix });
  }
  return check("white-bg", "fail", `Border averages ${measured}: marketplaces reject non-white main images.`, { measured, fix });
}

/** fill = product's longest side / canvas side (0..1). */
export function checkFill(fill: number | null, fixUrl?: string): ReadinessCheck {
  if (fill === null || !Number.isFinite(fill)) return check("fill", "unknown", "Couldn't measure the product's size in the frame.");
  const measured = Math.round(fill * 1000) / 1000;
  const fix: ReadinessFix = { kind: "transformation", label: "Re-frame to 85%", transformation: REPAD_85, previewUrl: fixUrl, apply: "repad" };
  if (fill >= 0.8 && fill <= 0.9) return check("fill", "pass", `Product fills ${pct(fill)} of the frame.`, { measured });
  if (fill >= 0.7 && fill <= 0.95) {
    return check("fill", "warn", `Product fills ${pct(fill)}; marketplaces want about 85%.`, { measured, fix });
  }
  return check("fill", "fail", fill < 0.7 ? `Product fills only ${pct(fill)}: it looks lost in the frame.` : `Product fills ${pct(fill)}: it touches the edges.`, { measured, fix });
}

/**
 * canvas = the delivered image's longest side; native = the product's own pixels
 * on its longest side (the cutout), i.e. how much real detail zoom can show.
 */
export function checkResolution(canvas: number, native: number | null, upscaleUrl?: string): ReadinessCheck {
  const fixUpscale: ReadinessFix = {
    kind: "transformation",
    label: "AI upscale the product",
    transformation: "e_upscale/" + REPAD_85,
    previewUrl: upscaleUrl,
    paid: true,
  };
  if (canvas < 1000) {
    return check("resolution", "fail", `Only ${canvas} px: marketplaces need at least 1000 px for zoom.`, { measured: canvas, fix: fixUpscale });
  }
  if (native !== null && native < 600) {
    return check("resolution", "fail", `${canvas} px canvas, but the product itself is only ${native} px: zoom will look soft.`, { measured: native, fix: fixUpscale });
  }
  if (native !== null && native < 1000) {
    return check("resolution", "warn", `${canvas} px canvas from ${native} px of real product detail: fine on phones, soft on zoom.`, { measured: native, fix: fixUpscale });
  }
  if (canvas < 2000) {
    return check("resolution", "warn", `${canvas} px meets the 1000 px minimum; 2000 px is the target for crisp zoom.`, {
      measured: canvas,
      fix: { kind: "transformation", label: "Export at 2000 px", transformation: REPAD_85 },
    });
  }
  return check("resolution", "pass", `${canvas} px canvas${native !== null ? `, ${native} px of real product detail` : ""}.`, { measured: canvas });
}

/** Tag names for the AI Vision tagging call (lower-case letters, digits and hyphens only). */
export const TEXT_TAGS = [
  {
    name: "watermark",
    description: "A watermark, stock-photo mark, copyright notice or semi-transparent logo is overlaid on top of the photo.",
  },
  {
    name: "overlay-text",
    description:
      "Promotional text, a price, a badge, a sticker, a caption or a border has been ADDED ON TOP of the photo. Text that is printed on the product itself or on its packaging does NOT count.",
  },
  {
    name: "extra-objects",
    description: "Besides the single main product there are other objects in the image: props, plants, hands, other products or furniture.",
  },
  { name: "product-visible", description: "One physical product is clearly visible, whole, and not cut off by the image edges." },
] as const;

export function checkNoText(matched: string[] | null): ReadinessCheck {
  if (!matched) return check("no-text", "unknown", "Not checked yet (AI Vision).");
  const issues: string[] = [];
  if (matched.includes("watermark")) issues.push("a watermark");
  if (matched.includes("overlay-text")) issues.push("overlaid text or badges");
  if (matched.includes("extra-objects")) issues.push("extra objects or props");
  if (!issues.length) {
    return check("no-text", matched.includes("product-visible") ? "pass" : "warn", matched.includes("product-visible") ? "Just the product: no watermark, overlay text or props." : "No text found, but the product isn't clearly visible.", {
      measured: matched.join(",") || "none",
    });
  }
  return check("no-text", "fail", `AI Vision found ${issues.join(" and ")}.`, {
    measured: matched.join(","),
    fix: { kind: "transformation", label: "Rebuild from the cutout", transformation: REPAD_85, apply: "repad" },
  });
}

/** quality_analysis.focus 0..1, stored in the raw asset's context at analyze time. */
export function checkSharpness(focus: number | null, sharpenUrl?: string, sharpened = false): ReadinessCheck {
  if (focus === null || !Number.isFinite(focus)) return check("sharpness", "unknown", "No focus measurement yet (analyze the photo first).");
  const measured = Math.round(focus * 100) / 100;
  const sharpen: ReadinessFix = { kind: "transformation", label: "Sharpen", transformation: APPLICABLE_FIXES.sharpen, previewUrl: sharpenUrl, apply: "sharpen" };
  if (focus >= 0.6) return check("sharpness", "pass", `Focus score ${measured.toFixed(2)}: crisp.`, { measured });
  if (focus >= 0.35 && sharpened) return check("sharpness", "pass", `Focus score ${measured.toFixed(2)}, sharpened with e_sharpen:80.`, { measured });
  if (focus >= 0.35) return check("sharpness", "warn", `Focus score ${measured.toFixed(2)}: a little soft.`, { measured, fix: sharpen });
  return check("sharpness", "fail", `Focus score ${measured.toFixed(2)}: blurry.`, {
    measured,
    fix: { kind: "retake", label: "Retake the photo", tip: "Tap to focus on the product and hold the phone steady, or rest it on something." },
  });
}

// ------------------------------------------------------------------ social safe zones

/** Product box on the 1080x1350 plate (see geometry()). baseY defaults to py + ph. */
export interface ProductBoxLike {
  px: number;
  py: number;
  pw: number;
  ph: number;
  baseY?: number;
}

/** Story 9:16: the 4:5 hero is centred on 1080x1920, so it starts 285 px down. */
export const STORY = { width: 1080, height: 1920, heroTop: 285, topBand: 250, bottomBand: 340, side: 60 } as const;

/** Where the offer overlay (lib/transform/channels.ts) writes on the 1350 px hero: two lines, ~70–270 px from the edge. */
export const OFFER_BAND = 280;
const PLATE_H = 1350;

export function checkSafeZone(box: ProductBoxLike | null, opts: { textZone?: SceneDNA["text_zone"]; hasOffer?: boolean } = {}): ReadinessCheck {
  if (!box) return check("safe-zone", "unknown", "Product position unknown (stage it in Snap2Shelf to measure).");
  const top = box.py;
  const bottom = box.baseY ?? box.py + box.ph;
  const storyTop = STORY.heroTop + top;
  const storyBottom = STORY.heroTop + bottom;
  const measured = `${storyTop}-${storyBottom}`;

  const story: string[] = [];
  if (storyTop < STORY.topBand) story.push("its top sits under the story header");
  if (storyBottom > STORY.height - STORY.bottomBand) story.push("its base sits under the reply bar");
  if (box.px < STORY.side || box.px + box.pw > STORY.width - STORY.side) story.push("it touches the side edges");

  // channels.ts writes the offer at the bottom only for text_zone "bottom", otherwise at the top
  const zone = opts.textZone ?? "top";
  const offerAtBottom = zone === "bottom";
  const clearTop = top >= OFFER_BAND;
  const clearBottom = bottom <= PLATE_H - OFFER_BAND;
  const offerClash = Boolean(opts.hasOffer) && (offerAtBottom ? !clearBottom : !clearTop);

  if (!story.length && !offerClash) return check("safe-zone", "pass", "Clear of the story header, reply bar and offer text.", { measured });

  let fix: ReadinessFix | undefined;
  if (offerClash) {
    if (!offerAtBottom && clearBottom) fix = { kind: "repack", label: "Move the offer text to the bottom", textZone: "bottom" };
    else if (offerAtBottom && clearTop) fix = { kind: "repack", label: "Move the offer text to the top", textZone: "top" };
    else fix = { kind: "restage", label: "Make the product a little smaller", controls: { scale: 0.4 } };
  } else if (storyBottom > STORY.height - STORY.bottomBand) {
    const up = storyBottom - (STORY.height - STORY.bottomBand);
    fix = { kind: "restage", label: `Move the product up ${up} px`, controls: { offsetY: -Math.ceil(up / 10) * 10 } };
  } else {
    fix = { kind: "restage", label: "Make the product a little smaller", controls: { scale: 0.4 } };
  }
  const parts = [offerClash ? "the offer text would overlap the product" : "", story.length ? `on a story, ${story.join(" and ")}` : ""].filter(Boolean);
  const detail = parts.join("; ");
  const n = story.length + (offerClash ? 1 : 0);
  return check("safe-zone", n > 1 ? "fail" : "warn", detail[0].toUpperCase() + detail.slice(1) + ".", { measured, fix });
}

// ------------------------------------------------------------------ score

export function score(checks: ReadinessCheck[]): number {
  const known = checks.filter((c) => c.status !== "unknown");
  const total = known.reduce((s, c) => s + c.weight, 0);
  if (!total) return 0;
  return Math.round((100 * known.reduce((s, c) => s + c.points, 0)) / total);
}

export function grade(s: number): Grade {
  return s >= 85 ? "ready" : s >= 60 ? "almost" : "not-ready";
}

export const GRADE_LABEL: Record<Grade, string> = {
  ready: "Marketplace ready",
  almost: "Almost there",
  "not-ready": "Needs work",
};

/** Keep check order stable for the UI: the objective checks first. */
export const CHECK_ORDER: CheckId[] = ["white-bg", "fill", "resolution", "sharpness", "no-text", "safe-zone"];

export function sortChecks(checks: ReadinessCheck[]): ReadinessCheck[] {
  return [...checks].sort((a, b) => CHECK_ORDER.indexOf(a.id) - CHECK_ORDER.indexOf(b.id));
}

/** Parse "px,py,pw,ph[,baseY]" (pack_box / geo context values). */
export function parseBox(s: string | undefined | null): ProductBoxLike | null {
  if (!s) return null;
  const n = s.split(",").map(Number);
  if ((n.length !== 4 && n.length !== 5) || n.some((v) => !Number.isFinite(v) || Math.abs(v) > 5000)) return null;
  const [px, py, pw, ph, baseY] = n;
  if (pw <= 0 || ph <= 0) return null;
  return { px, py, pw, ph, baseY: baseY ?? py + ph };
}
