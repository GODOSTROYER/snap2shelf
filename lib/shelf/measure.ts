import "server-only";
import { createHash } from "node:crypto";
import { withPooledAccount } from "../cloudinary/pool";
import { visionTagging } from "../cloudinary/vision";
import {
  APPLICABLE_FIXES,
  borderStats,
  checkFill,
  checkNoText,
  checkResolution,
  checkSafeZone,
  checkSharpness,
  checkWhiteBackground,
  contentBox,
  decodeBmp,
  grade,
  parseBox,
  REPAD_85,
  score,
  sortChecks,
  TEXT_TAGS,
  type ApplicableFix,
  type BorderStats,
  type Pixels,
  type ReadinessCheck,
  type ReadinessReport,
} from "../readiness";
import { deliveryUrl, mainCloud, probe, uploadToMain, type AssetInfo } from "../server/cld";
import { addTokens, TOKEN_KEYS, updateProduct } from "../server/facts";
import { notFound, pending } from "../server/http";
import { packId } from "../server/pack";
import { skuTag } from "../server/products";
import { channelAssets, packTags } from "../transform/channels";
import type { SceneDNA, Sku } from "../types";
import { currentHero, productAssets } from "./server";

/**
 * Measures the facts lib/readiness.ts scores:
 *   - border + product box: a 96x96 f_bmp of the marketplace image (one tiny derived image, decoded here)
 *   - geometry: the trimmed cutout (= the product box in raw pixels)
 *   - focus: quality_analysis stored on the raw at analyze time
 *   - text/watermark/props: one AI Vision tagging call, cached in the raw's context (rd_*)
 *   - safe zone: the hero's product box (geo on the hero, or pack_box on the raw)
 * Admin API: one listByPrefix call per report.
 */

const SAMPLE = 96;
const SAMPLE_T = `c_scale,w_${SAMPLE},h_${SAMPLE}/f_bmp`;

async function fetchPixels(url: string, timeoutMs = 8000): Promise<Pixels | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), next: { revalidate: 3600 } });
    if (!res.ok) return null;
    return decodeBmp(new Uint8Array(await res.arrayBuffer()));
  } catch (err) {
    console.error(`[readiness] sample failed: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
    return null;
  }
}

interface MarketplaceSource {
  /** Transformation + public id of the marketplace main image (materialised asset, or the pack recipe on the cutout). */
  transformation: string;
  publicId: string;
  width: number;
  height: number;
  materialised: boolean;
}

const hash8 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 8);

export interface MeasureOptions {
  /** Allow one AI Vision tagging call when there is no cached verdict for this image. Default true. */
  vision?: boolean;
  /** Where to read the product's assets (see productAssets). Default "list": CDN, no Admin API quota. */
  source?: "list" | "admin";
  /** A marketplace asset just written (fix): used instead of a possibly stale listing. */
  marketplace?: AssetInfo;
}

/** Verdicts seen by this server instance, so a stale CDN listing never triggers a second AI Vision call. */
const visionMemo = new Map<string, string[]>();

export interface MeasureOutcome {
  report: ReadinessReport;
  tokens: number;
  visionCalled: boolean;
  product: { name: string; rawUrl: string };
}

export async function measureReadiness(sku: Sku, opts: MeasureOptions = {}): Promise<MeasureOutcome> {
  const p = await productAssets(sku, opts.source ?? "list");
  if (!p.raw) throw notFound("No upload found for this product yet.");
  const raw = p.raw;
  const cloud = mainCloud();
  const leaf = (id: string) => id.slice(`snap2shelf/products/${sku}/`.length);
  const packed = opts.marketplace ?? p.all.find((a) => leaf(a.publicId) === "pack/marketplace");
  const hero = currentHero(p);

  // ---- which image is the marketplace main image?
  let mk: MarketplaceSource | null = null;
  if (packed) {
    // versioned, so a re-materialised (fixed) image never shows a cached old copy
    mk = { transformation: "", publicId: `v${packed.version}/${packed.publicId}`, width: packed.width, height: packed.height, materialised: true };
  } else if (p.cutout) {
    const recipe = channelAssets({
      heroPublicId: hero?.publicId ?? p.cutout.publicId,
      cutoutPublicId: p.cutout.publicId,
      alt: raw.context.caption ?? "",
      cloud,
    }).find((a) => a.format === "marketplace");
    const xray = recipe?.xray && "segments" in recipe.xray ? recipe.xray : null;
    if (recipe && xray) {
      mk = {
        transformation: xray.segments.filter((s) => s.kind !== "format" && s.kind !== "asset").map((s) => s.text).join("/"),
        publicId: xray.segments.find((s) => s.kind === "asset")?.text ?? p.cutout.publicId,
        width: recipe.width,
        height: recipe.height,
        materialised: false,
      };
    }
  }
  const mkUrl = (t: string) => (mk ? deliveryUrl(`${mk.publicId}`, [mk.transformation, t].filter(Boolean).join("/")) : "");

  // ---- pixels: marketplace image + original photo, in parallel
  const [mkPixels, rawPixels] = await Promise.all([
    mk ? fetchPixels(mkUrl(SAMPLE_T)) : Promise.resolve(null),
    fetchPixels(deliveryUrl(raw.publicId, SAMPLE_T)),
  ]);
  const mkBorder: BorderStats | null = mkPixels ? borderStats(mkPixels, 2) : null;
  const rawBorder: BorderStats | null = rawPixels ? borderStats(rawPixels, 2) : null;

  // ---- geometry
  const cw = p.cutout?.width ?? 0;
  const ch = p.cutout?.height ?? 0;
  const native = p.cutout ? Math.max(cw, ch) : null;
  const box = mkPixels ? contentBox(mkPixels) : null;
  const measuredFill = box ? Math.max(box.x1 - box.x0, box.y1 - box.y0) : null;
  // a white product on white can hide from the pixel box; the pack recipe fits the trimmed cutout to 85%
  const kitFill = measuredFill !== null && measuredFill > 0.3 ? measuredFill : mk ? 0.85 : null;
  const rawFill = p.cutout && raw.width && raw.height ? Math.max(cw / raw.width, ch / raw.height) : null;

  const focusN = Number(raw.context.focus);
  const focus = raw.context.focus && Number.isFinite(focusN) ? focusN : null;

  // ---- AI Vision: text / watermark / props on the marketplace image (cached per image)
  let matched: string[] | null = null;
  let tokens = 0;
  let visionCalled = false;
  if (mk) {
    const visionUrl = mkUrl("c_limit,w_1024,h_1024/f_jpg,q_80");
    const src = hash8(mk.materialised ? `${mk.publicId}@${packed?.version}` : visionUrl);
    if (visionMemo.has(src)) {
      matched = visionMemo.get(src)!;
    } else if (raw.context.rd_src === src && raw.context.rd_tags !== undefined) {
      matched = raw.context.rd_tags ? raw.context.rd_tags.split(",") : [];
    } else if (opts.vision !== false) {
      try {
        visionCalled = true;
        const { result } = await withPooledAccount("ai_vision", (a) => visionTagging(a, { uri: visionUrl }, [...TEXT_TAGS]));
        matched = result.matched;
        tokens = result.quota?.usedByRequest ?? 0;
        visionMemo.set(src, matched);
        // Verdict cached on the raw (context mirror, read back from the CDN list) and its tokens
        // added to the product's cost ledger (facts t_rd → GET /api/cost/:sku). Never fails the report.
        const spent = tokens;
        await updateProduct(
          sku,
          { ctx: { rd_tags: matched.join(","), rd_src: src, rd_at: new Date().toISOString() }, mutate: (f) => addTokens(f, TOKEN_KEYS.readiness, spent) },
          { critical: false },
        ).catch(() => null);
      } catch (err) {
        console.error(`[readiness] vision failed: ${String((err as Error)?.message ?? err).slice(0, 160)}`);
      }
    }
  }

  // ---- fixes preview on the cutout (the source of truth for the product pixels)
  const repadUrl = p.cutout ? deliveryUrl(p.cutout.publicId, REPAD_85) : undefined;
  const sharpenUrl = mk ? mkUrl("e_sharpen:80/f_auto,q_auto") : undefined;

  const heroBox = parseBox(hero?.context.geo) ?? (hero && raw.context.hero === hero.publicId ? parseBox(raw.context.pack_box) : null);
  const hasOffer = Boolean(raw.context.pack_hi || raw.context.pack_en);

  const kitChecks: ReadinessCheck[] = mk
    ? [
        checkWhiteBackground(mkBorder, repadUrl),
        checkFill(kitFill, repadUrl),
        checkResolution(Math.max(mk.width, mk.height), native, undefined),
        checkSharpness(focus, sharpenUrl, Boolean(packed?.context.fix?.includes("sharpen"))),
        checkNoText(matched),
        checkSafeZone(heroBox, { textZone: (raw.context.pack_tz as SceneDNA["text_zone"]) || undefined, hasOffer }),
      ]
    : [];

  const baselineChecks: ReadinessCheck[] = [
    checkWhiteBackground(rawBorder, repadUrl),
    checkFill(rawFill, repadUrl),
    checkResolution(Math.max(raw.width, raw.height), native ?? Math.max(raw.width, raw.height)),
    checkSharpness(focus, undefined),
  ];

  const checks = sortChecks(kitChecks.length ? kitChecks : baselineChecks);
  const s = score(checks);
  const bs = score(baselineChecks);
  const report: ReadinessReport = {
    sku,
    score: s,
    grade: grade(s),
    checks,
    image: {
      url: mk ? mkUrl("f_auto,q_auto") : deliveryUrl(raw.publicId, "f_auto,q_auto"),
      width: mk?.width ?? raw.width,
      height: mk?.height ?? raw.height,
      materialised: mk?.materialised ?? false,
    },
    ...(kitChecks.length ? { baseline: { score: bs, grade: grade(bs), checks: sortChecks(baselineChecks) } } : {}),
    measuredAt: new Date().toISOString(),
  };
  const product = { name: raw.context.u_name || "Product", rawUrl: deliveryUrl(raw.publicId, "c_limit,w_720,h_720/f_auto,q_auto") };
  return { report, tokens, visionCalled, product };
}

/**
 * One-click fix: re-materialise the saved marketplace image from the cutout with
 * an allow-listed recipe (never a client-supplied transformation). Keeps the pack's
 * `hero` context so GET /api/pack/:sku treats it as current.
 */
export async function applyReadinessFix(sku: Sku, fixes: ApplicableFix[]): Promise<{ publicId: string; transformation: string; asset: AssetInfo }> {
  const p = await productAssets(sku, "list");
  if (!p.raw) throw notFound("No upload found for this product yet.");
  if (!p.cutout) throw notFound("Cut out the product first.");
  const transformation = fixes.includes("sharpen") ? APPLICABLE_FIXES.sharpen : APPLICABLE_FIXES.repad;
  const url = deliveryUrl(p.cutout.publicId, transformation);
  const pr = await probe(url, 8000);
  if (pr.status !== 200) throw pending(2000, "Rendering the fixed image, try again shortly.");
  const up = await uploadToMain(url, {
    public_id: packId(sku, "marketplace"),
    overwrite: true,
    invalidate: true,
    tags: [...packTags(sku), skuTag(sku)],
    context: { hero: p.raw.context.hero ?? "", format: "marketplace", label: "Marketplace main 2000px", fix: [...new Set(fixes)].join(",") },
  });
  return { publicId: up.publicId, transformation, asset: up };
}

