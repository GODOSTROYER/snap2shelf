// Dev fixtures for realism tuning: upload the SYNTHETIC test photos to main and
// make one trimmed transparent cutout per photo.
//
//   node --conditions=react-server --import tsx scripts/dev/seed-cutouts.mts [name ...]
//
//   snap2shelf/dev/<name>/raw      the photo as uploaded
//   snap2shelf/dev/<name>/cutout   e_background_removal/e_trim/f_png of raw, saved as its own asset
//
// Idempotent: existing assets are read back, never re-derived (background removal is 75 tx each).
// Writes scripts/spikes/out/dev-cutouts.json (git-ignored) with width/height per cutout.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { v2 as cloudinary } from "cloudinary";
import { loadEnv } from "../lib/env.mjs";

loadEnv();
const { getMainAccount } = await import("../../lib/cloudinary/accounts.ts");
const main = getMainAccount();
const auth = { cloud_name: main.cloudName, api_key: main.apiKey, api_secret: main.apiSecret };
const B = `https://res.cloudinary.com/${main.cloudName}/image/upload`;
const PHOTOS = process.env.S2S_PHOTOS_DIR ?? "../../photos";
const OUT = "scripts/spikes/out";
mkdirSync(OUT, { recursive: true });

/** Test inputs are synthetic images, not seller photos. `kind` drives the default staging size. */
export const DEV_PRODUCTS = [
  { name: "bottle_decent", file: "decent/06_steel_bottle.png", kind: "bottle", placement: "standing" },
  { name: "sneaker_decent", file: "decent/09_neutral_sneaker.png", kind: "shoe", placement: "standing" },
  { name: "pouch_decent", file: "decent/10_trail_mix_pouch.png", kind: "pouch", placement: "standing" },
  { name: "bottle_messy", file: "messy/01_steel_bottle.png", kind: "bottle", placement: "standing" },
  { name: "sneaker_messy", file: "messy/04_white_knit_sneaker.png", kind: "shoe", placement: "standing" },
  { name: "pouch_messy", file: "messy/05_trail_mix_pouch.png", kind: "pouch", placement: "standing" },
  { name: "kurta_decent", file: "decent/07_olive_kurta.png", kind: "apparel", placement: "flatlay" },
  { name: "kurta_messy", file: "messy/02_burgundy_kurta.png", kind: "apparel", placement: "flatlay" },
] as const;

const only = process.argv.slice(2);
const TAGS = ["s2s-dev"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function resource(publicId: string) {
  try {
    return await cloudinary.api.resource(publicId, auth);
  } catch {
    return null;
  }
}

/** Fetch a derived URL, retrying while Cloudinary answers 423 (AI derivation still processing). */
async function derive(url: string) {
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    const res = await fetch(url);
    if (res.status === 423 || res.status === 420) {
      await res.arrayBuffer();
      await sleep(3000);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, buf, ms: Date.now() - t0, error: res.headers.get("x-cld-error"), polls: i };
  }
  return { status: 423, buf: Buffer.alloc(0), ms: Date.now() - t0, error: "still processing", polls: 60 };
}

const record: Record<string, { cutout: string; width: number; height: number; raw: string; kind: string; placement: string; ms?: number }> =
  existsSync(`${OUT}/dev-cutouts.json`) ? JSON.parse(readFileSync(`${OUT}/dev-cutouts.json`, "utf8")) : {};

for (const p of DEV_PRODUCTS) {
  if (only.length && !only.includes(p.name)) continue;
  const rawId = `snap2shelf/dev/${p.name}/raw`;
  const cutId = `snap2shelf/dev/${p.name}/cutout`;

  let raw = await resource(rawId);
  if (!raw) {
    raw = await cloudinary.uploader.upload(`${PHOTOS}/${p.file}`, { ...auth, public_id: rawId, overwrite: false, tags: [...TAGS, "s2s-dev-raw"] });
    console.log(`${p.name}: uploaded raw ${raw.width}x${raw.height}`);
  }

  let cut = await resource(cutId);
  let ms: number | undefined;
  if (!cut) {
    // one chain: remove background, trim transparent margin so the layer box == product box
    const d = await derive(`${B}/e_background_removal/e_trim/f_png/v${raw.version}/${rawId}`);
    if (d.status !== 200) throw new Error(`${p.name}: cutout derive HTTP ${d.status} ${d.error ?? ""}`);
    ms = d.ms;
    console.log(`${p.name}: derived cutout in ${d.ms} ms (${d.polls} x 423), ${d.buf.length} bytes`);
    cut = await cloudinary.uploader.upload(`data:image/png;base64,${d.buf.toString("base64")}`, {
      ...auth,
      public_id: cutId,
      overwrite: false,
      tags: [...TAGS, "s2s-dev-cutout"],
      context: { kind: p.kind, placement: p.placement },
    });
  }
  record[p.name] = { cutout: cutId, width: cut.width, height: cut.height, raw: rawId, kind: p.kind, placement: p.placement, ...(ms ? { ms } : {}) };
  console.log(`${p.name}: cutout ${cut.width}x${cut.height}`);
  writeFileSync(`${OUT}/dev-cutouts.json`, JSON.stringify(record, null, 2));
}
