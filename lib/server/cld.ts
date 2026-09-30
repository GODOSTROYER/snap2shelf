import "server-only";
import { v2 as cloudinary, type ResourceApiResponse, type UploadApiOptions, type UploadApiResponse } from "cloudinary";
import { getMainAccount } from "../cloudinary/accounts";
import { cldHttpCode } from "./http";

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

/** Admin API resource lookup on main; null when it doesn't exist. */
export async function getResource(publicId: string): Promise<AssetInfo | null> {
  try {
    const r = (await cloudinary.api.resource(publicId, { ...mainAuth(), context: true, tags: true })) as unknown as ResourceLike;
    return toAssetInfo(r);
  } catch (err) {
    if (cldHttpCode(err) === 404) return null;
    throw err;
  }
}

/** All assets under a folder prefix (with context), up to 100. One Admin API call. */
export async function listByPrefix(prefix: string): Promise<AssetInfo[]> {
  const res = (await cloudinary.api.resources({
    ...mainAuth(),
    type: "upload",
    resource_type: "image",
    prefix,
    context: true,
    tags: true,
    max_results: 100,
  })) as ResourceApiResponse;
  return (res.resources as unknown as ResourceLike[]).map(toAssetInfo);
}

/** Upload to main (by URL or data URI). Upload API calls don't count against the Admin API rate limit. */
export async function uploadToMain(file: string, options: UploadApiOptions & { public_id: string }): Promise<AssetInfo> {
  const r: UploadApiResponse = await cloudinary.uploader.upload(file, {
    resource_type: "image",
    unique_filename: false,
    ...options,
    ...mainAuth(),
  });
  return toAssetInfo(r as unknown as ResourceLike);
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
  await uploader.add_context(clean, publicIds, mainAuth());
}

export async function addTags(publicIds: string[], tags: string[]): Promise<void> {
  for (const t of tags) await uploader.add_tag(t, publicIds, mainAuth());
}

export async function removeTag(publicIds: string[], tag: string): Promise<void> {
  if (publicIds.length) await uploader.remove_tag(tag, publicIds, mainAuth());
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
