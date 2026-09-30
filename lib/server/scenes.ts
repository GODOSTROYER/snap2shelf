import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { SceneMatch } from "../api-contract";
import type { CloudinaryAccount } from "../cloudinary/accounts";
import { copyToMain } from "../cloudinary/copy";
import { getGenerationTask, startGeneration, type GenerateRequest, type GeneratedAsset, type GenerationOutcome } from "../cloudinary/generate";
import { withPooledAccount } from "../cloudinary/pool";
import { parseJsonAnswer, visionGeneral, visionTagging, type TagDefinition } from "../cloudinary/vision";
import { detectFestival } from "../festivals";
import { SCENE_RECIPES, sceneDnaPrompt } from "../scene-prompts";
import { SCENE_TAG, sceneFromListResource, sceneListUrl, sceneToContext } from "../scenes";
import { PLATE, SCENE_ROOT, SCENE_THEMES, type QaResult, type Scene, type SceneDNA, type SceneTier, type SceneView } from "../types";
import { addContext, addTags, deliveryUrl, getResource, mainCloud, type AssetInfo } from "./cld";

/**
 * Scene library core, shared by scripts/seed-scenes.mts (blocking, many plates)
 * and the on-demand routes (POST /api/scenes/generate → GET /api/scene-jobs/:job).
 *
 *   generate (pinned model, key pool) → copy into main as the canonical 1080x1350
 *   plate → Scene DNA (AI Vision General) + scene QA (AI Vision tagging) →
 *   context + the `s2s-scene` tag (only when QA approves).
 *
 * Every plate's public_id is snap2shelf/scenes/<theme>/<tier>-<hash8>, where the
 * hash covers prompt + tier + seed: the same request always maps to the same id,
 * which is what makes reuse (C2) a lookup instead of a generation.
 */

/** Pinned model ids: mode:auto is NOT cost-stable (SPIKES.md §1). Credits are the documented per-image cost. */
export const SCENE_TIERS: Record<SceneTier, { model: string; credits: number }> = {
  draft: { model: "flux-2-flash", credits: 1 },
  final: { model: "gpt-image-2.5-flare", credits: 5 },
};
export const SCENE_SEED = 42;

export const dnaSchema = z.object({
  anchor_x: z.coerce.number().min(0).max(1),
  anchor_y: z.coerce.number().min(0).max(1),
  surface_width: z.coerce.number().min(0).max(1),
  light_azimuth: z.coerce.number().min(0).max(360),
  light_elevation: z.coerce.number().min(0).max(90),
  temperature: z.enum(["warm", "neutral", "cool"]),
  glossy: z.boolean(),
  text_zone: z.enum(["top", "bottom", "left", "right", "top_left", "top_right", "none"]),
});

/** An "empty" plate must not contain a product, text or people. */
export const SCENE_QA_TAGS: TagDefinition[] = [
  { name: "contains-product", description: "A sellable item is present: a garment, bottle, package, shoe, box, jar or any product (decorations like flowers, lamps or pots do not count)." },
  { name: "contains-text", description: "Letters, words, numbers or logos are visible." },
  { name: "contains-person", description: "A person, face or hand is visible." },
];
const SCENE_QA_REASONS: Record<string, string> = {
  "contains-product": "The backdrop already contains a product.",
  "contains-text": "The backdrop contains text or a logo.",
  "contains-person": "The backdrop contains a person or a hand.",
};

// ------------------------------------------------------------------ specs + prompt hash (pure)

export interface SceneSpec {
  theme: string; // folder + theme context (SCENE_THEMES slug, or "custom")
  view: SceneView;
  title: string;
  tier: SceneTier;
  seed: number;
  text: string; // user backdrop text ("" = the theme's library recipe)
  prompt: string; // full generation prompt
}

const NEGATIVE = "No products, no bottles, no packaging, no people, no hands, no text, no letters, no logos, no brand names.";

/** Canonical form of a user backdrop description (also what the prompt hash sees). */
export function cleanSceneText(s: string | undefined | null): string {
  return (s ?? "")
    .replace(/[\u0000-\u001f\u007f<>{}\\`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!\s]+$/, "")
    .toLowerCase()
    .slice(0, 300);
}

/** Same camera recipes as lib/scene-prompts.ts, around a free-text backdrop description. */
export function customScenePrompt(text: string, view: SceneView): string {
  return view === "top-down"
    ? `Photorealistic top-down flat-lay product-photography background, camera directly overhead looking straight down. Scene: ${text}. ` +
        `Props only along the outer edges; the central 60% of the frame is completely empty for laying a folded garment. ${NEGATIVE}`
    : `Photorealistic empty product-photography backdrop, professional commercial photo. Camera at eye level, about 15 degrees above the surface. Scene: ${text}. ` +
        `The surface fills the lower 40% of the frame and its centre foreground is completely empty and clear for placing a product. ` +
        `Background softly out of focus with shallow depth of field. ${NEGATIVE}`;
}

export const sceneHash = (prompt: string, tier: SceneTier, seed: number) =>
  createHash("sha1").update(`${prompt}|${tier}|${seed}`).digest("hex").slice(0, 8);

export const scenePublicId = (s: Pick<SceneSpec, "theme" | "tier" | "prompt" | "seed">) => `${SCENE_ROOT}/${s.theme}/${s.tier}-${sceneHash(s.prompt, s.tier, s.seed)}`;

const THEME_VIEW = new Map<string, SceneView>(SCENE_THEMES.map((t) => [t.slug, t.view]));

/** Library label from a backdrop description: its first clause, whole words, ≤ 40 chars. */
export function titleFrom(text: string): string {
  const clause = text.split(/[,;:.]/)[0].trim() || text;
  let t = "";
  for (const w of clause.split(" ").slice(0, 6)) {
    if ((t ? t.length + 1 : 0) + w.length > 40) break;
    t = t ? `${t} ${w}` : w;
  }
  t = t || clause.slice(0, 40);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * The spec for a request: a theme alone is that theme's library recipe (same
 * hash as scripts/seed-scenes.mts, so it is found and reused); a prompt is a
 * custom backdrop filed under the theme (or "custom").
 */
export function sceneSpec(req: { theme?: string; prompt?: string; view?: SceneView; tier: SceneTier; seed?: number }): SceneSpec | null {
  const seed = req.seed ?? SCENE_SEED;
  const text = cleanSceneText(req.prompt);
  if (!text) {
    const recipe = SCENE_RECIPES.find((r) => r.theme === req.theme);
    if (!recipe) return null;
    return { theme: recipe.theme, view: recipe.view, title: recipe.title, tier: req.tier, seed, text: "", prompt: recipe.prompt };
  }
  if (text.length < 8) return null;
  const theme = req.theme && THEME_VIEW.has(req.theme) ? req.theme : "custom";
  const view = req.view ?? THEME_VIEW.get(theme) ?? "eye-level";
  return { theme, view, title: titleFrom(text), tier: req.tier, seed, text, prompt: customScenePrompt(text, view) };
}

/** Scene generation request (text_to_image). The temporary target is per prompt hash, so parallel jobs never collide. */
export function sceneGenerateRequest(spec: SceneSpec): GenerateRequest {
  return {
    prompt: spec.prompt,
    model: { id: SCENE_TIERS[spec.tier].model },
    image_size: { aspect_ratio: "3:4", resolution: "1K" },
    seed: spec.seed,
    async: true,
    target: { target_type: "managed_asset", public_id: `snap2shelf/gen/scenes/${spec.theme}-${spec.tier}-${sceneHash(spec.prompt, spec.tier, spec.seed)}` },
  };
}

export const sceneXrayRequest = (spec: SceneSpec) => ({ endpoint: "POST /v2/generate/{cloud}/text_to_image", body: sceneGenerateRequest(spec) });

// ------------------------------------------------------------------ library state

type ListResource = Parameters<typeof sceneFromListResource>[0];

/** Approved library scenes from the client-side list JSON (CDN-cached ~60 s; no Admin API). */
export async function libraryScenes(): Promise<Scene[]> {
  const res = await fetch(sceneListUrl(mainCloud(), SCENE_TAG), { next: { revalidate: 60 } } as RequestInit);
  if (res.status === 404) return []; // no asset carries the tag yet
  if (!res.ok) throw new Error(`scene list HTTP ${res.status}`);
  const json = (await res.json()) as { resources?: ListResource[] };
  return (json.resources ?? []).map(sceneFromListResource).filter((s): s is Scene => s !== null);
}

export const sceneFromAsset = (a: AssetInfo): Scene | null => sceneFromListResource({ public_id: a.publicId, context: { custom: a.context } });

export type PlateState =
  | { kind: "missing" }
  | { kind: "ready"; scene: Scene }
  | { kind: "rejected"; matched: string[]; asset: AssetInfo }
  | { kind: "unanalysed"; asset: AssetInfo };

/** Where a plate id stands, from the Admin API (exact and immediate, unlike the cached list). */
export async function plateState(publicId: string): Promise<PlateState> {
  const a = await getResource(publicId);
  if (!a) return { kind: "missing" };
  if (a.tags.includes("s2s-scene-rejected")) return { kind: "rejected", matched: (a.context.qa_matched ?? "").split(",").filter(Boolean), asset: a };
  const scene = sceneFromAsset(a);
  if (scene && a.tags.includes(SCENE_TAG)) return { kind: "ready", scene };
  return { kind: "unanalysed", asset: a };
}

// ------------------------------------------------------------------ pipeline steps

/** Start a generation on the key pool (async task). */
export async function startScene(spec: SceneSpec): Promise<{ outcome: GenerationOutcome; account: CloudinaryAccount }> {
  const { result, account } = await withPooledAccount("image_generation", (a) => startGeneration(a, "text_to_image", sceneGenerateRequest(spec)), {
    cost: SCENE_TIERS[spec.tier].credits,
  });
  return { outcome: result, account };
}

export interface PlateMeta {
  modelId: string;
  credits: number;
  origin: "seed" | "on-demand";
  sku?: string;
}

/** Copy a finished generation into main as the canonical 1080x1350 plate (not in the library until QA approves). */
export async function copyPlate(account: CloudinaryAccount, asset: GeneratedAsset, spec: SceneSpec, meta: PlateMeta): Promise<{ publicId: string; secureUrl: string }> {
  const publicId = scenePublicId(spec);
  const plate = await copyToMain(
    account,
    { secure_url: asset.storage.secure_url }, // always upload: the incoming c_fill makes the canonical plate
    {
      public_id: publicId,
      transformation: [{ width: PLATE.width, height: PLATE.height, crop: "fill", gravity: "center" }],
      tags: ["s2s", `s2s-theme-${spec.theme}`, `s2s-view-${spec.view}`, `s2s-tier-${spec.tier}`],
      context: {
        theme: spec.theme,
        view: spec.view,
        title: spec.title,
        model: meta.modelId,
        credits: String(meta.credits),
        origin: meta.origin,
        ...(meta.sku ? { sku: meta.sku } : {}),
      },
    },
  );
  return { publicId: plate.public_id, secureUrl: plate.secure_url };
}

export interface PlateVerdict {
  dna: SceneDNA;
  qa: QaResult;
  tokens: number;
}

export function decideSceneQa(matched: string[]): QaResult {
  const reasons = matched.map((t) => SCENE_QA_REASONS[t]).filter(Boolean);
  return { status: reasons.length ? "rejected" : "approved", matched, reasons, checkedAt: new Date().toISOString() };
}

/** Scene DNA + scene QA on the canonical plate, in parallel (~1.2k AI Vision tokens). */
export async function analysePlate(publicId: string, view: SceneView): Promise<PlateVerdict> {
  const uri = deliveryUrl(publicId, "c_limit,w_768/f_jpg,q_80");
  const [dnaRes, qaRes] = await Promise.all([
    withPooledAccount("ai_vision", (a) => visionGeneral(a, { uri }, [sceneDnaPrompt(view)])),
    withPooledAccount("ai_vision", (a) => visionTagging(a, { uri }, SCENE_QA_TAGS)),
  ]);
  const dna = parseJsonAnswer(dnaRes.result.answers[0] ?? "", dnaSchema);
  if (!dna) throw new Error(`Scene DNA not parseable for ${publicId}`);
  return {
    dna,
    qa: decideSceneQa(qaRes.result.matched),
    tokens: (dnaRes.result.quota?.usedByRequest ?? 0) + (qaRes.result.quota?.usedByRequest ?? 0),
  };
}

/** Write DNA + provenance into context; only an approved plate joins the library (`s2s-scene`). */
export async function commitPlate(publicId: string, spec: SceneSpec, meta: PlateMeta, v: PlateVerdict): Promise<Scene> {
  const scene: Scene = { publicId, theme: spec.theme, view: spec.view, title: spec.title, prompt: spec.prompt, modelId: meta.modelId, credits: meta.credits, dna: v.dna };
  await addContext([publicId], {
    ...sceneToContext(scene),
    origin: meta.origin,
    qa_status: v.qa.status,
    qa_matched: v.qa.matched.join(","),
    qa_tokens: String(v.tokens),
  });
  await addTags([publicId], [v.qa.status === "approved" ? SCENE_TAG : "s2s-scene-rejected"]);
  return scene;
}

export interface BlockingResult {
  publicId: string;
  scene: Scene;
  verdict: PlateVerdict;
  modelId: string;
  credits: number;
  remaining: number | null;
  accountLabel: string; // local logs only; never sent to a client
  genMs: number;
  totalMs: number;
}

/** Start → poll → copy → analyse → commit, in one call (scripts; not for routes). */
export async function generateSceneBlocking(spec: SceneSpec, opts: { pollMs?: number; origin?: PlateMeta["origin"] } = {}): Promise<BlockingResult> {
  const t0 = Date.now();
  const { result: gen, account } = await withPooledAccount(
    "image_generation",
    async (a) => {
      const started = await startGeneration(a, "text_to_image", sceneGenerateRequest(spec));
      let o = started;
      while (o.status === "pending" || o.status === "processing") {
        await new Promise((r) => setTimeout(r, opts.pollMs ?? 2000));
        o = await getGenerationTask(a, started.taskId!);
      }
      if (o.status !== "completed" || !o.assets[0]) throw new Error(`generation ${o.status}: ${o.error ?? ""}`);
      return { asset: o.assets[0], quota: o.quota ?? started.quota };
    },
    { cost: SCENE_TIERS[spec.tier].credits },
  );
  const genMs = Date.now() - t0;
  const meta: PlateMeta = {
    modelId: gen.asset.model?.id ?? SCENE_TIERS[spec.tier].model,
    credits: gen.quota?.usedByRequest ?? SCENE_TIERS[spec.tier].credits,
    origin: opts.origin ?? "seed",
  };
  const { publicId } = await copyPlate(account, gen.asset, spec, meta);
  const verdict = await analysePlate(publicId, spec.view);
  const scene = await commitPlate(publicId, spec, meta, verdict);
  return {
    publicId,
    scene,
    verdict,
    modelId: meta.modelId,
    credits: meta.credits,
    remaining: gen.quota?.remaining ?? null,
    accountLabel: account.label,
    genMs,
    totalMs: Date.now() - t0,
  };
}

// ------------------------------------------------------------------ matching (pure)

const STOP = new Set(
  "a an and the of on in at to for with from by or no not any its it is are be as into onto over under near very some few one two this that these those only just like our my your their them each whole please make want need".split(
    " ",
  ),
);

export function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-zà-ÿ]+/g) ?? [])
    .filter((w) => w.length >= 3 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("es") && !w.endsWith("ses") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

const WARM = /\b(?:warm|cozy|cosy|festive|golden|diwali|candle|diyas?|evening|sunset)\b/;
const COOL = /\b(?:cool|fresh|clean|crisp|morning|minimal|bright|airy)\b/;

/**
 * Rank library scenes for a theme and/or free text. Keyword weight is IDF over
 * the library, so words every recipe shares ("backdrop", "surface", "light") count
 * for nothing and distinctive ones ("brass", "marigold", "marble") decide.
 */
export function rankScenes(scenes: Scene[], q: { theme?: string; text?: string; view?: SceneView }, limit = 6): SceneMatch[] {
  const pool = q.view ? scenes.filter((s) => s.view === q.view) : scenes;
  const docs = pool.map((s) => new Set(tokens(`${s.title} ${s.theme.replace(/-/g, " ")} ${s.prompt}`)));
  const n = Math.max(1, docs.length);
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d) df.set(t, (df.get(t) ?? 0) + 1);
  const text = (q.text ?? "").toLowerCase();
  const qTokens = [...new Set(tokens(text))];
  const festival = text ? detectFestival(text) : null;

  const scored = pool.map((scene, i) => {
    let score = 0;
    const reasons: string[] = [];
    if (q.theme && scene.theme === q.theme) {
      score += 6;
      reasons.push(`theme ${scene.theme}`);
    }
    if (festival && (festival.theme === scene.theme || festival.flatlayTheme === scene.theme)) {
      score += 3;
      reasons.push(`${festival.label} theme`);
    }
    const hits = qTokens.filter((t) => docs[i].has(t));
    const kw = hits.reduce((sum, t) => sum + Math.log(n / (df.get(t) ?? n)), 0);
    if (kw > 0) {
      score += 2 * kw;
      reasons.push(`matches ${hits.filter((t) => (df.get(t) ?? n) < n).slice(0, 4).join(", ")}`);
    }
    if (WARM.test(text) && scene.dna.temperature === "warm") {
      score += 1;
      reasons.push("warm light");
    } else if (COOL.test(text) && scene.dna.temperature !== "warm") {
      score += 1;
      reasons.push("cool light");
    }
    const final = /\/final-[a-f0-9]{8}$/.test(scene.publicId);
    if (final) score += 0.5;
    return { scene, score: Math.round(score * 100) / 100, reasons, final };
  });
  return scored
    .sort((a, b) => b.score - a.score || Number(b.final) - Number(a.final) || a.scene.title.localeCompare(b.scene.title))
    .slice(0, limit)
    .map(({ scene, score, reasons }) => ({ scene, score, reasons }));
}
