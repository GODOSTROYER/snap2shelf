import "server-only";
import type { JobResponse } from "../api-contract";
import { getAccounts } from "../cloudinary/accounts";
import { copyToMain } from "../cloudinary/copy";
import { getGenerationTask, startGeneration, type GenerateRequest as CldGenerateRequest } from "../cloudinary/generate";
import { withPooledAccount } from "../cloudinary/pool";
import { PLATE, productId, type KitAsset, type Sku } from "../types";
import { addContext, addTags, deliveryUrl, getResource } from "./cld";
import { GENERATION_MODELS } from "./config";
import { HttpError, badRequest, notFound } from "./http";
import { encodeJob, type JobClaims } from "./job-token";
import { fidelityQa, qaFromContext, qaToContext } from "./qa";
import { getCutout, rawId, skuTag } from "./products";

/**
 * Creative mode: image_to_image on the key pool with the real cutout as
 * reference [1], then copy into main + fidelity QA. Start returns an opaque
 * job token; the client polls GET /api/jobs/:job (sequentially, ~every 2 s).
 */

export const creativeId = (sku: Sku, model: string, seed: number) => productId(sku, `creative-${model}-${seed}`);

const FIDELITY_WRAP = (scene: string) =>
  "Professional e-commerce lifestyle photograph of the EXACT product shown in reference image [1]. " +
  `Scene: ${scene}. ` +
  "The product must stay IDENTICAL to [1]: same shape, proportions, colours, materials, finish, logos, text and every detail. " +
  "Do not redesign, restyle, recolour, add or remove any part of the product, and show exactly one product, whole and in focus. " +
  "Place it naturally on a surface with realistic contact shadow and lighting that matches the scene. Photorealistic, no added text, no watermark, no people.";

const DEFAULT_SCENE = "a warm, softly lit tabletop styled for a festive Indian home, shallow depth of field";

/** Strip control characters and anything that tries to address the model outside the scene description. */
export function cleanScenePrompt(p: string | undefined): string {
  const s = (p ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  return s || DEFAULT_SCENE;
}

export function buildCreativeRequest(sku: Sku, cutoutUrl: string, model: string, seed: number, userPrompt: string): CldGenerateRequest {
  return {
    prompt: FIDELITY_WRAP(cleanScenePrompt(userPrompt)),
    model: { id: model },
    image_size: { aspect_ratio: "3:4", resolution: "1K" },
    seed,
    async: true,
    reference_images: [{ source_type: "url", url: cutoutUrl }],
    target: { target_type: "managed_asset", public_id: creativeId(sku, model, seed) },
  };
}

/** Request JSON for the X-ray panel: what was sent, minus nothing secret (all URLs are on main). */
const xrayRequest = (r: CldGenerateRequest) => ({ endpoint: "POST /v2/generate/{cloud}/image_to_image", body: r });

const cutoutRefUrl = (sku: Sku, version: number) => deliveryUrl(`v${version}/${productId(sku, "cutout")}`);

export async function startCreative(input: { sku: Sku; model: string; seed: number; prompt?: string; sid: string }): Promise<string> {
  const spec = GENERATION_MODELS[input.model];
  if (!spec) throw badRequest("Unsupported model.");
  const cutout = await getCutout(input.sku);
  if (!cutout) throw notFound("Cut out the product first.");
  const version = cutout.version ?? 0;
  // Versioned URL: the reference can't change under a running job.
  const prompt = cleanScenePrompt(input.prompt);
  const req = buildCreativeRequest(input.sku, cutoutRefUrl(input.sku, version), input.model, input.seed, prompt);

  const { result, account } = await withPooledAccount("image_generation", (a) => startGeneration(a, "image_to_image", req), {
    cost: spec.credits,
  });
  if (!result.taskId) throw new HttpError(502, "upstream", "The generation service answered unexpectedly. Please try again.");
  return encodeJob({
    a: account.label,
    t: result.taskId,
    s: input.sku,
    m: input.model,
    seed: input.seed,
    cv: version,
    p: prompt,
    sid: input.sid,
    iat: Date.now(),
  });
}

function creativeAsset(sku: Sku, publicId: string, model: string, seed: number, alt: string, request: unknown, qa: KitAsset["qa"]): KitAsset {
  return {
    id: `creative-${model}-${seed}`,
    format: "hero",
    label: `Creative · ${model}`,
    url: deliveryUrl(publicId, `c_fill,w_${PLATE.width},h_${PLATE.height},g_auto/f_auto,q_auto`),
    width: PLATE.width,
    height: PLATE.height,
    frame: "feed-post",
    alt,
    xray: { json: request },
    publicId,
    qa,
  };
}

/**
 * One poll. While the task runs this costs one v2 task GET and no Admin API
 * call. On completion: copy into main, fidelity QA, and store the verdict in
 * the asset's context so later polls return it without re-running anything.
 */
export async function pollCreative(claims: JobClaims): Promise<JobResponse & { tokens?: number }> {
  const account = getAccounts().find((a) => a.label === claims.a);
  if (!account) return { status: "failed", error: "This job can no longer be found." };
  const request = xrayRequest(buildCreativeRequest(claims.s, cutoutRefUrl(claims.s, claims.cv), claims.m, claims.seed, claims.p));
  const publicId = creativeId(claims.s, claims.m, claims.seed);

  let task: Awaited<ReturnType<typeof getGenerationTask>> | null = null;
  try {
    task = await getGenerationTask(account, claims.t);
  } catch (err) {
    // Tasks expire eventually; a finished job is still answered from the saved asset below.
    console.error(`[jobs] task lookup failed: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
  }
  if (task && (task.status === "pending" || task.status === "processing")) return { status: task.status, request };

  const done = await getResource(publicId);
  const doneQa = done ? qaFromContext(done.context) : null;
  if (done && doneQa) {
    const raw = await getResource(rawId(claims.s));
    return {
      status: "completed",
      modelId: done.context.model ?? claims.m,
      credits: Number(done.context.credits ?? GENERATION_MODELS[claims.m]?.credits ?? 0),
      latencyMs: Number(done.context.latency_ms ?? 0) || undefined,
      request,
      asset: creativeAsset(claims.s, publicId, claims.m, claims.seed, raw?.context.caption ?? "", request, doneQa),
      tokens: 0,
    };
  }
  if (!task || task.status === "failed" || !task.assets[0]) {
    if (task) console.error(`[jobs] generation failed: ${(task.error ?? "no asset").slice(0, 200)}`);
    return { status: "failed", error: "The AI couldn't generate this image. Try another seed or prompt.", request };
  }

  const gen = task.assets[0];
  const latencyMs = Date.now() - claims.iat;
  const credits = task.quota?.usedByRequest ?? GENERATION_MODELS[claims.m]?.credits ?? 0;
  const modelId = gen.model?.id ?? claims.m;
  const tags = ["s2s", "s2s-creative", skuTag(claims.s)];
  const ctx = { model: modelId, seed: String(claims.seed), credits: String(credits), latency_ms: String(latencyMs) };

  if (!done) {
    const copied = await copyToMain(
      account,
      { secure_url: gen.storage.secure_url, public_id: gen.storage.public_id, asset_id: gen.storage.asset_id },
      { public_id: publicId, tags, context: ctx },
    );
    if (!copied.copied) {
      // Generated directly on main: add what the copy upload would have set.
      await addTags([publicId], tags);
      await addContext([publicId], ctx);
    }
  }

  let out;
  try {
    out = await fidelityQa(claims.s, publicId);
  } catch (err) {
    if (err instanceof HttpError && err.code === "pending") return { status: "processing", request };
    throw err;
  }
  await addContext([publicId], { ...ctx, ...qaToContext(out.qa), qa_tokens: String(out.tokens) });
  const raw = await getResource(rawId(claims.s));
  return {
    status: "completed",
    modelId,
    credits,
    latencyMs,
    request,
    asset: creativeAsset(claims.s, publicId, claims.m, claims.seed, raw?.context.caption ?? "", request, out.qa),
    tokens: out.tokens,
  };
}
