import "server-only";
import type { RetouchPendingResponse, RetouchResponse } from "../api-contract";
import { withPooledAccount } from "../cloudinary/pool";
import { visionTagging } from "../cloudinary/vision";
import type { Sku } from "../types";
import { assertLivePipeline } from "./budget";
import { deliveryUrl, probe, uploadToMain, type AssetInfo } from "./cld";
import { loadProduct, updateProduct } from "./facts";
import { HttpError } from "./http";
import { readOnly } from "./protect";
import { analysisSourceUrl, rawId, retouchedId, skuTag } from "./products";
import { RETOUCH_TAGS, bmpMeanLuma, planRetouch, retouchChain, retouchStateFromContext, retouchXray, type RetouchPlan } from "./retouch-plan";

/**
 * Q4 auto-retouch (POST /api/products/:sku/retouch).
 *
 * Call 1 plans: AI Vision tagging + a 16x16 BMP luma probe (in parallel), plus
 * size / bytes / focus → planRetouch(). The plan is stored in the raw asset's
 * context, so it is never recomputed or re-billed, and the derivation is kicked off.
 * Later calls finish: HEAD the derived URL (AI effects answer 423 while
 * processing) and, once it answers 200, snapshot it as
 * snapshot snap2shelf/products/<sku>/retouched (one derived asset, one upload).
 * The cutout then starts from that asset (products.ts cutoutSource()).
 */

/** Whole-frame thumbnail for the luma measurement (a standard 1 tx derivation). */
export const lumaProbeUrl = (sku: Sku) => deliveryUrl(rawId(sku), "c_scale,w_16,h_16/f_bmp");
const VIEW = "c_limit,w_1080,h_1350/f_auto,q_auto";

async function measureLuma(sku: Sku, timeoutMs = 5000): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(lumaProbeUrl(sku), { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return null;
    return bmpMeanLuma(new Uint8Array(await res.arrayBuffer()));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const focusOf = (c: Record<string, string>) => {
  const f = Number(c.fix_focus ?? c.focus);
  return (c.fix_focus ?? c.focus) && Number.isFinite(f) ? f : null;
};

function planFor(raw: AssetInfo, tags: string[], luma: number | null, focus: number | null): RetouchPlan {
  return planRetouch({ width: raw.width, height: raw.height, bytes: raw.bytes, format: raw.format, focus, luma, tags });
}

export type RetouchOutcome =
  | { kind: "done"; response: RetouchResponse; spent: boolean }
  | { kind: "pending"; response: RetouchPendingResponse; spent: boolean };

/**
 * One retouch step within ~budgetMs. `beforeSpend` runs right before the first
 * paid call (AI Vision), so a session over its cap is refused before any spend
 * while its later polls still work. `readOnly` (sample / showcase product without the
 * access code, lib/server/protect.ts): answer only from the stored plan / retouched
 * photo; anything that would spend, derive or write is refused with 403 read_only.
 */
export async function retouchProduct(sku: Sku, opts: { budgetMs?: number; beforeSpend?: () => void; readOnly?: boolean } = {}): Promise<RetouchOutcome> {
  const budgetMs = opts.budgetMs ?? 6000;
  const t0 = Date.now();
  const { raw } = await loadProduct(sku);
  let state = retouchStateFromContext(raw.context);
  let tokens = 0;
  let spent = false;
  let plan: RetouchPlan;

  if (!state.planned) {
    if (opts.readOnly) throw readOnly();
    await assertLivePipeline(); // planning derives a luma probe and starts a kit
    opts.beforeSpend?.();
    spent = true;
    const [tagged, luma] = await Promise.all([
      withPooledAccount("ai_vision", (a) => visionTagging(a, { uri: analysisSourceUrl(sku) }, RETOUCH_TAGS)).catch((err: unknown) => {
        // Measured signals alone still give a sensible plan; never block the pipeline on tagging.
        console.error(`[retouch] tagging failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
        return null;
      }),
      measureLuma(sku),
    ]);
    const tags = tagged?.result.matched ?? [];
    tokens = tagged?.result.quota?.usedByRequest ?? 0;
    const focus = focusOf(raw.context);
    plan = planFor(raw, tags, luma, focus);
    const chain = retouchChain(plan);
    // Critical: without the stored plan the next poll would plan (and bill AI Vision) again.
    await updateProduct(sku, {
      ctx: {
        fix_tags: tags.join(",") || "-",
        fix_luma: luma === null ? "" : luma.toFixed(1),
        fix_focus: focus === null ? "" : focus.toFixed(3),
        fix_plan: plan.fixes.join(",") || "none",
        fix_chain: chain,
        fix_tx: String(plan.tx),
        t_fix: String(tokens),
        ms_fix: String(Date.now() - t0),
      },
    });
    state = { ...state, planned: true, tags, luma, fixes: plan.fixes, chain, tx: plan.tx };
  } else {
    plan = planFor(raw, state.tags, state.luma, focusOf(raw.context));
  }

  const base = {
    sku,
    detected: plan.detected,
    notes: plan.notes,
    tx: state.tx,
    tokens,
  };

  // Nothing to fix, or Cloudinary refused the chain earlier: the cutout uses the raw photo.
  if (!state.chain || state.fixes.length === 0) {
    return { kind: "done", spent, response: { ...base, status: "none", fixes: { applied: [] }, tx: 0, ms: Date.now() - t0 } };
  }
  if (state.failed) {
    return {
      kind: "done",
      spent,
      response: {
        ...base,
        status: "none",
        fixes: { applied: [] },
        notes: ["Cloudinary couldn't apply these fixes to this photo, so the cutout uses the original.", ...plan.notes],
        tx: 0,
        ms: Date.now() - t0,
      },
    };
  }

  const derived = deliveryUrl(rawId(sku), state.chain);
  const done = (retouchedPublicId: string): RetouchOutcome => ({
    kind: "done",
    spent,
    response: {
      ...base,
      status: "done",
      fixes: { applied: state.fixes, retouchedPublicId },
      transformation: state.chain,
      xray: retouchXray(derived, plan, rawId(sku)),
      beforeUrl: deliveryUrl(rawId(sku), VIEW),
      url: deliveryUrl(retouchedPublicId, VIEW),
      ms: Date.now() - t0,
    },
  });
  if (state.retouchedPublicId === retouchedId(sku)) return done(state.retouchedPublicId);

  const pendingOutcome = (): RetouchOutcome => ({
    kind: "pending",
    spent,
    response: {
      error: "Retouching the photo, try again shortly.",
      code: "pending",
      retryAfterMs: 2000,
      planned: state.fixes,
      detected: plan.detected,
      notes: plan.notes,
      tokens,
    },
  });

  if (opts.readOnly) throw readOnly();
  // The retouch chain can include generative / AI effects: respect the credit floor.
  await assertLivePipeline();
  // Planning may have used most of this call's budget: just kick the derivation off.
  const left = budgetMs - (Date.now() - t0);
  const p = await probe(derived, Math.max(1200, Math.min(left, budgetMs)));
  if (p.status === 423 || p.status === 420 || p.status === 429 || p.status === 0) return pendingOutcome();
  if (p.status !== 200) {
    console.error(`[retouch] ${sku}: derived HTTP ${p.status} ${String(p.error ?? "").slice(0, 160)}`);
    await updateProduct(sku, { ctx: { fix_err: "1" } }, { critical: false });
    state = { ...state, failed: true };
    return {
      kind: "done",
      spent,
      response: {
        ...base,
        status: "none",
        fixes: { applied: [] },
        notes: ["Cloudinary couldn't apply these fixes to this photo, so the cutout uses the original.", ...plan.notes],
        tx: 0,
        ms: Date.now() - t0,
      },
    };
  }

  const up = await uploadToMain(derived, {
    public_id: retouchedId(sku),
    overwrite: false,
    tags: ["s2s", "s2s-retouched", skuTag(sku)],
    context: { source: rawId(sku), chain: state.chain, fixes: state.fixes.join(",") },
  });
  if (up.publicId !== retouchedId(sku)) throw new HttpError(502, "upstream", "Saving the retouched photo failed. Please try again.");
  await updateProduct(
    sku,
    {
      ctx: { fix_id: up.publicId, ms_fix_done: String(Date.now() - t0) },
      mutate: (f) => void (f.retouched = { publicId: up.publicId, width: up.width, height: up.height, version: up.version, bytes: up.bytes, at: Date.now() }),
    },
    { critical: false },
  );
  console.info(`[retouch] ${sku}: saved ${state.chain} in ${Date.now() - t0} ms`);
  return done(up.publicId);
}
