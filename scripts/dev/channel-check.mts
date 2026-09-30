// Live check of every Channel Pack format on the dev heroes (scripts/dev/save-heroes.mts).
// Fetches each URL (retrying 423 while AI effects derive), records HTTP status,
// real dimensions, bytes and time, and saves the images for eyeballing.
//
//   node --conditions=react-server --import tsx scripts/dev/channel-check.mts [heroSlug ...]
//
// Cost note: story/banner (b_gen_fill) and recolor (e_gen_recolor) are 50 tx each
// the first time a URL is requested; re-running is free (cached derived assets).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnv } from "../lib/env.mjs";

loadEnv();
const { channelAssets } = await import("../../lib/transform/channels.ts");
const OUT = "scripts/spikes/out";
const DIR = `${OUT}/view/channels`;
mkdirSync(DIR, { recursive: true });
const heroes = JSON.parse(readFileSync(`${OUT}/dev-heroes.json`, "utf8"));

const PLAN: Record<string, { recolorPart?: string; swatches?: string[]; gen: boolean; offer: { hindi?: string; english?: string } }> = {
  "sneaker-diwali": { recolorPart: "suede panels", swatches: ["1e3a8a"], gen: true, offer: { hindi: "दिवाली सेल · 20% छूट", english: "Diwali sale, 20% off / this week only" } },
  "bottle-kitchen": { recolorPart: "bottle body", swatches: ["0f766e"], gen: true, offer: { hindi: "त्योहार ऑफ़र", english: "Festive offer: free engraving" } },
  "pouch-jute": { gen: false, offer: { hindi: "नया स्वाद", english: "New flavour, 15% off" } },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const probe = (f: string) => execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", f], { encoding: "utf8" }).trim();
const only = process.argv.slice(2);
const results: unknown[] = [];

for (const [slug, h] of Object.entries(heroes) as [string, { publicId: string; dna: { text_zone: string }; box: never; cutout: { publicId: string } }][]) {
  if (only.length && !only.includes(slug)) continue;
  const plan = PLAN[slug];
  const assets = channelAssets({
    heroPublicId: h.publicId,
    cutoutPublicId: h.cutout.publicId,
    alt: slug,
    recolorPart: plan.recolorPart,
    swatches: plan.swatches,
    offer: plan.offer,
    textZone: h.dna.text_zone as never,
    productBox: h.box,
  });
  for (const a of assets) {
    if (!plan.gen && (a.format === "story" || a.format === "banner" || a.format === "recolor")) continue;
    const url = a.url.replace(/f_auto,q_auto(:eco)?$/, "f_jpg,q_85").replace(/\/f_auto,q_auto(:eco)?\//, "/f_jpg,q_85/");
    const t0 = Date.now();
    let res: Response | null = null;
    let polls = 0;
    for (; polls < 40; polls++) {
      res = await fetch(url);
      if (res.status !== 423 && res.status !== 420) break;
      await res.arrayBuffer();
      await sleep(3000);
    }
    const buf = Buffer.from(await res!.arrayBuffer());
    const file = `${DIR}/${slug}__${a.id}.jpg`;
    let dims = "";
    if (res!.ok) {
      writeFileSync(file, buf);
      dims = probe(file);
    }
    const rec = { slug, id: a.id, http: res!.status, err: res!.headers.get("x-cld-error"), ms: Date.now() - t0, polls, bytes: buf.length, dims, expected: `${a.width},${a.height}`, url };
    results.push(rec);
    console.log(`${slug} ${a.id}: HTTP ${rec.http} ${rec.err ?? ""} ${dims} (expected ${rec.expected}) ${rec.ms}ms ${buf.length}B`);
  }
}
writeFileSync(`${OUT}/channel-check.json`, JSON.stringify(results, null, 2));
