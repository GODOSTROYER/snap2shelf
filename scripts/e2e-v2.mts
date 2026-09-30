// Pipeline v2 over HTTP against a running dev server:
//   npx next dev -p 3006
//   node --conditions=react-server --import tsx scripts/e2e-v2.mts [--base http://localhost:3006] [--sku 9uo8w8pc]
//        [--photo <messy photo>] [--messy-sku <reuse an uploaded one>] [--no-generate] [--no-damaged]
// Exercises: brief bar, scene match, scene reuse (C2), one fresh draft scene (C1, flux-2-flash = 1 credit),
// auto-retouch on a processed sku, on a messy upload (→ cutout from the retouched photo) and on a
// degraded copy of it (small + heavy JPEG), the cost ledger, negative cases, and a leak scan.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { v2 as cloudinary } from "cloudinary";
import { loadEnv } from "./lib/env.mjs";

loadEnv();
const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3006" },
    sku: { type: "string", default: "9uo8w8pc" },
    photo: { type: "string", default: "Z:/Projects/Cloudinary/photos/messy/05_trail_mix_pouch.png" },
    "messy-sku": { type: "string" },
    "no-generate": { type: "boolean", default: false },
    "no-damaged": { type: "boolean", default: false },
  },
});
const BASE = values.base!;
const SKU = values.sku!;
const cloud = process.env.CLOUDINARY_CLOUD_NAME!;
const auth = { cloud_name: cloud, api_key: process.env.CLOUDINARY_API_KEY!, api_secret: process.env.CLOUDINARY_API_SECRET! };
/** Admin lookup whose failures carry the API message only: SDK rejections include request_options.auth (the secret). */
async function adminResource<T>(publicId: string, opts: object = {}): Promise<T> {
  try {
    return (await cloudinary.api.resource(publicId, { ...auth, ...opts })) as T;
  } catch (e) {
    const err = e as { error?: { message?: unknown; http_code?: unknown } };
    throw new Error(`Admin resource lookup failed (${String(err?.error?.http_code ?? "-")}): ${typeof err?.error?.message === "string" ? err.error.message : "unknown"}`);
  }
}

const bodies: string[] = [];
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randomSku = () => Array.from({ length: 8 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
type J = Record<string, unknown>;

class Jar {
  cookie = "";
  async call(method: string, path: string, body?: unknown) {
    const t0 = Date.now();
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    bodies.push(text);
    let json: J = {};
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 200) };
    }
    return { status: res.status, json, ms: Date.now() - t0, headers: res.headers };
  }
}
const jar = new Jar();
const anon = new Jar();
const short = (v: unknown, n = 400) => JSON.stringify(v).slice(0, n);
console.log(`base ${BASE}  processed sku ${SKU}`);

console.log("\n▶ access");
{
  const ok = await jar.call("POST", "/api/access", { code: process.env.DEMO_ACCESS_CODE });
  check(ok.status === 200 && ok.json.ok === true, `unlock → ${ok.status} generationsLeft=${ok.json.generationsLeft}`);
}

// ------------------------------------------------------------------ brief bar
console.log("\n▶ brief bar");
let christmasScenePrompt = "";
{
  const b = await jar.call("POST", "/api/brief", { sku: SKU, brief: "Diwali sale ad, 20% off, Hindi, for WhatsApp + Instagram" });
  const kit = b.json.kit as { theme: string; offer: { hindi?: string; english?: string }; channels: string[]; swatches: string[]; tone: string };
  check(
    b.status === 200 &&
      kit.theme === "diwali" &&
      kit.offer.hindi === "दिवाली सेल · 20% छूट" &&
      kit.offer.english === "Diwali Sale · 20% off" &&
      JSON.stringify(kit.channels) === '["whatsapp","feed","story"]',
    `brief (headline example) → ${b.status} (${b.ms} ms) tokens=${b.json.tokens} cached=${b.json.cached} kit=${short(kit)} sources=${short(b.json.sources)}`,
  );
  const again = await jar.call("POST", "/api/brief", { sku: SKU, brief: "Diwali sale ad, 20% off, Hindi, for WhatsApp + Instagram" });
  check(again.status === 200 && again.json.cached === true && again.json.tokens === 0, `same brief again → cached, tokens=0 (${again.ms} ms)`);

  const x = await jar.call("POST", "/api/brief", { sku: SKU, brief: "Warm gifting post for Instagram, premium feel", festival: "christmas" });
  const xk = x.json.kit as { theme: string; offer: object; channels: string[]; tone: string; swatches: string[] };
  christmasScenePrompt = String(x.json.scenePrompt ?? "");
  check(
    x.status === 200 && x.json.festival === "christmas" && xk.theme === "cafe" && christmasScenePrompt.length > 20,
    `brief + festival chip (christmas) → ${x.status} (${x.ms} ms) tokens=${x.json.tokens} kit=${short(xk)} sources=${short(x.json.sources)}`,
  );
  const free = await jar.call("POST", "/api/brief", { sku: SKU, brief: "Launch post for our new steel bottle, clean and minimal, for the website" });
  check(free.status === 200, `free-form brief (AI fills theme/offer/palette) → ${free.status} (${free.ms} ms) tokens=${free.json.tokens} kit=${short(free.json.kit)} sources=${short(free.json.sources)} scenePrompt="${String(free.json.scenePrompt ?? "").slice(0, 120)}"`);

  const long = await jar.call("POST", "/api/brief", { sku: SKU, brief: "x".repeat(301) });
  check(long.status === 400, `brief > 300 chars → ${long.status}`);
  const fest = await jar.call("POST", "/api/brief", { sku: SKU, brief: "sale", festival: "halloween" });
  check(fest.status === 400, `unknown festival → ${fest.status}`);
  const missing = await jar.call("POST", "/api/brief", { sku: "zzzzzzz0", brief: "sale" });
  check(missing.status === 404, `unknown sku → ${missing.status}`);
}

// ------------------------------------------------------------------ scene match + reuse
console.log("\n▶ scene match");
{
  const m = await anon.call("GET", "/api/scenes/match?theme=diwali&q=" + encodeURIComponent("brass diyas, warm evening"));
  const ms = m.json.matches as { scene: { publicId: string; theme: string }; score: number; reasons: string[] }[];
  check(m.status === 200 && ms[0]?.scene.theme === "diwali" && !m.headers.has("set-cookie"), `match theme=diwali → ${m.status} (${m.ms} ms) top=${ms.slice(0, 3).map((x) => `${x.scene.publicId}:${x.score} [${x.reasons.join("; ")}]`).join(" | ")} cache="${m.headers.get("cache-control")}"`);
  const k = await anon.call("GET", "/api/scenes/match?q=" + encodeURIComponent("light oak counter with fresh herbs"));
  const kt = k.json.matches as { scene: { theme: string }; score: number; reasons: string[] }[];
  check(k.status === 200 && kt[0]?.scene.theme === "kitchen", `match by keywords only → top ${kt[0]?.scene.theme} ${kt[0]?.score} [${kt[0]?.reasons.join("; ")}]`);
  const flat = await anon.call("GET", "/api/scenes/match?view=top-down&q=festive");
  check(flat.status === 200 && (flat.json.matches as { scene: { view: string } }[]).every((x) => x.scene.view === "top-down"), `match view=top-down → only top-down scenes`);
}

console.log("\n▶ scene reuse (C2)");
{
  const r = await anon.call("POST", "/api/scenes/generate", { theme: "diwali", tier: "final", sku: SKU });
  const sc = r.json.scene as { publicId: string; credits: number } | undefined;
  check(r.status === 200 && r.json.reused === true && r.json.credits === 0 && Number(r.json.creditsSaved) > 0, `locked session, library theme → reused=${r.json.reused} credits=${r.json.credits} creditsSaved=${r.json.creditsSaved} ${sc?.publicId} (${r.ms} ms)`);
  const locked = await anon.call("POST", "/api/scenes/generate", { prompt: "a brand new never generated seafoam tabletop " + Date.now(), tier: "draft" });
  check(locked.status === 403 && locked.json.code === "locked", `locked session, new prompt → ${locked.status} ${locked.json.code}`);
  for (const [name, body] of [
    ["no theme or prompt", { tier: "draft" }],
    ["bad tier", { theme: "diwali", tier: "ultra" }],
    ["too-short prompt", { prompt: "tiny", tier: "draft" }],
    ["unknown theme only", { theme: "moon", tier: "draft" }],
  ] as const) {
    const bad = await jar.call("POST", "/api/scenes/generate", body);
    check(bad.status === 400, `generate refuses ${name} → ${bad.status}`);
  }
  const rej = await jar.call("POST", "/api/scenes/generate", { theme: "flatlay-linen", tier: "draft" });
  check(rej.status === 409, `library plate that failed scene QA → ${rej.status} "${rej.json.error}"`);
  const nojob = await jar.call("GET", "/api/scene-jobs/not-a-real-token");
  check(nojob.status === 404, `unknown scene job token → ${nojob.status}`);
}

if (!values["no-generate"]) {
  console.log("\n▶ fresh scene (C1, draft = flux-2-flash)");
  const before = (await jar.call("GET", "/api/usage")).json as { session: { generationsLeft: number }; generation: { usable: number } };
  const req = { theme: "cafe", prompt: christmasScenePrompt, tier: "draft", sku: SKU };
  const g = await jar.call("POST", "/api/scenes/generate", req);
  if (g.json.reused === true) {
    check(true, `scene already generated by an earlier run → reused, creditsSaved=${g.json.creditsSaved} (${g.ms} ms)`);
  } else {
    check(g.status === 200 && typeof g.json.job === "string", `generate → ${g.status} (${g.ms} ms) model=${g.json.modelId} estimatedCredits=${g.json.estimatedCredits}`);
    const job = String(g.json.job);
    const forged = job.slice(0, -3) + (job.endsWith("AAA") ? "BBB" : "AAA");
    check((await jar.call("GET", `/api/scene-jobs/${forged}`)).status === 404, "tampered scene job token → 404");
    const t0 = Date.now();
    for (let i = 0; i < 45; i++) {
      const r = await jar.call("GET", `/api/scene-jobs/${job}`);
      console.log(`  poll ${i + 1}: ${r.status} ${r.json.status} (${r.ms} ms)`);
      if (r.json.status === "completed" || r.json.status === "failed" || r.status !== 200) {
        const s = r.json.scene as { publicId: string; dna: unknown; credits: number; title: string } | undefined;
        check(r.status === 200 && r.json.status === "completed", `scene job → ${r.json.status} after ${Date.now() - t0} ms: ${s?.publicId} "${s?.title}" credits=${r.json.credits} qa=${short(r.json.qa)} dna=${short(s?.dna)}`);
        break;
      }
      await sleep(2000);
    }
    const after = (await jar.call("GET", "/api/usage")).json as { session: { generationsLeft: number } };
    check(after.session.generationsLeft === before.session.generationsLeft - 1, `session cap: generationsLeft ${before.session.generationsLeft} → ${after.session.generationsLeft}`);
  }
  const again = await jar.call("POST", "/api/scenes/generate", req);
  check(again.status === 200 && again.json.reused === true && again.json.credits === 0, `same backdrop again → reused=${again.json.reused} credits=0 creditsSaved=${again.json.creditsSaved} (${again.ms} ms)`);
}

// ------------------------------------------------------------------ retouch
async function retouch(sku: string, label: string) {
  const t0 = Date.now();
  for (let i = 0; i < 30; i++) {
    const r = await jar.call("POST", `/api/products/${sku}/retouch`);
    if (r.status === 202) {
      console.log(`  ${label} retouch → 202 pending (${r.ms} ms) planned=${short(r.json.planned)} detected=${short(r.json.detected)} tokens=${r.json.tokens}`);
      await sleep(Number(r.json.retryAfterMs ?? 2000));
      continue;
    }
    console.log(`  ${label} retouch → ${r.status} (${r.ms} ms, ${Date.now() - t0} ms total) ${short(r.json, 900)}`);
    return r;
  }
  return null;
}

async function uploadRaw(sku: string, bytes: Buffer, filename: string) {
  const ts = Math.floor(Date.now() / 1000);
  const params = { timestamp: ts, source: "uw", upload_preset: "s2s_ingest", public_id: `snap2shelf/products/${sku}/raw`, tags: `s2s,s2s-raw,s2s-sku-${sku}`, context: "origin=e2e" };
  const s = await jar.call("POST", "/api/sign-upload", { paramsToSign: params });
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(bytes)]), filename);
  for (const [k, v] of Object.entries(params)) form.set(k, String(v));
  form.set("api_key", process.env.CLOUDINARY_API_KEY!);
  form.set("signature", String(s.json.signature));
  const up = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: "POST", body: form });
  const j = (await up.json()) as { public_id?: string; width?: number; height?: number; bytes?: number; format?: string };
  check(up.status === 200 && j.public_id === params.public_id, `upload ${filename} → ${sku} ${j.width}x${j.height} ${j.bytes} B ${j.format}`);
  for (let i = 0; i < 10; i++) {
    const c = await jar.call("GET", `/api/capture/${sku}`);
    if (c.json.ready) return;
    await sleep(1000);
  }
}

console.log("\n▶ retouch: processed sku (well-lit photo)");
{
  const r = await retouch(SKU, SKU);
  check(r?.status === 200 && (r.json.status === "none" || r.json.status === "done"), `processed sku → status=${r?.json.status} applied=${short((r?.json.fixes as J)?.applied)}`);
  const bad = await jar.call("POST", "/api/products/BAD..SKU/retouch");
  check(bad.status === 400 || bad.status === 404, `invalid sku → ${bad.status}`);
  const missing = await jar.call("POST", "/api/products/zzzzzzz0/retouch");
  check(missing.status === 404, `unknown sku → ${missing.status}`);
}

console.log("\n▶ retouch: messy photo → analyze → retouch → cutout from the retouched asset");
const messy = values["messy-sku"] ?? randomSku();
{
  if (!values["messy-sku"]) await uploadRaw(messy, readFileSync(values.photo!), basename(values.photo!));
  const a = await jar.call("POST", `/api/products/${messy}/analyze`);
  check(a.status === 200, `analyze → ${a.status} (${a.ms} ms) "${a.json.caption}" focus=${a.json.focus} fixes=${short(a.json.fixes)} tokens=${a.json.tokens}`);
  const r = await retouch(messy, messy);
  const fixes = r?.json.fixes as { applied: string[]; retouchedPublicId?: string } | undefined;
  check(r?.status === 200 && r.json.status === "done" && Boolean(fixes?.retouchedPublicId) && (fixes?.applied.length ?? 0) > 0, `messy photo → ${r?.json.status} applied=${short(fixes?.applied)} chain=${r?.json.transformation} tx=${r?.json.tx}`);
  const a2 = await jar.call("POST", `/api/products/${messy}/analyze`);
  check(a2.status === 200 && JSON.stringify(a2.json.fixes) === JSON.stringify(fixes), `analyze again → fixes ${short(a2.json.fixes)} tokens=${a2.json.tokens}`);
  const again = await jar.call("POST", `/api/products/${messy}/retouch`);
  check(again.status === 200 && again.json.tokens === 0, `retouch again → cached (${again.ms} ms, tokens=0)`);
  let cut: J | null = null;
  for (let i = 0; i < 15 && !cut; i++) {
    const c = await jar.call("POST", `/api/products/${messy}/cutout`);
    if (c.status === 200) cut = c.json;
    else if (c.status === 202) await sleep(Number(c.json.retryAfterMs ?? 2000));
    else break;
  }
  const res = await adminResource<{ context?: { custom?: Record<string, string> }; width: number; height: number }>(`snap2shelf/products/${messy}/cutout`, { context: true });
  check(res.context?.custom?.source === `snap2shelf/products/${messy}/retouched`, `cutout ${res.width}x${res.height} cut from ${res.context?.custom?.source} in ${res.context?.custom?.ms} ms`);
}

let damaged = "";
if (!values["no-damaged"]) {
  console.log("\n▶ retouch: degraded copy (640 px, q_8 JPEG) → restore + upscale");
  damaged = randomSku();
  const src = `https://res.cloudinary.com/${cloud}/image/upload/c_scale,w_640/q_8/f_jpg/snap2shelf/products/${messy}/raw`;
  const buf = Buffer.from(await (await fetch(src)).arrayBuffer());
  await uploadRaw(damaged, buf, "degraded.jpg");
  const r = await retouch(damaged, damaged);
  const fixes = r?.json.fixes as { applied: string[] } | undefined;
  check(r?.status === 200 && r.json.status === "done" && fixes!.applied.includes("resolution") && fixes!.applied.includes("restore"), `degraded → applied=${short(fixes?.applied)} detected=${short(r?.json.detected)} tx=${r?.json.tx}`);
  if (r?.json.url) {
    const h = await fetch(String(r.json.url), { method: "HEAD" });
    console.log(`  retouched view ${h.status} ${h.headers.get("content-type")} ${h.headers.get("content-length")} B`);
    const info = await adminResource<{ width: number; height: number; bytes: number }>(`snap2shelf/products/${damaged}/retouched`);
    check(info.width > 640, `retouched asset ${info.width}x${info.height} (${info.bytes} B) vs 640 px upload`);
  }
}

// ------------------------------------------------------------------ cost ledger
console.log("\n▶ cost ledger");
{
  const c = await anon.call("GET", `/api/cost/${SKU}?scene=${encodeURIComponent("snap2shelf/scenes/diwali/final-59f4388a")}`);
  const cs = c.json.cost as { bytesOriginal: number; bytesDelivered: number; creditsSavedByReuse: number };
  check(c.status === 200 && cs.bytesDelivered > 0 && cs.bytesDelivered < cs.bytesOriginal, `cost ${SKU} → ${c.status} (${c.ms} ms) ${short(c.json.cost)} delivered=${short(c.json.delivered, 300)} wall=${c.json.wallClockSeconds}`);
  console.log(`    breakdown ${short(c.json.breakdown, 1200)}`);
  const m = await anon.call("GET", `/api/cost/${messy}`);
  const mb = m.json.breakdown as { transformations: { label: string }[]; tokens: { label: string }[] };
  check(m.status === 200 && mb.transformations.some((t) => t.label.startsWith("Retouch")) && mb.tokens.some((t) => t.label.startsWith("Auto-retouch")), `cost ${messy} → ${short(m.json.cost)} delivered=${short(m.json.delivered, 200)}`);
  if (damaged) {
    const d = await anon.call("GET", `/api/cost/${damaged}`);
    check(d.status === 200, `cost ${damaged} → ${short(d.json.cost)}`);
  }
  const badScene = await anon.call("GET", `/api/cost/${SKU}?scene=../../etc`);
  check(badScene.status === 400, `cost with a bad scene id → ${badScene.status}`);
  const badSku = await anon.call("GET", `/api/cost/NOPE`);
  check(badSku.status === 400, `cost with a bad sku → ${badSku.status}`);
}

console.log("\n▶ leak scan over all response bodies");
{
  const poolClouds = Object.entries(process.env)
    .filter(([k]) => /^CLOUDINARY_POOL_\d+_CLOUD_NAME$/.test(k))
    .map(([, v]) => v!)
    .filter(Boolean);
  const secrets = [process.env.CLOUDINARY_API_SECRET, process.env.DEMO_ACCESS_CODE, ...Object.entries(process.env).filter(([k]) => /^CLOUDINARY_POOL_\d+_API_(KEY|SECRET)$/.test(k)).map(([, v]) => v)].filter(Boolean) as string[];
  const all = bodies.join("\n");
  check(!poolClouds.some((c) => all.includes(c)), `no pool cloud name in ${bodies.length} responses`);
  check(!/\bpool\d\b/.test(all), "no pool account label in responses");
  check(!secrets.some((s) => all.includes(s)), "no secret / access code in responses");
  check(!/at .+\(.+:\d+:\d+\)/.test(all), "no stack traces in responses");
}

console.log(`\n${failures ? `${failures} FAILED` : "all checks passed"}  (processed ${SKU}, messy ${messy}${damaged ? `, degraded ${damaged}` : ""})`);
process.exit(failures ? 1 : 0);
