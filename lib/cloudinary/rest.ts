import "server-only";
import { basicAuth, type CloudinaryAccount } from "./accounts";
import { QuotaError, recordQuota, type PooledCapability } from "./pool";

/** Error from a Cloudinary v2 REST API (generate / analysis). Never carries credentials. */
export class CloudinaryApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly category?: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "CloudinaryApiError";
  }
}

export interface AddonQuota {
  type: string;
  usedByRequest: number | null;
  remaining: number | null;
  limit: number | null;
}

/**
 * Pull add-on quota readings out of a response body. The docs show three shapes
 * (`limits.addons_quota[]`, `limits.items[]`, legacy `limits.usage`), and for
 * async task polls the block may sit under `data.limits`, so accept all of them.
 */
export function extractQuotas(body: unknown): AddonQuota[] {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return [];
  const limitsBlocks = [b.limits, (b.data as Record<string, unknown> | undefined)?.limits].filter(Boolean) as Record<string, unknown>[];
  const out: AddonQuota[] = [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  for (const limits of limitsBlocks) {
    for (const arr of [limits.addons_quota, limits.items]) {
      if (!Array.isArray(arr)) continue;
      for (const q of arr as Record<string, unknown>[]) {
        if (typeof q?.type !== "string") continue;
        out.push({ type: q.type, usedByRequest: num(q.used_by_request), remaining: num(q.remaining), limit: num(q.limit) });
      }
    }
    const legacy = limits.usage as Record<string, unknown> | undefined;
    if (legacy && typeof legacy.type === "string") {
      out.push({ type: legacy.type, usedByRequest: num(legacy.count), remaining: null, limit: null });
    }
  }
  return out;
}

const CAPABILITY_BY_TYPE: Record<string, PooledCapability> = {
  image_generation: "image_generation",
  ai_vision: "ai_vision",
};

/**
 * POST/GET a Cloudinary v2 REST endpoint as `account`. Records any quota block
 * into the pool, and maps quota / rate-limit failures to QuotaError so that
 * withPooledAccount() moves on to the next account.
 */
export async function cldRequest<T = unknown>(
  account: CloudinaryAccount,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {},
): Promise<{ status: number; body: T; quotas: AddonQuota[] }> {
  const url = `https://api.cloudinary.com/v2${path.replace("{cloud}", account.cloudName)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 55_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? (init.body ? "POST" : "GET"),
      headers: {
        Authorization: basicAuth(account),
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: { message: text.slice(0, 300) } };
  }

  const quotas = extractQuotas(body);
  for (const q of quotas) {
    const cap = CAPABILITY_BY_TYPE[q.type];
    if (cap) recordQuota(account, cap, { remaining: q.remaining, limit: q.limit });
  }

  if (!res.ok) {
    const err = (body as { error?: { message?: string; code?: string; category?: string; details?: { message?: string } } }).error ?? {};
    const requestId = (body as { request_id?: string }).request_id;
    const message = [err.message ?? `Cloudinary API ${res.status}`, err.details?.message].filter(Boolean).join(": ");
    const exhausted = quotas.some((q) => q.remaining !== null && q.remaining <= 0);
    if (res.status === 402 || res.status === 429 || err.category === "rate_limit_error" || exhausted) {
      throw new QuotaError(message, res.status);
    }
    throw new CloudinaryApiError(message, res.status, err.code, err.category, requestId);
  }

  return { status: res.status, body: body as T, quotas };
}
