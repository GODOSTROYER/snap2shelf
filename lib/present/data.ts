/**
 * Data adapter for the director's cut (/present) and the video cards.
 *
 * Every chapter reads ONE object, `PRESENT` (type PresentData). It is built by
 * `fromKits(kits, extras)` from plain `Kit` records (lib/types.ts), so real
 * seeded kits drop in without touching a single chapter:
 *
 *   ── To switch to the seeded showcase: uncomment the `showcase` import below
 *      the other imports, and change the marked line at the end of this file to
 *
 *        export const PRESENT: PresentData = fromShowcase(showcase);
 *
 *      `showcase.json` may be `Kit[]` or `{ kits: Kit[] }`. The first Exact-mode
 *      kit with a scene and a cutout is featured (or pass `featuredSku`).
 *      Anything a kit can't provide (the QA evidence pair, the shop, the live
 *      shelf snapshot) comes from `EXTRAS` below.
 *
 * Every number, name and disclosure comes from lib/claims.ts (the measured
 * photo → ZIP time, the photoshoot estimate, product names, the sample-photo
 * disclosure). Never inline a figure in a chapter.
 *
 * Everything here is pure and deterministic: the same input always yields the
 * same Cloudinary URLs, so each derived image is billed once and then cached.
 * The sample kits reuse URLs that were already rendered and verified by the
 * transform workstream (scripts/dev/channel-check.mts, reel-check.mts,
 * og-check.mts), so this deck costs close to zero new transformations.
 */
import {
  CREDITS_SAVED_COPY,
  DEMO_SHELF,
  heroWeightConditions,
  MEASURED_HERO_WEIGHT,
  MEASURED_PHOTO_TO_ZIP_RANGE_S,
  PHOTO_TO_KIT_COPY,
  PHOTO_TO_KIT_MEASURED_COPY,
  PHOTOSHOOT_INR_ESTIMATE,
  PHOTOSHOOT_NOTE,
  PRODUCT_NAMES,
  SAMPLE_PHOTO_DISCLOSURE,
  SAMPLE_PHOTO_LABEL,
} from "@/lib/claims";
import { channelAssets, offerLayout } from "@/lib/transform/channels";
import { compositeUrl, defaultControls, deliveryBase, geometry, layerId, quantise } from "@/lib/transform/composite";
import { REEL_MOVES, reelUrl } from "@/lib/transform/reel";
import { describeTransformation } from "@/lib/transform/xray";
import {
  PLATE,
  type BuiltUrl,
  type CompositeControls,
  type Kit,
  type KitAsset,
  type PipelineStepId,
  type Placement,
  type ProductRecord,
  type QaResult,
  type Scene,
  type SceneDNA,
  type XraySegment,
} from "@/lib/types";
import showcase from "@/data/showcase.json"; // seeded kits (scripts/seed-showcase.mts)

// ─── Public shape ─────────────────────────────────────────────────────────────

export interface PresentImage {
  url: string;
  width: number;
  height: number;
  alt: string;
}

/** Fractions (0..1) of a parent box. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StageShot {
  scene: Scene;
  image: PresentImage;
  /** Where the product's base sits, as a fraction of the plate height (for alignment). */
  baseY: number;
  /** Credits this product paid for the scene here (0 = reused from the library). */
  credits: number;
}

export interface QaCard {
  model: string;
  tier: string; // "Faithful" / "Fast draft"
  credits: number;
  seconds: number;
  /** Reference (left) | candidate (right) sheet AI Vision judged, 1024×683. */
  sheet: PresentImage;
  result: QaResult;
  sameProduct: boolean;
  /** What AI Vision flagged, pinned on the sheet (fractions of the sheet). */
  marks: { x: number; y: number; r: number; label: string }[];
}

export interface PipelineStat {
  id: PipelineStepId;
  label: string;
  /**
   * Relative share of a run, used ONLY to pace the animation. Never shown as a
   * time: the one speed claim the deck states is the measured range, MEASURED_PHOTO_TO_ZIP_RANGE_S.
   */
  weight: number;
  detail: string;
}

/** One product on the live Demo Studio shelf, exactly as /shelf/demo-studio shows it. */
export interface ShelfProduct {
  sku: string;
  title: string;
  /** The short "colour · material" line under the name. */
  facts: string;
  /** The same crop and width the shelf page renders (a cache hit), plus its 2x. */
  image: PresentImage & { srcSet: string };
  /** The stored transparent cutout, native size (scaled DOWN in CSS, never up). */
  cutout: PresentImage;
}

export interface ReelClip extends PresentImage {
  publicId: string;
  /** Ken Burns move, as the reel URL spells it ("slow push in"). */
  move: string;
  seconds: number;
}

export interface PresentData {
  cloud: string;
  site: { url: string; host: string; repo: string; repoLabel: string };
  shop: { name: string; slug: string; url: string; host: string };
  product: {
    sku: string;
    /** Canonical kit name (lib/claims PRODUCT_NAMES). */
    name: string;
    /** How a seller would list it on a channel ("Steel water bottle"). */
    listingTitle: string;
    caption: string;
    raw: PresentImage & {
      bytes: number;
      format: string;
      /** "Sample photo" for the seeded kits (their input photos are AI-generated test images). */
      source: string;
      /** Shown under the photo whenever the input is a sample; null for a seller's own photo. */
      disclosure: string | null;
    };
    /** seconds: this kit's own recorded cutout time. */
    cutout: PresentImage & { box: Rect | null; seconds: number | null; chain: string };
  };
  scene: Scene & { image: PresentImage };
  /** Product box on the plate (fractions) + the text-safe card the offer uses. */
  landing: { box: Rect; textZone: Rect | null };
  hero: PresentImage & { built: BuiltUrl };
  stages: StageShot[];
  qa: { approved: QaCard; rejected: QaCard } | null;
  pack: KitAsset[];
  /** clips are read back from the reel URL itself, so the count can't drift from the video. */
  reel: { url: string; poster: string; seconds: number; clips: ReelClip[]; built: BuiltUrl } | null;
  xray: { hero: BuiltUrl; extras: { title: string; segment: XraySegment }[] };
  /**
   * The one speed claim (lib/claims), used by every chapter: the measured photo → ZIP range
   * ("36–58 s"), its headline form ("about a minute") and the full measured sentence.
   * Never a single run's time on its own.
   */
  pipeline: { steps: PipelineStat[]; range: readonly [number, number]; headline: string; claim: string; note: string };
  cost: {
    generationCredits: number;
    sceneTitle: string;
    sceneCredits: number; // what the reused scene cost ONCE, when the library was seeded
    creditsSavedByReuse: number; // the app's per-kit number (= that scene's cost)
    reuseNote: string;
    transformations: number; // tx estimate for the whole kit
    /**
     * Upload → delivered hero, the SAME figure the studio and kit receipts show (lib/claims
     * MEASURED_HERO_WEIGHT): the photo as uploaded vs the stored 1080 × 1350 hero at
     * f_auto,q_auto, and the conditions sentence that goes next to it.
     */
    weight: { original: number; delivered: number; format: string; conditions: string };
    photoshootInr: number;
    photoshootNote: string;
    inrPerCredit: number;
    inrNote: string;
  };
  /** The live Demo Studio storefront, snapshotted (the deck fetches nothing at runtime). */
  shelf: {
    title: string;
    tagline: string;
    products: ShelfProduct[];
    share: { image: PresentImage; title: string; description: string; message: string };
  };
}

// ─── Extras: facts a Kit record doesn't carry ────────────────────────────────

export interface PresentExtras {
  cloud: string;
  site: PresentData["site"];
  shop: { name: string; slug: string };
  /** Where the trimmed cutout sits inside the raw photo (px), keyed by cutout public id. */
  cutoutBoxInRaw: Record<string, { x: number; y: number }>;
  /** Library scenes to stage the featured cutout on when the kits don't already do it. */
  stageScenes: Scene[];
  /** The six steps, with animation weights. */
  pipeline: { steps: PipelineStat[] };
  /** Reference-vs-candidate evidence for the QA chapter when no kit carries a creative pair. */
  qaFallback: { approved: QaCard; rejected: QaCard } | null;
  /** Reel inputs when the featured kit has none. */
  reelFallback: { images: string[]; offer: { hindi?: string; english?: string } } | null;
  shelf: PresentData["shelf"];
  photoshootInr: number;
  photoshootNote: string;
  inrPerCredit: number;
  inrNote: string;
}

const CLOUD = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || "nyxyma1i";
const up = (t: string, id: string, cloud = CLOUD) => `${deliveryBase(cloud)}/${t}/${id}`;

// Scene DNA snapshot of the library plates used here (client-side list, tag
// s2s-scene, read 30 Sep 2026). DNA is AI Vision's one-off reading of each plate.
const scene = (publicId: string, title: string, theme: string, credits: number, modelId: string, dna: SceneDNA): Scene => ({
  publicId,
  title,
  theme,
  view: "eye-level",
  prompt: "",
  modelId,
  credits,
  dna,
});

export const LIBRARY = {
  diwali: scene("snap2shelf/scenes/diwali/final-59f4388a", "Diwali glow", "diwali", 4, "gpt-image-2.5-flare", {
    anchor_x: 0.5, anchor_y: 0.65, surface_width: 1, light_azimuth: 270, light_elevation: 20, temperature: "warm", glossy: false, text_zone: "none",
  }),
  marble: scene("snap2shelf/scenes/marble/final-ca4c3ac1", "Marble studio", "marble", 5, "gpt-image-2.5-flare", {
    anchor_x: 0.5, anchor_y: 0.75, surface_width: 1, light_azimuth: 315, light_elevation: 45, temperature: "neutral", glossy: true, text_zone: "none",
  }),
  kitchen: scene("snap2shelf/scenes/kitchen/final-bd611466", "Kitchen counter", "kitchen", 4, "gpt-image-2.5-flare", {
    anchor_x: 0.5, anchor_y: 0.75, surface_width: 1, light_azimuth: 270, light_elevation: 45, temperature: "warm", glossy: false, text_zone: "none",
  }),
  jute: scene("snap2shelf/scenes/jute/final-eb20e69e", "Rustic jute", "jute", 9, "nano-banana-2", {
    anchor_x: 0.5, anchor_y: 0.72, surface_width: 0.8, light_azimuth: 90, light_elevation: 30, temperature: "warm", glossy: false, text_zone: "top",
  }),
  cafe: scene("snap2shelf/scenes/cafe/final-04757f01", "Outdoor café", "cafe", 4, "gpt-image-2.5-flare", {
    anchor_x: 0.5, anchor_y: 0.78, surface_width: 0.95, light_azimuth: 90, light_elevation: 25, temperature: "warm", glossy: true, text_zone: "top_right",
  }),
} as const;

// ─── Sample kits: REAL assets on the demo cloud (dev run, 30 Sep 2026) ────────

const SNEAKER_CUTOUT = { publicId: "snap2shelf/dev/sneaker_decent/cutout", width: 976, height: 523 };
const OFFER = { hindi: "दिवाली सेल · 20% छूट", english: "Diwali sale, 20% off / this week only" };
/** Delivery used by the verified dev renders: reuse it so every URL is a cache hit. */
const VERIFIED_FMT = "f_jpg,q_85";
const toVerified = (url: string) => url.replace(/\/f_auto,q_auto(:eco)?\//, `/${VERIFIED_FMT}/`);

function stagedKit(o: {
  sku: string;
  name: string;
  caption: string;
  raw: { publicId: string; width: number; height: number; bytes: number };
  cutout: { publicId: string; width: number; height: number };
  placement: Placement;
  scene: Scene;
  heroPublicId: string;
  recolorPart?: string;
  swatches?: string[];
  offer?: { hindi?: string; english?: string };
  materialised?: Record<string, string>; // pack id → stored public id
  cost: Kit["cost"];
}): Kit {
  const controls: CompositeControls = quantise(defaultControls(o.placement, o.scene.dna, o.cutout));
  const box = geometry(o.cutout, o.scene.dna, controls, o.placement);
  const alt = `${o.name}, staged in the ${o.scene.title} scene`;
  const built = compositeUrl({ scenePublicId: o.scene.publicId, dna: o.scene.dna, cutout: o.cutout, placement: o.placement, controls, format: VERIFIED_FMT, cloud: CLOUD });
  const product: ProductRecord = {
    sku: o.sku,
    rawPublicId: o.raw.publicId,
    rawWidth: o.raw.width,
    rawHeight: o.raw.height,
    rawBytes: o.raw.bytes,
    caption: o.caption,
    understanding: {
      name: o.name,
      category: "",
      primary_color: "",
      material: "",
      recolorable_part: o.recolorPart ?? "product",
      placement: o.placement,
      suggested_themes: [o.scene.theme],
    },
    cutout: o.cutout,
  };
  const hero: KitAsset = {
    id: "hero",
    format: "hero",
    label: "Hero 4:5",
    url: up(VERIFIED_FMT, o.heroPublicId),
    width: PLATE.width,
    height: PLATE.height,
    frame: "feed-post",
    alt,
    xray: built,
    publicId: o.heroPublicId,
    qa: { status: "approved", matched: ["product-visible"], reasons: ["Your real product pixels, untouched"] },
  };
  const assets = channelAssets({
    heroPublicId: o.heroPublicId,
    cutoutPublicId: o.cutout.publicId,
    alt,
    recolorPart: o.recolorPart,
    swatches: o.swatches,
    offer: o.offer,
    textZone: o.scene.dna.text_zone,
    productBox: box,
    cloud: CLOUD,
  }).map((a) => ({ ...a, url: toVerified(a.url), publicId: o.materialised?.[a.id] }));
  return { sku: o.sku, product, mode: "exact", scene: o.scene, controls, hero, assets, cost: o.cost, createdAt: "2026-09-30T08:00:00+05:30" };
}

export const SAMPLE_KITS: Kit[] = [
  stagedKit({
    sku: "sneakerd",
    name: "Casual sneaker",
    // AI captioning of this photo (pipeline run, product zi86lf6a = same shot)
    caption: "A white and beige sneaker sits on a light-colored tiled floor against a plain white wall.",
    raw: { publicId: "snap2shelf/dev/sneaker_decent/raw", width: 1122, height: 1402, bytes: 2028411 },
    cutout: SNEAKER_CUTOUT,
    placement: "standing",
    scene: LIBRARY.diwali,
    heroPublicId: "snap2shelf/dev/heroes/sneaker-diwali",
    recolorPart: "suede panels",
    swatches: ["1e3a8a"],
    offer: OFFER,
    materialised: { story: "snap2shelf/dev/kit/sneaker-diwali/story", "recolor-1e3a8a": "snap2shelf/dev/kit/sneaker-diwali/recolor-1e3a8a" },
    cost: {
      generationCredits: 0, // Exact mode: no image generation at all
      creditsSavedByReuse: LIBRARY.diwali.credits,
      aiVisionTokens: 1276, // measured on the live run: product reading 690 + exact QA 586
      transformationsEstimate: 160, // 2 × b_gen_fill + 1 × e_gen_recolor at 50 tx, plus ~10 plain derived images
      bytesOriginal: 2028411, // measured: the phone photo as uploaded (PNG)
      bytesDelivered: 115075, // measured 30 Sep: f_auto,q_auto answers JPEG for this photo (Vary: Accept, User-Agent); the deck re-measures live
      seconds: 28,
    },
  }),
  stagedKit({
    sku: "bottlekt",
    name: "Steel water bottle",
    caption: "A stainless steel water bottle stands on a white countertop with a potted plant and a wooden block in the background.",
    raw: { publicId: "snap2shelf/dev/bottle_decent/raw", width: 1122, height: 1402, bytes: 0 },
    cutout: { publicId: "snap2shelf/dev/bottle_decent/cutout", width: 309, height: 1223 },
    placement: "standing",
    scene: LIBRARY.kitchen,
    heroPublicId: "snap2shelf/dev/heroes/bottle-kitchen",
    cost: { generationCredits: 0, creditsSavedByReuse: LIBRARY.kitchen.credits, aiVisionTokens: 0, transformationsEstimate: 0, bytesOriginal: 0, bytesDelivered: 0, seconds: 0 },
  }),
  stagedKit({
    sku: "pouchjut",
    name: "Trail mix pouch",
    caption: "A resealable trail mix pouch.",
    raw: { publicId: "snap2shelf/dev/pouch_decent/raw", width: 1122, height: 1402, bytes: 0 },
    cutout: { publicId: "snap2shelf/dev/pouch_decent/cutout", width: 709, height: 1015 },
    placement: "standing",
    scene: LIBRARY.jute,
    heroPublicId: "snap2shelf/dev/heroes/pouch-jute",
    cost: { generationCredits: 0, creditsSavedByReuse: LIBRARY.jute.credits, aiVisionTokens: 0, transformationsEstimate: 0, bytesOriginal: 0, bytesDelivered: 0, seconds: 0 },
  }),
];

// ─── QA evidence (SPIKES.md §2–3b, real captured verdicts) ────────────────────

const QA_REFERENCE = "snap2shelf/spikes/cutouts/samples_shoe_trim";
/** Same recipe as lib/server/qa.ts fidelitySheetUrl(): reference left, candidate right. */
const fidelitySheet = (candidate: string, cloud = CLOUD) =>
  up(`c_fill,w_512,h_683,g_auto/c_pad,w_1024,h_683,g_east,b_white/l_${layerId(QA_REFERENCE)}/c_fit,w_480,h_640/fl_layer_apply,g_west,x_16/${VERIFIED_FMT}`, candidate, cloud);

const QA_EVIDENCE: { approved: QaCard; rejected: QaCard } = {
  approved: {
    model: "nano-banana-2-edit",
    tier: "Faithful",
    credits: 9,
    seconds: 16.6,
    sheet: { url: fidelitySheet("snap2shelf/spikes/i2i_main/nano-banana-2-edit"), width: 1024, height: 683, alt: "Reference sneaker on the left; the faithful AI take on a sandstone ledge on the right" },
    result: { status: "approved", matched: ["same-product"], reasons: ["Same colours, panels, tongue and proportions as the photo"], fidelity: 95 },
    sameProduct: true,
    marks: [],
  },
  rejected: {
    model: "flux-2-flash-edit",
    tier: "Fast draft",
    credits: 1,
    seconds: 7.6,
    sheet: { url: fidelitySheet("snap2shelf/spikes/i2i_main/flux-2-flash-edit"), width: 1024, height: 683, alt: "Reference sneaker on the left; the draft AI take on the right, with an invented logo badge and a ghost second shoe" },
    result: {
      status: "rejected",
      matched: ["product-redesigned", "extra-product", "garbled-text"],
      reasons: ["Added a logo badge on the side", "Ghost second shoe", "Tongue logo changed"],
      fidelity: 85,
    },
    sameProduct: false,
    // candidate is 768×1024, scaled ×2/3 onto the right half (x 512..1024) of the sheet
    marks: [
      { x: (512 + 335 * (2 / 3)) / 1024, y: (512 * (2 / 3)) / 683, r: 0.045, label: "Added a logo badge" },
      { x: (512 + 242 * (2 / 3)) / 1024, y: (628 * (2 / 3)) / 683, r: 0.075, label: "Ghost second shoe" },
      { x: (512 + 405 * (2 / 3)) / 1024, y: (442 * (2 / 3)) / 683, r: 0.032, label: "Tongue logo changed" },
    ],
  },
};

// ─── The live Demo Studio shelf (snapshot) ───────────────────────────────────

/**
 * /shelf/demo-studio exactly as it was served on 30 Sep 2026 (GET /api/shelf/demo-studio,
 * plus the page's og:image). Hardcoded so the deck fetches nothing at runtime. Tile URLs are
 * the crops and widths the shelf page itself renders, so they are cache hits, not new
 * transformations. Cutout sizes read from the stored PNGs. Re-snapshot if the shelf changes.
 */
const shelfItem = (o: { sku: string; title: string; facts: string; hero: string; v: number; crop: string; cutout: [number, number] }): ShelfProduct => {
  const tile = (w: number) => up(`${o.crop}/c_limit,w_${w}/f_auto,q_auto/v${o.v}`, `snap2shelf/products/${o.sku}/${o.hero}`);
  return {
    sku: o.sku,
    title: o.title,
    facts: o.facts,
    image: { url: tile(360), srcSet: `${tile(360)} 1x, ${tile(720)} 2x`, width: 360, height: 450, alt: `${o.title}, ${o.facts.toLowerCase()}, on the Diwali glow scene` },
    // the stored original, no transformation: native pixels, always scaled down on screen
    cutout: { url: `${deliveryBase(CLOUD)}/f_auto,q_auto/snap2shelf/products/${o.sku}/cutout`, width: o.cutout[0], height: o.cutout[1], alt: `${o.title}, cut out` },
  };
};

export const DEMO_SHELF_SNAPSHOT: PresentData["shelf"] = {
  title: DEMO_SHELF.title,
  tagline: "The Diwali edit · sample products, one festive stage",
  products: [
    shelfItem({ sku: "s2candle", title: "Scented glass candle", facts: "White · wax", hero: "hero-diwali-final-59f4388a-d4d9dc2f", v: 1790741099, crop: "c_crop,w_627,h_784,x_227,y_272", cutout: [508, 659] }),
    shelfItem({ sku: "s2trlmix", title: "Trail mix pouch", facts: "Brown · plastic", hero: "hero-diwali-final-59f4388a-8b8e8e32", v: 1790741100, crop: "c_crop,w_662,h_827,x_209,y_239", cutout: [709, 1015] }),
    shelfItem({ sku: "9uo8w8pc", title: "Steel water bottle", facts: "Silver · stainless steel", hero: "hero-diwali-final-59f4388a-61fd138b", v: 1790741099, crop: "c_crop,w_905,h_1131,x_88,y_4", cutout: [309, 1223] }),
    shelfItem({ sku: "zi86lf6a", title: "Casual sneaker", facts: "White · mesh", hero: "hero-diwali-final-59f4388a-b65fa150", v: 1790741099, crop: "c_crop,w_840,h_1050,x_120,y_210", cutout: [976, 523] }),
  ],
  share: {
    // the page's og:image, verbatim
    image: {
      url: "https://res.cloudinary.com/nyxyma1i/image/upload/c_fill,w_1200,h_630,g_auto/e_blur:1500/e_brightness:-70/co_rgb:f5a524,l_text:Inter@google_22_700_letter_spacing_6:SNAP2SHELF%20%C2%B7%20SHOP/fl_layer_apply,g_north_west,x_72,y_104/co_rgb:f4efe7,c_fit,w_500,l_text:Fraunces@google_80_600_line_spacing_-6:Demo%20Studio/fl_layer_apply,g_north_west,x_72,y_146/co_rgb:a89f92,c_fit,w_480,l_text:Inter@google_26_500_line_spacing_6:The%20Diwali%20edit%20%C2%B7%20sample%20products%252C%20one%20festive%20stage/fl_layer_apply,g_north_west,x_74,y_258/l_snap2shelf:products:s2candle:hero-diwali-final-59f4388a-d4d9dc2f/c_scale,w_252,h_58/co_rgb:f5a524,e_colorize:100/co_rgb:0e0c0a,l_text:Inter@google_24_700:Open%20the%20shelf%20%20%E2%86%92/fl_layer_apply,g_center/r_29/fl_layer_apply,g_south_west,x_72,y_64/l_snap2shelf:products:s2candle:hero-diwali-final-59f4388a-d4d9dc2f/c_crop,w_627,h_784,x_227,y_272/c_fill,w_200,h_250,g_auto/bo_5px_solid_rgb:f4efe7/r_20/a_-3/co_black,e_shadow:60,x_8,y_14/fl_layer_apply,g_center,x_190,y_-125/l_snap2shelf:products:s2trlmix:hero-diwali-final-59f4388a-8b8e8e32/c_crop,w_662,h_827,x_209,y_239/c_fill,w_200,h_250,g_auto/bo_5px_solid_rgb:f4efe7/r_20/a_3/co_black,e_shadow:60,x_8,y_14/fl_layer_apply,g_center,x_420,y_-150/l_snap2shelf:products:9uo8w8pc:hero-diwali-final-59f4388a-61fd138b/c_crop,w_905,h_1131,x_88,y_4/c_fill,w_200,h_250,g_auto/bo_5px_solid_rgb:f4efe7/r_20/a_2/co_black,e_shadow:60,x_8,y_14/fl_layer_apply,g_center,x_190,y_140/l_snap2shelf:products:zi86lf6a:hero-diwali-final-59f4388a-b65fa150/c_crop,w_840,h_1050,x_120,y_210/c_fill,w_200,h_250,g_auto/bo_5px_solid_rgb:f4efe7/r_20/a_-2/co_black,e_shadow:60,x_8,y_14/fl_layer_apply,g_center,x_420,y_115/f_jpg,q_auto/snap2shelf/products/s2candle/hero-diwali-final-59f4388a-d4d9dc2f",
      width: 1200,
      height: 630,
      alt: "Demo Studio link preview: Scented glass candle, Trail mix pouch, Steel water bottle, Casual sneaker",
    },
    title: DEMO_SHELF.title,
    description: "The Diwali edit · sample products, one festive stage",
    // app/shelf/[shop]/page.tsx shareMessage()
    message: "Demo Studio: The Diwali edit · sample products, one festive stage. Take a look at the shelf 👇",
  },
};

// ─── Extras for the sample data ──────────────────────────────────────────────

export const EXTRAS: PresentExtras = {
  cloud: CLOUD,
  site: {
    url: "https://snap2shelf.vercel.app",
    host: "snap2shelf.vercel.app",
    repo: "https://github.com/GODOSTROYER/snap2shelf",
    repoLabel: "github.com/GODOSTROYER/snap2shelf",
  },
  // The storefront seeded by scripts/seed-shelf.mts (/shelf/demo-studio).
  shop: { name: DEMO_SHELF.title, slug: DEMO_SHELF.slug },
  // measured pixel-exact by matching opaque cutout pixels against the raw photo
  cutoutBoxInRaw: {
    "snap2shelf/dev/sneaker_decent/cutout": { x: 79, y: 473 },
    "snap2shelf/products/shmessy1/cutout": { x: 464, y: 106 }, // template match, mean abs diff 6.4/255
    "snap2shelf/spikes/cutouts/samples_shoe_trim": { x: 164, y: 295 },
  },
  stageScenes: [LIBRARY.diwali, LIBRARY.marble, LIBRARY.kitchen, LIBRARY.cafe],
  pipeline: {
    // weights: step shares of an end-to-end API run (scripts/e2e-pipeline.mts); pacing only, never shown
    steps: [
      { id: "fix", label: "Fix", weight: 4.7, detail: "Caption, focus check, product reading" },
      { id: "cutout", label: "Cut out", weight: 5.7, detail: "Background removed once, trimmed, stored" },
      { id: "stage", label: "Stage", weight: 1.5, detail: "Cutout composited onto a library scene" },
      { id: "light", label: "Light-match", weight: 0.9, detail: "Shadows and tint from the scene's DNA, in the URL" },
      { id: "qa", label: "QA", weight: 5.4, detail: "AI Vision approves or rejects the image" },
      { id: "pack", label: "Pack", weight: 10.8, detail: "Every channel format, zipped" },
    ],
  },
  qaFallback: QA_EVIDENCE,
  reelFallback: null,
  shelf: DEMO_SHELF_SNAPSHOT,
  // lib/claims: an estimate, and labelled as one wherever it's shown
  photoshootInr: PHOTOSHOOT_INR_ESTIMATE,
  photoshootNote: PHOTOSHOOT_NOTE,
  inrPerCredit: 33,
  inrNote: "about ₹33 per credit at Cloudinary Plus list price",
};

// ─── The adapter ──────────────────────────────────────────────────────────────

const SWATCH_NAMES: Record<string, string> = {
  "1e3a8a": "blue",
  "2563eb": "royal blue",
  "0f766e": "teal",
  b91c1c: "crimson",
  "1f2937": "charcoal",
  a16207: "mustard",
  "7c3aed": "violet",
};
const swatchName = (hex: string) => SWATCH_NAMES[hex.toLowerCase()] ?? "new colour";

const isBuilt = (x: KitAsset["xray"] | undefined): x is BuiltUrl => !!x && typeof (x as BuiltUrl).url === "string" && Array.isArray((x as BuiltUrl).segments);
const builtOf = (a: Pick<KitAsset, "url" | "xray">): BuiltUrl => (isBuilt(a.xray) ? a.xray : describeTransformation(a.url));
const round1 = (n: number) => Math.round(n * 10) / 10;

function pickFeatured(kits: Kit[], featuredSku?: string) {
  return (
    kits.find((k) => k.sku === featuredSku) ??
    kits.find((k) => k.mode === "exact" && k.scene && k.product.cutout) ??
    kits.find((k) => k.scene && k.product.cutout) ??
    kits[0]
  );
}

function qaFromKits(kits: Kit[]): PresentData["qa"] {
  const creatives = kits.flatMap((k) => k.assets.filter((a) => a.qa && a.qa.status !== "pending" && a.publicId && !isBuilt(a.xray)));
  const ok = creatives.find((a) => a.qa!.status === "approved");
  const bad = creatives.find((a) => a.qa!.status === "rejected");
  if (!ok || !bad) return null;
  const card = (a: KitAsset, approved: boolean): QaCard => {
    const req = (a.xray as { json?: { request?: { model?: string } } }).json?.request;
    return {
      model: req?.model ?? a.label,
      tier: approved ? "Faithful" : "Fast draft",
      credits: 0,
      seconds: 0,
      sheet: { url: fidelitySheet(a.publicId!), width: 1024, height: 683, alt: a.alt },
      result: a.qa!,
      sameProduct: approved,
      marks: [],
    };
  };
  return { approved: card(ok, true), rejected: card(bad, false) };
}

/** Seeded kits carry their run's step timings (ms) next to the Kit fields. */
type KitWithRun = Kit & { title?: string; sample?: boolean; timings?: Partial<Record<string, number>> };

/**
 * Reads the clips back out of a reel URL: the base image, then every fl_splice layer, each with
 * the Ken Burns move and duration its e_zoompan spells. The reel shown IS this URL, so the count,
 * the moves and the seconds can't drift from the video.
 */
export function reelClipsFromUrl(built: BuiltUrl): { publicId: string; move: string; seconds: number }[] {
  const at = built.url.indexOf(built.transformation);
  const base = at >= 0 ? built.url.slice(at + built.transformation.length + 1).replace(/\.[a-z0-9]+$/i, "") : "";
  const layers = [...built.transformation.matchAll(/fl_splice,l_([^/,]+)/g)].map((m) => m[1].replace(/:/g, "/"));
  const zooms = [...built.transformation.matchAll(/e_zoompan:du_([\d.]+);fps_\d+;from_\(([^)]*)\);to_\(([^)]*)\)/g)];
  return [base, ...layers].filter(Boolean).map((publicId, i) => {
    const z = zooms[i];
    const move = z ? REEL_MOVES.find((m) => m.from === z[2] && m.to === z[3])?.label : undefined;
    return { publicId, move: move ?? "Ken Burns move", seconds: z ? Number(z[1]) : 0 };
  });
}

export function fromKits(kits: Kit[], x: PresentExtras = EXTRAS, featuredSku?: string): PresentData {
  if (!kits.length) throw new Error("present: no kits to show");
  const cloud = x.cloud;
  const k = pickFeatured(kits, featuredSku) as KitWithRun;
  const p = k.product;
  const cut = p.cutout!;
  const placement: Placement = p.understanding?.placement ?? "standing";
  const sc = k.scene ?? x.stageScenes[0];
  const controls = k.controls ?? quantise(defaultControls(placement, sc.dna, cut));
  const g = geometry(cut, sc.dna, controls, placement);
  const name = PRODUCT_NAMES[k.sku] ?? k.title ?? p.understanding?.name ?? "Your product";
  const listingTitle = k.title ?? p.understanding?.name ?? name;
  // seeded kits are samples unless the record says otherwise: their photos are AI-generated test images
  const isSample = k.sample !== false;

  // Raw photo, delivered at its own size in the best format (and measured live).
  const rawUrl = up("c_limit,w_1200/f_auto,q_auto", p.rawPublicId, cloud);
  const boxPx = x.cutoutBoxInRaw[cut.publicId];
  const cutoutBox: Rect | null = boxPx ? { x: boxPx.x / p.rawWidth, y: boxPx.y / p.rawHeight, w: cut.width / p.rawWidth, h: cut.height / p.rawHeight } : null;
  const cutoutMs = k.timings?.cutout;

  // One cutout, every stage: kits that share this cutout first, then library plates.
  const stageKits = kits.filter((o) => o.product.cutout?.publicId === cut.publicId && o.scene);
  const stageScenes: Scene[] = [];
  for (const s of [sc, ...stageKits.map((o) => o.scene!), ...x.stageScenes]) if (!stageScenes.some((t) => t.publicId === s.publicId)) stageScenes.push(s);
  // Product-locked: every stage is composited with the hero's own placement (the featured scene's
  // anchor and this kit's controls), so the product lands on the same pixels in every scene and
  // the deck can wipe between them without it moving. Each scene keeps its own light: cast
  // shadow, reflection, contact shadows and light-match all still come from that scene's DNA.
  const locked = (s: Scene): SceneDNA => ({ ...s.dna, anchor_x: sc.dna.anchor_x, anchor_y: sc.dna.anchor_y, surface_width: sc.dna.surface_width });
  const stages: StageShot[] = stageScenes.slice(0, 4).map((s) => {
    const b = compositeUrl({ scenePublicId: s.publicId, dna: locked(s), cutout: cut, placement, controls, format: VERIFIED_FMT, cloud });
    return {
      scene: s,
      image: { url: b.url, width: PLATE.width, height: PLATE.height, alt: `${listingTitle} on the ${s.title} scene` },
      baseY: g.baseY / PLATE.height,
      credits: 0, // reused from the library: the scene's own cost (scene.credits) was paid once, when it was generated
    };
  });

  // stages[0] is this same URL: the hero on screen and the pixel proof share one geometry (g)
  const heroBuilt = compositeUrl({ scenePublicId: sc.publicId, dna: sc.dna, cutout: cut, placement, controls, format: VERIFIED_FMT, cloud });
  // upload → delivered hero: the figure every receipt shows (lib/claims), else this kit's own record
  const measured = MEASURED_HERO_WEIGHT[k.sku];
  const heroWeight: PresentData["cost"]["weight"] = measured
    ? { original: measured.original, delivered: measured.delivered, format: measured.format, conditions: heroWeightConditions(measured.format) }
    : { original: k.cost.bytesOriginal || p.rawBytes, delivered: k.cost.bytesDelivered, format: "", conditions: heroWeightConditions() };
  const offerAsset = k.assets.find((a) => a.format === "offer");
  const offerText = { hindi: OFFER.hindi, english: OFFER.english };
  const card = offerLayout(sc.dna.text_zone, g, offerText).card;

  // Pack: this kit's own channel formats (the shelf's link preview belongs to the shelf chapter).
  const pack: KitAsset[] = k.assets
    .filter((a) => a.format !== "hero")
    .map((a) => (a.format === "recolor" ? { ...a, label: `Colour variant, ${swatchName(a.id.replace(/^recolor-/, ""))}` } : { ...a }));

  // Reel: the kit's own, else the verified sample reel (stored images only).
  let reelBuilt: { url: string; seconds: number; built: BuiltUrl } | null = null;
  if (k.reel) {
    reelBuilt = { url: k.reel.url, seconds: k.reel.seconds, built: k.reel.xray };
  } else {
    const shelfHeroes = kits.map((o) => o.hero.publicId).filter((id): id is string => !!id);
    const images =
      x.reelFallback?.images ??
      [k.assets.find((a) => a.format === "story")?.publicId, k.hero.publicId, k.assets.find((a) => a.format === "recolor")?.publicId, ...shelfHeroes.filter((id) => id !== k.hero.publicId).slice(-1)].filter(
        (id): id is string => !!id,
      );
    if (images.length >= 3) {
      const r = reelUrl({ images, offer: x.reelFallback?.offer ?? offerText, cloud });
      reelBuilt = { url: r.url, seconds: r.seconds, built: r };
    }
  }
  let reel: PresentData["reel"] = null;
  if (reelBuilt) {
    // thumbnails: the kit's own stored asset URLs where they exist (already on screen in the pack chapter)
    const known = [k.hero, ...k.assets];
    const clips: ReelClip[] = reelClipsFromUrl(reelBuilt.built).map((c) => {
      const a = known.find((o) => o.publicId === c.publicId);
      return a
        ? { ...c, url: a.url, width: a.width, height: a.height, alt: "" }
        : { ...c, url: up("c_fill,w_240,h_427,g_center/f_auto,q_auto", c.publicId, cloud), width: 240, height: 427, alt: "" };
    });
    reel = { url: reelBuilt.url, poster: clips[0]?.url ?? k.hero.url, seconds: reelBuilt.seconds, clips, built: reelBuilt.built };
  }

  const story = k.assets.find((a) => a.format === "story");
  const extras: PresentData["xray"]["extras"] = [];
  const pickSeg = (a: KitAsset | undefined, kind: XraySegment["kind"], title: string) => {
    const s = a && builtOf(a).segments.find((t) => t.kind === kind);
    if (s) extras.push({ title, segment: s });
  };
  pickSeg(story, "gen-ai", "Story 9:16");
  pickSeg(offerAsset, "text", "Festive offer");
  if (reel) {
    const v = reel.built.segments.find((t) => t.kind === "video" && t.text.startsWith("fl_splice"));
    if (v) extras.push({ title: "Kit Reel", segment: v });
  }

  const shopUrl = `${x.site.url}/shelf/${x.shop.slug}`;

  return {
    cloud,
    site: x.site,
    shop: { ...x.shop, url: shopUrl, host: shopUrl.replace(/^https?:\/\//, "") },
    product: {
      sku: k.sku,
      name,
      listingTitle,
      caption: p.caption ?? name,
      raw: {
        url: rawUrl,
        width: p.rawWidth,
        height: p.rawHeight,
        alt: p.caption ?? `${name}, as photographed`,
        bytes: p.rawBytes,
        format: "PNG",
        source: isSample ? SAMPLE_PHOTO_LABEL : "Your photo",
        disclosure: isSample ? SAMPLE_PHOTO_DISCLOSURE : null,
      },
      cutout: {
        url: up("c_limit,w_1200/f_auto,q_auto", cut.publicId, cloud),
        width: cut.width,
        height: cut.height,
        alt: `${listingTitle}, cut out on a transparent background`,
        box: cutoutBox,
        seconds: typeof cutoutMs === "number" && cutoutMs > 0 ? round1(cutoutMs / 1000) : null,
        chain: "e_background_removal/e_trim/f_png",
      },
    },
    scene: { ...sc, image: { url: up("f_auto,q_auto", sc.publicId, cloud), width: PLATE.width, height: PLATE.height, alt: `${sc.title} scene plate, empty` } },
    landing: {
      box: { x: g.px / PLATE.width, y: g.py / PLATE.height, w: g.pw / PLATE.width, h: g.ph / PLATE.height },
      textZone: { x: card.x / PLATE.width, y: card.y / PLATE.height, w: card.w / PLATE.width, h: card.h / PLATE.height },
    },
    hero: { url: heroBuilt.url, width: PLATE.width, height: PLATE.height, alt: k.hero.alt, built: heroBuilt },
    stages,
    qa: qaFromKits(kits) ?? x.qaFallback,
    pack,
    reel,
    // the X-ray shows the kit's own stored hero URL: the same URL (and character count) as the landing's
    xray: { hero: isBuilt(k.hero.xray) ? k.hero.xray : heroBuilt, extras },
    pipeline: {
      steps: x.pipeline.steps,
      range: MEASURED_PHOTO_TO_ZIP_RANGE_S,
      headline: PHOTO_TO_KIT_COPY,
      claim: PHOTO_TO_KIT_MEASURED_COPY,
      note: "Timed live runs, 30 Sep 2026: from choosing the file to the ZIP link, upload included. Most of the spread is upload time.",
    },
    cost: {
      generationCredits: k.cost.generationCredits,
      sceneTitle: sc.title,
      sceneCredits: sc.credits,
      creditsSavedByReuse: k.cost.creditsSavedByReuse,
      reuseNote: CREDITS_SAVED_COPY,
      transformations: k.cost.transformationsEstimate,
      weight: heroWeight,
      photoshootInr: x.photoshootInr,
      photoshootNote: x.photoshootNote,
      inrPerCredit: x.inrPerCredit,
      inrNote: x.inrNote,
    },
    shelf: x.shelf,
  };
}

/** Accepts the seeded showcase file as `Kit[]` or `{ kits: Kit[] }`. */
export function fromShowcase(json: unknown, featuredSku?: string): PresentData {
  const kits = (Array.isArray(json) ? json : (json as { kits?: unknown })?.kits) as Kit[] | undefined;
  if (!Array.isArray(kits) || !kits.length) return fromKits(SAMPLE_KITS, EXTRAS, featuredSku);
  return fromKits(kits, EXTRAS, featuredSku);
}

// ══ THE LINE TO CHANGE ══════════════════════════════════════════════════════
// Seeded showcase: export const PRESENT: PresentData = fromShowcase(showcase);
export const PRESENT: PresentData = fromShowcase(showcase, "shmessy1");
