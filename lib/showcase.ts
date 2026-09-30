/**
 * Showcase data: finished kits built from REAL assets already on the demo cloud.
 * The landing page, /kit/<sku>, the sample flow in /studio and the API mock all
 * read from here, so replacing the showcase is a one-file change.
 *
 * Numbers marked "measured" come from SPIKES.md / live requests; "estimate"
 * values are illustrative until seeded kits replace this file.
 */
import { channelAssets } from "./transform/channels";
import { compositeUrl, defaultControls, deliveryBase, lqip } from "./transform/composite";
import { reelUrl } from "./client/reel";
import { recolorLabel, swatchName } from "./client/swatches";
import type { CompositeControls, Kit, KitAsset, ProductRecord, Scene, SceneDNA, Sku } from "./types";

export const SHOWCASE_CLOUD = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || "nyxyma1i";

export interface SampleProduct {
  sku: Sku;
  title: string; // shown on the sample picker
  product: ProductRecord;
  scene: Scene;
  controls: CompositeControls;
  heroPublicId: string; // the composite, saved once as its own asset
  offer: { hindi: string; english: string };
  swatches: string[];
  /** Crop that puts the raw photo's product exactly where the hero places it (for the before/after slider). */
  alignRaw?: string;
}

// ─── Sample 1: the sneaker ────────────────────────────────────────────────────

const teakDna: SceneDNA = {
  anchor_x: 0.5,
  anchor_y: 0.65,
  surface_width: 0.9,
  light_azimuth: 315,
  light_elevation: 45,
  temperature: "warm",
  glossy: false, // matte teak
  text_zone: "top",
};

const teakScene: Scene = {
  publicId: "snap2shelf/spikes/scenes/diwali_teak_42",
  theme: "diwali",
  view: "eye-level",
  title: "Diwali teak table",
  prompt:
    "Photorealistic product-photography background: an empty polished teak table in the foreground, brass diyas and marigold garlands softly out of focus behind, warm festive light. No products, no people, no text.",
  modelId: "gpt-image-2.5-flare",
  credits: 5, // quality tier, SPIKES.md §1
  dna: teakDna,
};

const sneaker: ProductRecord = {
  sku: "sneaker1",
  rawPublicId: "samples/shoe",
  rawWidth: 1000, // measured (fl_getinfo)
  rawHeight: 1140,
  rawBytes: 72888,
  caption: "A white and tan sneaker with pink accents floats in the foreground against a solid pink background.", // measured, SPIKES.md §9
  focus: 0.64,
  understanding: {
    name: "White and tan running sneaker",
    category: "footwear",
    primary_color: "white",
    material: "mesh and suede",
    recolorable_part: "laces",
    placement: "standing",
    suggested_themes: ["diwali", "marble", "cafe"],
  },
  cutout: { publicId: "snap2shelf/spikes/cutouts/samples_shoe_trim", width: 645, height: 477 },
};

export const SAMPLES: SampleProduct[] = [
  {
    sku: "sneaker1",
    title: "Running sneaker",
    product: sneaker,
    scene: teakScene,
    controls: defaultControls("standing", teakDna),
    heroPublicId: "snap2shelf/spikes/heroes/shoe_diwali",
    offer: { hindi: "दिवाली धमाका", english: "Flat 30% off till Sunday" },
    swatches: ["0f766e", "2563eb"],
    // measured: product box in the raw is ≈ (167, 293) 645×477; hero puts it at (292, 510) 497 wide
    alignRaw: "c_mpad,w_1500,h_2000,b_auto:border/c_crop,x_38,y_61,w_1402,h_1752",
  },
];

export const getSample = (sku: string | null | undefined) => SAMPLES.find((s) => s.sku === sku);
export const isSampleSku = (sku: string | null | undefined) => !!getSample(sku);

// ─── Creative takes (image_to_image, SPIKES.md §2 + §3b) ─────────────────────

const creativeRequest = (model: string, seed: number) => ({
  prompt:
    "Place this exact sneaker on a sandstone ledge in a sunlit Rajasthani courtyard. Keep every logo, colour, panel and proportion of the product unchanged.",
  model,
  seed,
  aspect_ratio: "3:4",
  reference_images: [{ source_type: "url", url: `${deliveryBase(SHOWCASE_CLOUD)}/${sneaker.cutout!.publicId}` }],
});

function creativeAsset(id: string, publicId: string, label: string, model: string, seed: number, qa: KitAsset["qa"]): KitAsset {
  return {
    id,
    format: "hero",
    label,
    url: `${deliveryBase(SHOWCASE_CLOUD)}/c_fill,w_1080,h_1350,g_auto/f_auto,q_auto/${publicId}`,
    width: 1080,
    height: 1350,
    frame: "feed-post",
    alt: "The same white and tan sneaker on a sandstone ledge in a sunlit courtyard",
    publicId,
    xray: { json: { endpoint: "POST /v2/generate/image_to_image", request: creativeRequest(model, seed) } },
    qa,
  };
}

export const CREATIVE_APPROVED = creativeAsset(
  "creative-faithful",
  "snap2shelf/spikes/i2i_main/nano-banana-2-edit",
  "Creative take",
  "nano-banana-2-edit",
  7,
  {
    status: "approved",
    matched: ["same-product"],
    reasons: ["Same colours, panels, tongue and proportions as your photo"],
    fidelity: 95,
  },
);

export const CREATIVE_REJECTED = creativeAsset(
  "creative-draft",
  "snap2shelf/spikes/i2i_main/flux-2-flash-edit",
  "Draft take",
  "flux-2-flash-edit",
  7,
  {
    status: "rejected",
    matched: ["product-redesigned", "extra-product", "garbled-text"],
    reasons: ["Added a logo badge on the side", "Tongue logo changed", "Ghost second shoe"],
    fidelity: 85,
  },
);

export const CREATIVE_MODELS = [
  {
    id: "nano-banana-2-edit",
    name: "Faithful",
    detail: "Keeps logos, colours and shape",
    credits: 9,
    seconds: 17,
  },
  {
    id: "flux-2-flash-edit",
    name: "Fast draft",
    detail: "Quicker and cheaper, may redesign details",
    credits: 1,
    seconds: 8,
  },
] as const;

// ─── Kit assembly ─────────────────────────────────────────────────────────────

export function heroAlt(p: ProductRecord, scene: Scene) {
  const name = p.understanding?.name ?? "Your product";
  return `${name}, staged on ${scene.title.toLowerCase()}`;
}

function sampleKit(s: SampleProduct): Kit {
  const p = s.product;
  const alt = heroAlt(p, s.scene);
  const built = compositeUrl({
    scenePublicId: s.scene.publicId,
    dna: s.scene.dna,
    cutout: p.cutout!,
    placement: p.understanding!.placement,
    controls: s.controls,
    cloud: SHOWCASE_CLOUD,
  });
  const hero: KitAsset = {
    id: "hero",
    format: "hero",
    label: "Hero 4:5",
    url: built.url,
    width: 1080,
    height: 1350,
    frame: "feed-post",
    alt,
    xray: built,
    publicId: s.heroPublicId,
    qa: { status: "approved", matched: ["product-visible"], reasons: ["Your real product pixels, untouched"] },
  };
  const pack = channelAssets({
    heroPublicId: s.heroPublicId,
    cutoutPublicId: p.cutout!.publicId,
    alt,
    recolorPart: p.understanding!.recolorable_part,
    swatches: s.swatches,
    offer: s.offer,
    textZone: s.scene.dna.text_zone,
    cloud: SHOWCASE_CLOUD,
  }).map((a) => (a.id.startsWith("recolor-") ? { ...a, label: recolorLabel(a.id), alt: `${alt}, recoloured ${swatchName(a.id.slice(8)).toLowerCase()}` } : a));

  return {
    sku: s.sku,
    product: p,
    mode: "exact",
    scene: s.scene,
    controls: s.controls,
    hero,
    assets: [...pack, CREATIVE_APPROVED],
    reel: reelUrl({
      heroPublicId: s.heroPublicId,
      extraShotPublicIds: [CREATIVE_APPROVED.publicId!],
      closeUp: { scenePublicId: s.scene.publicId, cutoutPublicId: p.cutout!.publicId, placement: "standing" },
      caption: s.offer.hindi,
      cloud: SHOWCASE_CLOUD,
    }),
    cost: {
      generationCredits: 0, // Exact mode: no generation at all
      creditsSavedByReuse: s.scene.credits,
      aiVisionTokens: 1690, // estimate: product reading ≈690 + QA ≈1000 (SPIKES.md §3)
      transformationsEstimate: 215, // estimate: 2 × b_gen_fill + 2 × e_gen_recolor at 50 each, plus plain crops
      bytesOriginal: 268847, // measured: saved hero master (the sample photo itself is already tiny)
      bytesDelivered: 87598, // measured: same hero with f_auto,q_auto (WebP)
      seconds: 24, // estimate until seeded kits land
    },
    createdAt: "2026-09-30T00:05:00+05:30",
  };
}

export const SHOWCASE_KITS: Kit[] = SAMPLES.map(sampleKit);
export const FEATURED_KIT = SHOWCASE_KITS[0];
export const getShowcaseKit = (sku: string) => SHOWCASE_KITS.find((k) => k.sku === sku);

// ─── Landing helpers ──────────────────────────────────────────────────────────

/** Raw phone photo, cropped to the hero's 4:5 so the slider halves line up. */
export function rawAt(p: ProductRecord, w: number) {
  const align = getSample(p.sku)?.alignRaw;
  const t = align ? `${align}/c_scale,w_${w}` : `c_fill,ar_4:5,g_auto,w_${w}`;
  return `${deliveryBase(SHOWCASE_CLOUD)}/${t}/f_auto,q_auto/${p.rawPublicId}`;
}

/** The live composite at a given width (same recipe as the studio). */
export function heroAt(kit: Kit, w: number) {
  const s = getSample(kit.sku);
  if (!s) return kit.hero.url;
  return compositeUrl({
    scenePublicId: s.scene.publicId,
    dna: s.scene.dna,
    cutout: s.product.cutout!,
    placement: s.product.understanding!.placement,
    controls: s.controls,
    width: w,
    cloud: SHOWCASE_CLOUD,
  }).url;
}

export const heroLqip = (kit: Kit) => lqip(kit.hero.publicId ?? kit.scene?.publicId ?? kit.product.rawPublicId, SHOWCASE_CLOUD);

export function ogImageUrl(kit: Kit) {
  return `${deliveryBase(SHOWCASE_CLOUD)}/c_fill,w_1200,h_630,g_auto/f_jpg,q_auto/${kit.hero.publicId ?? kit.product.rawPublicId}`;
}
