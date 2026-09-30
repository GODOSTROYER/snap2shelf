import "server-only";
import { v2 as cloudinary } from "cloudinary";
import { INGEST_PRESET } from "./config";

/**
 * Strict allowlist for POST /api/sign-upload (next-cloudinary CldUploadWidget
 * contract, also used by the phone capture page). Anything outside it is
 * refused, so a signature can only ever create
 *   snap2shelf/products/<sku>/raw  through the s2s_ingest preset
 * (preset: signed, overwrite false, c_limit 2400, image formats only).
 */

export const RAW_PUBLIC_ID = /^snap2shelf\/products\/([a-z0-9]{8})\/raw$/;
const ALLOWED_KEYS = new Set(["timestamp", "source", "upload_preset", "public_id", "tags", "context"]);
const CONTEXT_KEYS = new Set(["origin", "capture"]);
const MAX_SKEW_S = 10 * 60;

export type SignCheck = { ok: true; params: Record<string, string | number> } | { ok: false; reason: string };

export function checkParamsToSign(input: unknown, now = Date.now()): SignCheck {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, reason: "shape" };
  const params = input as Record<string, unknown>;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (!ALLOWED_KEYS.has(k)) return { ok: false, reason: `param ${k.slice(0, 40)} not allowed` };
    if (typeof v !== "string" && typeof v !== "number") return { ok: false, reason: `param ${k} type` };
    if (String(v).length > 512) return { ok: false, reason: `param ${k} too long` };
    out[k] = v;
  }

  const ts = Number(out.timestamp);
  if (!Number.isInteger(ts) || Math.abs(Math.floor(now / 1000) - ts) > MAX_SKEW_S) return { ok: false, reason: "timestamp" };
  if (out.upload_preset !== INGEST_PRESET) return { ok: false, reason: "upload_preset" };
  if (out.source !== undefined && out.source !== "uw") return { ok: false, reason: "source" };

  const m = RAW_PUBLIC_ID.exec(String(out.public_id ?? ""));
  if (!m) return { ok: false, reason: "public_id" };
  const sku = m[1];

  if (out.tags !== undefined) {
    const allowed = new Set(["s2s", "s2s-raw", "s2s-capture", `s2s-sku-${sku}`]);
    const tags = String(out.tags).split(",").map((t) => t.trim());
    if (!tags.length || tags.some((t) => !allowed.has(t))) return { ok: false, reason: "tags" };
    if (!tags.includes("s2s") || !tags.includes("s2s-raw")) return { ok: false, reason: "tags" };
  }

  if (out.context !== undefined) {
    const pairs = String(out.context).split("|");
    if (pairs.length > CONTEXT_KEYS.size) return { ok: false, reason: "context" };
    for (const p of pairs) {
      const cm = /^([a-z_]{1,20})=([A-Za-z0-9 _.-]{0,64})$/.exec(p);
      if (!cm || !CONTEXT_KEYS.has(cm[1])) return { ok: false, reason: "context" };
    }
  }
  return { ok: true, params: out };
}

/** Signature for the upload, same algorithm the SDK uses (api_sign_request). */
export function signParams(params: Record<string, string | number>, secret = process.env.CLOUDINARY_API_SECRET): string {
  if (!secret) throw new Error("Server secret is not configured.");
  return cloudinary.utils.api_sign_request(params, secret);
}
