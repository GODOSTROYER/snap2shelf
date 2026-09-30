import "server-only";
import { v2 as cloudinary, type ResourceApiResponse, type UploadApiOptions, type UploadApiResponse } from "cloudinary";
import { getMainAccount } from "../cloudinary/accounts";
import { adminCall } from "../cloudinary/admin";
import { cldSafe } from "../cloudinary/safe";
import { cldHttpCode } from "./http";

/**
 * Every Cloudinary SDK call on main goes through here (or lib/cloudinary/*),
 * wrapped in cldSafe() / adminCall(): rejections are re-thrown sanitised
 * (no request_options / auth), Admin API calls go through the rate-limit breaker.
 */

/** Node SDK auth options for the MAIN environment (passed per call; no global config). */
export function mainAuth() {
  const m = getMainAccount();
  return { cloud_name: m.cloudName, api_key: m.apiKey, api_secret: m.apiSecret };
}

export const mainCloud = () => getMainAccount().cloudName;
export const deliveryBase = () => `https://res.cloudinary.com/${mainCloud()}/image/upload`;
export const deliveryUrl = (publicId: string, transformation?: string) =>
  `${deliveryBase()}/${transformation ? transformation + "/" : ""}${publicId}`;

export type Ctx = Record<string, string>;

export interface AssetInfo {
  publicId: string;
  assetId: string;
  version: number;
  width: number;
  height: number;
  bytes: number;
  format: string;
  secureUrl: string;
  tags: string[];
  context: Ctx;
}

type ResourceLike = {
  public_id: string;
  asset_id?: string;
  version?: number;
  width?: number;
  height?: number;
  bytes?: number;
  format?: string;
  secure_url?: string;
  tags?: string[];
  context?: { custom?: Ctx } | Ctx;
  created_at?: string;
};

export function toAssetInfo(r: ResourceLike): AssetInfo {
  const ctx = (r.context as { custom?: Ctx } | undefined)?.custom ?? {};
  return {
    publicId: r.public_id,
    assetId: r.asset_id ?? "",
    version: Number(r.version ?? 0),
    width: Number(r.width ?? 0),
    height: Number(r.height ?? 0),
    bytes: Number(r.bytes ?? 0),
    format: r.format ?? "",
    secureUrl: r.secure_url ?? "",
    tags: r.tags ?? [],
    context: ctx,
  };
}

/**
 * Admin API resource lookup on main (with context); null when it doesn't exist.
 * Counts against the 500/hour Admin limit and goes through the breaker. Live
 * routes use assetInfo() and product facts instead; this is for rare fallbacks.
 */
export async function getResource(publicId: string): Promise<AssetInfo | null> {
  try {
    const r = (await adminCall("resource", () => cloudinary.api.resource(publicId, { ...mainAuth(), context: true, tags: true }))) as unknown as ResourceLike;
    return toAssetInfo(r);
  } catch (err) {
    if (cldHttpCode(err) === 404) return null;
    throw err;
  }
}

/** All assets under a folder prefix (with context), up to 100. One Admin API call (breaker-guarded). */
export async function listByPrefix(prefix: string): Promise<AssetInfo[]> {
  const res = (await adminCall("resources", () =>
    cloudinary.api.resources({
      ...mainAuth(),
      type: "upload",
      resource_type: "image",
      prefix,
      context: true,
      tags: true,
      max_results: 100,
    }),
  )) as ResourceApiResponse;
  return (res.resources as unknown as ResourceLike[]).map(toAssetInfo);
}

/** Asset facts from an Upload API call: everything in AssetInfo except context, plus created_at. */
export type ExplicitInfo = Omit<AssetInfo, "context"> & { createdAt: string };

/**
 * Existence + version / dims / bytes / tags of an asset via `uploader.explicit`
 * (Upload API: not counted against the Admin API limit, and verified to keep
 * working during an Admin 420). No eager transformations, so no derivation and
 * no transformation count. Returns null on 404. Context is NOT returned.
 */
export async function assetInfo(publicId: string, resourceType: "image" | "raw" = "image"): Promise<ExplicitInfo | null> {
  try {
    const r = (await cldSafe("explicit", () =>
      cloudinary.uploader.explicit(publicId, { ...mainAuth(), type: "upload", resource_type: resourceType }),
    )) as unknown as ResourceLike;
    const info = toAssetInfo(r);
    return {
      publicId: info.publicId,
      assetId: info.assetId,
      version: info.version,
      width: info.width,
      height: info.height,
      bytes: info.bytes,
      format: info.format,
      secureUrl: info.secureUrl,
      tags: info.tags,
      createdAt: r.created_at ?? "",
    };
  } catch (err) {
    if (cldHttpCode(err) === 404) return null;
    throw err;
  }
}

/** Upload to main (by URL or data URI). Upload API calls don't count against the Admin API rate limit. */
export async function uploadToMain(file: string, options: UploadApiOptions & { public_id: string }): Promise<AssetInfo> {
  const r: UploadApiResponse = await cldSafe("upload", () =>
    cloudinary.uploader.upload(file, {
      resource_type: "image",
      unique_filename: false,
      ...options,
      ...mainAuth(),
    }),
  );
  return toAssetInfo(r as unknown as ResourceLike);
}

/** Store a small JSON document on main as a raw asset (Upload API; raw files are not image transformations). */
export async function uploadRawJson(publicId: string, value: unknown): Promise<{ version: number; bytes: number }> {
  const data = `data:application/json;base64,${Buffer.from(JSON.stringify(value)).toString("base64")}`;
  const r = (await cldSafe("upload-raw", () =>
    cloudinary.uploader.upload(data, {
      resource_type: "raw",
      type: "upload",
      public_id: publicId,
      overwrite: true,
      unique_filename: false,
      ...mainAuth(),
    }),
  )) as unknown as { version?: number; bytes?: number };
  return { version: Number(r.version ?? 0), bytes: Number(r.bytes ?? 0) };
}

/**
 * Create a small raw JSON document only if `publicId` doesn't exist yet (Upload API,
 * overwrite: false, which Cloudinary applies atomically: of two concurrent uploads
 * one creates the asset, the other gets the existing one back). Returns the version
 * that is stored, which is ours or the one that was already there; `existing` is
 * Cloudinary's flag for the latter. Callers that must know WHO holds the document
 * read it back at that version (lib/server/locks.ts), so they don't depend on the flag.
 */
export async function uploadRawJsonOnce(publicId: string, value: unknown, tags: string[] = []): Promise<{ version: number; existing: boolean }> {
  const data = `data:application/json;base64,${Buffer.from(JSON.stringify(value)).toString("base64")}`;
  const r = (await cldSafe("upload-raw-once", () =>
    cloudinary.uploader.upload(data, {
      resource_type: "raw",
      type: "upload",
      public_id: publicId,
      overwrite: false,
      unique_filename: false,
      ...(tags.length ? { tags } : {}),
      ...mainAuth(),
    }),
  )) as unknown as { version?: number; existing?: boolean };
  return { version: Number(r.version ?? 0), existing: r.existing === true };
}

/**
 * The SDK's typings only accept a context string and no auth options here, but
 * the implementation takes an object (escaping `=` and `|`) plus per-call auth.
 */
const uploader = cloudinary.uploader as unknown as {
  add_context(ctx: Ctx, ids: string[], options: object): Promise<unknown>;
  add_tag(tag: string, ids: string[], options: object): Promise<unknown>;
  remove_tag(tag: string, ids: string[], options: object): Promise<unknown>;
};

/** Merge context key/values into assets (SDK escapes `=` and `|`). */
export async function addContext(publicIds: string[], ctx: Ctx): Promise<void> {
  const clean: Ctx = {};
  for (const [k, v] of Object.entries(ctx)) clean[k] = String(v).replace(/[\r\n]+/g, " ").slice(0, 900);
  await cldSafe("add_context", () => uploader.add_context(clean, publicIds, mainAuth()));
}

export async function addTags(publicIds: string[], tags: string[]): Promise<void> {
  for (const t of tags) await cldSafe("add_tag", () => uploader.add_tag(t, publicIds, mainAuth()));
}

export async function removeTag(publicIds: string[], tag: string): Promise<void> {
  if (publicIds.length) await cldSafe("remove_tag", () => uploader.remove_tag(tag, publicIds, mainAuth()));
}

export interface ProbeResult {
  status: number;
  ms: number;
  error?: string | null;
}

/**
 * Check whether a delivery URL is ready. HEAD is enough to trigger (and wait for)
 * a derivation; AI effects answer 423 while they are still processing.
 */
export async function probe(url: string, timeoutMs = 8000, method: "HEAD" | "GET" = "HEAD"): Promise<ProbeResult> {
  const t0 = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The deadline is enforced by the race, not only by the abort signal: an abort
  // is not always honoured while a HEAD waits for Cloudinary to finish deriving.
  const deadline = new Promise<ProbeResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ status: 0, ms: Date.now() - t0, error: "timeout" });
    }, timeoutMs);
  });
  const request = (async (): Promise<ProbeResult> => {
    try {
      const res = await fetch(url, { method, signal: controller.signal, cache: "no-store" });
      if (method === "GET") await res.arrayBuffer();
      return { status: res.status, ms: Date.now() - t0, error: res.headers.get("x-cld-error") };
    } catch {
      return { status: 0, ms: Date.now() - t0, error: "timeout" };
    }
  })();
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
