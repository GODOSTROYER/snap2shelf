// Spike 1: text_to_image to a managed asset (async + poll). Measures latency,
// credits per image per model and remaining quota. Pinned to one account.
//   node --conditions=react-server --import tsx scripts/spikes/01-t2i.mts --account pool1 --model auto:economy_fast
import { appendFileSync, mkdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadEnv } from "../lib/env.mjs";

loadEnv();
const { getAccounts } = await import("../../lib/cloudinary/accounts.ts");
const { startGeneration, getGenerationTask } = await import("../../lib/cloudinary/generate.ts");
const pool = await import("../../lib/cloudinary/pool.ts");

const { values } = parseArgs({
  options: {
    account: { type: "string", default: "pool1" },
    model: { type: "string", default: "auto:economy_fast" },
    size: { type: "string", default: "3:4" }, // aspect ratio, or WxH
    resolution: { type: "string", default: "1K" },
    seed: { type: "string", default: "42" },
    prompt: { type: "string" },
    id: { type: "string" },
    minRemaining: { type: "string", default: "15" },
  },
});

const SCENE_PROMPT =
  "Photorealistic empty product-photography backdrop. A warm teak wooden tabletop fills the lower half of the frame, " +
  "camera at eye level, soft warm light from the upper left. The background is softly blurred with brass diyas, " +
  "marigold garlands and warm bokeh lights. The centre of the tabletop is completely empty and clear for placing a product. " +
  "No products, no people, no hands, no text, no logos.";

const account = getAccounts().find((a) => a.label === values.account);
if (!account) throw new Error(`No account labelled ${values.account}`);

await pool.refreshUsage(true);
const guard = Number(values.minRemaining) - pool.QUOTA_FLOOR.image_generation;
const eligible = (await pool.rankAccounts("image_generation", guard)).some((a) => a.label === account.label);
const summaryBefore = await pool.poolSummary("image_generation");
if (!eligible) throw new Error(`${account.label} has fewer than ${values.minRemaining} generation credits left (or is benched); refusing to spend.`);
console.log(`pool before: ${summaryBefore.remaining}/${summaryBefore.limit} credits across accounts; ${account.label} eligible=${eligible}`);

const model = values.model!.startsWith("auto:")
  ? { mode: "auto" as const, preference: values.model!.slice(5) as "economy_fast" }
  : { id: values.model! };
const image_size = /^\d+x\d+$/.test(values.size!)
  ? { width: Number(values.size!.split("x")[0]), height: Number(values.size!.split("x")[1]) }
  : { aspect_ratio: values.size as "3:4", resolution: values.resolution as "1K" };
const slug = values.model!.replace(/[^a-z0-9]+/gi, "-");
const publicId = values.id ?? `snap2shelf/spikes/t2i_${slug}_${values.seed}`;

const t0 = Date.now();
const started = await startGeneration(account, "text_to_image", {
  prompt: values.prompt ?? SCENE_PROMPT,
  model,
  image_size,
  seed: Number(values.seed),
  async: true,
  target: { target_type: "managed_asset", public_id: publicId },
});
console.log(`POST ${Date.now() - t0} ms → status=${started.status} task=${started.taskId ?? "-"} quota=${JSON.stringify(started.quota)}`);

let outcome = started;
while (outcome.status === "pending" || outcome.status === "processing") {
  await new Promise((r) => setTimeout(r, 2000));
  outcome = await getGenerationTask(account, started.taskId!);
  process.stdout.write(`  ${((Date.now() - t0) / 1000).toFixed(1)}s ${outcome.status}\n`);
}
const latencyMs = Date.now() - t0;
const asset = outcome.assets[0];
const quota = outcome.quota ?? started.quota;
const record = {
  spike: "01-t2i",
  at: new Date().toISOString(),
  account: account.label,
  requested_model: values.model,
  model_id: asset?.model?.id ?? null,
  status: outcome.status,
  error: outcome.error ?? null,
  latency_ms: latencyMs,
  used_by_request: quota?.usedByRequest ?? null,
  remaining: quota?.remaining ?? null,
  limit: quota?.limit ?? null,
  seed: asset?.seed ?? null,
  width: asset?.width ?? null,
  height: asset?.height ?? null,
  bytes: asset?.bytes ?? null,
  format: asset?.format ?? null,
  public_id: asset?.storage.public_id ?? null,
  url: asset?.storage.secure_url ?? null,
  poll_quota_block_present: Boolean(outcome.quota),
};
mkdirSync("scripts/spikes/out", { recursive: true });
appendFileSync("scripts/spikes/out/usage-log.jsonl", JSON.stringify(record) + "\n");
console.log(JSON.stringify(record, null, 2));
