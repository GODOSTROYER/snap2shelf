/**
 * Responsive helpers for Cloudinary delivery URLs we already built.
 * Pure and client-safe (used from Server Components too).
 */
import { deliveryBase } from "../transform/composite";
import type { BuiltUrl, KitAsset } from "../types";

export const isBuiltUrl = (x: KitAsset["xray"] | undefined): x is BuiltUrl =>
  !!x && typeof (x as BuiltUrl).transformation === "string" && typeof (x as BuiltUrl).url === "string";

/** Does this asset run a generative transformation? Resizing it would re-run the AI step. */
export const isGenerative = (a: Pick<KitAsset, "xray">) =>
  isBuiltUrl(a.xray) && a.xray.segments.some((s) => s.kind === "gen-ai");

/**
 * Same image, scaled down to `w` px wide, as the last step of the chain.
 * Generative assets are returned untouched: a new URL would re-run the AI
 * step (≈50 transformations, and a different outpaint).
 */
export function sizedUrl(asset: Pick<KitAsset, "url" | "xray">, w: number): string {
  if (!isBuiltUrl(asset.xray) || isGenerative(asset)) return asset.url;
  const t = asset.xray.transformation;
  const marker = `/${t}/`;
  const at = asset.url.indexOf(marker);
  if (at < 0) return asset.url;
  return `${asset.url.slice(0, at)}/${t}/c_limit,w_${w}/f_auto,q_auto/${asset.url.slice(at + marker.length)}`;
}

/** Plain public id → sized URL. */
export function publicUrl(publicId: string, opts: { w?: number; h?: number; crop?: string; cloud?: string } = {}) {
  const parts: string[] = [];
  if (opts.w || opts.h) {
    parts.push([opts.crop ?? "c_limit", opts.w && `w_${opts.w}`, opts.h && `h_${opts.h}`].filter(Boolean).join(","));
  }
  parts.push("f_auto,q_auto");
  return `${deliveryBase(opts.cloud)}/${parts.join("/")}/${publicId}`;
}

export function srcSet(make: (w: number) => string, widths: number[]) {
  return widths.map((w) => `${make(w)} ${w}w`).join(", ");
}

export function formatBytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
