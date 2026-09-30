/**
 * One source of truth for every number, name and disclosure the site, the
 * director's cut and the README show. Client-safe. If a number changes, change
 * it here (and re-measure) — never inline a figure in copy.
 */

/** Live production run, 30 Sep 2026: file selected → ZIP link live (06_steel_bottle.png, desktop, Upload Widget). */
export const MEASURED_PHOTO_TO_ZIP_S = 36;
/** Copy form of the headline speed claim. */
export const PHOTO_TO_KIT_COPY = "about 40 seconds";
export const PHOTO_TO_KIT_MEASURED_COPY = `${MEASURED_PHOTO_TO_ZIP_S} s photo → ZIP, measured on the live site`;

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
  sneaker1: "Grey suede sneaker",
  shsneakr: "Grey suede sneaker",
  shbottle: "Steel water bottle",
  shmessy1: "Steel bottle, cluttered-counter photo",
  shtrail1: "Trail mix pouch",
  shkurta1: "Chikankari kurta",
};

/**
 * The sample INPUT photos are AI-generated test images (photos/README_QUALITY_NOTES.txt).
 * Say so wherever a sample's "before" photo is shown. Remove only when real photos replace them.
 */
export const SAMPLE_PHOTO_DISCLOSURE = "Sample input photo (AI-generated test image). Upload your own to see your product.";
export const SAMPLE_PHOTO_LABEL = "Sample photo";

/** The product pixels are never redrawn in Exact mode — true for any input photo. */
export const FIDELITY_CLAIM = "Your product's pixels are never redrawn: AI builds only the stage.";

/** Public storefront built from the sample kits. */
export const DEMO_SHELF = { slug: "demo-studio", path: "/shelf/demo-studio", title: "Demo Studio" } as const;

/** The sample every "Try a sample" entry point opens: it has a ZIP and shows the QA gate catching and fixing a bad placement. */
export const PRIMARY_SAMPLE_SKU = "shmessy1";
/** Best-looking finished kit for "See a finished kit" links. */
export const SHOWCASE_KIT_SKU = "shbottle";
