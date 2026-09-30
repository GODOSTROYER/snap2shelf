// Contact sheet for Exact-mode realism tuning. Builds compositeUrl() for every
// product x scene pair, fetches each (1 tx per new URL), and tiles them with ffmpeg.
//
//   node --conditions=react-server --import tsx scripts/dev/realism-sheet.mts [sheetName] [--full] [--products a,b] [--scenes x,y]
//
// Needs scripts/dev/seed-cutouts.mts to have run. Output: scripts/spikes/out/view/<sheetName>.jpg (git-ignored).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnv } from "../lib/env.mjs";

loadEnv();
const { compositeUrl, defaultControls } = await import("../../lib/transform/composite.ts");
const { sceneFromListResource } = await import("../../lib/scenes.ts");
type Scene = import("../../lib/types.ts").Scene;
type Placement = import("../../lib/types.ts").Placement;

const OUT = "scripts/spikes/out";
const VIEW = `${OUT}/view`;
const TILES = `${VIEW}/tiles`;
mkdirSync(TILES, { recursive: true });

const args = process.argv.slice(2);
const flag = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const sheetName = args[0] && !args[0].startsWith("--") ? args[0] : "exact-sheet";
const full = args.includes("--full");
const tileW = full ? 1080 : 360;

const cutouts: Record<string, { cutout: string; width: number; height: number; placement: Placement; kind: string }> = JSON.parse(
  readFileSync(`${OUT}/dev-cutouts.json`, "utf8"),
);

// live scene library (client-side list), plus the Day-0 spike plate with its measured DNA
// the CDN list can briefly answer 404 while tags change: fall back to the last good copy
let list = await (await fetch(`https://res.cloudinary.com/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/list/s2s-scene.json`)).json();
if (Array.isArray(list.resources) && list.resources.length) writeFileSync(`${OUT}/scene-list.json`, JSON.stringify(list, null, 2));
else list = JSON.parse(readFileSync(`${OUT}/scene-list.json`, "utf8"));
const scenes: Scene[] = (list.resources ?? []).map(sceneFromListResource).filter(Boolean);
scenes.push({
  publicId: "snap2shelf/spikes/scenes/diwali_teak_42",
  theme: "diwali",
  view: "eye-level",
  title: "Diwali teak (spike)",
  prompt: "",
  modelId: "",
  credits: 0,
  dna: { anchor_x: 0.5, anchor_y: 0.65, surface_width: 1, light_azimuth: 315, light_elevation: 45, temperature: "warm", glossy: false, text_zone: "top" },
});
const short = (s: Scene) => s.publicId.replace(/^snap2shelf\/(scenes|spikes\/scenes)\//, "").replace(/\//g, "_");

const DEFAULT_PRODUCTS = ["bottle_decent", "sneaker_decent", "pouch_decent", "bottle_messy", "sneaker_messy", "pouch_messy", "kurta_decent", "kurta_messy"];
const DEFAULT_SCENES = ["diwali_final-59f4388a", "kitchen_final-bd611466", "jute_final-eb20e69e", "cafe_final-04757f01", "marble_final-ca4c3ac1", "flatlay-festive_final-ed645adc", "flatlay-linen_final-c9e88705"];
const products = (flag("--products")?.split(",") ?? DEFAULT_PRODUCTS).filter((p) => cutouts[p]);
const sceneKeys = flag("--scenes")?.split(",") ?? DEFAULT_SCENES;
const chosen = sceneKeys.map((k) => scenes.find((s) => short(s) === k || s.publicId === k)).filter((s): s is Scene => Boolean(s));
const overrides = flag("--controls") ? JSON.parse(flag("--controls")!) : {};

const rows: string[][] = [];
const log: unknown[] = [];
for (const s of chosen) {
  const row: string[] = [];
  for (const p of products) {
    const c = cutouts[p];
    const placement: Placement = c.placement;
    if ((placement === "flatlay") !== (s.view === "top-down")) continue;
    const controls = { ...defaultControls(placement, s.dna, { width: c.width, height: c.height }), ...overrides };
    const b = compositeUrl({
      scenePublicId: s.publicId,
      dna: s.dna,
      cutout: { publicId: c.cutout, width: c.width, height: c.height },
      placement,
      controls,
      width: full ? undefined : tileW,
      format: "f_jpg,q_85",
    });
    const file = `${TILES}/${sheetName}__${short(s)}__${p}.jpg`;
    const t0 = Date.now();
    const res = await fetch(b.url);
    const buf = Buffer.from(await res.arrayBuffer());
    const rec = { scene: short(s), product: p, http: res.status, ms: Date.now() - t0, err: res.headers.get("x-cld-error"), url: b.url };
    log.push(rec);
    if (!res.ok) {
      console.log(`FAIL ${short(s)} ${p}: HTTP ${res.status} ${rec.err}`);
      continue;
    }
    writeFileSync(file, buf);
    row.push(file);
    console.log(`${short(s)} ${p}: ${res.status} ${rec.ms}ms`);
  }
  if (row.length) rows.push(row);
}
writeFileSync(`${OUT}/${sheetName}.urls.json`, JSON.stringify(log, null, 2));

// tile: one row per scene
const inputs = rows.flat();
const cols = Math.max(...rows.map((r) => r.length));
const tileH = Math.round((tileW * 1350) / 1080);
const layout: string[] = [];
rows.forEach((r, y) => r.forEach((_, x) => layout.push(`${x * tileW}_${y * tileH}`)));
const filter =
  inputs.map((_, i) => `[${i}]scale=${tileW}:${tileH}[t${i}]`).join(";") +
  ";" +
  inputs.map((_, i) => `[t${i}]`).join("") +
  `xstack=inputs=${inputs.length}:layout=${layout.join("|")}:fill=black`;
if (inputs.length === 1) {
  writeFileSync(`${VIEW}/${sheetName}.jpg`, readFileSync(inputs[0]));
} else {
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...inputs.flatMap((f) => ["-i", f]), "-filter_complex", filter, "-frames:v", "1", "-q:v", "3", `${VIEW}/${sheetName}.jpg`]);
}
console.log(`sheet: ${VIEW}/${sheetName}.jpg  (${rows.length} rows x ${cols} cols)`);
