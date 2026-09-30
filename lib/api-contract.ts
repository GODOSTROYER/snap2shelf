/**
 * HTTP contract between the UI and the route handlers. Client-safe types only.
 * Every route returns JSON; errors are `ApiError` with an HTTP status >= 400.
 * No route may run longer than ~10 s: long work is started, then polled.
 *
 * Access: routes marked [gated] need the access cookie set by POST /api/access.
 * Everything else (sample products, Exact mode, pack from a saved hero) is open
 * but rate-capped per session cookie.
 */
import type {
  CutoutRecord,
  KitAsset,
  ProductRecord,
  ProductUnderstanding,
  QaResult,
  Scene,
  SceneDNA,
  Sku,
} from "./types";
import type { BriefKit, BuiltUrl, CostSummary, RetouchFix, SceneTier, SceneView } from "./types";
import type { FestivalSlug } from "./festivals";

export interface ApiError {
  error: string; // human-readable, safe to show
  code:
    | "bad_request"
    | "not_found"
    | "pending" // try again shortly (Cloudinary 423 still processing, or a rate-limit wait ≤ 15 s on a polled route); 202 + retryAfterMs
    | "locked" // access code required
    | "cap_reached" // per-session generation cap hit
    | "quota_low" // pool below threshold, main's transformation credits at the floor, or Cloudinary's hourly Admin API limit hit (retryAfterMs says when) → UI switches to showcase
    | "upstream"; // Cloudinary error
  retryAfterMs?: number;
}

// POST /api/access  { code }  → sets httpOnly signed cookie `s2s_access`
export interface AccessRequest { code: string }
export interface AccessResponse { ok: true; generationsLeft: number }

// POST /api/sign-upload   (next-cloudinary CldUploadWidget contract, also used by /capture)
// Only signs an allowlist: timestamp, source, upload_preset (must be "s2s_ingest"),
// public_id (must match ^snap2shelf/products/[a-z0-9]{8}/raw$), tags, context.
export interface SignUploadRequest { paramsToSign: Record<string, string | number> }
export interface SignUploadResponse { signature: string }

// POST /api/products/:sku/analyze   → captioning + quality + AI Vision product JSON; writes context on raw
export interface AnalyzeResponse {
  sku: Sku;
  caption: string;
  focus: number | null;
  understanding: ProductUnderstanding;
  fixes: { applied: string[]; retouchedPublicId?: string }; // Q4 auto-retouch (SHOULD); [] for now
  tokens: number;
}

// POST /api/products/:sku/cutout   → e_background_removal once, trimmed, saved as its own asset
// 202 + ApiError{code:"pending"} while Cloudinary is still deriving; client retries after retryAfterMs.
export interface CutoutResponse { sku: Sku; cutout: CutoutRecord; ms: number }

// GET /api/scenes?view=eye-level&theme=diwali  → scene library from the client-side list (cached 60 s)
export interface ScenesResponse { scenes: Scene[] }

// POST /api/generate  [gated]  → start an Image Generation job on the key pool
export interface GenerateRequest {
  sku: Sku;
  kind: "creative"; // image_to_image with the cutout as reference [1]
  model: string; // e.g. "nano-banana-2-edit" | "flux-2-flash-edit"
  seed: number;
  prompt?: string; // optional scene description; server wraps it with fidelity instructions
}
export interface GenerateResponse { job: string } // opaque signed token

// GET /api/jobs/:job  → poll every 2 s
export interface JobResponse {
  status: "pending" | "processing" | "completed" | "failed";
  asset?: KitAsset; // set when completed: copied into main + fidelity QA done
  modelId?: string;
  credits?: number;
  latencyMs?: number;
  request?: unknown; // the generate JSON body (for X-ray)
  error?: string;
}

// POST /api/qa  → Exact-mode "is it pasted?" check on a composite URL, or re-check an asset
export interface QaRequest { sku: Sku; url: string; kind: "exact" | "creative" }
export interface QaResponse { qa: QaResult; tokens: number }

// POST /api/pack  → save hero (upload by composite URL) and start materialising channel assets
export interface PackRequest {
  sku: Sku;
  heroUrl: string; // composite URL (Exact) or creative asset URL; must be on our cloud
  sceneSlug: string; // used for the hero public_id
  offer?: { hindi?: string; english?: string };
  recolor?: string[]; // hex swatches without '#', max 4
  textZone?: SceneDNA["text_zone"]; // (additive) where the offer text goes; from the scene's DNA
  productBox?: { pw: number; ph: number; px: number; py: number; baseY: number }; // (additive) product box on the 1080x1350 plate, from geometry(); keeps offer text off the product and centres the WhatsApp crop
}
// heroPublicId is snap2shelf/products/<sku>/hero-<sceneSlug>-<hash8 of heroUrl>.
// failed (additive): formats Cloudinary refused to render; they are not retried.
export interface PackResponse { sku: Sku; heroPublicId: string; assets: KitAsset[]; pending: string[]; failed?: string[] }

// GET /api/pack/:sku  → poll until pending is empty; zipUrl is a signed download_zip_url
export interface PackStatusResponse { assets: KitAsset[]; pending: string[]; zipUrl?: string; failed?: string[]; heroPublicId?: string }

// GET /api/capture/:sku  (additive) → has the phone's upload of snap2shelf/products/<sku>/raw landed?
// Cheapest path is client-side: lib/capture.ts waitForCapture() HEADs the delivery URL with a
// version buster (no server, no Admin API). This route does the same check server-side and,
// once ready, returns the ProductRecord (one Admin API lookup).
export interface CaptureResponse { ready: boolean; product?: ProductRecord }

// GET /api/usage  → totals only (the key pool is disclosed but accounts are never listed)
export interface UsageResponse {
  generation: { remaining: number; limit: number; usable: number };
  vision: { remaining: number; limit: number; usable: number };
  liveGeneration: boolean; // false → UI shows showcase + explains why
  session: { unlocked: boolean; generationsLeft: number };
  // (additive) false → main's transformation credits reached the floor (LIVE_TX_MAX_USED, default 21 of 25):
  // routes that create new derivatives (analyze, retouch, cutout, pack, scene / creative generation)
  // answer ApiError {code:"quota_low"}; show the prebuilt showcase instead of starting a live kit.
  livePipeline?: boolean;
  // (additive) main's plan credits (1 credit ≈ 1,000 transformations or 1 GB), totals only; null until known.
  // floorCredits = LIVE_TX_MAX_USED: livePipeline turns false once usedCredits reaches it.
  transformations?: { usedCredits: number | null; limitCredits: number | null; floorCredits?: number };
  // (additive) true → Cloudinary's Admin API is rate limited right now and these numbers are from an earlier refresh.
  stale?: boolean;
}

// ================================================================ pipeline v2 (additive)
// Suggested studio order: capture → analyze → RETOUCH → cutout → BRIEF → scenes (match / generate)
// → stage + QA → pack → COST meter. Every route answers in < 10 s; long work is start + poll.

// POST /api/products/:sku/retouch  → Q4 auto-retouch; call after analyze and BEFORE cutout.
// 200 RetouchResponse once done (status "none" when the photo needs nothing: the cutout uses the raw);
// 202 RetouchPendingResponse (an ApiError with code "pending" + the plan) while Cloudinary derives:
// poll again after retryAfterMs. Afterwards AnalyzeResponse.fixes reports the same fixes.
export interface RetouchResponse {
  sku: Sku;
  status: "done" | "none";
  fixes: { applied: RetouchFix[]; retouchedPublicId?: string }; // same shape as AnalyzeResponse.fixes
  detected: string[]; // AI Vision tags + measured signals, e.g. ["clutter-in-frame", "dim", "small"]
  notes: string[]; // plain-language decisions, e.g. "Brightened a dim photo with auto-improve."
  transformation?: string; // the retouch chain (X-ray)
  xray?: BuiltUrl;
  beforeUrl?: string; // raw, c_limit 1080x1350, f_auto/q_auto (before/after slider)
  url?: string; // retouched, same sizing
  tx: number; // documented transformation estimate of the chain
  tokens: number; // AI Vision tokens this call spent (0 once planned)
  ms: number;
}
export interface RetouchPendingResponse extends ApiError {
  planned: RetouchFix[];
  detected: string[];
  notes: string[];
  tokens: number;
}

// POST /api/brief  → one-line brief → kit settings (AI Vision General on the product photo + rules).
// Explicit words in the brief win (channels, %, "Hindi"), then the festival preset (lib/festivals.ts),
// then AI Vision, then the product's own suggested theme. The last 3 briefs per product are cached (tokens: 0).
export interface BriefRequest {
  sku: Sku;
  brief: string; // ≤ 300 chars, e.g. "Diwali sale ad, 20% off, Hindi, for WhatsApp + Instagram"
  festival?: FestivalSlug; // preset chip; overrides a festival named in the text
}
export type BriefSource = "brief" | "festival" | "ai" | "product" | "default";
export interface BriefResponse {
  sku: Sku;
  kit: BriefKit; // theme → staging / scenes; offer + swatches → PackRequest.offer / .recolor
  festival?: FestivalSlug;
  scenePrompt?: string; // empty-backdrop description for "Generate a new scene" (POST /api/scenes/generate)
  sources: Record<keyof BriefKit, BriefSource>; // where each field came from (UI can badge "AI")
  tokens: number;
  cached: boolean;
}

// GET /api/scenes/match?theme=diwali&q=brass+diyas&view=eye-level&limit=6  → library ranked by
// theme, keywords (title/prompt), festival and warmth. Public and cacheable (no session).
export interface SceneMatch { scene: Scene; score: number; reasons: string[] }
export interface SceneMatchResponse { matches: SceneMatch[] }

// POST /api/scenes/generate  → C1 on-demand scene with C2 reuse.
// Reuse first: the prompt-hash public_id already in the library → {reused:true, credits:0} at once
// (any session). Otherwise [gated]: access cookie + session cap + pool quota floor, like /api/generate;
// starts a pinned-model job (draft flux-2-flash 1 credit, final gpt-image-2.5-flare 4-5) → poll
// GET /api/scene-jobs/:job. With `sku`, credits spent / saved are recorded for that product's cost meter.
export interface SceneGenerateRequest {
  theme?: string; // SCENE_THEMES slug; alone = that theme's library recipe
  prompt?: string; // ≤ 300 chars empty-backdrop description (e.g. BriefResponse.scenePrompt)
  tier: SceneTier;
  view?: SceneView; // default: the theme's view, else eye-level
  sku?: Sku;
}
export type SceneGenerateResponse =
  | { reused: true; scene: Scene; credits: 0; creditsSaved: number }
  | { reused: false; job: string; tier: SceneTier; modelId: string; estimatedCredits: number };

// GET /api/scene-jobs/:job  → poll every 2 s (await each response). When completed the plate is a
// canonical 1080x1350 library scene with Scene DNA; scene QA rejects plates with products/text/people.
export interface SceneJobResponse {
  status: "pending" | "processing" | "completed" | "failed";
  scene?: Scene; // completed
  credits?: number;
  latencyMs?: number;
  qa?: QaResult; // scene QA verdict (rejected → status "failed")
  request?: unknown; // generate JSON for X-ray
  error?: string;
}

// GET /api/cost/:sku?scene=<scene publicId>  → cost meter for one product's kit.
// `scene` (optional) = the library scene the kit is staged on; its credits count as saved by reuse.
export interface CostResponse {
  sku: Sku;
  cost: CostSummary; // seconds = recorded server time of the pipeline steps
  breakdown: {
    generation: { label: string; credits: number }[];
    tokens: { label: string; tokens: number }[];
    transformations: { label: string; tx: number }[];
    steps: { label: string; ms: number }[];
  };
  delivered: { url: string; format: string; bytes: number; from: "hero" | "raw" };
  wallClockSeconds: number | null; // raw upload → newest hero/pack asset (created_at), null without a hero
  estimated: true; // transformation counts are estimates from the documented per-effect counts
}
