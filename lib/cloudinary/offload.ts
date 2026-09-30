import "server-only";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import type { CloudinaryAccount } from "./accounts";
import { cldSafe } from "./safe";

/**
 * Cloudinary side of rendering AI transformations on a pool account
 * (policy and fallback: lib/server/offload.ts).
 *
 * A pool account gets a plain copy of a main asset (Upload API, upload by URL
 * of main's original: no transformation on main), derives the expensive chain
 * on its own credits, and main then stores the finished image by URL. Pool
 * copies live under OFFLOAD_PREFIX so they never collide with the pool's own
 * assets. Nothing here is ever returned to the client: pool URLs are only
 * fetched server-side (HEAD probe, then main's upload by URL).
 */

export const OFFLOAD_PREFIX = "s2s-offload";

/** Public id of the pool copy of a main asset. */
export const poolCopyId = (mainPublicId: string) => `${OFFLOAD_PREFIX}/${mainPublicId}`;

/** Delivery URL of `transformation` applied to a pool copy (versioned: a fresh copy is a fresh CDN key). */
export function poolDeliveryUrl(account: CloudinaryAccount, transformation: string, copy: { publicId: string; version: number }): string {
  const v = copy.version > 0 ? `v${copy.version}/` : "";
  return `https://res.cloudinary.com/${account.cloudName}/image/upload/${transformation ? `${transformation}/` : ""}${v}${copy.publicId}`;
}

export interface PoolCopy {
  publicId: string;
  version: number;
}

const MAX_MEMO = 500;
/** Per Node process (globalThis), shared by every route bundle: one upload per account + asset. */
const G = globalThis as unknown as { __s2sPoolCopies?: Map<string, Promise<PoolCopy>> };
const copies: Map<string, Promise<PoolCopy>> = (G.__s2sPoolCopies ??= new Map());

/**
 * Make sure `account` holds a copy of the asset at `sourceUrl` (a main delivery
 * URL without transformation) under poolCopyId(mainPublicId). overwrite:false:
 * an existing copy is answered as-is (main's product assets never change under
 * the same id: raws are immutable, heroes carry a hash of their source).
 * Concurrent callers share one upload; a failure is forgotten so the next call retries.
 */
export function ensurePoolCopy(account: CloudinaryAccount, sourceUrl: string, mainPublicId: string): Promise<PoolCopy> {
  const publicId = poolCopyId(mainPublicId);
  const k = `${account.label}|${publicId}`;
  const hit = copies.get(k);
  if (hit) return hit;
  const p = cldSafe("offload-copy", () =>
    cloudinary.uploader.upload(sourceUrl, {
      public_id: publicId,
      overwrite: false,
      unique_filename: false,
      resource_type: "image",
      type: "upload",
      tags: [OFFLOAD_PREFIX],
      cloud_name: account.cloudName,
      api_key: account.apiKey,
      api_secret: account.apiSecret,
    }),
  ).then((r: UploadApiResponse) => ({ publicId: r.public_id, version: Number(r.version ?? 0) }));
  copies.set(k, p);
  if (copies.size > MAX_MEMO) copies.delete(copies.keys().next().value as string);
  p.catch(() => {
    if (copies.get(k) === p) copies.delete(k);
  });
  return p;
}

/** Drop the memo of one pool copy (after a failed attempt), so the next call checks it again. */
export function forgetPoolCopy(account: CloudinaryAccount, mainPublicId: string): void {
  copies.delete(`${account.label}|${poolCopyId(mainPublicId)}`);
}

/** Test hook. */
export function __resetPoolCopies(): void {
  copies.clear();
}
