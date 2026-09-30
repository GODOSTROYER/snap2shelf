/**
 * Demo answers for every route in lib/api-contract.ts, used when
 * NEXT_PUBLIC_S2S_MOCK=1 or when a route isn't deployed yet.
 * Wherever possible the answers are still real Cloudinary data: scenes come from
 * the public tag list, pack assets are real transformation URLs on a saved hero.
 */
import type {
  AccessResponse,
  AnalyzeResponse,
  CutoutResponse,
  GenerateRequest,
  GenerateResponse,
  JobResponse,
  PackRequest,
  PackResponse,
  PackStatusResponse,
  QaRequest,
  QaResponse,
  UsageResponse,
} from "../api-contract";
import { sceneFromListResource, sceneListUrl, SCENE_TAG } from "../scenes";
import { CREATIVE_APPROVED, CREATIVE_MODELS, CREATIVE_REJECTED, FEATURED_KIT, getSample, SAMPLES, SHOWCASE_CLOUD, heroAlt } from "../showcase";
import { channelAssets } from "../transform/channels";
import { SCENE_ROOT, type KitAsset, type Scene, type SceneView, type Sku } from "../types";
import { ApiFailure } from "./errors";
import { recolorLabel } from "./swatches";

export async function analyze(sku: Sku): Promise<AnalyzeResponse> {
  return {
    sku,
    caption: "Your product photo",
    focus: null,
    understanding: {
      name: "Your product",
      category: "product",
      primary_color: "",
      material: "",
      recolorable_part: "product",
      placement: "standing",
      suggested_themes: ["marble", "diwali"],
    },
    fixes: { applied: [] },
    tokens: 0,
  };
}

export async function cutout(sku: Sku): Promise<CutoutResponse> {
  void sku;
  throw new ApiFailure(503, {
    error: "Background removal isn't connected on this deployment yet. Try the sample product to see the whole flow.",
    code: "upstream",
  });
}

// ─── scenes: the real library, straight from Cloudinary's public tag list ────

interface ListJson {
  resources?: { public_id: string; context?: { custom?: Record<string, string> } }[];
}

let sceneCache: Promise<Scene[]> | null = null;

async function loadList(tag: string): Promise<ListJson["resources"]> {
  const res = await fetch(sceneListUrl(SHOWCASE_CLOUD, tag));
  if (!res.ok) return [];
  return ((await res.json()) as ListJson).resources ?? [];
}

async function allScenes(): Promise<Scene[]> {
  let list = await loadList(SCENE_TAG).catch(() => []);
  if (!list?.length) list = (await loadList("s2s").catch(() => [])) ?? [];
  const parsed = list
    .filter((r) => r.public_id.startsWith(`${SCENE_ROOT}/`))
    .map(sceneFromListResource)
    .filter((s): s is Scene => !!s);
  // One plate per theme: the final render if there is one.
  const byTheme = new Map<string, Scene>();
  for (const s of parsed) {
    const prev = byTheme.get(s.theme);
    if (!prev || (!prev.publicId.includes("/final-") && s.publicId.includes("/final-"))) byTheme.set(s.theme, s);
  }
  const showcase = SAMPLES.map((x) => x.scene);
  return [...showcase, ...byTheme.values()];
}

export async function scenes(view: SceneView): Promise<Scene[]> {
  sceneCache ??= allScenes().catch(() => SAMPLES.map((x) => x.scene));
  const all = await sceneCache;
  return all.filter((s) => s.view === view);
}

// ─── QA ───────────────────────────────────────────────────────────────────────

export async function qa(req: QaRequest): Promise<QaResponse> {
  await new Promise((r) => setTimeout(r, 900));
  return {
    qa: {
      status: "approved",
      matched: ["product-visible"],
      reasons: req.kind === "exact" ? ["Your real product pixels, untouched", "Product fully visible"] : ["Same product as your photo"],
      checkedAt: new Date().toISOString(),
    },
    tokens: 0,
  };
}

// ─── pack: real channel URLs on the sample's saved hero ───────────────────────

const packs = new Map<Sku, PackStatusResponse>();

export async function pack(req: PackRequest): Promise<PackResponse> {
  const s = getSample(req.sku) ?? SAMPLES[0];
  const alt = heroAlt(s.product, s.scene);
  const assets: KitAsset[] = channelAssets({
    heroPublicId: s.heroPublicId,
    cutoutPublicId: s.product.cutout!.publicId,
    alt,
    recolorPart: s.product.understanding?.recolorable_part,
    swatches: req.recolor ?? s.swatches,
    offer: req.offer ?? s.offer,
    textZone: s.scene.dna.text_zone,
    cloud: SHOWCASE_CLOUD,
  }).map((a) => (a.id.startsWith("recolor-") ? { ...a, label: recolorLabel(a.id) } : a));
  packs.set(req.sku, { assets, pending: [] });
  return { sku: req.sku, heroPublicId: s.heroPublicId, assets, pending: [] };
}

export async function packStatus(sku: Sku): Promise<PackStatusResponse> {
  return packs.get(sku) ?? { assets: FEATURED_KIT.assets.filter((a) => !a.id.startsWith("creative")), pending: [] };
}

// ─── creative ─────────────────────────────────────────────────────────────────

export async function access(code: string): Promise<AccessResponse> {
  await new Promise((r) => setTimeout(r, 500));
  if (code.trim().length < 4) {
    throw new ApiFailure(401, { error: "That code didn't work. Check it and try again.", code: "locked" });
  }
  return { ok: true, generationsLeft: 4 };
}

export const isMockJob = (token: string) => token.startsWith("mock_");

export async function generate(req: GenerateRequest): Promise<GenerateResponse> {
  return { job: `mock_${req.model}_${req.seed}_${Date.now()}` };
}

export async function job(token: string): Promise<JobResponse> {
  const [, model, seed, started] = token.split("_");
  const spec = CREATIVE_MODELS.find((m) => m.id === model) ?? CREATIVE_MODELS[0];
  const elapsed = Date.now() - Number(started);
  const takes = spec.seconds * 700; // a little quicker than live
  if (elapsed < 1500) return { status: "pending", modelId: spec.id };
  if (elapsed < takes) return { status: "processing", modelId: spec.id };
  const base = spec.id === "flux-2-flash-edit" ? CREATIVE_REJECTED : CREATIVE_APPROVED;
  return {
    status: "completed",
    modelId: spec.id,
    credits: spec.credits,
    latencyMs: takes,
    asset: { ...base, id: `${base.id}-${seed}` },
    request: base.xray,
  };
}

export async function usage(): Promise<UsageResponse> {
  return {
    generation: { remaining: 30, limit: 50, usable: 30 },
    vision: { remaining: 90_000, limit: 100_000, usable: 90_000 },
    liveGeneration: true,
    session: { unlocked: false, generationsLeft: 4 },
  };
}
