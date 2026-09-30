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

export interface ApiError {
  error: string; // human-readable, safe to show
  code:
    | "bad_request"
    | "not_found"
    | "pending" // try again shortly (e.g. Cloudinary 423 still processing)
    | "locked" // access code required
    | "cap_reached" // per-session generation cap hit
    | "quota_low" // pool below threshold → UI switches to showcase
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
}
