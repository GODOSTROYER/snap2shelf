/**
 * Showcase: the sample products and their finished kits, built from REAL
 * assets already stored on the demo cloud (synthetic test photos, never a
 * seller's). The landing page, /kit/<sku> and the sample run in /studio all
 * read from here. A sample run in the studio is a zero-quota REPLAY of these
 * results: no analyze, QA or pack call is made, and every image it shows is a
 * stored asset or an already-rendered transformation.
 *
 * Two sources:
 *  - the featured sneaker (hand-assembled below): the landing hero, with a
 *    "before" photo aligned to the hero for the wipe slider;
 *  - the seeded kits (scripts/seed-showcase.mts → data/showcase.json): full
 *    live runs with a stored pack, reel, signed ZIP, step timings and every QA
 *    attempt (including real rejections the replay retells).
 *
 * Provenance of every number:
 *  - product reading (caption, focus, understanding): measured by the live
 *    analyze route on these exact photos (30 Sep, e2e runs);
 *  - cut-outs, heroes, story/banner/recolor: rendered live once, then stored;
 *  - QA verdicts: the live exact-QA route on the stored hero recipes (30 Sep);
 *  - "before" photos: the raw photo, cropped so the product sits exactly where
 *    the hero places it (stored once).
 */
import { PRIMARY_SAMPLE_SKU, PRODUCT_NAMES, SHOWCASE_KIT_SKU } from "./claims";
import { snapWidth } from "./client/img";
import { SHOWCASE, type ShowcaseKit, type ShowcaseTimings } from "./showcase-data";
import { channelAssets } from "./transform/channels";
import { compositeUrl, defaultControls, deliveryBase, geometry, quantise } from "./transform/composite";
import { ogImageUrl as ogUrl } from "./transform/og";
import { reelUrl } from "./transform/reel";
import { recolorExplain, recolorLabel, swatchName } from "./client/swatches";
import type { CompositeControls, Kit, KitAsset, ProductRecord, QaResult, Scene, SceneDNA, Sku } from "./types";

export const SHOWCASE_CLOUD = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || "nyxyma1i";

// widths snap to the site's fixed set (lib/client/img.ts): every new width is a new billable derivative
const stored = (publicId: string, w?: number) => `${deliveryBase(SHOWCASE_CLOUD)}/${w ? `c_limit,w_${snapWidth(w)}/` : ""}f_auto,q_auto/${publicId}`;

/** Canonical display name of a sample (lib/claims.ts), e.g. "Chikankari kurta". */
export const productName = (sku: string, fallback = "Your product") => PRODUCT_NAMES[sku] ?? fallback;
/** The same name, short enough for a shop listing or alt text ("Steel bottle, cluttered-counter photo" → "Steel bottle"). */
export const shortProductName = (sku: string, fallback = "Your product") => (PRODUCT_NAMES[sku] ? PRODUCT_NAMES[sku].split(",")[0] : fallback);
/** A title and its qualifier, for a two-line heading: "Steel bottle, cluttered-counter photo" → ["Steel bottle", "cluttered-counter photo"]. */
export function nameParts(name: string): [string, string | undefined] {
  const at = name.indexOf(", ");
  return at < 0 ? [name, undefined] : [name.slice(0, at), name.slice(at + 2)];
}

/** A real QA rejection from the seeded run, retold by the replay: caught → auto-fixed → approved. */
export interface SampleQaStory {
  rejected: QaResult; // the first attempt's verdict, as the live QA route wrote it
  rejectedUrl: string; // that attempt's composite (rendered during the seed run, so cached)
  rejectedControls: CompositeControls;
  caught: string; // first sentence of the first reason
  fix: string; // what changed between the rejected and the approved attempt
  attempts: number; // how many checks the live run took
}

export interface SampleProduct {
  sku: Sku;
  title: string; // canonical product name (lib/claims.ts PRODUCT_NAMES): picker, studio, kit page
  blurb: string; // the scene of the sample photo, in a few words (never "phone photo": the samples are AI-generated test images)
  /** What this sample demonstrates beyond a clean run (the picker's featured tile says it). */
  highlight?: string;
  /** Shown in the studio's sample picker (false: a duplicate photo, still reachable by link). */
  listed: boolean;
  product: ProductRecord;
  scene: Scene;
  controls: CompositeControls;
  heroPublicId: string; // the approved composite, saved once as its own asset
  /** The sample photo cropped (and extended) so its product sits exactly where the hero places it, 1080×1350. */
  beforePublicId?: string;
  /** Same, as a ready delivery URL (seeded data: beforeAfter[].rawAlignedUrl). */
  beforeUrl?: string;
  offer: { hindi: string; english: string };
  swatches: string[];
  qa: QaResult; // the verdict the replay shows (measured)
  qaTokens: number;
  /** Replay pacing, ms per step (the live run's order of magnitude, compressed). */
  pace: { analyze: number; cutout: number; qa: number; pack: number };
  kit: Kit; // what the replay deals onto the shelves
  /** Seeded runs: a QA rejection the live run fixed, retold by the replay. */
  qaStory?: SampleQaStory;
  /** Seeded runs: wall-clock per step on the live run (cost receipt). */
  timings?: ShowcaseTimings;
  /** Seeded runs: AI Vision tokens of the product reading (the rest went to QA). */
  analyzeTokens?: number;
}

// ─── Scenes (from the shared library, tag s2s-scene) ─────────────────────────

const diwaliDna: SceneDNA = {
  anchor_x: 0.5,
  anchor_y: 0.65,
  surface_width: 1,
  light_azimuth: 270,
  light_elevation: 20,
  temperature: "warm",
  glossy: false,
  text_zone: "none",
};

const diwali: Scene = {
  publicId: "snap2shelf/scenes/diwali/final-59f4388a",
  theme: "diwali",
  view: "eye-level",
  title: "Diwali glow",
  prompt:
    "Photorealistic empty product-photography backdrop, professional commercial photo. Camera at eye level, about 15 degrees above the surface. A warm teak wooden tabletop fills the lower 40% of the frame. The centre foreground of the surface is completely empty and clear for placing a product. In the background brass diyas with small flames, marigold garlands and warm fairy-light bokeh, softly out of focus with shallow depth of field. Soft warm light from the upper left. No products, no bottles, no packaging, no people, no hands, no text, no letters, no logos, no brand names.",
  modelId: "gpt-image-2.5-flare",
  credits: 4,
  dna: diwaliDna,
};

const kitchenDna: SceneDNA = {
  anchor_x: 0.5,
  anchor_y: 0.75,
  surface_width: 1,
  light_azimuth: 270,
  light_elevation: 45,
  temperature: "warm",
  glossy: false,
  text_zone: "none",
};

const kitchen: Scene = {
  publicId: "snap2shelf/scenes/kitchen/final-bd611466",
  theme: "kitchen",
  view: "eye-level",
  title: "Kitchen counter",
  prompt:
    "Photorealistic empty product-photography backdrop, professional commercial photo. Camera at eye level, about 15 degrees above the surface. A light oak kitchen countertop fills the lower 40% of the frame. The centre foreground of the surface is completely empty and clear for placing a product. In the background a bright modern kitchen with white tiles and fresh green herbs, softly out of focus with shallow depth of field. Morning daylight from a window on the left. No products, no bottles, no packaging, no people, no hands, no text, no letters, no logos, no brand names.",
  modelId: "gpt-image-2.5-flare",
  credits: 4,
  dna: kitchenDna,
};

/**
 * Snapshot of the scene library's final plates (tag s2s-scene, 30 Sep), so a
 * sample replay needs no request at all. Live runs read the library via /api/scenes.
 */
const plate = (id: string, theme: string, title: string, view: Scene["view"], credits: number, modelId: string, d: [number, number, number, number, number, SceneDNA["temperature"], boolean, SceneDNA["text_zone"]]): Scene => ({
  publicId: `snap2shelf/scenes/${theme}/${id}`,
  theme,
  view,
  title,
  prompt: "",
  modelId,
  credits,
  dna: { anchor_x: d[0], anchor_y: d[1], surface_width: d[2], light_azimuth: d[3], light_elevation: d[4], temperature: d[5], glossy: d[6], text_zone: d[7] },
});

export const SCENE_LIBRARY: Scene[] = [
  diwali,
  kitchen,
  plate("final-04757f01", "cafe", "Outdoor café", "eye-level", 4, "gpt-image-2.5-flare", [0.5, 0.78, 0.95, 90, 25, "warm", true, "top_right"]),
  plate("final-f5fa67e9", "pastel", "Pastel minimal", "eye-level", 4, "gpt-image-2.5-flare", [0.5, 0.74, 1, 270, 45, "cool", false, "top"]),
  plate("final-eb20e69e", "jute", "Rustic jute", "eye-level", 9, "nano-banana-2", [0.5, 0.72, 0.8, 90, 30, "warm", false, "top"]),
  plate("final-ca4c3ac1", "marble", "Marble studio", "eye-level", 5, "gpt-image-2.5-flare", [0.5, 0.75, 1, 315, 45, "neutral", true, "none"]),
  plate("final-ed645adc", "flatlay-festive", "Festive flat-lay", "top-down", 4, "gpt-image-2.5-flare", [0.5, 0.45, 0.7, 0, 60, "warm", false, "none"]),
  plate("final-c9e88705", "flatlay-linen", "Linen flat-lay", "top-down", 4, "gpt-image-2.5-flare", [0.5, 0.5, 0.7, 0, 60, "warm", false, "none"]),
];

// ─── Sample definitions ──────────────────────────────────────────────────────

interface SampleSpec {
  sku: Sku;
  title: string;
  blurb: string;
  product: ProductRecord;
  scene: Scene;
  heroPublicId: string;
  beforePublicId: string;
  /** Pack formats that were rendered once and stored (AI formats): format id → public id. */
  storedFormats: Record<string, string>;
  recolorPart: string; // the part prompt the stored recolor was made with
  offer: { hindi: string; english: string };
  swatches: string[];
  qa: QaResult;
  qaTokens: number;
  analyzeTokens: number; // estimate: SPIKES.md §3 (≈690 per product reading)
  seconds: number; // measured: photo → finished kit on a live run of this photo
  pace: SampleProduct["pace"];
}

const QA_OK = (checkedAt: string): QaResult => ({ status: "approved", matched: ["product-visible"], reasons: [], checkedAt });

const SPECS: SampleSpec[] = [
  {
    sku: "sneaker1",
    title: PRODUCT_NAMES.sneaker1,
    blurb: "On a tiled floor",
    product: {
      sku: "sneaker1",
      rawPublicId: "snap2shelf/dev/sneaker_decent/raw",
      rawWidth: 1122,
      rawHeight: 1402,
      rawBytes: 2028411,
      caption: "A white and beige sneaker sits on a light-colored tiled floor against a plain white wall.",
      focus: 0.77,
      understanding: {
        name: PRODUCT_NAMES.sneaker1,
        category: "footwear",
        primary_color: "white",
        material: "mesh",
        recolorable_part: "upper panel",
        placement: "standing",
        suggested_themes: ["pastel", "marble"],
      },
      cutout: { publicId: "snap2shelf/dev/sneaker_decent/cutout", width: 976, height: 523 },
    },
    scene: diwali,
    heroPublicId: "snap2shelf/dev/heroes/sneaker-diwali",
    beforePublicId: "snap2shelf/dev/before/sneaker-diwali",
    storedFormats: {
      story: "snap2shelf/dev/kit/sneaker-diwali/story",
      banner: "snap2shelf/dev/kit/sneaker-diwali/banner",
      "recolor-1e3a8a": "snap2shelf/dev/kit/sneaker-diwali/recolor-1e3a8a",
    },
    recolorPart: "suede panels",
    offer: { hindi: "दिवाली सेल · 20% छूट", english: "Diwali sale, 20% off / this week only" },
    swatches: ["1e3a8a"],
    qa: QA_OK("2026-09-30T04:08:34.844Z"),
    qaTokens: 675,
    analyzeTokens: 690,
    seconds: 44,
    pace: { analyze: 1400, cutout: 1500, qa: 1300, pack: 2200 },
  },
];

// ─── Creative takes (image_to_image, SPIKES.md §2 + §3b) ─────────────────────
// Real takes from the Day-0 spike, of a different test sneaker (Cloudinary's
// samples/shoe). Shown as examples of what Creative mode and its QA do.

const SPIKE_CUTOUT = "snap2shelf/spikes/cutouts/samples_shoe_trim";

const creativeRequest = (model: string, seed: number) => ({
  prompt:
    "Place this exact sneaker on a sandstone ledge in a sunlit Rajasthani courtyard. Keep every logo, colour, panel and proportion of the product unchanged.",
  model,
  seed,
  aspect_ratio: "3:4",
  reference_images: [{ source_type: "url", url: `${deliveryBase(SHOWCASE_CLOUD)}/${SPIKE_CUTOUT}` }],
});

function creativeAsset(id: string, publicId: string, label: string, alt: string, model: string, seed: number, qa: KitAsset["qa"]): KitAsset {
  return {
    id,
    format: "hero",
    label,
    url: `${deliveryBase(SHOWCASE_CLOUD)}/c_fill,w_1080,h_1350,g_auto/f_auto,q_auto/${publicId}`,
    width: 1080,
    height: 1350,
    frame: "feed-post",
    alt,
    publicId,
    xray: { json: { endpoint: "POST /v2/generate/image_to_image", request: creativeRequest(model, seed) } },
    qa,
  };
}

export const CREATIVE_APPROVED = creativeAsset(
  "creative-faithful",
  "snap2shelf/spikes/i2i_main/nano-banana-2-edit",
  "Creative take",
  "A generated take of a white, tan and pink test sneaker on a sandstone ledge in a sunlit courtyard",
  "nano-banana-2-edit",
  7,
  {
    status: "approved",
    matched: ["same-product"],
    reasons: ["Same colours, panels, tongue and proportions as the photo"],
    fidelity: 95,
  },
);

export const CREATIVE_REJECTED = creativeAsset(
  "creative-draft",
  "snap2shelf/spikes/i2i_main/flux-2-flash-edit",
  "Draft take",
  "A draft generated take that redesigned the test sneaker: a new side badge, a changed tongue logo and a ghost second shoe",
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

export function heroAlt(p: Pick<ProductRecord, "understanding">, scene: Pick<Scene, "title">) {
  const name = p.understanding?.name ?? "Your product";
  return `${name}, staged on the ${scene.title} scene`;
}

/** Order the reel's clips: native 9:16 first, then the hero, colour variants, the banner. */
export function reelClips(heroPublicId: string, assets: Pick<KitAsset, "id" | "publicId">[]): string[] {
  const id = (k: string) => assets.find((a) => a.id === k)?.publicId;
  const recolors = assets.filter((a) => a.id.startsWith("recolor-") && a.publicId).map((a) => a.publicId!);
  return [id("story"), heroPublicId, ...recolors.slice(0, 2), id("banner")].filter((x): x is string => !!x).slice(0, 5);
}

function buildSample(s: SampleSpec): SampleProduct {
  const p = s.product;
  const placement = p.understanding!.placement;
  // the same defaults the studio starts from, so the replay's sliders match the saved hero
  const controls = quantise(defaultControls(placement, s.scene.dna, p.cutout));

  const alt = heroAlt(p, s.scene);
  const built = compositeUrl({ scenePublicId: s.scene.publicId, dna: s.scene.dna, cutout: p.cutout!, placement, controls, cloud: SHOWCASE_CLOUD });
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
    qa: s.qa,
  };

  const box = geometry(p.cutout!, s.scene.dna, controls, placement);
  const assets = channelAssets({
    heroPublicId: s.heroPublicId,
    cutoutPublicId: p.cutout!.publicId,
    alt,
    recolorPart: s.recolorPart,
    swatches: s.swatches,
    offer: s.offer,
    textZone: s.scene.dna.text_zone,
    productBox: box,
    cloud: SHOWCASE_CLOUD,
  }).map((a): KitAsset => {
    const pid = s.storedFormats[a.id];
    const recolor = a.id.startsWith("recolor-");
    const xray = recolor && "segments" in a.xray
      ? { ...a.xray, segments: a.xray.segments.map((g) => (g.kind === "gen-ai" ? { ...g, label: recolorExplain(p.understanding) } : g)) }
      : a.xray;
    return {
      ...a,
      xray,
      // AI formats show their stored copy: re-requesting the recipe would re-run (and re-bill) the AI step
      ...(pid ? { url: stored(pid), publicId: pid } : {}),
      ...(recolor
        ? { label: recolorLabel(a.id, p.understanding), alt: `${alt}, in ${swatchName(a.id.slice(8)).toLowerCase()}` }
        : {}),
    };
  });

  const reel = reelUrl({ images: reelClips(s.heroPublicId, assets), offer: s.offer, cloud: SHOWCASE_CLOUD });

  const kit: Kit = {
    sku: s.sku,
    product: p,
    mode: "exact",
    scene: s.scene,
    controls,
    hero,
    assets,
    reel: { url: reel.url, xray: reel, seconds: reel.seconds },
    cost: {
      generationCredits: 0, // Exact mode: no generation at all
      creditsSavedByReuse: s.scene.credits,
      aiVisionTokens: s.analyzeTokens + s.qaTokens,
      transformationsEstimate: 50 * (2 + s.swatches.length) + 6, // b_gen_fill ×2 + recolor at 50 each, plus plain crops
      bytesOriginal: p.rawBytes,
      bytesDelivered: 0, // filled in by the studio when it measures the delivered hero
      seconds: s.seconds,
    },
    createdAt: "2026-09-30T09:00:00+05:30",
  };

  return {
    sku: s.sku,
    title: s.title,
    blurb: s.blurb,
    listed: false, // no stored ZIP: the picker offers the seeded sneaker (same photo, full kit)
    product: p,
    scene: s.scene,
    controls,
    heroPublicId: s.heroPublicId,
    beforePublicId: s.beforePublicId,
    offer: s.offer,
    swatches: s.swatches,
    qa: s.qa,
    qaTokens: s.qaTokens,
    pace: s.pace,
    kit,
  };
}

// ─── Seeded kits (data/showcase.json) ─────────────────────────────────────────

/**
 * How each seeded kit appears in the studio's picker, in picker order. The
 * primary sample leads (it replays a real QA rejection and its automatic fix).
 * shsneakr is the same sample photo as the landing's sneaker on the same scene;
 * the picker offers it because, unlike the hand-built landing sneaker, its kit
 * has a stored ZIP. Titles are the canonical names (lib/claims.ts).
 */
const SEEDED_META: { sku: Sku; blurb: string; highlight?: string; listed: boolean }[] = [
  { sku: "shmessy1", blurb: "Mug, fruit bowl and towels behind it", highlight: "QA catches a floating bottle, then fixes it", listed: true },
  { sku: "shbottle", blurb: "On a kitchen counter", listed: true },
  { sku: "shtrail1", blurb: "Beside a house plant", listed: true },
  { sku: "shkurta1", blurb: "Laid flat on a patterned sheet", listed: true },
  { sku: "shsneakr", blurb: "On a marble floor", listed: true },
];

/** Offer lines as the pack wrote them onto the festive offer (its two l_text layers). */
function offerOf(k: Kit): { hindi: string; english: string } {
  const texts = (k.assets.find((a) => a.id === "offer")?.xray as { segments?: { kind: string; text: string }[] } | undefined)?.segments?.filter((s) => s.kind === "text") ?? [];
  const read = (t: string) => {
    const m = /^l_text:[^:]+:(.*?),co_/.exec(t);
    if (!m) return "";
    try {
      return decodeURIComponent(decodeURIComponent(m[1]));
    } catch {
      return "";
    }
  };
  const lines = texts.map((s) => read(s.text)).filter(Boolean);
  const hindi = lines.find((l) => /[ऀ-ॿ]/.test(l)) ?? "";
  const english = lines.find((l) => l !== hindi) ?? "";
  return { hindi, english };
}

/** What changed between two staging attempts, in the QA story's words ("We …"). */
function describeFix(from: { controls: CompositeControls; sceneTitle: string }, to: { controls: CompositeControls; sceneTitle: string }): string {
  if (from.sceneTitle !== to.sceneTitle) return `moved it to the ${to.sceneTitle} scene`;
  const a = from.controls;
  const b = to.controls;
  const parts: string[] = [];
  const dy = b.offsetY - a.offsetY;
  if (dy > 0) parts.push(`set it ${dy} px lower, onto the surface`);
  if (dy < 0) parts.push(`lifted it ${-dy} px`);
  if (a.contact !== b.contact) parts.push(b.contact ? "turned on the contact shadow" : "turned the contact shadow off");
  if (a.shadow !== b.shadow) parts.push(b.shadow ? "turned on the cast shadow" : "turned the cast shadow off");
  if (Math.abs(b.scale - a.scale) >= 0.01) parts.push(b.scale < a.scale ? "made it a little smaller" : "made it a little larger");
  if (b.offsetX !== a.offsetX) parts.push("re-centred it");
  return parts.length ? parts.join(" and ") : "re-staged it";
}

function qaStoryOf(k: ShowcaseKit): SampleQaStory | undefined {
  const first = k.attempts[0];
  const last = k.attempts[k.attempts.length - 1];
  if (!first || !last || first === last || first.qa.status !== "rejected" || last.qa.status !== "approved") return undefined;
  return {
    rejected: first.qa,
    rejectedUrl: first.url,
    rejectedControls: first.controls,
    caught: (first.qa.reasons[0] ?? "Something looked off.").split(/(?<=\.)\s/)[0],
    fix: describeFix(first, last),
    attempts: k.attempts.length,
  };
}

/**
 * The seed wrote AI Vision's generic reading ("Embroidered linen tunic") into the
 * product and every alt text; the site uses the canonical name everywhere.
 */
function renamed(k: ShowcaseKit): Pick<Kit, "product" | "hero" | "assets"> {
  const read = k.product.understanding?.name;
  const name = shortProductName(k.sku, read);
  const alt = (s: string) => (read && s.startsWith(read) ? name + s.slice(read.length) : s);
  return {
    product: k.product.understanding ? { ...k.product, understanding: { ...k.product.understanding, name } } : k.product,
    hero: { ...k.hero, alt: alt(k.hero.alt) },
    assets: k.assets.map((a) => ({ ...a, alt: alt(a.alt) })),
  };
}

function fromSeeded(k: ShowcaseKit, meta: (typeof SEEDED_META)[number]): SampleProduct {
  const last = k.attempts[k.attempts.length - 1];
  const qaTokens = k.attempts.reduce((n, a) => n + a.tokens, 0);
  const { product, hero, assets } = renamed(k);
  // a plain Kit: the seed's extras (timings, attempts, overrides) stay out of the props that reach the browser
  const kit: Kit = {
    sku: k.sku,
    product,
    mode: k.mode,
    scene: k.scene,
    controls: k.controls,
    hero,
    assets,
    reel: k.reel,
    zipUrl: k.zipUrl,
    cost: k.cost,
    createdAt: k.createdAt,
  };
  return {
    sku: k.sku,
    title: productName(k.sku, k.title),
    blurb: meta.blurb,
    highlight: meta.highlight,
    listed: meta.listed,
    product,
    scene: k.scene!,
    controls: k.controls!,
    heroPublicId: k.hero.publicId!,
    beforeUrl: SHOWCASE.beforeAfter.find((b) => b.sku === k.sku)?.rawAlignedUrl,
    offer: offerOf(k),
    swatches: k.assets.filter((a) => a.id.startsWith("recolor-")).map((a) => a.id.slice(8)),
    qa: k.hero.qa ?? last?.qa ?? QA_OK(k.createdAt),
    qaTokens,
    pace: { analyze: 1300, cutout: 1400, qa: 1200, pack: 2000 },
    kit,
    qaStory: qaStoryOf(k),
    timings: k.timings,
    analyzeTokens: Math.max(0, k.cost.aiVisionTokens - qaTokens),
  };
}

const SEEDED: SampleProduct[] = SEEDED_META.flatMap((m) => {
  const k = SHOWCASE.kits.find((x) => x.sku === m.sku);
  return k && k.scene && k.controls && k.hero.publicId && k.product.cutout ? [fromSeeded(k, m)] : [];
});

/** The landing's sneaker first (its before/after hero), then the seeded kits. */
export const SAMPLES: SampleProduct[] = [...SPECS.map(buildSample), ...SEEDED];

/**
 * The samples offered in the studio's picker, the primary sample first. The
 * landing's hand-built sneaker has no stored ZIP, so the picker offers the
 * seeded sneaker (same photo, full kit) instead; the other stays reachable by link.
 */
export const LISTED_SAMPLES = SAMPLES.filter((s) => s.listed).sort(
  (a, b) => Number(b.sku === PRIMARY_SAMPLE_SKU) - Number(a.sku === PRIMARY_SAMPLE_SKU),
);

export const getSample = (sku: string | null | undefined) => SAMPLES.find((s) => s.sku === sku);
export const isSampleSku = (sku: string | null | undefined) => !!getSample(sku);

export const SHOWCASE_KITS: Kit[] = SAMPLES.map((s) => s.kit);
/** The landing hero's before/after (and its how-it-works story) only. Its kit has no ZIP: link people to the two below. */
export const FEATURED = SAMPLES[0];
export const FEATURED_KIT = FEATURED.kit;
/** Every "Try a sample" entry point: it has a ZIP and replays QA catching a bad placement, the auto-fix and the approval. */
export const PRIMARY_SAMPLE = getSample(PRIMARY_SAMPLE_SKU) ?? FEATURED;
/** Every "See a finished kit" link. */
export const SHOWCASE_SAMPLE = getSample(SHOWCASE_KIT_SKU) ?? FEATURED;
export const getShowcaseKit = (sku: string) => SHOWCASE_KITS.find((k) => k.sku === sku);

// ─── Landing / page helpers ───────────────────────────────────────────────────

/** The saved hero at a given width (stored asset: cheap, cached, identical to the approved composite). */
export function heroAt(kit: Kit, w: number) {
  return kit.hero.publicId ? stored(kit.hero.publicId, w) : kit.hero.url;
}

/** The sample photo, aligned with the hero for the wipe slider (falls back to a 4:5 crop). */
export function beforeAt(s: SampleProduct, w: number) {
  const px = snapWidth(w);
  if (s.beforePublicId) return stored(s.beforePublicId, px);
  if (s.beforeUrl?.includes("/f_auto,q_auto/")) return s.beforeUrl.replace("/f_auto,q_auto/", `/c_scale,w_${px}/f_auto,q_auto/`);
  if (s.beforeUrl) return s.beforeUrl;
  return rawAt(s.product, px);
}

/** The sample photo as taken (4:5 crop for tiles). */
export function rawAt(p: Pick<ProductRecord, "rawPublicId">, w: number) {
  return `${deliveryBase(SHOWCASE_CLOUD)}/c_fill,ar_4:5,g_auto,w_${snapWidth(w)}/f_auto,q_auto/${p.rawPublicId}`;
}

/** Tiny blurred placeholder of a stored image (≈1 KB), painted under the real one. */
export const lqipOf = (publicId: string) => `${deliveryBase(SHOWCASE_CLOUD)}/c_limit,w_32/e_blur:600,q_30/f_auto/${publicId}`;

export const heroLqip = (kit: Kit) => lqipOf(kit.hero.publicId ?? kit.scene?.publicId ?? kit.product.rawPublicId);

/** Link-preview image for the whole site: three sample heroes as cards under the name (a fixed trio, so the card stays one cached derivative). */
export function siteOgImage() {
  const heroes = ["sneaker1", "shbottle", "shtrail1"].flatMap((sku) => getSample(sku)?.heroPublicId ?? []);
  return ogUrl({ heroes, shopName: "Snap2Shelf", tagline: "One photo. A whole shelf.", cloud: SHOWCASE_CLOUD }).url;
}
