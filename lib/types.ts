/**
 * Shared domain contracts for Snap2Shelf. Client-safe (no secrets, no server imports).
 *
 * Storage model: Cloudinary is the whole backend. Everything below maps onto
 * public_ids, tags and context in the MAIN product environment:
 *
 *   snap2shelf/products/<sku>/raw            original upload          tags: s2s, s2s-raw, s2s-sku-<sku>
 *   snap2shelf/products/<sku>/cutout         trimmed transparent PNG  tags: s2s, s2s-cutout, s2s-sku-<sku>
 *   snap2shelf/products/<sku>/hero-<slug>    approved hero (saved)    tags: s2s, s2s-hero, s2s-sku-<sku>
 *   snap2shelf/products/<sku>/creative-<m>-<seed>  image_to_image    tags: s2s, s2s-creative, s2s-sku-<sku>
 *   snap2shelf/products/<sku>/pack/<format>  materialised channel    tags: s2s, s2s-pack, s2s-pack-<sku>
 *   snap2shelf/scenes/<theme>/<slug>         1080x1350 scene plate   tags: s2s, s2s-scene, s2s-theme-<theme>, s2s-view-<view>
 *
 * Product facts and Scene DNA live in each asset's `context` (flat string
 * key/values), so the client can read them from the client-side list
 * `https://res.cloudinary.com/<cloud>/image/list/<tag>.json` without any API.
 */

/** 8-char lower-case id, e.g. "k3v9x2ab". Regex: /^[a-z0-9]{8}$/ */
export type Sku = string;

export const SKU_RE = /^[a-z0-9]{8}$/;
export const PRODUCT_ROOT = "snap2shelf/products";
export const SCENE_ROOT = "snap2shelf/scenes";
export const productId = (sku: Sku, leaf: string) => `${PRODUCT_ROOT}/${sku}/${leaf}`;

/** Canonical plate size every scene is normalised to, and every hero is rendered at. */
export const PLATE = { width: 1080, height: 1350 } as const;

/** How the product is photographed / should be staged. Drives which scenes fit. */
export type Placement = "standing" | "flatlay" | "hanging";

/** Scene camera view. Standing products need eye-level scenes, flat-lays need top-down ones. */
export type SceneView = "eye-level" | "top-down";

export const VIEW_FOR_PLACEMENT: Record<Placement, SceneView> = {
  standing: "eye-level",
  hanging: "eye-level",
  flatlay: "top-down",
};

/** AI Vision General reading of the product (validated with zod server-side). */
export interface ProductUnderstanding {
  name: string; // "Stainless steel water bottle"
  category: string; // "drinkware"
  primary_color: string; // "silver"
  material: string; // "brushed stainless steel"
  recolorable_part: string; // "bottle body" — prompt target for e_gen_recolor
  placement: Placement;
  suggested_themes: string[]; // theme slugs from SCENE_THEMES
}

export interface ProductRecord {
  sku: Sku;
  rawPublicId: string;
  rawWidth: number;
  rawHeight: number;
  rawBytes: number;
  caption?: string; // AI captioning → alt text
  focus?: number; // quality_analysis.focus 0..1
  understanding?: ProductUnderstanding;
  cutout?: CutoutRecord;
}

export interface CutoutRecord {
  publicId: string; // snap2shelf/products/<sku>/cutout
  width: number; // trimmed size = product bounding box
  height: number;
  version?: number;
}

/**
 * Scene DNA: AI Vision's one-off reading of a scene plate, measured on the
 * canonical 1080x1350 plate. Stored in the scene's context as dna_* keys.
 */
export interface SceneDNA {
  anchor_x: number; // 0..1 horizontal centre of the clear surface
  anchor_y: number; // 0..1 from top: where the product's base touches the surface
  surface_width: number; // 0..1
  light_azimuth: number; // 0..360, direction light comes FROM, clockwise from top
  light_elevation: number; // 0..90
  temperature: "warm" | "neutral" | "cool";
  glossy: boolean; // reflective surface → add reflection layer
  text_zone: "top" | "bottom" | "left" | "right" | "top_left" | "top_right" | "none";
}

export interface Scene {
  publicId: string; // snap2shelf/scenes/<theme>/<slug>
  theme: string; // slug from SCENE_THEMES
  view: SceneView;
  title: string; // human label: "Diwali teak table"
  prompt: string;
  modelId: string;
  credits: number; // generation credits it cost (0 when reused)
  dna: SceneDNA;
}

export const SCENE_THEMES = [
  { slug: "diwali", label: "Diwali glow", view: "eye-level" },
  { slug: "marble", label: "Marble studio", view: "eye-level" },
  { slug: "pastel", label: "Pastel minimal", view: "eye-level" },
  { slug: "jute", label: "Rustic jute", view: "eye-level" },
  { slug: "kitchen", label: "Kitchen counter", view: "eye-level" },
  { slug: "cafe", label: "Outdoor café", view: "eye-level" },
  { slug: "flatlay-festive", label: "Festive flat-lay", view: "top-down" },
  { slug: "flatlay-linen", label: "Linen flat-lay", view: "top-down" },
] as const satisfies readonly { slug: string; label: string; view: SceneView }[];

/** User-adjustable composite controls (sliders). Defaults come from Scene DNA. */
export interface CompositeControls {
  scale: number; // product width as a fraction of plate width, 0.2..0.8 (default by placement)
  offsetX: number; // px nudge on the 1080 plate, -300..300
  offsetY: number; // px nudge, -300..300
  shadow: boolean; // cast drop shadow (e_dropshadow, direction from DNA)
  contact: boolean; // contact shadow (squashed silhouette)
  reflection: "auto" | "on" | "off"; // auto = DNA.glossy
  harmonise: boolean; // tint/brightness toward scene temperature (SHOULD)
}

export type GenerationMode = "exact" | "creative" | "blend";

export type ChannelFormat =
  | "hero" // 4:5 1080x1350 master
  | "marketplace" // 2000x2000 pure white, product ~85%
  | "feed" // 4:5 1080x1350 (hero, f_auto)
  | "story" // 9:16 1080x1920 via b_gen_fill
  | "banner" // 16:9 1920x1080 via b_gen_fill
  | "whatsapp" // 600x600 square catalog tile
  | "recolor" // colour variant via e_gen_recolor (one per swatch)
  | "offer"; // festive offer overlay (l_text, Devanagari + Latin)

/** Which generic device/placement frame the UI shows an asset in. No real brand UI. */
export type PreviewFrame = "feed-post" | "story" | "listing-card" | "catalog-tile" | "web-banner" | "none";

export type QaStatus = "pending" | "approved" | "rejected";

export interface QaResult {
  status: QaStatus;
  matched: string[]; // AI Vision tag names that matched
  reasons: string[]; // human-readable, e.g. "Logo changed on the tongue"
  fidelity?: number; // 0..100 (creative only; informative, not the decision)
  checkedAt?: string;
}

/** One colour-coded piece of a transformation URL, for the X-ray panel. */
export interface XraySegment {
  text: string; // exact URL component, e.g. "e_dropshadow:azimuth_315;elevation_50;spread_45"
  kind: "crop" | "layer" | "placement" | "shadow" | "reflection" | "effect" | "gen-ai" | "text" | "format" | "asset" | "video";
  label: string; // plain-language explanation shown on hover
}

export interface BuiltUrl {
  url: string;
  transformation: string; // everything between /upload/ and the public_id
  segments: XraySegment[];
}

export interface KitAsset {
  id: string; // stable within a kit, e.g. "story"
  format: ChannelFormat;
  label: string; // "Story 9:16"
  url: string; // delivery URL (f_auto/q_auto where appropriate)
  width: number;
  height: number;
  frame: PreviewFrame;
  alt: string; // from captioning
  xray: BuiltUrl | { json: unknown }; // transformation URL, or the generate/analyze JSON
  publicId?: string; // set once materialised as its own asset
  qa?: QaResult;
}

export interface CostSummary {
  generationCredits: number; // image generation credits spent on this kit
  creditsSavedByReuse: number; // credits a fresh scene would have cost
  aiVisionTokens: number;
  transformationsEstimate: number; // tx units, from the documented per-effect counts
  bytesOriginal: number; // raw upload bytes
  bytesDelivered: number; // hero delivered with f_auto/q_auto
  seconds: number; // wall-clock photo → approved kit
}

export interface Kit {
  sku: Sku;
  product: ProductRecord;
  mode: GenerationMode;
  scene?: Scene;
  controls?: CompositeControls;
  hero: KitAsset;
  assets: KitAsset[];
  reel?: { url: string; xray: BuiltUrl; seconds: number };
  zipUrl?: string; // signed, ~1 h lifetime
  cost: CostSummary;
  createdAt: string;
}

/** Pipeline steps in the order the UI lights them up. */
export const PIPELINE_STEPS = [
  { id: "fix", label: "Fix" },
  { id: "cutout", label: "Cut out" },
  { id: "stage", label: "Stage" },
  { id: "light", label: "Light-match" },
  { id: "qa", label: "QA" },
  { id: "pack", label: "Pack" },
] as const;
export type PipelineStepId = (typeof PIPELINE_STEPS)[number]["id"];
