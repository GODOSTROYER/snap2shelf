// Spike 2: image_to_image with the product cutout as reference image [1].
// Step A (once): cut out the product on main with e_background_removal and save it as its own asset.
// Step B: run image_to_image on a pinned account with a chosen model, reference passed by URL.
//   node --conditions=react-server --import tsx scripts/spikes/02-i2i.mts --source samples/shoe --account pool2 --model flux-2-flash-edit
import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { v2 as cloudinary } from "cloudinary";
import { loadEnv } from "../lib/env.mjs";

loadEnv();
const { getAccounts, getMainAccount } = await import("../../lib/cloudinary/accounts.ts");
const { startGeneration, getGenerationTask } = await import("../../lib/cloudinary/generate.ts");
const pool = await import("../../lib/cloudinary/pool.ts");

const { values } = parseArgs({
  options: {
    source: { type: "string", default: "samples/shoe" },
    account: { type: "string", default: "pool2" },
    model: { type: "string" },
    seed: { type: "string", default: "7" },
    prompt: { type: "string" },
    minRemaining: { type: "string", default: "15" },
    "cutout-only": { type: "boolean", default: false },
  },
});

const main = getMainAccount();
const cutoutId = `snap2shelf/spikes/cutouts/${values.source!.replace(/[^a-z0-9]+/gi, "_")}`;
const auth = { cloud_name: main.cloudName, api_key: main.apiKey, api_secret: main.apiSecret };

async function ensureCutout(): Promise<{ url: string; asset_id: string; ms: number }> {
  try {
    const r = await cloudinary.api.resource(cutoutId, auth);
    return { url: r.secure_url, asset_id: r.asset_id, ms: 0 };
  } catch {
    // not there yet
  }
  const derived = `https://res.cloudinary.com/${main.cloudName}/image/upload/e_background_removal/f_png/${values.source}`;
  const t0 = Date.now();
  // Background removal is derived asynchronously; poll the delivery URL until it is ready.
  for (let i = 0; i < 30; i++) {
    const res = await fetch(derived, { method: "GET" });
    await res.arrayBuffer();
    process.stdout.write(`  cutout derive: HTTP ${res.status} (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
    if (res.status === 200) break;
    if (res.status !== 423 && res.status !== 420) throw new Error(`background removal failed: HTTP ${res.status} ${res.headers.get("x-cld-error") ?? ""}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  const up = await cloudinary.uploader.upload(derived, { ...auth, public_id: cutoutId, overwrite: false, tags: ["s2s", "cutout", "spike"] });
  return { url: up.secure_url, asset_id: up.asset_id, ms: Date.now() - t0 };
}

const cutout = await ensureCutout();
console.log(`cutout: ${cutout.url} (${cutout.ms} ms)`);
appendFileSync("scripts/spikes/out/usage-log.jsonl", JSON.stringify({ spike: "02-cutout", at: new Date().toISOString(), source: values.source, url: cutout.url, ms: cutout.ms }) + "\n");
if (values["cutout-only"] || !values.model) process.exit(0);

const account = getAccounts().find((a) => a.label === values.account);
if (!account) throw new Error(`No account labelled ${values.account}`);
await pool.refreshUsage(true);
const guard = Number(values.minRemaining) - pool.QUOTA_FLOOR.image_generation;
if (!(await pool.rankAccounts("image_generation", guard)).some((a) => a.label === account.label)) {
  throw new Error(`${account.label} has fewer than ${values.minRemaining} generation credits left; refusing to spend.`);
}

const prompt =
  values.prompt ??
  "Professional lifestyle e-commerce photograph of the EXACT product shown in reference image [1], standing on a sunlit " +
    "sandstone step in a Jaipur courtyard, soft warm morning light, shallow depth of field. Keep the product's shape, " +
    "colours, materials, logo, laces and proportions identical to [1]; do not redesign it. Photorealistic, no text, no people.";

const model = values.model!.startsWith("auto:") ? { mode: "auto" as const, preference: values.model!.slice(5) as "economy" } : { id: values.model! };
const t0 = Date.now();
const started = await startGeneration(account, "image_to_image", {
  prompt,
  model,
  image_size: { aspect_ratio: "3:4", resolution: "1K" },
  seed: Number(values.seed),
  async: true,
  reference_images: [{ source_type: "url", url: cutout.url }],
  target: { target_type: "managed_asset", public_id: `snap2shelf/spikes/i2i_${values.model!.replace(/[^a-z0-9]+/gi, "-")}_${values.seed}` },
});
let outcome = started;
while (outcome.status === "pending" || outcome.status === "processing") {
  await new Promise((r) => setTimeout(r, 2000));
  outcome = await getGenerationTask(account, started.taskId!);
}
const asset = outcome.assets[0];
const quota = outcome.quota ?? started.quota;
const record = {
  spike: "02-i2i",
  at: new Date().toISOString(),
  account: account.label,
  requested_model: values.model,
  model_id: asset?.model?.id ?? null,
  status: outcome.status,
  error: outcome.error ?? null,
  latency_ms: Date.now() - t0,
  used_by_request: quota?.usedByRequest ?? null,
  remaining: quota?.remaining ?? null,
  width: asset?.width ?? null,
  height: asset?.height ?? null,
  url: asset?.storage.secure_url ?? null,
};
appendFileSync("scripts/spikes/out/usage-log.jsonl", JSON.stringify(record) + "\n");
console.log(JSON.stringify(record, null, 2));
