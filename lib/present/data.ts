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
 *      Anything a kit can't provide (live pipeline timings, the QA evidence
 *      pair, shop name, photoshoot estimate) comes from `EXTRAS` below.
 *
 * Everything here is pure and deterministic: the same input always yields the
 * same Cloudinary URLs, so each derived image is billed once and then cached.
 * The sample kits reuse URLs that were already rendered and verified by the
 * transform workstream (scripts/dev/channel-check.mts, reel-check.mts,
 * og-check.mts), so this deck costs close to zero new transformations.
 */
import { channelAssets, offerLayout } from "@/lib/transform/channels";
import { compositeUrl, defaultControls, deliveryBase, geometry, layerId, quantise } from "@/lib/transform/composite";
import { ogImageUrl } from "@/lib/transform/og";
import { reelUrl } from "@/lib/transform/reel";
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
// import showcase from "@/data/showcase.json"; // ← seeded kits (see the header)

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
  /** Measured seconds, or null when the step costs no extra time. */
  seconds: number | null;
  /** Shown instead of a time when seconds is null. */
  display?: string;
  detail: string;
}

export interface ShelfProduct {
  title: string;
  price: string;
  image: PresentImage;
}

export interface PresentData {
  cloud: string;
  site: { url: string; host: string; repo: string; repoLabel: string };
  shop: { name: string; slug: string; url: string; host: string };
  product: {
    sku: string;
    name: string;
    caption: string;
    raw: PresentImage & { bytes: number; format: string; source: string };
    cutout: PresentImage & { box: Rect | null; seconds: number | null; chain: string };
  };
  scene: Scene & { image: PresentImage };
  /** Product box on the plate (fractions) + the text-safe card the offer uses. */
  landing: { box: Rect; textZone: Rect | null };
  hero: PresentImage & { built: BuiltUrl };
  stages: StageShot[];
  qa: { approved: QaCard; rejected: QaCard } | null;
  pack: KitAsset[];
  reel: { url: string; poster: string; seconds: number; clips: PresentImage[]; built: BuiltUrl } | null;
  xray: { hero: BuiltUrl; extras: { title: string; segment: XraySegment }[] };
  pipeline: { steps: PipelineStat[]; totalSeconds: number; note: string };
  cost: {
    generationCredits: number;
    sceneCredits: number; // what the featured scene cost once, when the library was seeded
    creditsSavedByReuse: number;
    reuseNote: string;
    transformations: number; // tx estimate for the whole kit
    bytesOriginal: number;
    bytesDeliveredFallback: number; // measured offline; the deck re-measures live
    deliveredUrl: string; // image whose delivered size the deck measures live
    photoshootInr: number;
    photoshootNote: string;
    inrPerCredit: number;
    inrNote: string;
    seconds: number;
  };
  shelf: {
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
  /** Live pipeline timings (seconds). */
  pipeline: { steps: PipelineStat[]; note: string };
  /** Reference-vs-candidate evidence for the QA chapter when no kit carries a creative pair. */
  qaFallback: { approved: QaCard; rejected: QaCard } | null;
  /** Reel inputs when the featured kit has none. */
  reelFallback: { images: string[]; offer: { hindi?: string; english?: string } } | null;
  shelfTitles: Record<string, { title: string; price: string }>;
  extraShelf: ShelfProduct[];
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

// ─── Extras for the sample data ──────────────────────────────────────────────

export const EXTRAS: PresentExtras = {
  cloud: CLOUD,
  site: {
    url: "https://snap2shelf.vercel.app",
    host: "snap2shelf.vercel.app",
    repo: "https://github.com/GODOSTROYER/snap2shelf",
    repoLabel: "github.com/GODOSTROYER/snap2shelf",
  },
  // Same shop name as the verified OG card (scripts/dev/og-check.mts). TODO(lead): match the /shelf/<slug> the shelf workstream seeds.
  shop: { name: "Meera's Home Store", slug: "meera" },
  // measured pixel-exact by matching opaque cutout pixels against the raw photo
  cutoutBoxInRaw: {
    "snap2shelf/dev/sneaker_decent/cutout": { x: 79, y: 473 },
    "snap2shelf/spikes/cutouts/samples_shoe_trim": { x: 164, y: 295 },
  },
  stageScenes: [LIBRARY.diwali, LIBRARY.marble, LIBRARY.kitchen, LIBRARY.cafe],
  pipeline: {
    // Live end-to-end run through the deployed API routes, 30 Sep 2026 (scripts/e2e-pipeline.mts, run 1).
    steps: [
      { id: "fix", label: "Fix", seconds: 4.7, detail: "Caption, focus check, product reading" },
      { id: "cutout", label: "Cut out", seconds: 5.7, detail: "Background removed once, trimmed, stored" },
      { id: "stage", label: "Stage", seconds: 1.5, detail: "Cutout composited onto a library scene" },
      { id: "light", label: "Light-match", seconds: null, display: "in the URL", detail: "Shadows and tint from the scene's DNA" },
      { id: "qa", label: "QA", seconds: 5.4, detail: "AI Vision approves or rejects the image" },
      { id: "pack", label: "Pack", seconds: 10.8, detail: "Every channel format, zipped" },
    ],
    note: "Measured on a live run, 30 Sep 2026. Upload time not included.",
  },
  qaFallback: QA_EVIDENCE,
  reelFallback: null,
  shelfTitles: {
    sneakerd: { title: "Casual sneaker, grey suede", price: "₹2,499" },
    bottlekt: { title: "Steel water bottle, 750 ml", price: "₹649" },
    pouchjut: { title: "Trail mix, 200 g", price: "₹299" },
  },
  extraShelf: [
    {
      title: "Casual sneaker, royal blue",
      price: "₹2,499",
      image: { url: up(VERIFIED_FMT, "snap2shelf/dev/kit/sneaker-diwali/recolor-1e3a8a"), width: 1080, height: 1350, alt: "The same casual sneaker recoloured royal blue, on the Diwali table" },
    },
    {
      title: "White running shoe",
      price: "₹1,899",
      image: { url: up("c_limit,w_720/f_auto,q_auto", "snap2shelf/products/7chyt905/hero-diwali-teak-42-cc0c4509"), width: 720, height: 900, alt: "A white running shoe on a teak table with diyas behind" },
    },
    {
      title: "Retro runner, tan and rose",
      price: "₹3,199",
      image: { url: up("c_limit,w_720/f_auto,q_auto", "snap2shelf/spikes/heroes/shoe_diwali"), width: 720, height: 900, alt: "A white, tan and rose retro runner on a teak table with marigolds behind" },
    },
  ],
  // Illustrative, clearly labelled as estimates in the deck.
  photoshootInr: 4000,
  photoshootNote: "Typical small-studio quote for one product",
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

export function fromKits(kits: Kit[], x: PresentExtras = EXTRAS, featuredSku?: string): PresentData {
  if (!kits.length) throw new Error("present: no kits to show");
  const cloud = x.cloud;
  const k = pickFeatured(kits, featuredSku);
  const p = k.product;
  const cut = p.cutout!;
  const placement: Placement = p.understanding?.placement ?? "standing";
  const sc = k.scene ?? x.stageScenes[0];
  const controls = k.controls ?? quantise(defaultControls(placement, sc.dna, cut));
  const g = geometry(cut, sc.dna, controls, placement);
  const name = p.understanding?.name ?? "Your product";

  // Raw photo, delivered at its own size in the best format (and measured live).
  const rawUrl = up("c_limit,w_1200/f_auto,q_auto", p.rawPublicId, cloud);
  const boxPx = x.cutoutBoxInRaw[cut.publicId];
  const cutoutBox: Rect | null = boxPx ? { x: boxPx.x / p.rawWidth, y: boxPx.y / p.rawHeight, w: cut.width / p.rawWidth, h: cut.height / p.rawHeight } : null;

  // One cutout, every stage: kits that share this cutout first, then library plates.
  const stageKits = kits.filter((o) => o.product.cutout?.publicId === cut.publicId && o.scene);
  const stageScenes: Scene[] = [];
  for (const s of [sc, ...stageKits.map((o) => o.scene!), ...x.stageScenes]) if (!stageScenes.some((t) => t.publicId === s.publicId)) stageScenes.push(s);
  const stages: StageShot[] = stageScenes.slice(0, 4).map((s) => {
    const c = quantise(defaultControls(placement, s.dna, cut));
    const b = compositeUrl({ scenePublicId: s.publicId, dna: s.dna, cutout: cut, placement, controls: c, format: VERIFIED_FMT, cloud });
    return {
      scene: s,
      image: { url: b.url, width: PLATE.width, height: PLATE.height, alt: `${name} on the ${s.title} scene` },
      baseY: geometry(cut, s.dna, c, placement).baseY / PLATE.height,
      credits: 0,
    };
  });

  const heroBuilt = compositeUrl({ scenePublicId: sc.publicId, dna: sc.dna, cutout: cut, placement, controls, format: VERIFIED_FMT, cloud });
  const offerAsset = k.assets.find((a) => a.format === "offer");
  const offerText = { hindi: OFFER.hindi, english: OFFER.english };
  const card = offerLayout(sc.dna.text_zone, g, offerText).card;

  // Pack: every framed kit asset, plus the shelf's link-preview card.
  const shelfHeroes = kits.map((o) => o.hero.publicId).filter((id): id is string => !!id);
  const ogIds = [...shelfHeroes, ...k.assets.filter((a) => a.format === "recolor" && a.publicId).map((a) => a.publicId!)].slice(0, 4);
  const og = ogIds.length ? ogImageUrl({ heroes: ogIds, shopName: x.shop.name, cloud }) : null;
  const pack: KitAsset[] = k.assets
    .filter((a) => a.format !== "hero")
    .map((a) => (a.format === "recolor" ? { ...a, label: `Colour variant, ${swatchName(a.id.replace(/^recolor-/, ""))}` } : { ...a }));
  if (og) {
    pack.push({ id: "og", format: "feed", label: "Link preview 1200×630", url: og.url, width: 1200, height: 630, frame: "none", alt: `${x.shop.name}: link preview with four products`, xray: og });
  }

  // Reel: the kit's own, else the verified sample reel (stored images only).
  let reel: PresentData["reel"] = null;
  const reelImages = k.reel
    ? null
    : x.reelFallback?.images ??
      [k.assets.find((a) => a.format === "story")?.publicId, k.hero.publicId, k.assets.find((a) => a.format === "recolor")?.publicId, ...shelfHeroes.filter((id) => id !== k.hero.publicId).slice(-1)].filter(
        (id): id is string => !!id,
      );
  if (k.reel) {
    reel = { url: k.reel.url, poster: k.hero.url, seconds: k.reel.seconds, clips: [], built: k.reel.xray };
  } else if (reelImages && reelImages.length >= 3) {
    const r = reelUrl({ images: reelImages, offer: x.reelFallback?.offer ?? offerText, cloud });
    reel = {
      url: r.url,
      poster: up(VERIFIED_FMT, reelImages[0], cloud),
      seconds: r.seconds,
      clips: reelImages.map((id) => ({ url: up("c_fill,w_240,h_427,g_center/f_auto,q_auto", id, cloud), width: 240, height: 427, alt: "" })),
      built: r,
    };
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

  const savedByReuse = stages.reduce((n, s) => n + s.scene.credits, 0);
  const pipelineTotal = round1(x.pipeline.steps.reduce((n, s) => n + (s.seconds ?? 0), 0));

  const shelfProducts: ShelfProduct[] = [
    ...kits.map((o) => ({
      title: x.shelfTitles[o.sku]?.title ?? o.product.understanding?.name ?? "Product",
      price: x.shelfTitles[o.sku]?.price ?? "",
      image: { url: o.hero.url, width: o.hero.width, height: o.hero.height, alt: o.hero.alt },
    })),
    ...x.extraShelf,
  ].slice(0, 6);
  const shopUrl = `${x.site.url}/shelf/${x.shop.slug}`;

  return {
    cloud,
    site: x.site,
    shop: { ...x.shop, url: shopUrl, host: shopUrl.replace(/^https?:\/\//, "") },
    product: {
      sku: k.sku,
      name,
      caption: p.caption ?? name,
      raw: { url: rawUrl, width: p.rawWidth, height: p.rawHeight, alt: p.caption ?? `${name}, as photographed`, bytes: p.rawBytes, format: "PNG", source: "Phone photo" },
      cutout: {
        url: up("c_limit,w_1200/f_auto,q_auto", cut.publicId, cloud),
        width: cut.width,
        height: cut.height,
        alt: `${name}, cut out on a transparent background`,
        box: cutoutBox,
        seconds: x.pipeline.steps.find((s) => s.id === "cutout")?.seconds ?? null,
        chain: "e_background_removal/e_trim/f_png",
      },
    },
    scene: { ...sc, image: { url: up("f_auto,q_auto", sc.publicId, cloud), width: PLATE.width, height: PLATE.height, alt: `${sc.title} scene plate, empty` } },
    landing: {
      box: { x: g.px / PLATE.width, y: g.py / PLATE.height, w: g.pw / PLATE.width, h: g.ph / PLATE.height },
      textZone: { x: card.x / PLATE.width, y: card.y / PLATE.height, w: card.w / PLATE.width, h: card.h / PLATE.height },
    },
    hero: { url: stages[0]?.image.url ?? k.hero.url, width: PLATE.width, height: PLATE.height, alt: k.hero.alt, built: heroBuilt },
    stages,
    qa: qaFromKits(kits) ?? x.qaFallback,
    pack,
    reel,
    xray: { hero: heroBuilt, extras },
    pipeline: { steps: x.pipeline.steps, totalSeconds: pipelineTotal, note: x.pipeline.note },
    cost: {
      generationCredits: k.cost.generationCredits,
      sceneCredits: sc.credits,
      creditsSavedByReuse: savedByReuse,
      reuseNote: `${stages.length} library scenes, generated once, reused at 0 credits`,
      transformations: k.cost.transformationsEstimate,
      bytesOriginal: k.cost.bytesOriginal || p.rawBytes,
      bytesDeliveredFallback: k.cost.bytesDelivered,
      deliveredUrl: rawUrl,
      photoshootInr: x.photoshootInr,
      photoshootNote: x.photoshootNote,
      inrPerCredit: x.inrPerCredit,
      inrNote: x.inrNote,
      seconds: pipelineTotal,
    },
    shelf: {
      products: shelfProducts,
      share: {
        image: og ? { url: og.url, width: 1200, height: 630, alt: `${x.shop.name} link preview` } : shelfProducts[0].image,
        title: x.shop.name,
        description: `${shelfProducts.length} products · shop the shelf`,
        message: "Diwali stock is up. Have a look",
      },
    },
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
export const PRESENT: PresentData = fromKits(SAMPLE_KITS, EXTRAS);
