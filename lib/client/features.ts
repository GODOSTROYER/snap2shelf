/**
 * Typed client for the pipeline v2 routes (lib/api-contract.ts, "pipeline v2"):
 *   POST /api/brief                     brief bar → kit settings
 *   POST /api/products/:sku/retouch     Q4 auto-retouch (202 pending → poll)
 *   GET  /api/scenes/match              rank the scene library
 *   POST /api/scenes/generate           reuse first, else start a scene job [gated]
 *   GET  /api/scene-jobs/:job           poll a scene job (await each, ~2 s apart)
 *   GET  /api/cost/:sku?scene=…         cost meter for one product's kit
 *   POST /api/access                    unlock live generation for this session
 *
 * No mock fallback: these features only make sense against the live routes, so
 * every failure surfaces as an ApiFailure the components can explain. Responses
 * are normalised, so a missing optional field never crashes a component.
 * Client-safe (no secrets, no server imports).
 */
import type {
  AccessResponse,
  ApiError,
  BriefRequest,
  BriefResponse,
  BriefSource,
  CostResponse,
  RetouchPendingResponse,
  RetouchResponse,
  SceneGenerateRequest,
  SceneGenerateResponse,
  SceneJobResponse,
  SceneMatch,
} from "../api-contract";
import { SCENE_THEMES, type BriefKit, type ChannelFormat, type RetouchFix, type Scene, type SceneView, type Sku } from "../types";
import { ApiFailure } from "./errors";
import { sleep } from "./util";

export { ApiFailure };

// ─── transport ────────────────────────────────────────────────────────────────

const OFFLINE: ApiError = { error: "Can't reach the studio server. Check your connection and try again.", code: "upstream" };
const GENERIC: ApiError = { error: "Something went wrong on our side. Try again in a moment.", code: "upstream" };

interface Answer<T> {
  status: number;
  body: T;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<Answer<T>> {
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
  if (!isJson && res.status === 404) throw new ApiFailure(404, { error: "This feature isn't available on this server yet.", code: "not_found" });
  if (!res.ok) throw new ApiFailure(res.status, apiErrorOf(body) ?? { ...GENERIC, code: res.status === 404 ? "not_found" : "upstream" });
  return { status: res.status, body: (body ?? {}) as T };
}

function apiErrorOf(body: unknown): ApiError | null {
  const b = body as Partial<ApiError> | null;
  if (!b || typeof b.error !== "string") return null;
  return { error: b.error, code: b.code ?? "upstream", retryAfterMs: typeof b.retryAfterMs === "number" ? b.retryAfterMs : undefined };
}

const post = (body: unknown, signal?: AbortSignal): RequestInit => ({ method: "POST", body: JSON.stringify(body ?? {}), signal });

// ─── normalisers (tolerant of optional / missing fields) ─────────────────────

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

const KIT_KEYS: (keyof BriefKit)[] = ["theme", "offer", "channels", "swatches", "tone"];

export function normaliseBrief(b: Partial<BriefResponse>, sku: Sku): BriefResponse {
  const k: Partial<BriefKit> = b.kit ?? {};
  const sources = Object.fromEntries(KIT_KEYS.map((key) => [key, (b.sources?.[key] ?? "default") as BriefSource])) as Record<keyof BriefKit, BriefSource>;
  return {
    sku: b.sku ?? sku,
    kit: {
      theme: str(k.theme) ?? "",
      offer: { hindi: str(k.offer?.hindi) || undefined, english: str(k.offer?.english) || undefined },
      channels: arr<ChannelFormat>(k.channels),
      swatches: arr<string>(k.swatches)
        .map((h) => String(h).replace(/^#/, "").toLowerCase())
        .filter((h) => /^[0-9a-f]{6}$/.test(h))
        .slice(0, 4),
      tone: (str(k.tone) ?? "festive") as BriefKit["tone"],
    },
    festival: b.festival,
    scenePrompt: str(b.scenePrompt) || undefined,
    sources,
    tokens: num(b.tokens),
    cached: Boolean(b.cached),
  };
}

export function normaliseRetouch(r: Partial<RetouchResponse>, sku: Sku): RetouchResponse {
  return {
    sku: r.sku ?? sku,
    status: r.status === "done" ? "done" : "none",
    fixes: { applied: arr<RetouchFix>(r.fixes?.applied), retouchedPublicId: r.fixes?.retouchedPublicId },
    detected: arr<string>(r.detected),
    notes: arr<string>(r.notes),
    transformation: str(r.transformation),
    xray: r.xray && typeof r.xray.url === "string" ? { ...r.xray, segments: arr(r.xray.segments) } : undefined,
    beforeUrl: str(r.beforeUrl),
    url: str(r.url),
    tx: num(r.tx),
    tokens: num(r.tokens),
    ms: num(r.ms),
  };
}

function normalisePending(p: Partial<RetouchPendingResponse>): RetouchPendingResponse {
  return {
    error: p.error ?? "Retouching the photo, try again shortly.",
    code: "pending",
    retryAfterMs: num(p.retryAfterMs, 2000),
    planned: arr<RetouchFix>(p.planned),
    detected: arr<string>(p.detected),
    notes: arr<string>(p.notes),
    tokens: num(p.tokens),
  };
}

function normaliseCost(c: Partial<CostResponse>, sku: Sku): CostResponse {
  const cost: Partial<CostResponse["cost"]> = c.cost ?? {};
  const b: Partial<CostResponse["breakdown"]> = c.breakdown ?? {};
  return {
    sku: c.sku ?? sku,
    cost: {
      generationCredits: num(cost.generationCredits),
      creditsSavedByReuse: num(cost.creditsSavedByReuse),
      aiVisionTokens: num(cost.aiVisionTokens),
      transformationsEstimate: num(cost.transformationsEstimate),
      bytesOriginal: num(cost.bytesOriginal),
      bytesDelivered: num(cost.bytesDelivered),
      seconds: num(cost.seconds),
    },
    breakdown: {
      generation: arr(b.generation),
      tokens: arr(b.tokens),
      transformations: arr(b.transformations),
      steps: arr(b.steps),
    },
    delivered: {
      url: str(c.delivered?.url) ?? "",
      format: str(c.delivered?.format) ?? "",
      bytes: num(c.delivered?.bytes),
      from: c.delivered?.from === "hero" ? "hero" : "raw",
    },
    wallClockSeconds: typeof c.wallClockSeconds === "number" ? c.wallClockSeconds : null,
    estimated: true,
  };
}

// ─── the client ───────────────────────────────────────────────────────────────

export type RetouchStep = { kind: "pending"; data: RetouchPendingResponse } | { kind: "done"; data: RetouchResponse };

export interface MatchQuery {
  theme?: string;
  q?: string;
  view?: SceneView;
  limit?: number;
}

/** Everything the feature components call. Swap it (e.g. in a story) to mock a response. */
export interface FeaturesClient {
  brief(req: BriefRequest, signal?: AbortSignal): Promise<BriefResponse>;
  /** One retouch step: 202 → pending (poll again after retryAfterMs), 200 → done. */
  retouch(sku: Sku, signal?: AbortSignal): Promise<RetouchStep>;
  matchScenes(q: MatchQuery, signal?: AbortSignal): Promise<SceneMatch[]>;
  generateScene(req: SceneGenerateRequest, signal?: AbortSignal): Promise<SceneGenerateResponse>;
  sceneJob(job: string, signal?: AbortSignal): Promise<SceneJobResponse>;
  cost(sku: Sku, scene?: string | null, signal?: AbortSignal): Promise<CostResponse>;
  access(code: string): Promise<AccessResponse>;
}

export const featuresClient: FeaturesClient = {
  async brief(req, signal) {
    const r = await request<Partial<BriefResponse>>("/api/brief", post(req, signal));
    return normaliseBrief(r.body, req.sku);
  },

  async retouch(sku, signal) {
    const r = await request<Partial<RetouchResponse> & Partial<RetouchPendingResponse>>(`/api/products/${encodeURIComponent(sku)}/retouch`, post({}, signal));
    if (r.status === 202 || r.body.code === "pending") return { kind: "pending", data: normalisePending(r.body) };
    return { kind: "done", data: normaliseRetouch(r.body, sku) };
  },

  async matchScenes(q, signal) {
    const sp = new URLSearchParams();
    if (q.theme) sp.set("theme", q.theme);
    if (q.q?.trim()) sp.set("q", q.q.trim().slice(0, 300));
    if (q.view) sp.set("view", q.view);
    if (q.limit) sp.set("limit", String(q.limit));
    const r = await request<{ matches?: SceneMatch[] }>(`/api/scenes/match?${sp.toString()}`, { signal });
    return arr<SceneMatch>(r.body.matches).filter((m) => m?.scene?.publicId);
  },

  async generateScene(req, signal) {
    const r = await request<Partial<SceneGenerateResponse> & Record<string, unknown>>("/api/scenes/generate", post(req, signal));
    const b = r.body;
    if (b.reused === true && b.scene) return { reused: true, scene: b.scene as Scene, credits: 0, creditsSaved: num(b.creditsSaved) };
    if (typeof b.job === "string" && b.job) {
      return { reused: false, job: b.job, tier: (b.tier as SceneGenerateRequest["tier"]) ?? req.tier, modelId: str(b.modelId) ?? "", estimatedCredits: num(b.estimatedCredits, 1) };
    }
    throw new ApiFailure(502, GENERIC);
  },

  async sceneJob(job, signal) {
    const r = await request<Partial<SceneJobResponse>>(`/api/scene-jobs/${encodeURIComponent(job)}`, { signal });
    const b = r.body;
    const status = b.status === "completed" || b.status === "failed" || b.status === "processing" ? b.status : "pending";
    return { ...b, status };
  },

  async cost(sku, scene, signal) {
    const q = scene ? `?scene=${encodeURIComponent(scene)}` : "";
    const r = await request<Partial<CostResponse>>(`/api/cost/${encodeURIComponent(sku)}${q}`, { signal });
    return normaliseCost(r.body, sku);
  },

  async access(code) {
    const r = await request<AccessResponse>("/api/access", post({ code }));
    return { ok: true, generationsLeft: num(r.body.generationsLeft) };
  },
};

// ─── pollers ──────────────────────────────────────────────────────────────────

/**
 * Retouch until done: each 202 reports the plan (so the UI can narrate it),
 * then waits retryAfterMs (clamped to 1–5 s). Gives up after ~2 minutes.
 */
export async function retouchUntilDone(
  client: FeaturesClient,
  sku: Sku,
  opts: { signal?: AbortSignal; onPending?: (p: RetouchPendingResponse) => void; timeoutMs?: number } = {},
): Promise<RetouchResponse> {
  const t0 = Date.now();
  const limit = opts.timeoutMs ?? 120_000;
  for (;;) {
    const step = await client.retouch(sku, opts.signal);
    if (step.kind === "done") return step.data;
    opts.onPending?.(step.data);
    if (Date.now() - t0 > limit) throw new ApiFailure(408, { error: "Retouching is taking longer than usual. Try again in a minute.", code: "pending" });
    await sleep(Math.min(Math.max(step.data.retryAfterMs ?? 2000, 1000), 5000), opts.signal);
  }
}

/** Poll a scene job every `intervalMs` (awaiting each answer) until it completes or fails. */
export async function sceneJobUntilDone(
  client: FeaturesClient,
  job: string,
  opts: { signal?: AbortSignal; onStatus?: (r: SceneJobResponse) => void; intervalMs?: number; timeoutMs?: number } = {},
): Promise<SceneJobResponse> {
  const t0 = Date.now();
  const every = opts.intervalMs ?? 2000;
  const limit = opts.timeoutMs ?? 150_000;
  for (;;) {
    await sleep(every, opts.signal);
    const r = await client.sceneJob(job, opts.signal);
    opts.onStatus?.(r);
    if (r.status === "completed" || r.status === "failed") return r;
    if (Date.now() - t0 > limit) throw new ApiFailure(408, { error: "The new scene is taking longer than usual. Pick a library scene, or try again later.", code: "pending" });
  }
}

// ─── display helpers ──────────────────────────────────────────────────────────

/**
 * Cloudinary is rate-limiting or briefly unavailable (the route answers 502/503/420):
 * nothing is wrong with the request, it just needs a little time. Components show a
 * calm "busy" state for these and retry slowly (≥ 3 s apart, a few tries at most).
 */
export function isBusy(e: unknown): boolean {
  if (!(e instanceof ApiFailure)) return false;
  if (e.body.code === "quota_low" || e.body.code === "cap_reached" || e.body.code === "locked") return false;
  return e.status === 420 || e.status === 429 || e.status === 502 || e.status === 503 || e.status === 504;
}

export const BUSY_MESSAGE = "Cloudinary is busy for a moment. We'll try again shortly.";

/** Backoff for busy retries: 4 s, 8 s, 16 s, then stop and offer a button. */
export const BUSY_RETRIES = [4000, 8000, 16000] as const;

/**
 * Run `call`; while Cloudinary is busy, wait 4 / 8 / 16 s between tries (reporting each
 * wait through onBusy), then give up and rethrow so the UI can offer a button.
 */
export async function withBusyRetry<T>(call: () => Promise<T>, opts: { signal?: AbortSignal; onBusy?: (retryInMs: number, attempt: number) => void } = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (e) {
      if (!isBusy(e) || attempt >= BUSY_RETRIES.length || opts.signal?.aborted) throw e;
      const wait = BUSY_RETRIES[attempt];
      opts.onBusy?.(wait, attempt + 1);
      await sleep(wait, opts.signal);
    }
  }
}

/** Human message for any failure from this client. */
export function featureMessage(e: unknown): string {
  if (e instanceof ApiFailure) {
    if (isBusy(e)) return BUSY_MESSAGE;
    switch (e.body.code) {
      case "locked":
        return "A new scene needs the demo access code.";
      case "cap_reached":
        return "You've used this session's live generations. Pick a library scene instead.";
      case "quota_low":
        return "Live generation is paused to protect the shared quota. Pick a library scene instead.";
      default:
        return e.body.error || GENERIC.error;
    }
  }
  if (e instanceof Error && e.message && e.name !== "Aborted") return e.message;
  return GENERIC.error;
}

const THEME_LABEL = new Map<string, string>(SCENE_THEMES.map((t) => [t.slug, t.label]));
const titleCase = (s: string) => s.replace(/[-_]+/g, " ").replace(/\b\p{L}/gu, (c) => c.toUpperCase());
const sentence = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** "flatlay-festive" → "Festive flat-lay"; unknown slugs are title-cased. */
export const themeLabel = (slug: string) => THEME_LABEL.get(slug) ?? (slug === "custom" ? "Custom backdrop" : titleCase(slug));

export const CHANNEL_META: Partial<Record<ChannelFormat, { label: string; ratio: [number, number] }>> = {
  feed: { label: "Feed post", ratio: [4, 5] },
  story: { label: "Story", ratio: [9, 16] },
  whatsapp: { label: "WhatsApp", ratio: [1, 1] },
  marketplace: { label: "Marketplace", ratio: [1, 1] },
  banner: { label: "Web banner", ratio: [16, 9] },
  hero: { label: "Hero", ratio: [4, 5] },
  recolor: { label: "Colour variant", ratio: [4, 5] },
  offer: { label: "Offer post", ratio: [4, 5] },
};
export const channelMeta = (c: ChannelFormat) => CHANNEL_META[c] ?? { label: titleCase(c), ratio: [1, 1] as [number, number] };

export const FIX_META: Record<RetouchFix, { label: string; doing: string }> = {
  cleanup: { label: "Clutter", doing: "Removing clutter" },
  restore: { label: "Detail", doing: "Restoring detail" },
  brightness: { label: "Brightness", doing: "Brightening" },
  color: { label: "Colour", doing: "Correcting colour" },
  resolution: { label: "Resolution", doing: "Upscaling" },
};
export const fixMeta = (f: string) => FIX_META[f as RetouchFix] ?? { label: titleCase(f), doing: `Fixing ${f.replace(/[-_]+/g, " ")}` };

/** rankScenes reasons ("theme diwali", "matches brass, diyas", "warm light") in display form. */
export function matchReason(r: string): string {
  const t = /^theme (.+)$/.exec(r);
  if (t) return `${themeLabel(t[1])} theme`;
  return sentence(r);
}

/** 1_868_000 → "1.78 MB", 72_600 → "71 KB". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 KB";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  return `${mb >= 10 ? mb.toFixed(1) : mb.toFixed(2)} MB`;
}

const FORMAT_LABEL: Record<string, string> = { webp: "WebP", avif: "AVIF", jpeg: "JPEG", jpg: "JPEG", png: "PNG", gif: "GIF", "jxl": "JPEG XL" };
export const formatLabel = (f: string) => FORMAT_LABEL[f.toLowerCase()] ?? f.toUpperCase();

/** The product photo as the retouch route delivers it (same URL, so the same cached derivative). */
export const rawViewPath = (sku: Sku) => `snap2shelf/products/${sku}/raw`;
