// Live end-to-end run of the pipeline library (the same functions the API routes call):
//   signed upload (sign-upload allowlist) → analyze → cutout → Exact composite → exact QA
//   → pack (hero + channel formats) → zip → one Creative job (flux-2-flash-edit, 1 credit) + fidelity QA.
//
//   node --conditions=react-server --import tsx scripts/e2e-pipeline.mts [--photo <file>] [--sku <existing sku>] [--no-creative] [--no-recolor]
//
// Spends (fresh sku): 1 upload, ~1 captioning, ~2.3k AI Vision tokens, background removal (75 tx),
// 2x b_gen_fill (100 tx), 1x e_gen_recolor (50 tx), 1 image-generation credit.
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadEnv } from "./lib/env.mjs";
import { signedRawUpload } from "./lib/signed-upload.mts";

loadEnv();
const { values } = parseArgs({
  options: {
    photo: { type: "string", default: "Z:/Projects/Cloudinary/photos/decent/06_steel_bottle.png" },
    sku: { type: "string" },
    scene: { type: "string", default: "snap2shelf/spikes/scenes/diwali_teak_42" },
    "no-creative": { type: "boolean", default: false },
    "no-recolor": { type: "boolean", default: false },
    out: { type: "string", default: "scripts/spikes/out/e2e" },
  },
});

const { analyzeProduct, ensureCutout } = await import("../lib/server/products.ts");
const { exactQa } = await import("../lib/server/qa.ts");
const { startPack, packStatus } = await import("../lib/server/pack.ts");
const { startCreative, pollCreative } = await import("../lib/server/creative.ts");
const { decodeJob } = await import("../lib/server/job-token.ts");
const { HttpError } = await import("../lib/server/http.ts");
const { compositeUrl, defaultControls } = await import("../lib/transform/composite.ts");
const { poolSummary, refreshUsage } = await import("../lib/cloudinary/pool.ts");
const { captureProbeUrl } = await import("../lib/capture.ts");

const cloud = process.env.CLOUDINARY_CLOUD_NAME!;
mkdirSync(values.out!, { recursive: true });
const timings: Record<string, number> = {};
const T = Date.now();
async function step<R>(name: string, fn: () => Promise<R>): Promise<R> {
  const t0 = Date.now();
  process.stdout.write(`\n▶ ${name}\n`);
  const r = await fn();
  timings[name] = Date.now() - t0;
  console.log(`  ✓ ${name}: ${timings[name]} ms`);
  return r;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function save(name: string, url: string) {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  if (res.ok) writeFileSync(`${values.out}/${name}`, buf);
  return { status: res.status, bytes: buf.length, type: res.headers.get("content-type") };
}

await refreshUsage(true);
const before = { gen: await poolSummary("image_generation"), vision: await poolSummary("ai_vision"), cap: await poolSummary("object_detection") };

const sku = values.sku ?? Array.from({ length: 8 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
console.log(`sku ${sku}`);

if (!values.sku) {
  await step("1 signed upload", async () => {
    const up = await signedRawUpload(values.photo!, sku, { context: "origin=e2e" });
    console.log(`  ${up.public_id} ${up.width}x${up.height} ${up.bytes} B (network ${up.ms} ms)`);
  });
  await step("1b capture probe sees it", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await fetch(captureProbeUrl(cloud, sku), { method: "HEAD" });
      if (r.status === 200) return console.log(`  versioned HEAD 200 on poll ${i + 1}`);
      await sleep(500);
    }
    throw new Error("capture probe never saw the upload");
  });
}

const analysis = await step("2 analyze", async () => {
  const { response, cached } = await analyzeProduct(sku);
  console.log(`  cached=${cached} caption="${response.caption}" focus=${response.focus} tokens=${response.tokens}`);
  console.log(`  understanding=${JSON.stringify(response.understanding)}`);
  return response;
});

const cutout = await step("3 cutout", async () => {
  for (let i = 0; i < 10; i++) {
    try {
      const { response, created } = await ensureCutout(sku);
      console.log(`  created=${created} ${response.cutout.publicId} ${response.cutout.width}x${response.cutout.height} (${response.ms} ms in call)`);
      return response.cutout;
    } catch (err) {
      if (err instanceof HttpError && err.code === "pending") {
        console.log(`  pending, retry in ${err.retryAfterMs} ms`);
        await sleep(err.retryAfterMs ?? 2000);
        continue;
      }
      throw err;
    }
  }
  throw new Error("cutout never finished");
});

const dna = { anchor_x: 0.5, anchor_y: 0.65, surface_width: 0.8, light_azimuth: 315, light_elevation: 45, temperature: "warm", glossy: false, text_zone: "top" } as const;
const placement = analysis.understanding.placement;
const built = compositeUrl({ scenePublicId: values.scene!, dna, cutout, placement, controls: defaultControls(placement, dna), cloud });
await step("4 composite render", async () => {
  const r = await save("composite.jpg", built.url.replace("/f_auto,q_auto/", "/f_jpg,q_85/"));
  console.log(`  HTTP ${r.status} ${r.bytes} B ${r.type}`);
  console.log(`  ${built.url}`);
});

const qa = await step("5 exact QA", async () => {
  const out = await exactQa(built.url);
  console.log(`  ${out.qa.status} matched=${JSON.stringify(out.qa.matched)} reasons=${JSON.stringify(out.qa.reasons)} tokens=${out.tokens}`);
  return out;
});

const pack = await step("6 pack start", async () => {
  const out = await startPack({
    sku,
    heroUrl: built.url,
    sceneSlug: "diwali-teak-42",
    offer: { hindi: "दिवाली सेल", english: "20% off this Diwali" },
    recolor: values["no-recolor"] ? [] : ["2563eb"],
    textZone: dna.text_zone,
  });
  console.log(`  hero=${out.heroPublicId} done=${out.assets.filter((a) => a.publicId).map((a) => a.id).join(",")} pending=${out.pending.join(",")} failed=${out.failed.join(",")}`);
  return out;
});

const status = await step("7 pack poll → zip", async () => {
  for (let i = 0; i < 30; i++) {
    const s = await packStatus(sku);
    console.log(`  poll ${i + 1}: pending=[${s.pending.join(",")}] failed=[${s.failed.join(",")}]`);
    if (!s.pending.length) return s;
    await sleep(2000);
  }
  throw new Error("pack never finished");
});
await step("8 zip download", async () => {
  const res = await fetch(status.zipUrl!);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(`${values.out}/pack.zip`, buf);
  console.log(`  HTTP ${res.status} ${res.headers.get("content-type")} ${buf.length} B magic=${buf.subarray(0, 2).toString()}`);
  for (const a of status.assets) {
    if (!a.publicId) continue;
    const r = await save(`pack-${a.id}.jpg`, `https://res.cloudinary.com/${cloud}/image/upload/f_jpg,q_80,w_540/${a.publicId}`);
    console.log(`  ${a.id}: ${a.width}x${a.height} saved=${r.status}`);
  }
});

let creative: Awaited<ReturnType<typeof pollCreative>> | null = null;
if (!values["no-creative"]) {
  const job = await step("9 creative start (flux-2-flash-edit)", async () => {
    const token = await startCreative({ sku, model: "flux-2-flash-edit", seed: 7, prompt: "on a carved teak table beside brass diyas and marigolds, warm evening light", sid: "e2e" });
    console.log(`  job token ${token.length} chars (opaque)`);
    return token;
  });
  creative = await step("10 creative poll → copy → fidelity QA", async () => {
    const claims = decodeJob(job)!;
    for (let i = 0; i < 40; i++) {
      const r = await pollCreative(claims);
      if (r.status === "completed" || r.status === "failed") return r;
      process.stdout.write(`  ${r.status}…\n`);
      await sleep(2000);
    }
    throw new Error("creative job never finished");
  });
  console.log(`  status=${creative.status} model=${creative.modelId} credits=${creative.credits} latency=${creative.latencyMs} ms`);
  if (creative.asset) {
    console.log(`  asset=${creative.asset.publicId} qa=${JSON.stringify(creative.asset.qa)}`);
    await save("creative.jpg", creative.asset.url.replace("/f_auto,q_auto/", "/f_jpg,q_85/"));
  }
  // a second poll must be answered from the saved asset (no re-QA)
  await step("10b creative re-poll (cached)", async () => {
    const r = await pollCreative(decodeJob(job)!);
    console.log(`  status=${r.status} tokens=${r.tokens}`);
  });
}

await refreshUsage(true);
const after = { gen: await poolSummary("image_generation"), vision: await poolSummary("ai_vision"), cap: await poolSummary("object_detection") };
console.log("\n== summary");
console.log(JSON.stringify({ sku, total_ms: Date.now() - T, timings, qa: qa.qa.status, zip: Boolean(status.zipUrl), creative: creative?.asset?.qa?.status ?? null }, null, 2));
console.log(
  `pool (live readings): generation ${before.gen.remaining}→${after.gen.remaining}, ai_vision ${before.vision.remaining}→${after.vision.remaining}, captioning ${before.cap.remaining}→${after.cap.remaining}`,
);
void pack;
