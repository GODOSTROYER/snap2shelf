// Save tuned Exact composites as hero assets (non-transparent sources for
// b_gen_fill / e_gen_recolor), under snap2shelf/dev/heroes/<slug>. Idempotent.
//
//   node --conditions=react-server --import tsx scripts/dev/save-heroes.mts
//
// Writes scripts/spikes/out/dev-heroes.json: public id + the product box on the plate.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { v2 as cloudinary } from "cloudinary";
import { loadEnv } from "../lib/env.mjs";

loadEnv();
const { getMainAccount } = await import("../../lib/cloudinary/accounts.ts");
const { compositeUrl, defaultControls, geometry, quantise } = await import("../../lib/transform/composite.ts");
const { sceneFromListResource } = await import("../../lib/scenes.ts");
type Scene = import("../../lib/types.ts").Scene;

const main = getMainAccount();
const auth = { cloud_name: main.cloudName, api_key: main.apiKey, api_secret: main.apiSecret };
const OUT = "scripts/spikes/out";
const cutouts = JSON.parse(readFileSync(`${OUT}/dev-cutouts.json`, "utf8"));
const list = JSON.parse(readFileSync(`${OUT}/scene-list.json`, "utf8"));
const scenes: Scene[] = list.resources.map(sceneFromListResource).filter(Boolean);

export const HEROES = [
  { slug: "sneaker-diwali", product: "sneaker_decent", scene: "snap2shelf/scenes/diwali/final-59f4388a" },
  { slug: "bottle-kitchen", product: "bottle_decent", scene: "snap2shelf/scenes/kitchen/final-bd611466" },
  { slug: "pouch-jute", product: "pouch_decent", scene: "snap2shelf/scenes/jute/final-eb20e69e" },
];

const out: Record<string, unknown> = existsSync(`${OUT}/dev-heroes.json`) ? JSON.parse(readFileSync(`${OUT}/dev-heroes.json`, "utf8")) : {};
for (const h of HEROES) {
  const s = scenes.find((x) => x.publicId === h.scene);
  if (!s) throw new Error(`scene ${h.scene} not in list`);
  const c = cutouts[h.product];
  const cutout = { publicId: c.cutout, width: c.width, height: c.height };
  const controls = quantise(defaultControls(c.placement, s.dna, cutout));
  const b = compositeUrl({ scenePublicId: s.publicId, dna: s.dna, cutout, placement: c.placement, controls, format: "f_jpg,q_90" });
  const publicId = `snap2shelf/dev/heroes/${h.slug}`;
  let res;
  try {
    res = await cloudinary.api.resource(publicId, auth);
  } catch {
    res = await cloudinary.uploader.upload(b.url, { ...auth, public_id: publicId, overwrite: false, tags: ["s2s-dev", "s2s-dev-hero"] });
  }
  out[h.slug] = { publicId, width: res.width, height: res.height, scene: s.publicId, dna: s.dna, product: h.product, box: geometry(cutout, s.dna, controls, c.placement), cutout };
  console.log(h.slug, res.width, "x", res.height);
}
writeFileSync(`${OUT}/dev-heroes.json`, JSON.stringify(out, null, 2));
