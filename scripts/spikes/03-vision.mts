// Spike 3: AI Vision General (Scene DNA JSON) + Tagging (QA) via the key pool.
// Runs each prompt a few times to check JSON reliability; records tokens used.
//   node --conditions=react-server --import tsx scripts/spikes/03-vision.mts --uri <scene url> --product-uri <image url>
import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { loadEnv } from "../lib/env.mjs";

loadEnv();
const pool = await import("../../lib/cloudinary/pool.ts");
const { visionGeneral, visionTagging, parseJsonAnswer } = await import("../../lib/cloudinary/vision.ts");

const { values } = parseArgs({
  options: {
    uri: { type: "string" },
    "product-uri": { type: "string" },
    runs: { type: "string", default: "2" },
  },
});
if (!values.uri) throw new Error("--uri <scene image url> is required");

const sceneDnaSchema = z.object({
  surface_anchor_x: z.number().min(0).max(1),
  surface_anchor_y: z.number().min(0).max(1),
  surface_width: z.number().min(0).max(1),
  light_azimuth: z.number().min(0).max(360),
  light_elevation: z.number().min(0).max(90),
  colour_temperature: z.enum(["warm", "neutral", "cool"]),
  glossy_surface: z.boolean(),
  safe_text_zone: z.enum(["top", "bottom", "left", "right", "top_left", "top_right", "none"]),
  mood: z.string().max(60),
});

const SCENE_DNA_PROMPT = `You are preparing a product-photography backdrop for compositing a product photo onto it.
Return ONLY a JSON object, no prose, with exactly these keys:
{"surface_anchor_x": number 0-1 (horizontal centre of the empty surface area where a product should stand, fraction of image width),
 "surface_anchor_y": number 0-1 (vertical position where the product's base should touch the surface, fraction of image height from the top),
 "surface_width": number 0-1 (width of the clear surface area as a fraction of image width),
 "light_azimuth": number 0-360 (direction the main light comes FROM, degrees clockwise from the top of the image: 0=top, 90=right, 180=bottom, 270=left),
 "light_elevation": number 0-90 (0 = light at the horizon, 90 = directly overhead),
 "colour_temperature": "warm" | "neutral" | "cool",
 "glossy_surface": boolean (true if the surface is reflective like marble, glass or lacquer),
 "safe_text_zone": "top" | "bottom" | "left" | "right" | "top_left" | "top_right" | "none" (the largest calm area for overlay text that will not cover the product),
 "mood": short phrase}`;

const QA_TAGS = [
  { name: "product-visible", description: "A single physical product is clearly visible, in focus, and not cut off by the image edges." },
  { name: "product-distorted", description: "The product looks warped, melted, duplicated, has extra or missing parts, or its shape is physically implausible." },
  { name: "garbled-text", description: "The image contains unreadable, misspelled, nonsensical or fake-looking AI-generated text, letters or logos." },
  { name: "unsafe", description: "The image contains nudity, violence, weapons, drugs or offensive symbols." },
];

const runs = Number(values.runs);
const results: unknown[] = [];
for (let i = 0; i < runs; i++) {
  const t0 = Date.now();
  const { result, account } = await pool.withPooledAccount("ai_vision", (a) => visionGeneral(a, { uri: values.uri! }, [SCENE_DNA_PROMPT]));
  const parsed = parseJsonAnswer(result.answers[0], sceneDnaSchema);
  const rec = {
    spike: "03-vision-general",
    run: i + 1,
    account: account.label,
    latency_ms: Date.now() - t0,
    tokens_used: result.quota?.usedByRequest ?? null,
    tokens_remaining: result.quota?.remaining ?? null,
    json_valid: Boolean(parsed),
    dna: parsed,
    raw: parsed ? undefined : result.answers[0].slice(0, 400),
  };
  results.push(rec);
  console.log(JSON.stringify(rec));
}

for (const [label, uri] of [["scene", values.uri], ["product", values["product-uri"]]] as const) {
  if (!uri) continue;
  const t0 = Date.now();
  const { result, account } = await pool.withPooledAccount("ai_vision", (a) => visionTagging(a, { uri }, QA_TAGS));
  const rec = {
    spike: "03-vision-tagging",
    image: label,
    account: account.label,
    latency_ms: Date.now() - t0,
    tokens_used: result.quota?.usedByRequest ?? null,
    tokens_remaining: result.quota?.remaining ?? null,
    matched: result.matched,
  };
  results.push(rec);
  console.log(JSON.stringify(rec));
}

for (const r of results) appendFileSync("scripts/spikes/out/usage-log.jsonl", JSON.stringify({ at: new Date().toISOString(), ...(r as object) }) + "\n");
const s = await pool.poolSummary("ai_vision");
console.log(`ai_vision pool after: ${s.remaining}/${s.limit} tokens (known=${s.known})`);
