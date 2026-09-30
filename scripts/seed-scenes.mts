// Build the shared scene library (idempotent: prompt-hash public_ids are never regenerated).
// For each recipe × tier: text_to_image on the key pool → copy into main as a canonical
// 1080x1350 plate → Scene DNA + scene QA via AI Vision → context (+ `s2s-scene` when approved).
// The pipeline itself lives in lib/server/scenes.ts, shared with POST /api/scenes/generate.
//   node --conditions=react-server --import tsx scripts/seed-scenes.mts [--tiers final,draft] [--themes diwali,marble] [--dry]
import { appendFileSync, mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadEnv } from "./lib/env.mjs";

loadEnv();
const pool = await import("../lib/cloudinary/pool.ts");
const { SCENE_RECIPES } = await import("../lib/scene-prompts.ts");
const scenes = await import("../lib/server/scenes.ts");
type SceneTier = import("../lib/types.ts").SceneTier;

const { values } = parseArgs({
  options: {
    tiers: { type: "string", default: "final,draft" },
    themes: { type: "string" },
    seed: { type: "string", default: String(scenes.SCENE_SEED) },
    concurrency: { type: "string", default: "4" },
    dry: { type: "boolean", default: false },
  },
});

const tiers = values.tiers!.split(",").filter((t): t is SceneTier => t === "draft" || t === "final");
const themes = values.themes?.split(",");
const seed = Number(values.seed);
mkdirSync("scripts/spikes/out", { recursive: true });

const jobs = SCENE_RECIPES.filter((r) => !themes || themes.includes(r.theme)).flatMap((r) =>
  tiers.map((tier) => {
    const spec = scenes.sceneSpec({ theme: r.theme, tier, seed })!;
    return { spec, publicId: scenes.scenePublicId(spec) };
  }),
);

async function run(job: (typeof jobs)[number]) {
  const { spec, publicId } = job;
  const state = await scenes.plateState(publicId);
  if (state.kind === "ready" || state.kind === "rejected") return { publicId, skipped: state.kind };
  if (values.dry) return { publicId, dry: true, state: state.kind };
  if (state.kind === "unanalysed") {
    // generated earlier but never analysed: finish it without a new generation
    const credits = Number(state.asset.context.credits) || 0;
    const meta = { modelId: state.asset.context.model || scenes.SCENE_TIERS[spec.tier].model, credits, origin: "seed" as const };
    const verdict = await scenes.analysePlate(publicId, spec.view);
    await scenes.commitPlate(publicId, spec, meta, verdict);
    return { publicId, finished: true, scene_qa: verdict.qa.status, vision_tokens: verdict.tokens };
  }
  const r = await scenes.generateSceneBlocking(spec, { origin: "seed" });
  const rec = {
    spike: "seed-scenes",
    at: new Date().toISOString(),
    publicId,
    theme: spec.theme,
    tier: spec.tier,
    model_id: r.modelId,
    used_by_request: r.credits,
    remaining: r.remaining,
    account: r.accountLabel, // local git-ignored log only
    gen_ms: r.genMs,
    total_ms: r.totalMs,
    vision_tokens: r.verdict.tokens,
    scene_qa: r.verdict.qa.status === "approved" ? "approved" : `rejected: ${r.verdict.qa.matched.join(",")}`,
    dna: r.verdict.dna,
  };
  appendFileSync("scripts/spikes/out/usage-log.jsonl", JSON.stringify(rec) + "\n");
  return rec;
}

const limit = Number(values.concurrency);
const queue = [...jobs];
const results: unknown[] = [];
await Promise.all(
  Array.from({ length: limit }, async () => {
    while (queue.length) {
      const job = queue.shift()!;
      try {
        const r = await run(job);
        results.push(r);
        console.log(JSON.stringify(r));
      } catch (e) {
        console.log(JSON.stringify({ publicId: job.publicId, error: e instanceof Error ? e.message : String(e) }));
      }
    }
  }),
);
const g = await pool.poolSummary("image_generation");
console.log(`done: ${results.length}/${jobs.length}; generation credits left across pool: ${g.remaining}/${g.limit}`);
