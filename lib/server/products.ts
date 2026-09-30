import "server-only";
import { v2 as cloudinary } from "cloudinary";
import { z } from "zod";
import type { AnalyzeResponse, CutoutResponse } from "../api-contract";
import { withPooledAccount } from "../cloudinary/pool";
import { captioning, parseJsonAnswer, visionGeneral } from "../cloudinary/vision";
import {
  SCENE_THEMES,
  VIEW_FOR_PLACEMENT,
  productId,
  type CutoutRecord,
  type Placement,
  type ProductRecord,
  type ProductUnderstanding,
  type Sku,
} from "../types";
import { addContext, deliveryUrl, getResource, mainAuth, probe, uploadToMain, type AssetInfo, type Ctx } from "./cld";
import { HttpError, notFound, pending } from "./http";
import { fixesFromContext } from "./retouch-plan";

/**
 * Product steps on the raw upload: analyze (caption + focus + AI Vision product
 * JSON, cached in the raw asset's context) and cutout (background removal +
 * trim, saved once as its own asset).
 */

export const rawId = (sku: Sku) => productId(sku, "raw");
export const cutoutId = (sku: Sku) => productId(sku, "cutout");
/** Q4 auto-retouch output (see retouch.ts); the cutout prefers it when present. */
export const retouchedId = (sku: Sku) => productId(sku, "retouched");
export const skuTag = (sku: Sku) => `s2s-sku-${sku}`;

export async function requireRaw(sku: Sku): Promise<AssetInfo> {
  const raw = await getResource(rawId(sku));
  if (!raw) throw notFound("No upload found for this product yet.");
  return raw;
}

export function productRecord(sku: Sku, raw: AssetInfo, cutout?: CutoutRecord | null): ProductRecord {
  const understanding = understandingFromContext(raw.context);
  const focus = Number(raw.context.focus);
  return {
    sku,
    rawPublicId: raw.publicId,
    rawWidth: raw.width,
    rawHeight: raw.height,
    rawBytes: raw.bytes,
    caption: raw.context.caption || undefined,
    focus: raw.context.focus && Number.isFinite(focus) ? focus : undefined,
    understanding: understanding ?? undefined,
    cutout: cutout ?? undefined,
  };
}

// ------------------------------------------------------------------ analyze

const THEME_SLUGS = SCENE_THEMES.map((t) => t.slug) as string[];

const understandingSchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.string().trim().min(1).max(40),
  primary_color: z.string().trim().min(1).max(30),
  material: z.string().trim().min(1).max(60),
  recolorable_part: z.string().trim().min(1).max(40),
  placement: z.enum(["standing", "flatlay", "hanging"]),
  suggested_themes: z.array(z.string()).max(8).default([]),
});

const UNDERSTANDING_PROMPT = `You are cataloguing a product photo for an online seller.
Look only at the main product (ignore the background and props). Return ONLY a JSON object, no prose:
{"name": short product name, e.g. "Stainless steel water bottle",
 "category": one or two words, e.g. "drinkware",
 "primary_color": the product's main colour in plain words,
 "material": main visible material,
 "recolorable_part": the 1-3 word name of the product part a colour variant would change, e.g. "bottle body",
 "placement": "standing" if it stands upright on a surface (bottles, shoes, boxes, jars), "flatlay" if it is best shot lying flat from above (clothing, textiles, flat accessories, pouches), "hanging" if it hangs (bags on hooks, garments on hangers),
 "suggested_themes": up to 3 scene themes that suit it, chosen ONLY from: ${SCENE_THEMES.map((t) => `"${t.slug}" (${t.label}, ${t.view})`).join(", ")}}`;

function fitThemes(themes: string[], placement: Placement): string[] {
  const view = VIEW_FOR_PLACEMENT[placement];
  const okForView = new Set(SCENE_THEMES.filter((t) => t.view === view).map((t) => t.slug as string));
  const picked = [...new Set(themes.map((t) => t.trim().toLowerCase()))].filter((t) => THEME_SLUGS.includes(t) && okForView.has(t));
  if (picked.length) return picked.slice(0, 3);
  return view === "top-down" ? ["flatlay-festive", "flatlay-linen"] : ["diwali", "marble", "pastel"];
}

/** Used when AI Vision's JSON is unusable: generic but valid, staged standing. */
export function fallbackUnderstanding(caption: string): ProductUnderstanding {
  const flat = /\b(shirt|kurta|dress|saree|sari|scarf|towel|t-shirt|tshirt|pouch|wallet|cloth|fabric)\b/i.test(caption);
  const placement: Placement = flat ? "flatlay" : "standing";
  return {
    name: "Product",
    category: "product",
    primary_color: "neutral",
    material: "mixed",
    recolorable_part: "product",
    placement,
    suggested_themes: fitThemes([], placement),
  };
}

export function parseUnderstanding(answer: string | undefined, caption: string): { understanding: ProductUnderstanding; fromAi: boolean } {
  const parsed = answer ? parseJsonAnswer(answer, understandingSchema) : null;
  if (!parsed) return { understanding: fallbackUnderstanding(caption), fromAi: false };
  return {
    understanding: { ...parsed, suggested_themes: fitThemes(parsed.suggested_themes, parsed.placement) },
    fromAi: true,
  };
}

function understandingToContext(u: ProductUnderstanding): Ctx {
  return {
    u_name: u.name,
    u_cat: u.category,
    u_color: u.primary_color,
    u_mat: u.material,
    u_part: u.recolorable_part,
    u_place: u.placement,
    u_themes: u.suggested_themes.join(","),
  };
}

export function understandingFromContext(c: Ctx): ProductUnderstanding | null {
  if (!c.u_name || !c.u_place) return null;
  const placement = (["standing", "flatlay", "hanging"].includes(c.u_place) ? c.u_place : "standing") as Placement;
  return {
    name: c.u_name,
    category: c.u_cat ?? "product",
    primary_color: c.u_color ?? "neutral",
    material: c.u_mat ?? "mixed",
    recolorable_part: c.u_part ?? "product",
    placement,
    suggested_themes: fitThemes((c.u_themes ?? "").split(","), placement),
  };
}

/** What AI Vision / captioning look at: the raw capped at 1024 px, as JPEG. */
export const analysisSourceUrl = (sku: Sku) => deliveryUrl(rawId(sku), "c_limit,w_1024,h_1024/f_jpg,q_80");

export interface AnalyzeOutcome {
  response: AnalyzeResponse;
  cached: boolean;
}

export async function analyzeProduct(sku: Sku): Promise<AnalyzeOutcome> {
  const raw = await requireRaw(sku);
  const cachedU = raw.context.analyzed === "1" ? understandingFromContext(raw.context) : null;
  if (cachedU) {
    const focus = Number(raw.context.focus);
    return {
      cached: true,
      response: {
        sku,
        caption: raw.context.caption ?? "",
        focus: raw.context.focus && Number.isFinite(focus) ? focus : null,
        understanding: cachedU,
        fixes: fixesFromContext(raw.context, retouchedId(sku)),
        tokens: 0,
      },
    };
  }

  const t0 = Date.now();
  const source = { uri: analysisSourceUrl(sku) };
  // Warm the derived JPEG once so the three analysers don't race to create it.
  await probe(source.uri, 6000);

  const [caption, understanding, quality] = await Promise.allSettled([
    withPooledAccount("object_detection", (a) => captioning(a, source)),
    withPooledAccount("ai_vision", (a) => visionGeneral(a, source, [UNDERSTANDING_PROMPT])),
    cloudinary.uploader.explicit(raw.publicId, { ...mainAuth(), type: "upload", quality_analysis: true }),
  ]);

  const captionText = caption.status === "fulfilled" ? caption.value.result.caption : "";
  const answer = understanding.status === "fulfilled" ? understanding.value.result.answers[0] : undefined;
  const tokens = understanding.status === "fulfilled" ? (understanding.value.result.quota?.usedByRequest ?? 0) : 0;
  const q = quality.status === "fulfilled" ? (quality.value as { quality_analysis?: { focus?: number } }).quality_analysis : undefined;
  const focus = typeof q?.focus === "number" && Number.isFinite(q.focus) ? q.focus : null;

  for (const [label, r] of [["captioning", caption], ["ai_vision", understanding], ["quality", quality]] as const) {
    if (r.status === "rejected") console.error(`[analyze] ${label} failed: ${String((r.reason as Error)?.message ?? r.reason).slice(0, 200)}`);
  }
  if (caption.status === "rejected" && understanding.status === "rejected") {
    // Nothing usable: surface the upstream failure (pool exhaustion maps to quota_low).
    throw caption.reason;
  }

  const { understanding: u, fromAi } = parseUnderstanding(answer, captionText);
  const alt = captionText || `${u.name} (${u.primary_color})`;
  await addContext([raw.publicId], {
    caption: alt,
    ...(focus !== null ? { focus: focus.toFixed(3) } : {}),
    ...understandingToContext(u),
    analyzed: fromAi || captionText ? "1" : "0",
    // cost ledger (GET /api/cost/:sku): AI Vision tokens and server time of this step
    t_an: String(tokens),
    ms_an: String(Date.now() - t0),
  });

  return {
    cached: false,
    response: { sku, caption: alt, focus, understanding: u, fixes: fixesFromContext(raw.context, retouchedId(sku)), tokens },
  };
}

// ------------------------------------------------------------------ cutout

/**
 * One derived URL does the whole job (verified live): remove the background,
 * trim transparent edges so the layer box equals the product box, PNG.
 */
export const CUTOUT_CHAIN = "e_background_removal/e_trim/f_png";

export const cutoutRecord = (a: AssetInfo): CutoutRecord => ({ publicId: a.publicId, width: a.width, height: a.height, version: a.version });

export async function getCutout(sku: Sku): Promise<CutoutRecord | null> {
  const a = await getResource(cutoutId(sku));
  return a ? cutoutRecord(a) : null;
}

export interface CutoutOutcome {
  response: CutoutResponse;
  created: boolean;
}

/**
 * What the cutout is cut from: the Q4 retouched photo when POST /retouch saved
 * one (recorded as fix_id on the raw, which only the server writes), else the raw.
 * Only consulted while no cutout exists yet; an existing cutout is never redone.
 */
export async function cutoutSource(sku: Sku): Promise<string> {
  const raw = await requireRaw(sku);
  return raw.context.fix_id === retouchedId(sku) && raw.context.fix_err !== "1" ? retouchedId(sku) : rawId(sku);
}

/** Probe budget per call; the save afterwards takes ~1.2 s, keeping one call under ~8 s. */
export async function ensureCutout(sku: Sku, budgetMs = 6000): Promise<CutoutOutcome> {
  const t0 = Date.now();
  const existing = await getCutout(sku);
  if (existing) return { created: false, response: { sku, cutout: existing, ms: Date.now() - t0 } };

  const source = await cutoutSource(sku);
  const derived = deliveryUrl(source, CUTOUT_CHAIN);
  // HEAD waits while Cloudinary derives (≈4 s); 423 means "still processing" on a later request.
  let status = 0;
  while (Date.now() - t0 < budgetMs) {
    const left = budgetMs - (Date.now() - t0);
    const p = await probe(derived, Math.max(1000, left));
    status = p.status;
    if (status === 200) break;
    if (status === 404) throw notFound("No upload found for this product yet.");
    if (status !== 423 && status !== 420 && status !== 0) {
      throw new HttpError(502, "upstream", "Background removal failed for this photo. Try another photo.");
    }
    if (Date.now() - t0 + 1500 > budgetMs) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  const probeMs = Date.now() - t0;
  console.info(`[cutout] ${sku}: derived HTTP ${status} after ${probeMs} ms`);
  if (status !== 200) throw pending(2000, "Cutting out the product, try again shortly.");

  const up = await uploadToMain(derived, {
    public_id: cutoutId(sku),
    overwrite: false,
    tags: ["s2s", "s2s-cutout", skuTag(sku)],
    context: { source, chain: CUTOUT_CHAIN, ms: String(Date.now() - t0) },
  });
  console.info(`[cutout] ${sku}: saved in ${Date.now() - t0 - probeMs} ms`);
  return { created: true, response: { sku, cutout: cutoutRecord(up), ms: Date.now() - t0 } };
}
