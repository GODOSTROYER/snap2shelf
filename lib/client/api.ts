/**
 * Typed client for lib/api-contract.ts.
 *
 * - Sample products (lib/showcase.ts) never reach the API: the studio replays
 *   their stored results, and the calls below answer from the showcase too
 *   (source "sample"), so a sample costs no quota.
 * - NEXT_PUBLIC_S2S_MOCK=1 answers everything from lib/client/mock.ts (source
 *   "demo") for offline UI work. That is the ONLY time mock data appears.
 * - Otherwise every call hits its route. A missing route or a dropped
 *   connection is an error with a plain message, never silent demo data.
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
import { ApiFailure, isReadOnly, READ_ONLY_FALLBACK } from "./errors";
import * as mock from "./mock";
import { sleep } from "./util";

export const MOCK_MODE = process.env.NEXT_PUBLIC_S2S_MOCK === "1";

export type DataSource = "live" | "sample" | "demo";
export interface Sourced<T> {
  data: T;
  source: DataSource;
}

export { ApiFailure, isReadOnly };

class Pending extends Error {
  constructor(public retryAfterMs: number) {
    super("pending");
  }
}

const GENERIC: ApiError = { error: "Something went wrong on our side. Try again in a moment.", code: "upstream" };
const OFFLINE: ApiError = { error: "Can't reach Snap2Shelf. Check your connection and try again.", code: "upstream" };
const MISSING: ApiError = { error: "This step isn't available on this deployment yet. Try a sample product to see the whole flow.", code: "upstream" };

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
    throw new ApiFailure(0, OFFLINE);
  }
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : null;
  if (res.status === 202) throw new Pending((body as ApiError | null)?.retryAfterMs ?? 2500);
  if (!res.ok) throw new ApiFailure(res.status, (body as ApiError | null) ?? (res.status === 404 || res.status === 405 ? MISSING : GENERIC));
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
export async function cutout(sku: Sku, signal?: AbortSignal, onWait?: (attempt: number) => void): Promise<Sourced<CutoutResponse>> {
  const s = getSample(sku);
  if (s) return { source: "sample", data: { sku, cutout: s.product.cutout!, ms: 0 } };
  for (let attempt = 0; attempt < 24; attempt++) {
    try {
      return await call(`/api/products/${sku}/cutout`, post({}, signal), () => mock.cutout(sku));
    } catch (e) {
      if (!(e instanceof Pending)) throw e;
      onWait?.(attempt + 1);
      await sleep(Math.min(Math.max(e.retryAfterMs, 2500), 5000), signal);
    }
  }
  throw new ApiFailure(504, { error: "The cut-out is taking longer than usual. Try again.", code: "pending" });
}

// ─── scenes ───────────────────────────────────────────────────────────────────

/**
 * One scene per theme: the final render when there is one (drafts share its
 * title), the draft only when a theme has no final yet.
 */
export function curateScenes(list: Scene[]): Scene[] {
  const byTheme = new Map<string, Scene>();
  for (const s of list) {
    const prev = byTheme.get(s.theme);
    const isFinal = s.publicId.includes("/final-");
    if (!prev || (isFinal && !prev.publicId.includes("/final-"))) byTheme.set(s.theme, s);
  }
  return [...byTheme.values()];
}

export async function scenes(view: SceneView, signal?: AbortSignal): Promise<Sourced<Scene[]>> {
  const r = await call<{ scenes: Scene[] }>(`/api/scenes?view=${view}`, { signal }, async () => ({ scenes: await mock.scenes(view) }));
  return { ...r, data: curateScenes(r.data.scenes) };
}

// ─── QA + pack ────────────────────────────────────────────────────────────────

/** Pending (202) answers are retried a few times, e.g. while a composite is still rendering. */
export async function qa(req: QaRequest, signal?: AbortSignal): Promise<Sourced<QaResponse>> {
  const s = getSample(req.sku);
  if (s) return { source: "sample", data: { qa: s.qa, tokens: 0 } };
  for (let attempt = 0; ; attempt++) {
    try {
      return await call<QaResponse>("/api/qa", post(req, signal), () => mock.qa(req));
    } catch (e) {
      if (!(e instanceof Pending) || attempt >= 5) throw e instanceof Pending ? new ApiFailure(504, { error: "The QA check is taking longer than usual. Try again.", code: "pending" }) : e;
      await sleep(Math.min(Math.max(e.retryAfterMs, 2500), 5000), signal);
    }
  }
}

export function pack(req: PackRequest, signal?: AbortSignal): Promise<Sourced<PackResponse>> {
  const s = getSample(req.sku);
  if (s) return Promise.resolve({ source: "sample", data: { sku: req.sku, heroPublicId: s.heroPublicId, assets: s.kit.assets, pending: [] } });
  return call<PackResponse>("/api/pack", post(req, signal), () => mock.pack(req));
}

export function packStatus(sku: Sku, signal?: AbortSignal): Promise<Sourced<PackStatusResponse>> {
  const s = getSample(sku);
  if (s) return Promise.resolve({ source: "sample", data: { assets: s.kit.assets, pending: [], heroPublicId: s.heroPublicId, zipUrl: s.kit.zipUrl } });
  return call<PackStatusResponse>(`/api/pack/${sku}`, { signal }, () => mock.packStatus(sku));
}

// ─── creative (gated) ─────────────────────────────────────────────────────────

export const access = (code: string) => call<AccessResponse>("/api/access", post({ code }), () => mock.access(code));

export const generate = (req: GenerateRequest, signal?: AbortSignal) =>
  call<GenerateResponse>("/api/generate", post(req, signal), () => mock.generate(req));

export const job = (token: string, signal?: AbortSignal) =>
  mock.isMockJob(token)
    ? mock.job(token).then((data): Sourced<JobResponse> => ({ data, source: "demo" }))
    : call<JobResponse>(`/api/jobs/${encodeURIComponent(token)}`, { signal }, () => mock.job(token));

export const usage = (signal?: AbortSignal) => call<UsageResponse>("/api/usage", { signal }, () => mock.usage());

/** Human message for any thrown error. Server messages are shown as written. */
export function messageFor(e: unknown): string {
  if (isReadOnly(e)) return e.body.error || READ_ONLY_FALLBACK;
  if (e instanceof ApiFailure) {
    switch (e.body.code) {
      case "locked":
        return "Creative mode needs an access code.";
      case "cap_reached":
        return e.body.error || "You've used this session's allowance. Exact mode on the samples is still free.";
      case "quota_low":
        return e.body.error || "Live AI is paused to protect the shared quota. The sample kits still work.";
      default:
        return e.body.error || GENERIC.error;
    }
  }
  if (e instanceof Error && e.message && e.message !== "aborted") return e.message;
  return GENERIC.error;
}
