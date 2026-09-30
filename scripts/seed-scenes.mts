// Build the shared scene library (idempotent: prompt-hash public_ids are never regenerated).
// For each recipe × tier: text_to_image on the key pool → copy into main as a canonical
// 1080x1350 plate → Scene DNA via AI Vision → DNA written into the asset's context.
//   node --conditions=react-server --import tsx scripts/seed-scenes.mts [--tiers final,draft] [--themes diwali,marble] [--dry]
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { v2 as cloudinary } from "cloudinary";
import { z } from "zod";
import { loadEnv } from "./lib/env.mjs";

loadEnv();
const { getMainAccount } = await import("../lib/cloudinary/accounts.ts");
const { startGeneration, getGenerationTask } = await import("../lib/cloudinary/generate.ts");
const { copyToMain } = await import("../lib/cloudinary/copy.ts");
const pool = await import("../lib/cloudinary/pool.ts");
const { visionGeneral, visionTagging, parseJsonAnswer } = await import("../lib/cloudinary/vision.ts");
const { SCENE_RECIPES, sceneDnaPrompt } = await import("../lib/scene-prompts.ts");
const { sceneToContext } = await import("../lib/scenes.ts");
const { PLATE, SCENE_ROOT } = await import("../lib/types.ts");

const { values } = parseArgs({
  options: {
    tiers: { type: "string", default: "final,draft" },
    themes: { type: "string" },
    seed: { type: "string", default: "42" },
    concurrency: { type: "string", default: "4" },
    dry: { type: "boolean", default: false },
  },
});

// Pinned model ids: mode:auto is NOT cost-stable (economy_fast picked nano-banana-2 at 9-11 credits on 2026-09-30).
const TIERS = {
  final: { model: { id: "gpt-image-2.5-flare" }, cost: 5 },
  draft: { model: { id: "flux-2-flash" }, cost: 1 },
};
const tiers = values.tiers!.split(",") as (keyof typeof TIERS)[];
const themes = values.themes?.split(",");
const main = getMainAccount();
const auth = { cloud_name: main.cloudName, api_key: main.apiKey, api_secret: main.apiSecret };
cloudinary.config({ ...auth, secure: true }); // this script only talks to main through the SDK
mkdirSync("scripts/spikes/out", { recursive: true });

const dnaSchema = z.object({
  anchor_x: z.coerce.number().min(0).max(1),
  anchor_y: z.coerce.number().min(0).max(1),
  surface_width: z.coerce.number().min(0).max(1),
  light_azimuth: z.coerce.number().min(0).max(360),
  light_elevation: z.coerce.number().min(0).max(90),
  temperature: z.enum(["warm", "neutral", "cool"]),
  glossy: z.boolean(),
  text_zone: z.enum(["top", "bottom", "left", "right", "top_left", "top_right", "none"]),
});

const jobs = SCENE_RECIPES.filter((r) => !themes || themes.includes(r.theme)).flatMap((r) =>
  tiers.map((tier) => {
    const hash = createHash("sha1").update(`${r.prompt}|${tier}|${values.seed}`).digest("hex").slice(0, 8);
    return { recipe: r, tier, publicId: `${SCENE_ROOT}/${r.theme}/${tier}-${hash}` };
  }),
);

async function exists(publicId: string) {
  try {
    await cloudinary.api.resource(publicId, auth);
    return true;
  } catch {
    return false;
  }
}

async function run(job: (typeof jobs)[number]) {
  const { recipe, tier, publicId } = job;
  if (await exists(publicId)) return { publicId, skipped: true };
  if (values.dry) return { publicId, dry: true };
  const t0 = Date.now();
  // 1. generate on the pool (async + poll)
  const { result: gen, account } = await pool.withPooledAccount(
    "image_generation",
    async (a) => {
      const started = await startGeneration(a, "text_to_image", {
        prompt: recipe.prompt,
        model: TIERS[tier].model,
        image_size: { aspect_ratio: "3:4", resolution: "1K" },
        seed: Number(values.seed),
        async: true,
        target: { target_type: "managed_asset", public_id: `snap2shelf/gen/scenes/${recipe.theme}-${tier}` },
      });
      let o = started;
      while (o.status === "pending" || o.status === "processing") {
        await new Promise((r) => setTimeout(r, 2000));
        o = await getGenerationTask(a, started.taskId!);
      }
      if (o.status !== "completed" || !o.assets[0]) throw new Error(`generation ${o.status}: ${o.error ?? ""}`);
      return { asset: o.assets[0], quota: o.quota ?? started.quota };
    },
    { cost: TIERS[tier].cost },
  );
  const genMs = Date.now() - t0;
  // 2. canonical plate in main
  const plate = await copyToMain(account, { secure_url: gen.asset.storage.secure_url }, {
    public_id: publicId,
    transformation: [{ width: PLATE.width, height: PLATE.height, crop: "fill", gravity: "center" }],
    tags: ["s2s", "s2s-scene", `s2s-theme-${recipe.theme}`, `s2s-view-${recipe.view}`, `s2s-tier-${tier}`],
  });
  // 3. Scene DNA on the canonical plate
  const dnaUri = plate.secure_url.replace("/upload/", "/upload/c_limit,w_768/f_jpg,q_80/");
  const { result: vis } = await pool.withPooledAccount("ai_vision", (a) => visionGeneral(a, { uri: dnaUri }, [sceneDnaPrompt(recipe.view)]));
  const dna = parseJsonAnswer(vis.answers[0], dnaSchema);
  if (!dna) throw new Error(`Scene DNA not parseable for ${publicId}: ${vis.answers[0].slice(0, 200)}`);
  // 3b. scene QA: an "empty" plate must not contain a product, text or people
  const { result: qa } = await pool.withPooledAccount("ai_vision", (a) =>
    visionTagging(a, { uri: dnaUri }, [
      { name: "contains-product", description: "A sellable item is present: a garment, bottle, package, shoe, box, jar or any product (decorations like flowers, lamps or pots do not count)." },
      { name: "contains-text", description: "Letters, words, numbers or logos are visible." },
      { name: "contains-person", description: "A person, face or hand is visible." },
    ]),
  );
  if (qa.matched.length) {
    await cloudinary.uploader.remove_tag("s2s-scene", [publicId]);
    await cloudinary.uploader.add_tag("s2s-scene-rejected", [publicId]);
  }
  // 4. write DNA + provenance into context
  const modelId = gen.asset.model?.id ?? "unknown";
  const credits = gen.quota?.usedByRequest ?? 0;
  await cloudinary.uploader.explicit(publicId, {
    ...auth,
    type: "upload",
    context: sceneToContext({ theme: recipe.theme, view: recipe.view, title: recipe.title, prompt: recipe.prompt, modelId, credits, dna }),
  });
  const rec = {
    spike: "seed-scenes",
    at: new Date().toISOString(),
    publicId,
    theme: recipe.theme,
    tier,
    model_id: modelId,
    used_by_request: credits,
    remaining: gen.quota?.remaining ?? null,
    account: account.label,
    gen_ms: genMs,
    total_ms: Date.now() - t0,
    vision_tokens: (vis.quota?.usedByRequest ?? 0) + (qa.quota?.usedByRequest ?? 0),
    scene_qa: qa.matched.length ? `rejected: ${qa.matched.join(",")}` : "approved",
    dna,
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
