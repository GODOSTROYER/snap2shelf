/**
 * Showcase mode data: fully prebuilt kits for the SAMPLE products (synthetic
 * test photos, never real seller photos), so the landing page shows a finished
 * kit instantly with zero quota use. Written by scripts/seed-showcase.mts to
 * data/showcase.json; every URL in it points at an asset that is already
 * stored on the main cloud (only plain f_auto/q_auto delivery on top), so
 * viewing the showcase never re-runs an AI transformation.
 *
 * Client-safe: no secrets, no server imports. The JSON is ~100-200 KB, so
 * prefer reading it in Server Components and passing down only what a view needs.
 */
import raw from "../data/showcase.json";
import type { CompositeControls, Kit, QaResult, Sku } from "./types";

/** Wall-clock per pipeline stage in ms, measured by the seed script on a live run. */
export interface ShowcaseTimings {
  upload: number; // photo → stored raw (Node SDK upload)
  analyze: number; // captioning + AI Vision product reading + quality
  cutout: number; // background removal + trim, saved as its own asset
  stage: number; // first render of the approved composite (Cloudinary CDN)
  qa: number; // AI Vision exact-QA calls, all attempts
  pack: number; // hero saved + every channel format materialised
  zip: number; // stored ZIP created
  reel?: number; // first render of the reel video (when built)
  /** photo → QA-approved hero */
  toApprovedHero: number;
  /** photo → approved kit (pack materialised, ZIP ready). Equals the sum of the stages above except reel. */
  total: number;
}

/** One staging attempt: composite → exact QA. Rejected attempts are kept so the UI can show the gate working. */
export interface ShowcaseQaAttempt {
  scenePublicId: string;
  sceneTitle: string;
  controls: CompositeControls;
  url: string; // composite recipe URL (f_auto,q_auto)
  qa: QaResult;
  tokens: number;
  note: string; // why this attempt was made, e.g. "retry: cast shadow off after compositing-artifact"
}

export interface ShowcaseKit extends Kit {
  title: string; // "Steel water bottle"
  sample: true; // always a sample product (synthetic test photo)
  photo: { kind: "decent" | "messy"; file: string };
  timings: ShowcaseTimings;
  attempts: ShowcaseQaAttempt[];
  /** Art-direction corrections applied on top of AI Vision's reading (kept honest and visible). */
  overrides: string[];
  /** Pack formats Cloudinary refused to render (not retried). */
  packFailed: string[];
}

export interface ShowcaseCreative {
  sku: Sku;
  model: string; // pinned model id, e.g. "nano-banana-2-edit"
  seed: number;
  prompt: string; // the scene description the seller typed (the server wraps it with fidelity rules)
  publicId: string;
  url: string; // 1080x1350 f_auto/q_auto delivery of the stored result
  qa: QaResult; // fidelity QA verdict (reference-vs-candidate sheet)
  sheetUrl: string; // the exact sheet AI Vision judged: reference cutout left, candidate right
  credits: number; // image-generation credits reported by Cloudinary
  latencyMs: number; // start → task completed
  qaTokens: number;
  request: unknown; // the generate JSON (for the X-ray panel)
}

export interface ShowcaseBeforeAfter {
  sku: Sku;
  rawUrl: string; // the phone photo, 1080x1350, f_auto/q_auto
  heroUrl: string; // the approved hero, f_auto/q_auto
  alt: string;
  /**
   * Transformation (before any resize) that crops the raw so its product lands
   * exactly where the hero places it, for a wipe slider. Append c_scale,w_<n>.
   */
  alignRaw?: string;
  rawAlignedUrl?: string; // alignRaw applied, 1080x1350
}

export interface ShowcaseData {
  generatedAt: string;
  note: string;
  kits: ShowcaseKit[];
  creative: ShowcaseCreative[];
  beforeAfter: ShowcaseBeforeAfter[];
  totals: {
    generationCredits: number; // creative takes only; Exact kits spend none
    aiVisionTokens: number;
    transformationsEstimate: number;
    creditsSavedByReuse: number;
  };
}

export const SHOWCASE = raw as unknown as ShowcaseData;

export const getShowcaseKit = (sku: string | null | undefined) => SHOWCASE.kits.find((k) => k.sku === sku);
export const showcaseCreativeFor = (sku: string) => SHOWCASE.creative.filter((c) => c.sku === sku);
/** A real, captured QA rejection (Definition of Done): the draft model redesigning the product. */
export const showcaseRejection = () => SHOWCASE.creative.find((c) => c.qa.status === "rejected");
