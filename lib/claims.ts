/**
 * One source of truth for every number, name and disclosure the site, the
 * director's cut and the README show. Client-safe. If a number changes, change
 * it here (and re-measure) — never inline a figure in copy.
 */

/** Live production run, 30 Sep 2026: file selected → ZIP link live (06_steel_bottle.png, desktop, Upload Widget). */
export const MEASURED_PHOTO_TO_ZIP_S = 36;
/**
 * Copy form of the headline speed claim. Live photo → ZIP runs measured 36–48 s
 * (30 Sep: 36 s production, 40.9 s / 47.5 s / 48 s on other runs), so the
 * headline promises what every run met; the caption gives the best measured run.
 */
export const PHOTO_TO_KIT_COPY = "under a minute";
export const PHOTO_TO_KIT_MEASURED_COPY = `${MEASURED_PHOTO_TO_ZIP_S} s photo → ZIP, measured on the live site`;

/**
 * The one duration story for a saved sample's receipt. Its "Cloudinary
 * processing" figure is that sample's own steps after the upload (seed run,
 * data/showcase.json timings); the headline number stays the live
 * end-to-end run. `qaChecks` is the number of QA attempts the run recorded.
 */
export function sampleTimeNote(run: { seconds: number; qaChecks: number }): string {
  const live = `${MEASURED_PHOTO_TO_ZIP_S} s end-to-end on the live site (photo → ZIP)`;
  const s = `${Math.round(run.seconds)} s`;
  const rejected = run.qaChecks - 1;
  if (rejected > 0) {
    return `${live}. This sample's steps took ${s} because QA rejected the placement ${rejected === 1 ? "once" : rejected === 2 ? "twice" : `${rejected} times`} before approving it (${run.qaChecks} checks).`;
  }
  return `${live}. This sample's steps after the upload took ${s}, with one QA check.`;
}

/**
 * File weight of a kit hero, as a browser receives it: the stored 1080 × 1350
 * hero at f_auto,q_auto (HEAD with Chrome's image Accept header, 30 Sep 2026).
 * The account's f_auto answers WebP for most heroes and JPEG for the kurta.
 * `original` is the sample photo as uploaded.
 */
export const HERO_WEIGHT_SIZE = { width: 1080, height: 1350 } as const;
export const MEASURED_HERO_WEIGHT: Record<string, { original: number; delivered: number; format: "webp" | "jpeg" }> = {
  shmessy1: { original: 2249535, delivered: 41672, format: "webp" },
  shbottle: { original: 1783788, delivered: 105598, format: "webp" },
  shsneakr: { original: 1945200, delivered: 104308, format: "webp" },
  shtrail1: { original: 1814024, delivered: 117238, format: "webp" },
  shkurta1: { original: 2906917, delivered: 218479, format: "jpeg" },
  sneaker1: { original: 2028411, delivered: 104308, format: "webp" },
};

/** The measurement conditions, said next to any hero weight ("the 1080 × 1350 px hero, WebP via f_auto,q_auto"). */
export function heroWeightConditions(format?: string): string {
  const f = (format ?? "").replace(/^image\//, "").toLowerCase();
  const name = f === "jpg" || f === "jpeg" ? "JPEG" : f === "webp" ? "WebP" : f === "avif" ? "AVIF" : f ? f.toUpperCase() : "";
  return `the ${HERO_WEIGHT_SIZE.width} × ${HERO_WEIGHT_SIZE.height} px hero${name ? `, ${name}` : ""} via f_auto,q_auto`;
}

/** Brand line, in one punctuation everywhere. */
export const TAGLINE = "One photo. A whole shelf.";
export const STAGE_LINE = "AI builds the stage — your product stays real.";

/** Mock social handle inside the preview frames (feed, story, reel, banner). */
export const DEMO_HANDLE = "demo.studio";

/** A basic studio shoot for ONE product in India — an estimate, always labelled as one. */
export const PHOTOSHOOT_INR_ESTIMATE = 2500;
export const PHOTOSHOOT_NOTE = "Estimate: a basic studio shoot for one product";

/** Image Generation credits by tier (measured, SPIKES.md; models are pinned). */
export const CREDITS = {
  draftScene: 1, // flux-2-flash
  finalScene: "4–5", // gpt-image-2.5-flare
  faithfulCreative: 9, // nano-banana-2-edit
  fastCreative: 1, // flux-2-flash-edit
} as const;

/** Every Exact kit reuses a library scene: it spends 0 generation credits and "saves" what that scene cost. */
export const CREDITS_SAVED_COPY = "0 new generation credits — the scene is reused from the library";

/** Canonical product names for the sample/showcase kits (India-first naming). */
export const PRODUCT_NAMES: Record<string, string> = {
  sneaker1: "Casual sneaker",
  shsneakr: "Casual sneaker",
  shbottle: "Steel water bottle",
  shmessy1: "Steel water bottle", // the cluttered-counter photo of the same bottle; the picker tells them apart by the photo's blurb
  shtrail1: "Trail mix pouch",
  shkurta1: "Chikankari kurta",
  // the same steel bottle as it stands on the demo shelf (/shelf/demo-studio), where AI Vision read "Stainless steel water bottle"
  "9uo8w8pc": "Steel water bottle",
  zi86lf6a: "Casual sneaker", // AI reading of this photo: white mesh with grey suede panels
};

/**
 * The sample INPUT photos are AI-generated test images (photos/README_QUALITY_NOTES.txt).
 * Say so wherever a sample's "before" photo is shown. Remove only when real photos replace them.
 */
export const SAMPLE_PHOTO_DISCLOSURE = "Sample input photo (AI-generated test image). Upload your own to see your product.";
export const SAMPLE_PHOTO_LABEL = "Sample photo";

/** The product pixels are never redrawn in Exact mode — true for any input photo. */
export const FIDELITY_CLAIM = "The product's pixels are never redrawn: AI builds only the stage.";

/** Public storefront built from the sample kits. */
export const DEMO_SHELF = { slug: "demo-studio", path: "/shelf/demo-studio", title: "Demo Studio" } as const;

/** The sample every "Try a sample" entry point opens: it has a ZIP and shows the QA gate catching and fixing a bad placement. */
export const PRIMARY_SAMPLE_SKU = "shmessy1";
/**
 * The finished kit every "See a finished kit" / "Sample kit" link opens: the same
 * cluttered-kitchen steel bottle the landing features end to end, whose receipt
 * tells the QA-rejected-twice story. shbottle stays reachable at /kit/shbottle.
 */
export const SHOWCASE_KIT_SKU = "shmessy1";

/**
 * Kit links that permanently point at another kit. sneaker1 is the landing's
 * hand-built sneaker (no stored ZIP); shsneakr is the same sample photo on the
 * same scene with a full kit and ZIP.
 */
export const KIT_REDIRECTS: Record<string, string> = { sneaker1: "shsneakr" };
