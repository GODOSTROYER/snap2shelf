/**
 * Typed client for lib/api-contract.ts.
 *
 * - Samples (lib/showcase.ts) are pre-analysed: analyze/cutout answer from the
 *   showcase with no network call (source "sample").
 * - NEXT_PUBLIC_S2S_MOCK=1 answers everything from lib/client/mock.ts (source "demo").
 * - Otherwise each call hits the route; if the route isn't deployed yet (a
 *   non-JSON 404/405) or the network is down, it falls back to the mock and
 *   says so, so the UI can show a "demo data" note instead of breaking.
 */
import type {
  AccessResponse,
  AnalyzeResponse,
  ApiError,
  CutoutResponse,
  GenerateRequest,
  GenerateResponse,
  JobResponse,
  PackRequest,
  PackResponse,
  PackStatusResponse,
  QaRequest,
  QaResponse,
  UsageResponse,
} from "../api-contract";
import { getSample } from "../showcase";
import type { Scene, SceneView, Sku } from "../types";
import { ApiFailure } from "./errors";
import * as mock from "./mock";
import { sleep } from "./util";

export const MOCK_MODE = process.env.NEXT_PUBLIC_S2S_MOCK === "1";

export type DataSource = "live" | "sample" | "demo";
export interface Sourced<T> {
  data: T;
  source: DataSource;
}

export { ApiFailure };

class Pending extends Error {
  constructor(public retryAfterMs: number) {
    super("pending");
  }
}

const GENERIC: ApiError = { error: "Something went wrong on our side. Try again in a moment.", code: "upstream" };

async function call<T>(path: string, init: RequestInit, fallback: () => Promise<T>): Promise<Sourced<T>> {
  if (MOCK_MODE) return { data: await fallback(), source: "demo" };
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: init.body ? { "content-type": "application/json", ...init.headers } : init.headers,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (e) {
    if (init.signal?.aborted) throw e;
    return { data: await fallback(), source: "demo" };
  }
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  if (!isJson && (res.status === 404 || res.status === 405 || res.status === 501)) {
    return { data: await fallback(), source: "demo" }; // route not deployed yet
  }
  const body = isJson ? await res.json().catch(() => null) : null;
  if (res.status === 202) throw new Pending((body as ApiError | null)?.retryAfterMs ?? 2500);
  if (!res.ok) throw new ApiFailure(res.status, (body as ApiError | null) ?? GENERIC);
  return { data: body as T, source: "live" };
}

const post = (body: unknown, signal?: AbortSignal): RequestInit => ({ method: "POST", body: JSON.stringify(body), signal });

// ─── product ──────────────────────────────────────────────────────────────────

export async function analyze(sku: Sku, signal?: AbortSignal): Promise<Sourced<AnalyzeResponse>> {
  const s = getSample(sku);
  if (s) {
    const p = s.product;
    return {
      source: "sample",
      data: { sku, caption: p.caption ?? "", focus: p.focus ?? null, understanding: p.understanding!, fixes: { applied: [] }, tokens: 0 },
    };
  }
  return call(`/api/products/${sku}/analyze`, post({}, signal), () => mock.analyze(sku));
}

/** Retries while Cloudinary is still deriving the cut-out (202 pending). */
export async function cutout(sku: Sku, signal?: AbortSignal): Promise<Sourced<CutoutResponse>> {
  const s = getSample(sku);
  if (s) return { source: "sample", data: { sku, cutout: s.product.cutout!, ms: 0 } };
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      return await call(`/api/products/${sku}/cutout`, post({}, signal), () => mock.cutout(sku));
    } catch (e) {
      if (!(e instanceof Pending)) throw e;
      await sleep(Math.min(Math.max(e.retryAfterMs, 1000), 5000), signal);
    }
  }
  throw new ApiFailure(504, { error: "The cut-out is taking longer than usual. Try again.", code: "pending" });
}

// ─── scenes ───────────────────────────────────────────────────────────────────

export async function scenes(view: SceneView, signal?: AbortSignal): Promise<Sourced<Scene[]>> {
  const r = await call<{ scenes: Scene[] }>(`/api/scenes?view=${view}`, { signal }, async () => ({ scenes: await mock.scenes(view) }));
  return { ...r, data: r.data.scenes };
}

// ─── QA + pack ────────────────────────────────────────────────────────────────

export const qa = (req: QaRequest, signal?: AbortSignal) => call<QaResponse>("/api/qa", post(req, signal), () => mock.qa(req));

export const pack = (req: PackRequest, signal?: AbortSignal) => call<PackResponse>("/api/pack", post(req, signal), () => mock.pack(req));

export const packStatus = (sku: Sku, signal?: AbortSignal) =>
  call<PackStatusResponse>(`/api/pack/${sku}`, { signal }, () => mock.packStatus(sku));

// ─── creative (gated) ─────────────────────────────────────────────────────────

export const access = (code: string) => call<AccessResponse>("/api/access", post({ code }), () => mock.access(code));

export const generate = (req: GenerateRequest, signal?: AbortSignal) =>
  call<GenerateResponse>("/api/generate", post(req, signal), () => mock.generate(req));

export const job = (token: string, signal?: AbortSignal) =>
  mock.isMockJob(token)
    ? mock.job(token).then((data): Sourced<JobResponse> => ({ data, source: "demo" }))
    : call<JobResponse>(`/api/jobs/${encodeURIComponent(token)}`, { signal }, () => mock.job(token));

export const usage = (signal?: AbortSignal) => call<UsageResponse>("/api/usage", { signal }, () => mock.usage());

/** Human message for any thrown error. */
export function messageFor(e: unknown): string {
  if (e instanceof ApiFailure) {
    switch (e.body.code) {
      case "locked":
        return "Creative mode needs an access code.";
      case "cap_reached":
        return "You've used this session's generations. Exact mode is still unlimited.";
      case "quota_low":
        return "Live generation is paused to protect the shared quota. The showcase results are shown instead.";
      default:
        return e.body.error || GENERIC.error;
    }
  }
  if (e instanceof Error && e.message) return e.message;
  return GENERIC.error;
}
