// Seed the demo storefront /shelf/demo-studio from SAMPLE products (synthetic test photos),
// using the same library functions the API routes call:
//   signed upload → analyze → cutout (new samples only) → Collection mode on one scene → publish shelf.
//
//   node --conditions=react-server --import tsx scripts/seed-shelf.mts [--preview] [--scene <id>] [--shop <slug>]
//
// Idempotent: fixed sample skus, cached analysis/cutouts, hero ids hash their composite URL.
// Spends on a fresh run: 2 uploads, 2 captions, ~1.4k AI Vision tokens, 2 background removals (150 tx),
// a few composite/OG renders. --preview only renders the composites to scripts/spikes/out/shelf (no saves).
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadEnv } from "./lib/env.mjs";
import { signedRawUpload } from "./lib/signed-upload.mts";

loadEnv();
const { values } = parseArgs({
  options: {
    preview: { type: "boolean", default: false },
    scene: { type: "string", default: "snap2shelf/scenes/diwali/final-59f4388a" },
    shop: { type: "string", default: "demo-studio" },
    title: { type: "string", default: "Demo Studio" },
    tagline: { type: "string", default: "The Diwali edit · sample products, one festive stage" },
    photos: { type: "string", default: "Z:/Projects/Cloudinary/photos/decent" },
    out: { type: "string", default: "scripts/spikes/out/shelf" },
  },
});

const { analyzeProduct, ensureCutout, getCutout, rawId } = await import("../lib/server/products.ts");
const { getResource } = await import("../lib/server/cld.ts"); // Admin API: only for the sample uploads and --preview
const { HttpError } = await import("../lib/server/http.ts");
const { stageCollection, publishShelf, getShelf, shelfOgImage } = await import("../lib/shelf/server.ts");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
mkdirSync(values.out!, { recursive: true });

/** Sample products: fixed skus so re-runs reuse everything. Existing skus were processed by the pipeline e2e. */
const SAMPLES = [
  { sku: "s2candle", file: "08_glass_candle.png" },
  { sku: "s2trlmix", file: "10_trail_mix_pouch.png" },
  { sku: "9uo8w8pc" }, // steel bottle (06_steel_bottle.png, processed on main)
  { sku: "zi86lf6a" }, // neutral sneaker (09_neutral_sneaker.png, processed on main)
];

for (const s of SAMPLES) {
  if (s.file && !(await getResource(rawId(s.sku)))) {
    const up = await signedRawUpload(`${values.photos}/${s.file}`, s.sku, { context: "origin=sample" });
    console.log(`uploaded ${s.sku} ${up.width}x${up.height} (${up.ms} ms)`);
  }
  const a = await analyzeProduct(s.sku);
  console.log(`analyze ${s.sku}: cached=${a.cached} "${a.response.understanding.name}" focus=${a.response.focus} tokens=${a.response.tokens}`);
  for (let i = 0; i < 12; i++) {
    try {
      const c = await ensureCutout(s.sku);
      console.log(`cutout  ${s.sku}: ${c.response.cutout.width}x${c.response.cutout.height} created=${c.created}`);
      break;
    } catch (err) {
      if (err instanceof HttpError && err.code === "pending") {
        await sleep(err.retryAfterMs ?? 2000);
        continue;
      }
      throw err;
    }
  }
  if (!(await getCutout(s.sku))) throw new Error(`no cutout for ${s.sku}`);
}

const skus = SAMPLES.map((s) => s.sku);

if (values.preview) {
  const { sceneFromListResource } = await import("../lib/scenes.ts");
  const { compositeUrl, defaultControls, quantise, geometry } = await import("../lib/transform/composite.ts");
  const { collectionScale, COLLECTION_AREA } = await import("../lib/shelf/server.ts");
  const { PLATE } = await import("../lib/types.ts");
  const sa = (await getResource(values.scene!))!;
  const scene = sceneFromListResource({ public_id: sa.publicId, context: { custom: sa.context } })!;
  for (const sku of skus) {
    const cutout = (await getCutout(sku))!;
    const base = defaultControls("standing", scene.dna);
    const controls = { ...base, scale: collectionScale(cutout, scene.dna, "standing", base, PLATE.width * PLATE.height * COLLECTION_AREA.standing) };
    const g = geometry(cutout, scene.dna, quantise(controls), "standing");
    const url = compositeUrl({ scenePublicId: scene.publicId, dna: scene.dna, cutout, placement: "standing", controls, width: 540, format: "f_jpg,q_80", cloud: process.env.CLOUDINARY_CLOUD_NAME }).url;
    const res = await fetch(url);
    writeFileSync(`${values.out}/preview-${sku}.jpg`, Buffer.from(await res.arrayBuffer()));
    console.log(`preview ${sku}: HTTP ${res.status} scale=${controls.scale} box=${g.pw}x${g.ph}@${g.px},${g.py}`);
  }
  process.exit(0);
}

const t0 = Date.now();
const col = await stageCollection({ skus, scenePublicId: values.scene! });
console.log(`collection on ${col.scene.publicId} in ${Date.now() - t0} ms: ${col.items.length} staged, failed=${JSON.stringify(col.failed)}`);
console.log(`  consistency ${JSON.stringify(col.consistency)}`);
for (const it of col.items) console.log(`  ${it.sku} ${it.name} → ${it.hero.publicId} geo=${JSON.stringify(it.geo)}`);

// hand the just-saved hero ids over explicitly: CDN listings can lag a minute behind
const heroes = Object.fromEntries(col.items.map((it) => [it.sku, it.hero.publicId!]));
const shelf = await publishShelf({ shop: values.shop!, title: values.title!, tagline: values.tagline, skus, heroes });
console.log(`published ${shelf.url} items=${shelf.items.length} skipped=${JSON.stringify(shelf.skipped)} removed=${shelf.removed.length}`);

const read = await getShelf(values.shop!);
const og = read ? shelfOgImage(read) : shelf.ogImage;
const res = await fetch(og);
const buf = Buffer.from(await res.arrayBuffer());
writeFileSync(`${values.out}/og-${values.shop}.jpg`, buf);
console.log(`og HTTP ${res.status} ${res.headers.get("content-type")} ${buf.length} B`);
console.log(og);
