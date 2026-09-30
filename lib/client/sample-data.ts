/**
 * Zero-request stand-ins for the live cost and readiness routes, for sample
 * products only. Everything they return was measured on the sample's live run
 * (data/showcase.json, lib/client/sample-readiness.json), so a sample kit shows
 * real numbers without calling /api. Client-safe.
 */
import type { CostResponse } from "../api-contract";
import type { ReadinessReport } from "../readiness";
import type { SampleProduct } from "../showcase";
import type { Kit } from "../types";

/** Documented transformation counts (same table as the cost route). */
const TX = { derived: 1, backgroundRemoval: 75, genFill: 50, genRecolor: 50 } as const;

const STEP_LABELS: [keyof NonNullable<SampleProduct["timings"]>, string][] = [
  ["upload", "Upload"],
  ["analyze", "Read the product (AI Vision)"],
  ["cutout", "Cut out"],
  ["stage", "Stage"],
  ["qa", "QA check"],
  ["pack", "Pack every format"],
  ["zip", "Zip"],
  ["reel", "Kit Reel"],
];

/** The cost ledger of a sample's live run, in the cost route's shape. */
export function sampleCost(sample: SampleProduct, kit: Kit = sample.kit): CostResponse {
  const c = kit.cost;
  const formats = kit.assets.map((a) => ({
    label: a.label,
    tx: a.id === "story" || a.id === "banner" ? TX.derived + TX.genFill : a.id.startsWith("recolor-") ? TX.derived + TX.genRecolor : TX.derived,
  }));
  const known = TX.backgroundRemoval + TX.derived + formats.reduce((n, f) => n + f.tx, 0);
  const transformations = [
    { label: "Background removal", tx: TX.backgroundRemoval },
    { label: "Hero composite", tx: TX.derived },
    ...formats,
    ...(c.transformationsEstimate > known ? [{ label: "Previews, QA renders and delivery sizes", tx: c.transformationsEstimate - known }] : []),
  ];
  const qaTokens = sample.qaTokens;
  const analyzeTokens = sample.analyzeTokens ?? Math.max(0, c.aiVisionTokens - qaTokens);
  const tokens = [
    ...(analyzeTokens ? [{ label: "Product reading", tokens: analyzeTokens }] : []),
    ...(qaTokens ? [{ label: sample.qaStory ? `QA, ${sample.qaStory.attempts} checks` : "QA check", tokens: qaTokens }] : []),
  ];
  const steps = sample.timings ? STEP_LABELS.flatMap(([k, label]) => (sample.timings?.[k] ? [{ label, ms: sample.timings[k]! }] : [])) : [];
  return {
    sku: kit.sku,
    // server time = every step after the upload landed (the reel renders on first view, so it's left out)
    cost: { ...c, seconds: sample.timings ? Math.round((sample.timings.total - sample.timings.upload) / 100) / 10 : 0 },
    breakdown: { generation: [], tokens, transformations, steps },
    delivered: { url: kit.hero.url, format: "", bytes: c.bytesDelivered, from: "hero" },
    wallClockSeconds: sample.timings ? Math.round(sample.timings.total / 1000) : c.seconds || null,
    estimated: true,
  };
}

/**
 * Readiness of a sample's marketplace image, measured live on 30 Sep. The
 * featured sneaker is the same phone photo and cut-out as shsneakr (same pack
 * recipe on the same pixels), so it shares that measurement.
 */
const ALIAS: Record<string, string> = { sneaker1: "shsneakr" };

export async function sampleReadiness(sku: string): Promise<ReadinessReport | null> {
  const data = (await import("./sample-readiness.json")).default as unknown as { reports: Record<string, ReadinessReport> };
  return data.reports[ALIAS[sku] ?? sku] ?? null;
}
