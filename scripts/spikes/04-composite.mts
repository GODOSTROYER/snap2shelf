// Spike 4: Exact-mode composite as a pure URL.
//  1. copy the generated scene into main, cropped to the canonical 4:5 plate (1080x1350)
//  2. Scene DNA on the canonical plate (AI Vision, pooled)
//  3. trimmed cutout asset (e_trim on the background-removed PNG) so its box == the product
//  4. composites: placement, e_dropshadow inside a layer, a_vflip + e_gradient_fade reflection,
//     squashed-silhouette contact shadow. Each URL is fetched and its HTTP status recorded.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { v2 as cloudinary } from "cloudinary";
import { z } from "zod";
import { loadEnv } from "../lib/env.mjs";
import { lastUrl } from "../lib/spike-log.mjs";

loadEnv();
const { getAccounts, getMainAccount } = await import("../../lib/cloudinary/accounts.ts");
const { copyToMain } = await import("../../lib/cloudinary/copy.ts");
const pool = await import("../../lib/cloudinary/pool.ts");
const { visionGeneral, parseJsonAnswer } = await import("../../lib/cloudinary/vision.ts");

const main = getMainAccount();
const auth = { cloud_name: main.cloudName, api_key: main.apiKey, api_secret: main.apiSecret };
const sceneUrl = lastUrl((r: { spike: string; requested_model: string }) => r.spike === "01-t2i" && r.requested_model === "auto:quality", "premium scene (spike 1)");
const sceneAccount = getAccounts().find((a) => sceneUrl.includes(`/${a.cloudName}/`))!;
const VIEW = process.env.SPIKE_VIEW_DIR ?? "scripts/spikes/out/view";
mkdirSync(VIEW, { recursive: true });
const W = 1080, H = 1350;

// 1. canonical scene plate
const scene = await copyToMain(
  sceneAccount,
  { secure_url: sceneUrl },
  { public_id: "snap2shelf/spikes/scenes/diwali_teak_42", transformation: [{ width: W, height: H, crop: "fill", gravity: "center" }], tags: ["s2s", "scene", "spike"] },
);
console.log("scene:", scene.public_id, scene.width, "x", scene.height);

// 2. Scene DNA on the canonical plate
const dnaSchema = z.object({
  surface_anchor_x: z.number(), surface_anchor_y: z.number(), surface_width: z.number(),
  light_azimuth: z.number(), light_elevation: z.number(),
  colour_temperature: z.string(), glossy_surface: z.boolean(), safe_text_zone: z.string(),
});
const DNA_PROMPT = `You are preparing a product-photography backdrop for compositing a product photo onto it.
Return ONLY a JSON object with keys: surface_anchor_x (0-1, horizontal centre of the clear surface where a product should stand),
surface_anchor_y (0-1 from the top, where the product's base should touch the surface: pick a point on the surface a little in front of its back edge),
surface_width (0-1), light_azimuth (0-360, direction the main light comes FROM, clockwise from the top: 0=top, 90=right, 180=bottom, 270=left),
light_elevation (0-90), colour_temperature ("warm"|"neutral"|"cool"), glossy_surface (boolean), safe_text_zone ("top"|"bottom"|"left"|"right"|"top_left"|"top_right"|"none").`;
const dnaRes = await pool.withPooledAccount("ai_vision", (a) => visionGeneral(a, { uri: scene.secure_url.replace("/upload/", "/upload/f_jpg,q_80,w_768/") }, [DNA_PROMPT]));
const dna = parseJsonAnswer(dnaRes.result.answers[0], dnaSchema);
console.log("dna:", JSON.stringify(dna));
if (!dna) throw new Error("Scene DNA JSON invalid: " + dnaRes.result.answers[0]);

// 3. trimmed cutout
const trimmedId = "snap2shelf/spikes/cutouts/samples_shoe_trim";
let trimmed: { width: number; height: number };
try {
  const r = await cloudinary.api.resource(trimmedId, auth);
  trimmed = { width: r.width, height: r.height };
} catch {
  const src = `https://res.cloudinary.com/${main.cloudName}/image/upload/e_trim/f_png/snap2shelf/spikes/cutouts/samples_shoe`;
  const r = await cloudinary.uploader.upload(src, { ...auth, public_id: trimmedId, overwrite: false, tags: ["s2s", "cutout", "spike"] });
  trimmed = { width: r.width, height: r.height };
}
console.log("trimmed cutout:", trimmed);

// 4. geometry from Scene DNA (all integers: the API forbids mixing ints and floats in x/y/w/h)
const layer = trimmedId.replace(/\//g, ":");
const pw = Math.round(W * 0.46);
const ph = Math.round(pw * (trimmed.height / trimmed.width));
const baseY = Math.round(H * dna.surface_anchor_y);
const px = Math.round(W * dna.surface_anchor_x - pw / 2);
const py = baseY - ph;
const shadowAz = Math.round(dna.light_azimuth);
const elev = Math.round(Math.max(20, Math.min(70, dna.light_elevation)));

const base = `https://res.cloudinary.com/${main.cloudName}/image/upload/`;
const plate = `c_fill,w_${W},h_${H}`;
const tail = `f_jpg,q_85/${scene.public_id}`;
const product = (fx = "") => `l_${layer}/c_scale,w_${pw}${fx}/fl_layer_apply,g_north_west,x_${px},y_${py}`;
const reflection = `l_${layer}/c_scale,w_${pw}/a_vflip/e_gradient_fade:60,y_-0.7/o_22/fl_layer_apply,g_north_west,x_${px},y_${baseY - 2}`;
const contact = `l_${layer}/c_scale,w_${Math.round(pw * 0.9)},h_${Math.max(8, Math.round(ph * 0.07))}/co_black,e_colorize:100/e_blur:600/o_55/fl_layer_apply,g_north_west,x_${px + Math.round(pw * 0.05)},y_${baseY - Math.round(ph * 0.035)}`;

const variants: Record<string, string> = {
  A_place: `${plate}/${product()}/${tail}`,
  B_dropshadow_in_layer: `${plate}/${product(`/e_dropshadow:azimuth_${shadowAz};elevation_${elev};spread_30`)}/${tail}`,
  C_reflection: `${plate}/${reflection}/${product()}/${tail}`,
  D_contact: `${plate}/${contact}/${product()}/${tail}`,
  E_full: `${plate}/${contact}/${product(`/e_dropshadow:azimuth_${shadowAz};elevation_${elev};spread_30`)}/${tail}`,
  F_full_glossy: `${plate}/${reflection}/${contact}/${product(`/e_dropshadow:azimuth_${shadowAz};elevation_${elev};spread_30`)}/${tail}`,
};

for (const [name, t] of Object.entries(variants)) {
  const url = base + t;
  const t0 = Date.now();
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  const rec = { spike: "04-composite", at: new Date().toISOString(), variant: name, http: res.status, ms: Date.now() - t0, bytes: buf.length, cld_error: res.headers.get("x-cld-error"), url };
  if (res.ok) writeFileSync(`${VIEW}/${name}.jpg`, buf);
  appendFileSync("scripts/spikes/out/usage-log.jsonl", JSON.stringify(rec) + "\n");
  console.log(`${name}: HTTP ${res.status} ${rec.ms}ms ${rec.cld_error ?? ""}`);
}
console.log("geometry:", { pw, ph, px, py, baseY, shadowAz, elev });
