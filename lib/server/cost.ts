import "server-only";
import { v2 as cloudinary } from "cloudinary";
import type { CostResponse } from "../api-contract";
import { PRODUCT_ROOT, SCENE_ROOT, type Scene, type Sku } from "../types";
import { adminCall } from "../cloudinary/admin";
import { deliveryUrl, mainAuth } from "./cld";
import { notFound } from "./http";
import { libraryScenes } from "./scenes";

/**
 * Cost ledger for one product (GET /api/cost/:sku). Everything is read back from
 * Cloudinary: one Admin API listing of snap2shelf/products/<sku>/ (context carries
 * credits, tokens and step timings written as the pipeline ran), the cached scene
 * list for reuse savings, and one HEAD of the delivered hero for bytes.
 */

/** Documented transformation counts (cloudinary.com/documentation/transformation_counts, checked 30 Sep 2026). */
export const TX = {
  derived: 1, // any standard derived image (overlays, crops, e_improve, formats < 2 MP)
  backgroundRemoval: 75,
  genFill: 50,
  genRecolor: 50,
  genRemove: 50,
  genRestore: 100,
  enhance: 100,
  upscaleSmall: 10, // input < 0.25 MP
  upscale: 100, // input 0.25 - 4.2 MP
} as const;

export interface ProductAsset {
  publicId: string;
  bytes: number;
  format: string;
  createdAt: string;
  context: Record<string, string>;
}

const num = (v: string | undefined) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : 0;
};

/** Special-effect count of a pack format, by its asset id (story, banner, recolor-<hex>, …). */
export function packFormatTx(id: string): number {
  if (id === "story" || id === "banner") return TX.derived + TX.genFill;
  if (id.startsWith("recolor-")) return TX.derived + TX.genRecolor;
  return TX.derived;
}

export interface CostInput {
  sku: Sku;
  assets: ProductAsset[];
  scene?: Scene | null; // library scene the kit is staged on (?scene=)
  deliveredBytes: number;
}

/** Pure cost math over the product's assets (unit-tested). */
export function computeCost(i: CostInput): Omit<CostResponse, "delivered"> {
  const leaf = (a: ProductAsset) => a.publicId.slice(`${PRODUCT_ROOT}/${i.sku}/`.length);
  const raw = i.assets.find((a) => leaf(a) === "raw");
  if (!raw) throw notFound("No upload found for this product yet.");
  const c = raw.context;
  const cutout = i.assets.find((a) => leaf(a) === "cutout");
  const retouched = i.assets.find((a) => leaf(a) === "retouched");
  const creatives = i.assets.filter((a) => leaf(a).startsWith("creative-"));
  const heroes = i.assets.filter((a) => leaf(a).startsWith("hero-"));
  const pack = i.assets.filter((a) => leaf(a).startsWith("pack/"));

  // generation credits
  const generation = creatives.map((a) => ({ label: `Creative · ${a.context.model || leaf(a).slice("creative-".length)}`, credits: num(a.context.credits) }));
  if (num(c.sc_spent)) generation.push({ label: "New scene", credits: num(c.sc_spent) });

  // credits saved by reusing a library scene instead of generating one
  let saved = 0;
  if (i.scene) {
    const generatedForThis = i.scene.publicId === c.sc_id && num(c.sc_spent) > 0;
    saved = generatedForThis ? 0 : i.scene.credits;
  } else {
    saved = num(c.sc_saved);
  }

  // AI Vision tokens recorded along the way
  const tokens = [
    { label: "Analyze (product understanding)", tokens: num(c.t_an) },
    { label: "Auto-retouch check", tokens: num(c.t_fix) },
    { label: "Brief", tokens: num(c.t_brief) },
    ...creatives.map((a) => ({ label: `Fidelity QA · ${leaf(a)}`, tokens: num(a.context.qa_tokens) })),
    { label: "New scene DNA + QA", tokens: num(c.t_scene) },
  ].filter((t) => t.tokens > 0);

  // transformation estimate from what exists
  const transformations: { label: string; tx: number }[] = [];
  if (c.analyzed) transformations.push({ label: "Analysis JPEG", tx: TX.derived });
  if (c.fix_plan) transformations.push({ label: "Luma probe (16x16)", tx: TX.derived });
  if (retouched) transformations.push({ label: `Retouch (${c.fix_plan || "fixes"})`, tx: num(c.fix_tx) || TX.derived });
  if (cutout) transformations.push({ label: "Cutout (background removal + trim)", tx: TX.derived + TX.backgroundRemoval });
  for (const a of creatives) transformations.push({ label: `Fidelity sheet · ${leaf(a)}`, tx: TX.derived });
  for (const a of heroes) transformations.push({ label: `Hero composite · ${leaf(a)}`, tx: TX.derived });
  for (const a of pack) transformations.push({ label: `Pack · ${leaf(a).slice("pack/".length)}`, tx: packFormatTx(leaf(a).slice("pack/".length)) });
  transformations.push({ label: heroes.length ? "Delivered hero (f_auto, q_auto)" : "Delivered photo (f_auto, q_auto)", tx: TX.derived });

  // recorded server time per step
  const steps = [
    { label: "Analyze", ms: num(c.ms_an) },
    { label: "Auto-retouch", ms: num(c.ms_fix) + num(c.ms_fix_done) },
    { label: "Cutout", ms: cutout ? num(cutout.context.ms) : 0 },
    { label: "Brief", ms: num(c.ms_brief) },
    { label: "New scene", ms: num(c.ms_scene) },
    ...creatives.map((a) => ({ label: `Creative · ${leaf(a)}`, ms: num(a.context.latency_ms) })),
  ].filter((s) => s.ms > 0);

  const newest = [...heroes, ...pack].map((a) => Date.parse(a.createdAt)).filter(Number.isFinite);
  const start = Date.parse(raw.createdAt);
  const wallClockSeconds = newest.length && Number.isFinite(start) ? Math.max(0, Math.round((Math.max(...newest) - start) / 1000)) : null;

  return {
    sku: i.sku,
    cost: {
      generationCredits: generation.reduce((n, g) => n + g.credits, 0),
      creditsSavedByReuse: saved,
      aiVisionTokens: tokens.reduce((n, t) => n + t.tokens, 0),
      transformationsEstimate: transformations.reduce((n, t) => n + t.tx, 0),
      bytesOriginal: raw.bytes,
      bytesDelivered: i.deliveredBytes,
      seconds: Math.round(steps.reduce((n, s) => n + s.ms, 0) / 100) / 10,
    },
    breakdown: { generation, tokens, transformations, steps },
    wallClockSeconds,
    estimated: true,
  };
}

// ------------------------------------------------------------------ I/O

type ListedResource = { public_id: string; bytes?: number; format?: string; created_at?: string; context?: { custom?: Record<string, string> } };

/** Every asset under snap2shelf/products/<sku>/ with context and created_at (one Admin API call). */
export async function listProductAssets(sku: Sku): Promise<ProductAsset[]> {
  const res = (await adminCall("resources", () =>
    cloudinary.api.resources({
      ...mainAuth(),
      type: "upload",
      resource_type: "image",
      prefix: `${PRODUCT_ROOT}/${sku}/`,
      context: true,
      max_results: 100,
    }),
  )) as unknown as { resources: ListedResource[] };
  return res.resources.map((r) => ({
    publicId: r.public_id,
    bytes: Number(r.bytes ?? 0),
    format: r.format ?? "",
    createdAt: r.created_at ?? "",
    context: r.context?.custom ?? {},
  }));
}

/** Browser-like Accept header, so f_auto negotiates AVIF/WebP the way a real visitor gets it. */
export const BROWSER_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8";

export async function deliveredSize(url: string, timeoutMs = 8000): Promise<{ bytes: number; format: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const head = await fetch(url, { method: "HEAD", headers: { Accept: BROWSER_ACCEPT }, signal: controller.signal, cache: "no-store" });
    const format = (head.headers.get("content-type") ?? "").replace(/^image\//, "");
    const len = Number(head.headers.get("content-length"));
    if (head.ok && Number.isFinite(len) && len > 0) return { bytes: len, format };
    if (!head.ok) return { bytes: 0, format };
    const get = await fetch(url, { headers: { Accept: BROWSER_ACCEPT }, signal: controller.signal, cache: "no-store" });
    const buf = await get.arrayBuffer();
    return { bytes: buf.byteLength, format: (get.headers.get("content-type") ?? "").replace(/^image\//, "") };
  } catch {
    return { bytes: 0, format: "" };
  } finally {
    clearTimeout(timer);
  }
}

const SCENE_ID = new RegExp(`^${SCENE_ROOT}/[a-z0-9-]{1,40}/[a-z0-9_-]{1,60}$`);
export const isScenePublicId = (s: string) => SCENE_ID.test(s);

export async function costForProduct(sku: Sku, scenePublicId?: string): Promise<CostResponse> {
  const [assets, library] = await Promise.all([
    listProductAssets(sku),
    scenePublicId ? libraryScenes().catch(() => [] as Scene[]) : Promise.resolve([] as Scene[]),
  ]);
  const raw = assets.find((a) => a.publicId === `${PRODUCT_ROOT}/${sku}/raw`);
  if (!raw) throw notFound("No upload found for this product yet.");
  const heroes = assets.filter((a) => a.publicId.startsWith(`${PRODUCT_ROOT}/${sku}/hero-`)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const heroId = heroes.find((h) => h.publicId === raw.context.hero)?.publicId ?? heroes[0]?.publicId;
  const url = heroId ? deliveryUrl(heroId, "f_auto,q_auto") : deliveryUrl(raw.publicId, "c_limit,w_1080,h_1350/f_auto,q_auto");
  const delivered = await deliveredSize(url);

  const scene = scenePublicId ? (library.find((s) => s.publicId === scenePublicId) ?? null) : null;
  const out = computeCost({ sku, assets, scene, deliveredBytes: delivered.bytes });
  return { ...out, delivered: { url, format: delivered.format, bytes: delivered.bytes, from: heroId ? "hero" : "raw" } };
}
