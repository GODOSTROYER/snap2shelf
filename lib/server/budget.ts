import "server-only";
import { mainCreditsSummary } from "../cloudinary/pool";
import { HttpError } from "./http";
import { offloadEnabled } from "./offload";

/**
 * Transformation-credit floor for the MAIN environment.
 *
 * Free plan: 25 credits/month (1 credit ≈ 1,000 transformations or 1 GB of
 * storage / bandwidth). One live kit derives ~300 transformations (background
 * removal 75, generative fill 2 × 50, recolor 50 each, …). If main runs out,
 * NEW derivatives fail, and the prebuilt showcase judges look at needs the
 * remaining credits for delivery. So once main's used credits reach
 * LIVE_TX_MAX_USED (default 21 of 25), every route that would create new
 * derivatives answers {code:"quota_low"} and the UI falls back to the showcase.
 *
 * The reading comes from main's Admin `usage` call, cached ≥ 10 min per
 * instance and behind the Admin breaker (lib/cloudinary/pool.ts). If no reading
 * exists yet (cold instance while the Admin API is rate limited) the pipeline
 * stays on: failing open for a few minutes costs at most a kit or two, while
 * failing closed would take the live demo down on every Admin hiccup.
 * LIVE_TX_MAX_USED=0 switches the live pipeline off outright.
 *
 * With S2S_OFFLOAD_POOL=1 the heavy effects render on the key pool and a live
 * kit costs main only ~7 transformations (~0.007 credits), so the default floor
 * rises to 24: live kits stay on almost to the limit, and the last credit is
 * kept for delivering what already exists.
 */

export const DEFAULT_LIVE_TX_MAX_USED = 21;
export const DEFAULT_LIVE_TX_MAX_USED_OFFLOAD = 24;

export function liveTxMaxUsed(): number {
  const raw = process.env.LIVE_TX_MAX_USED;
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100_000 ? n : offloadEnabled() ? DEFAULT_LIVE_TX_MAX_USED_OFFLOAD : DEFAULT_LIVE_TX_MAX_USED;
}

export interface CreditsReading {
  used: number;
  limit: number;
}

/** Pure decision (unit-tested): is the live pipeline allowed to create new derivatives? */
export function txBudgetDecision(credits: CreditsReading | null, maxUsed: number): { livePipeline: boolean; reason: "ok" | "floor" | "off" | "unknown" } {
  if (maxUsed <= 0) return { livePipeline: false, reason: "off" };
  if (!credits || !Number.isFinite(credits.used)) return { livePipeline: true, reason: "unknown" };
  const exhausted = Number.isFinite(credits.limit) && credits.limit > 0 && credits.used >= credits.limit;
  return credits.used >= maxUsed || exhausted ? { livePipeline: false, reason: "floor" } : { livePipeline: true, reason: "ok" };
}

export interface TxBudget {
  livePipeline: boolean;
  usedCredits: number | null;
  limitCredits: number | null;
  maxUsedCredits: number;
  stale: boolean; // numbers are from an earlier refresh (the latest one failed)
  reason: "ok" | "floor" | "off" | "unknown";
}

export async function txBudget(): Promise<TxBudget> {
  let credits: Awaited<ReturnType<typeof mainCreditsSummary>> = null;
  try {
    credits = await mainCreditsSummary();
  } catch {
    credits = null; // never let the budget check itself break a route
  }
  const maxUsed = liveTxMaxUsed();
  const d = txBudgetDecision(credits, maxUsed);
  return {
    livePipeline: d.livePipeline,
    usedCredits: credits ? Math.round(credits.used * 100) / 100 : null,
    limitCredits: credits ? credits.limit : null,
    maxUsedCredits: maxUsed,
    stale: credits?.stale ?? false,
    reason: d.reason,
  };
}

export const LIVE_PAUSED_MESSAGE =
  "Live kit building is paused to keep the monthly Cloudinary quota for the showcase. Showing saved examples instead.";

/**
 * Call before creating NEW derivatives (cutout, retouch, pack, scene / creative
 * generation). Answers are cached, so this costs no network call on a warm instance.
 */
export async function assertLivePipeline(): Promise<void> {
  const b = await txBudget();
  if (!b.livePipeline) throw new HttpError(503, "quota_low", LIVE_PAUSED_MESSAGE);
}
