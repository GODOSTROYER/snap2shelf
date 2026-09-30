import "server-only";
import { v2 as cloudinary } from "cloudinary";
import { getMainAccount } from "./accounts";
import { scrubSecrets } from "./safe";

/**
 * MAIN's usage reading, shared by every server instance through one tiny raw
 * JSON asset (snap2shelf/state/usage-main.json), so the Admin `usage` call on
 * main happens about once per SHARED_USAGE_TTL_MS for the whole deployment
 * instead of once per 10 minutes per warm function.
 *
 * Read = Upload API `explicit` for the version + a GET of the versioned CDN URL;
 * write = Upload API `upload`. Neither counts against the Admin API limit.
 * Only main's own numbers are stored (credits and add-on quota totals, the
 * same totals /api/usage already exposes): never pool accounts, names or keys.
 * Plain signed fetches (no SDK): failures come back as null / a log line.
 */

export const SHARED_USAGE_ID = "snap2shelf/state/usage-main.json";
export const SHARED_USAGE_TTL_MS = 15 * 60_000;

export interface SharedMainUsage {
  s: 1;
  at: number; // when Cloudinary answered the Admin usage call
  credits?: { used: number; limit: number };
  addons: Record<string, { used: number; limit: number }>;
}

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);

export function parseSharedUsage(j: unknown): SharedMainUsage | null {
  const d = j as Partial<SharedMainUsage> | null;
  if (!d || d.s !== 1 || !num(d.at) || !d.addons || typeof d.addons !== "object") return null;
  for (const v of Object.values(d.addons)) if (!v || !num(v.used) || !num(v.limit)) return null;
  if (d.credits && (!num(d.credits.used) || !num(d.credits.limit))) return null;
  return d as SharedMainUsage;
}

/** Signed Upload API call on main (form-encoded). */
async function uploadApi(action: "explicit" | "upload", params: Record<string, string | number>): Promise<Response> {
  const m = getMainAccount();
  const signed: Record<string, string | number> = { ...params, timestamp: Math.floor(Date.now() / 1000) };
  const toSign = Object.fromEntries(Object.entries(signed).filter(([k]) => k !== "file" && k !== "resource_type"));
  const signature = cloudinary.utils.api_sign_request(toSign, m.apiSecret);
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(signed)) body.set(k, String(v));
  body.set("api_key", m.apiKey);
  body.set("signature", signature);
  return fetch(`https://api.cloudinary.com/v1_1/${m.cloudName}/raw/${action}`, { method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(6000) });
}

/** The shared reading, or null (missing, unreadable). Never throws. */
export async function readSharedMainUsage(): Promise<SharedMainUsage | null> {
  try {
    const info = await uploadApi("explicit", { public_id: SHARED_USAGE_ID, type: "upload" });
    if (!info.ok) return null; // 404 on the very first run
    const version = Number(((await info.json()) as { version?: number }).version);
    if (!Number.isFinite(version) || version <= 0) return null;
    const res = await fetch(`https://res.cloudinary.com/${getMainAccount().cloudName}/raw/upload/v${version}/${SHARED_USAGE_ID}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return parseSharedUsage(await res.json());
  } catch {
    return null; // network: fall back to the Admin call
  }
}

/** Publish a fresh reading for the other instances. Never throws. */
export async function writeSharedMainUsage(u: SharedMainUsage): Promise<void> {
  try {
    const file = `data:application/json;base64,${Buffer.from(JSON.stringify(u)).toString("base64")}`;
    const res = await uploadApi("upload", { file, public_id: SHARED_USAGE_ID, type: "upload", overwrite: "true", unique_filename: "false" });
    if (!res.ok) console.warn(`[usage] shared reading not saved: HTTP ${res.status}`);
  } catch (err) {
    console.warn(`[usage] shared reading not saved: ${scrubSecrets(String((err as Error)?.message ?? err)).slice(0, 120)}`);
  }
}
