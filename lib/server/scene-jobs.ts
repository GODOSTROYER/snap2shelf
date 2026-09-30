import "server-only";
import type { SceneGenerateResponse, SceneJobResponse } from "../api-contract";
import { getAccounts } from "../cloudinary/accounts";
import { getGenerationTask } from "../cloudinary/generate";
import type { Scene, SceneTier, SceneView, Sku } from "../types";
import { assertLivePipeline } from "./budget";
import { updateProduct } from "./facts";
import { HttpError, badRequest } from "./http";
import { encodeSceneJob, type SceneJobClaims } from "./scene-job-token";
import {
  SCENE_TIERS,
  analysePlate,
  commitPlate,
  copyPlate,
  libraryScenes,
  plateState,
  scenePublicId,
  sceneSpec,
  sceneXrayRequest,
  startScene,
  type PlateMeta,
  type SceneSpec,
} from "./scenes";
import { generationsLeft, liveGenerationEnabled, type Session } from "./session";

/**
 * C1 + C2: on-demand scenes with reuse.
 * requestScene()  reuse first (prompt-hash id already in the library → 0 credits),
 *                 otherwise gate + start a pinned-model job and seal a token.
 * pollSceneJob()  one step per poll, each well under 10 s:
 *                 task running → copy the result into main as the canonical plate →
 *                 Scene DNA + scene QA → commit (library tag only when approved).
 */

export interface SceneRequestInput {
  theme?: string;
  prompt?: string;
  view?: SceneView;
  tier: SceneTier;
  sku?: Sku;
}

const REJECTED_MSG = "An earlier try at this exact backdrop failed the scene check (it showed a product, text or a person). Reword the description.";

/** Credits bookkeeping in the product's facts (and raw context), for GET /api/cost/:sku. Never fails the request. */
async function recordForSku(sku: Sku | undefined, ctx: Record<string, string>): Promise<void> {
  if (!sku) return;
  try {
    await updateProduct(sku, { ctx }, { critical: false });
  } catch (err) {
    console.error(`[scenes] cost bookkeeping skipped: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
  }
}

async function reused(scene: Scene, sku?: Sku): Promise<SceneGenerateResponse> {
  await recordForSku(sku, { sc_id: scene.publicId, sc_saved: String(scene.credits) });
  return { reused: true, scene, credits: 0, creditsSaved: scene.credits };
}

function metaFromContext(c: Record<string, string>, spec: SceneSpec): PlateMeta {
  const credits = Number(c.credits);
  return {
    modelId: c.model || SCENE_TIERS[spec.tier].model,
    credits: Number.isFinite(credits) && c.credits ? credits : SCENE_TIERS[spec.tier].credits,
    origin: "on-demand",
    sku: c.sku || undefined,
  };
}

export async function requestScene(input: SceneRequestInput, session: Session): Promise<{ response: SceneGenerateResponse; started: boolean }> {
  const spec = sceneSpec(input);
  if (!spec) throw badRequest("Pick a scene theme or describe the backdrop (at least 8 characters).");
  const publicId = scenePublicId(spec);

  // C2, cheapest path: the cached client-side list (no Admin API), open to any session.
  const library = await libraryScenes().catch(() => [] as Scene[]);
  const hit = library.find((s) => s.publicId === publicId);
  if (hit) return { response: await reused(hit, input.sku), started: false };

  if (!session.u) throw new HttpError(403, "locked", "Enter the demo access code to generate a new scene.");

  // The list lags ~60 s behind: ask the Admin API for the exact state before paying.
  const state = await plateState(publicId);
  if (state.kind === "ready") return { response: await reused(state.scene, input.sku), started: false };
  if (state.kind === "rejected") throw new HttpError(409, "bad_request", REJECTED_MSG);
  if (state.kind === "unanalysed") {
    // A job was abandoned after its copy step: finish it (AI Vision only, no new generation).
    const meta = metaFromContext(state.asset.context, spec);
    const verdict = await analysePlate(publicId, spec.view);
    const scene = await commitPlate(publicId, spec, meta, verdict);
    if (verdict.qa.status !== "approved") throw new HttpError(409, "bad_request", REJECTED_MSG);
    return { response: await reused(scene, input.sku), started: false };
  }

  if (generationsLeft(session) <= 0) throw new HttpError(429, "cap_reached", "You've used this session's live generations. Pick a library scene instead.");
  const live = await liveGenerationEnabled();
  if (!live.enabled) throw new HttpError(503, "quota_low", "Live generation is paused to save quota. Pick a library scene instead.");
  // A new plate is uploaded with an incoming transformation and analysed through a derivative.
  await assertLivePipeline();

  const { outcome, account } = await startScene(spec);
  if (!outcome.taskId) throw new HttpError(502, "upstream", "The generation service answered unexpectedly. Please try again.");
  const job = encodeSceneJob({
    a: account.label,
    t: outcome.taskId,
    th: spec.theme,
    vw: spec.view,
    ti: spec.tier,
    x: spec.text,
    seed: spec.seed,
    id: publicId,
    sku: input.sku,
    sid: session.sid,
    iat: Date.now(),
  });
  return {
    response: { reused: false, job, tier: spec.tier, modelId: SCENE_TIERS[spec.tier].model, estimatedCredits: SCENE_TIERS[spec.tier].credits },
    started: true,
  };
}

/** Rebuild the spec from a token; null if it no longer maps to the same plate id. */
export function specFromClaims(c: SceneJobClaims): SceneSpec | null {
  const spec = sceneSpec({ theme: c.th, prompt: c.x || undefined, view: c.vw, tier: c.ti, seed: c.seed });
  return spec && scenePublicId(spec) === c.id ? spec : null;
}

export async function pollSceneJob(claims: SceneJobClaims): Promise<SceneJobResponse & { tokens?: number }> {
  const spec = specFromClaims(claims);
  const account = getAccounts().find((a) => a.label === claims.a);
  if (!spec || !account) return { status: "failed", error: "This scene job can no longer be found." };
  const request = sceneXrayRequest(spec);

  let task: Awaited<ReturnType<typeof getGenerationTask>> | null = null;
  try {
    task = await getGenerationTask(account, claims.t);
  } catch (err) {
    // Tasks expire eventually; a finished plate is still answered from main below.
    console.error(`[scene-jobs] task lookup failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
  }
  if (task && (task.status === "pending" || task.status === "processing")) return { status: task.status, request };

  const state = await plateState(claims.id);
  if (state.kind === "ready") {
    return { status: "completed", scene: state.scene, credits: state.scene.credits, request, qa: { status: "approved", matched: [], reasons: [] } };
  }
  if (state.kind === "rejected") {
    return {
      status: "failed",
      credits: Number(state.asset.context.credits ?? SCENE_TIERS[spec.tier].credits),
      qa: { status: "rejected", matched: state.matched, reasons: state.matched.map((m) => `Scene check: ${m.replace(/-/g, " ")}`) },
      request,
      error: "The new backdrop showed a product, text or a person, so it was kept out of the library.",
    };
  }

  if (state.kind === "unanalysed") {
    const meta = metaFromContext(state.asset.context, spec);
    const verdict = await analysePlate(claims.id, spec.view);
    const scene = await commitPlate(claims.id, spec, meta, verdict);
    const latencyMs = Date.now() - claims.iat;
    await recordForSku(claims.sku, { sc_id: claims.id, sc_spent: String(meta.credits), ms_scene: String(latencyMs), t_scene: String(verdict.tokens) });
    if (verdict.qa.status !== "approved") {
      return { status: "failed", credits: meta.credits, latencyMs, qa: verdict.qa, request, tokens: verdict.tokens, error: "The new backdrop showed a product, text or a person, so it was kept out of the library." };
    }
    return { status: "completed", scene, credits: meta.credits, latencyMs, qa: verdict.qa, request, tokens: verdict.tokens };
  }

  // Plate not in main yet.
  if (!task || task.status === "failed" || !task.assets[0]) {
    if (task) console.error(`[scene-jobs] generation failed: ${(task.error ?? "no asset").slice(0, 200)}`);
    return { status: "failed", error: "The AI couldn't generate this backdrop. Try rewording it.", request };
  }
  const gen = task.assets[0];
  const meta: PlateMeta = {
    modelId: gen.model?.id ?? SCENE_TIERS[spec.tier].model,
    credits: task.quota?.usedByRequest ?? SCENE_TIERS[spec.tier].credits,
    origin: "on-demand",
    sku: claims.sku,
  };
  await copyPlate(account, gen, spec, meta);
  // Scene DNA + QA run on the next poll, keeping each request short.
  return { status: "processing", request };
}

