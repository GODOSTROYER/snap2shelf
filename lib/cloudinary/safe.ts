import "server-only";
import { getAccounts } from "./accounts";

/**
 * Credential-safe Cloudinary SDK errors.
 *
 * Node SDK rejections are plain objects, and Admin API ones carry
 * `request_options` (with `auth` = "api_key:api_secret"), `query_params` and
 * sometimes the full call options. Anything that logs, inspects, serialises or
 * re-throws such an object leaks the API secret (Next.js prints uncaught errors
 * verbatim and forwards them to the browser console in dev).
 *
 * Every SDK call goes through cldSafe() (Upload API, pure) or adminCall()
 * (lib/cloudinary/admin.ts: Admin API, plus rate-limit breaker), which re-throw
 * a CloudinarySdkError built from whitelisted primitives only: a scrubbed
 * message string and the numeric HTTP code. The original object is dropped
 * (not kept as `cause`), so no inspect / JSON / log path can reach it.
 */

export class CloudinarySdkError extends Error {
  readonly http_code?: number;
  readonly op?: string;
  constructor(message: string, httpCode?: number, op?: string) {
    super(message);
    this.name = "CloudinarySdkError";
    if (httpCode !== undefined) this.http_code = httpCode;
    if (op) this.op = op;
  }
  toJSON() {
    return { name: this.name, message: this.message, http_code: this.http_code, op: this.op };
  }
}

const GENERIC = "Cloudinary request failed";

/** Remove anything credential-shaped from a string: configured keys/secrets, basic auth, userinfo URLs, key=value secrets. */
export function scrubSecrets(s: string, extra: string[] = []): string {
  let out = s;
  const known = new Set<string>(extra.filter((x) => x && x.length >= 6));
  try {
    for (const a of getAccounts()) {
      if (a.apiSecret && a.apiSecret.length >= 6) known.add(a.apiSecret);
      if (a.apiKey && a.apiKey.length >= 6) known.add(a.apiKey);
    }
  } catch {
    // no accounts configured: pattern scrubbing below still applies
  }
  for (const k of [...known].sort((a, b) => b.length - a.length)) out = out.split(k).join("[redacted]");
  return out
    .replace(/\b(Basic|Bearer)\s+[A-Za-z0-9+/=._-]{8,}/gi, "$1 [redacted]")
    .replace(/(\/\/)[^/\s:@]+:[^/\s@]+@/g, "$1[redacted]@")
    .replace(/\b(api_secret|api_key|auth|signature|authorization|password|secret)(["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi, "$1$2[redacted]");
}

function messageOf(err: unknown): string {
  const e = err as { error?: { message?: unknown }; message?: unknown } | null | undefined;
  const candidates = [e?.error?.message, e?.message];
  for (const m of candidates) {
    if (typeof m === "string" && m) return m;
    // network errors arrive as { error: { message: <Error> } }
    if (m && typeof m === "object" && typeof (m as { message?: unknown }).message === "string") return (m as { message: string }).message;
  }
  return typeof err === "string" ? err : GENERIC;
}

function httpCodeOf(err: unknown): number | undefined {
  const e = err as { error?: { http_code?: unknown }; http_code?: unknown; status?: unknown } | null | undefined;
  for (const c of [e?.error?.http_code, e?.http_code, e?.status]) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
  }
  return undefined;
}

/** Any SDK rejection (or thrown value) → CloudinarySdkError with a scrubbed message and the HTTP code only. */
export function sanitizeCldError(err: unknown, op?: string): CloudinarySdkError {
  if (err instanceof CloudinarySdkError) return err;
  const message = scrubSecrets(messageOf(err)).replace(/[\r\n]+/g, " ").slice(0, 300) || GENERIC;
  return new CloudinarySdkError(message, httpCodeOf(err), op);
}

/** Run one Upload-API / utility SDK call; rejections come back sanitised. */
export async function cldSafe<T>(op: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw sanitizeCldError(err, op);
  }
}
