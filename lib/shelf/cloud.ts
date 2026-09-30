import "server-only";
import { mainCloud, toAssetInfo, type AssetInfo } from "../server/cld";
import { cldHttpCode, HttpError } from "../server/http";

/**
 * Read helpers for the shelf/readiness paths.
 *
 * 1. CDN first: the client-side list `image/list/<tag>.json` (public, cached ~60 s,
 *    no Admin API quota). Every product asset carries s2s-sku-<sku>; every shelf
 *    hero carries s2s-shop-<shop>.
 * 2. Admin API only as a fallback, through adminSafe(): Cloudinary SDK rejections
 *    carry `request_options.auth` (api_key:api_secret). If such an object escapes
 *    a server component, Next.js logs it verbatim, so it is replaced here by an
 *    error that holds only the message and HTTP code.
 */

type ListResource = Parameters<typeof toAssetInfo>[0];

export class CloudinaryReadError extends Error {
  constructor(message: string, public readonly httpCode?: number) {
    super(message);
    this.name = "CloudinaryReadError";
  }
}

/** Strip an SDK rejection down to message + code (never request_options). Rate limits become a friendly 503. */
export function sanitizeCldError(err: unknown): Error {
  if (err instanceof HttpError || err instanceof CloudinaryReadError) return err;
  const code = cldHttpCode(err);
  const e = err as { error?: { message?: unknown }; message?: unknown } | null;
  const raw = String(e?.error?.message ?? e?.message ?? "Cloudinary request failed");
  const message = raw.replace(/[a-z0-9_]*:?\/\/[^\s"]*@/gi, "").slice(0, 200);
  if (code === 420 || code === 429) return new HttpError(503, "quota_low", "Cloudinary is busy right now. Try again in a minute.", 60_000);
  return new CloudinaryReadError(message, code);
}

export async function adminSafe<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw sanitizeCldError(err);
  }
}

export const listJsonUrl = (tag: string, cloud = mainCloud()) => `https://res.cloudinary.com/${cloud}/image/list/${tag}.json`;

/**
 * Assets carrying `tag`, from the CDN list. null when the list 404s (no asset has
 * the tag yet, or the 404 is still cached); throws on other failures.
 * `revalidate` is Next's data-cache window on top of the CDN's own ~60 s; pass 0
 * for reads that must see a write made seconds ago (readiness after a fix, publish).
 */
export async function listByTag(tag: string, revalidate = 60): Promise<AssetInfo[] | null> {
  const res = await fetch(listJsonUrl(tag), revalidate > 0 ? { next: { revalidate } } : { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new CloudinaryReadError(`list ${tag}: HTTP ${res.status}`, res.status);
  const json = (await res.json()) as { resources?: ListResource[] };
  return (json.resources ?? []).map((r) => toAssetInfo(r));
}
