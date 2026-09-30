// Exercise every pipeline route over HTTP against a running dev server:
//   npx next dev -p 3001
//   node --conditions=react-server --import tsx scripts/e2e-http.mts [--base http://localhost:3001] [--photo <file>] [--no-generate] [--min-admin 60]
// Uploads one photo to a fresh sku through /api/sign-upload (as the widget / phone page would),
// then capture → analyze → cutout → scenes → QA → pack → zip → generate → jobs, plus negative cases.
// Finally scans every response body for pool account names (must never appear).
// Dev servers answer with x-s2s-admin-calls (Admin API calls main has received from this
// process): the run prints the delta per step, and aborts early when the hourly Admin
// allowance (x-s2s-admin-remaining) is below --min-admin.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { loadEnv } from "./lib/env.mjs";

loadEnv();
const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://localhost:3001" },
    photo: { type: "string", default: "Z:/Projects/Cloudinary/photos/decent/09_neutral_sneaker.png" },
    "no-generate": { type: "boolean", default: false },
    "min-admin": { type: "string", default: "60" },
  },
});
const BASE = values.base!;
const cloud = process.env.CLOUDINARY_CLOUD_NAME!;
const { compositeUrl, defaultControls } = await import("../lib/transform/composite.ts");

const bodies: string[] = [];
/** Admin API calls to main, as reported by the dev server (cumulative per process). */
const admin = { first: NaN, last: NaN, remaining: NaN, steps: [] as { step: string; calls: number; ms: number }[] };
let stepName = "";
let stepAt = NaN;
let stepT0 = Date.now();
function step(name: string) {
  if (stepName) admin.steps.push({ step: stepName, calls: (admin.last || 0) - (stepAt || 0), ms: Date.now() - stepT0 });
  stepName = name;
  stepAt = admin.last;
  stepT0 = Date.now();
  if (name) console.log(`\n▶ ${name}`);
}
let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"} ${what}`);
  if (!ok) failures++;
};

class Jar {
  cookie = "";
  async call(method: string, path: string, body?: unknown) {
    const t0 = Date.now();
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}) },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const calls = Number(res.headers.get("x-s2s-admin-calls"));
    if (res.headers.has("x-s2s-admin-calls") && Number.isFinite(calls)) {
      if (Number.isNaN(admin.first)) admin.first = calls;
      if (Number.isNaN(stepAt)) stepAt = calls;
      admin.last = calls;
    }
    const rem = Number(res.headers.get("x-s2s-admin-remaining"));
    if (res.headers.has("x-s2s-admin-remaining") && Number.isFinite(rem)) admin.remaining = rem;
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await res.text();
    bodies.push(text);
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text.slice(0, 200) };
    }
    return { status: res.status, json, ms: Date.now() - t0, headers: res.headers };
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sku = Array.from({ length: 8 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
const jar = new Jar();
console.log(`base ${BASE}  sku ${sku}`);

step("usage + access");
{
  const u = await jar.call("GET", "/api/usage");
  console.log(`  admin API: ${Number.isNaN(admin.remaining) ? "remaining unknown" : `${admin.remaining} calls left this hour`}; livePipeline=${u.json.livePipeline} transformations=${JSON.stringify(u.json.transformations)} stale=${u.json.stale}`);
  if (admin.remaining < Number(values["min-admin"])) {
    console.log(`  ABORT: fewer than ${values["min-admin"]} Admin API calls left this hour`);
    process.exit(2);
  }
  check(u.status === 200 && typeof (u.json.generation as { usable: number }).usable === "number", `GET /api/usage 200 (${u.ms} ms) liveGeneration=${u.json.liveGeneration}`);
  check(typeof u.json.livePipeline === "boolean" && typeof u.json.transformations === "object", `usage exposes the credit floor: livePipeline=${u.json.livePipeline}`);
  check(Boolean(jar.cookie.startsWith("s2s_access=")), "anonymous session cookie issued");
  const bad = await jar.call("POST", "/api/access", { code: "definitely-wrong" });
  check(bad.status === 403 && bad.json.code === "locked", `wrong access code → ${bad.status} ${bad.json.code}`);
  const junk = await jar.call("POST", "/api/access", "{not json");
  check(junk.status === 400 && junk.json.code === "bad_request", `malformed body → ${junk.status}`);
  const ok = await jar.call("POST", "/api/access", { code: process.env.DEMO_ACCESS_CODE });
  check(ok.status === 200 && ok.json.ok === true, `right access code → ${ok.status} generationsLeft=${ok.json.generationsLeft}`);
}

step("sign-upload + phone-style upload + capture polling");
{
  const ts = Math.floor(Date.now() / 1000);
  const params = { timestamp: ts, source: "uw", upload_preset: "s2s_ingest", public_id: `snap2shelf/products/${sku}/raw`, tags: `s2s,s2s-raw,s2s-sku-${sku}`, context: "origin=phone" };
  for (const [name, p] of [
    ["overwrite param", { ...params, overwrite: "true" }],
    ["other preset", { ...params, upload_preset: "ml_default" }],
    ["other public_id", { ...params, public_id: "snap2shelf/scenes/x/y" }],
    ["spoofed context", { ...params, context: "analyzed=1" }],
  ] as const) {
    const r = await jar.call("POST", "/api/sign-upload", { paramsToSign: p });
    check(r.status === 400 && !("signature" in r.json), `sign-upload refuses ${name} → ${r.status}`);
  }
  const s = await jar.call("POST", "/api/sign-upload", { paramsToSign: params });
  check(s.status === 200 && typeof s.json.signature === "string", `sign-upload signs the allowlisted params (${s.ms} ms)`);

  const before = await jar.call("GET", `/api/capture/${sku}`);
  check(before.status === 200 && before.json.ready === false, `capture before upload → ready=false (${before.ms} ms)`);

  const form = new FormData();
  form.set("file", new Blob([readFileSync(values.photo!)]), basename(values.photo!));
  for (const [k, v] of Object.entries(params)) form.set(k, String(v));
  form.set("api_key", process.env.CLOUDINARY_API_KEY!);
  form.set("signature", String(s.json.signature));
  const t0 = Date.now();
  const up = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: "POST", body: form });
  const upJson = (await up.json()) as { public_id?: string; error?: { message: string } };
  check(up.status === 200 && upJson.public_id === params.public_id, `upload with route signature → ${up.status} (${Date.now() - t0} ms network)`);

  const tUp = Date.now();
  for (let i = 0; i < 10; i++) {
    const c = await jar.call("GET", `/api/capture/${sku}`);
    if (c.json.ready) {
      const p = c.json.product as { rawWidth: number; rawHeight: number };
      check(true, `capture → ready after ${Date.now() - tUp} ms (poll ${i + 1}), raw ${p.rawWidth}x${p.rawHeight}`);
      break;
    }
    if (i === 9) check(false, "capture never became ready");
    await sleep(1000);
  }
}

step("analyze + cutout");
let placement: "standing" | "flatlay" | "hanging" = "standing";
{
  const a = await jar.call("POST", `/api/products/${sku}/analyze`);
  const u = a.json.understanding as { name: string; placement: typeof placement; suggested_themes: string[] };
  placement = u?.placement ?? "standing";
  check(a.status === 200 && typeof a.json.caption === "string", `analyze → ${a.status} (${a.ms} ms) "${a.json.caption}" ${JSON.stringify(u)} tokens=${a.json.tokens}`);
  const again = await jar.call("POST", `/api/products/${sku}/analyze`);
  check(again.status === 200 && again.json.tokens === 0, `analyze again → cached, tokens=0 (${again.ms} ms)`);
  const badSku = await jar.call("POST", `/api/products/BAD..SKU/analyze`);
  check(badSku.status === 400 || badSku.status === 404, `invalid sku → ${badSku.status}`);
  const missing = await jar.call("POST", `/api/products/zzzzzzz0/analyze`);
  check(missing.status === 404 && missing.json.code === "not_found", `unknown sku → ${missing.status}`);

  let cut: Record<string, unknown> | null = null;
  for (let i = 0; i < 10 && !cut; i++) {
    const c = await jar.call("POST", `/api/products/${sku}/cutout`);
    if (c.status === 200) {
      cut = c.json;
      check(true, `cutout → 200 (${c.ms} ms) ${JSON.stringify(c.json.cutout)}`);
    } else if (c.status === 202 && c.json.code === "pending") {
      console.log(`  cutout → 202 pending, retryAfterMs=${c.json.retryAfterMs}`);
      await sleep(Number(c.json.retryAfterMs ?? 2000));
    } else {
      check(false, `cutout → ${c.status} ${JSON.stringify(c.json)}`);
      break;
    }
  }
  const again2 = await jar.call("POST", `/api/products/${sku}/cutout`);
  check(again2.status === 200, `cutout again → cached (${again2.ms} ms)`);
}

step("scenes");
{
  const s = await jar.call("GET", "/api/scenes?view=eye-level");
  check(s.status === 200 && Array.isArray(s.json.scenes), `GET /api/scenes → ${s.status} ${(s.json.scenes as unknown[]).length} scenes, cache-control="${s.headers.get("cache-control")}", set-cookie=${s.headers.has("set-cookie")}`);
}

step("QA + SSRF guard");
const cutoutInfo = (await jar.call("GET", `/api/capture/${sku}`)).json.product as { cutout: { publicId: string; width: number; height: number } };
const dna = { anchor_x: 0.5, anchor_y: 0.65, surface_width: 0.8, light_azimuth: 315, light_elevation: 45, temperature: "warm", glossy: false, text_zone: "top" } as const;
const built = compositeUrl({ scenePublicId: "snap2shelf/spikes/scenes/diwali_teak_42", dna, cutout: cutoutInfo.cutout, placement, controls: defaultControls(placement, dna), cloud });
{
  for (const [name, url] of [
    ["other host", "https://evil.example/snap2shelf/products/x/raw.jpg"],
    ["other cloud", built.url.replace(`/${cloud}/`, "/demo/")],
    ["fetch layer", built.url.replace("c_fill,w_1080,h_1350/", "c_fill,w_1080,h_1350/l_fetch:aHR0cHM6Ly9ldmlsLmV4YW1wbGU=/fl_layer_apply/")],
    ["gen recolor", built.url.replace("c_fill,w_1080,h_1350/", "c_fill,w_1080,h_1350/e_gen_recolor:prompt_shoe;to-color_ff0000/")],
    ["query string", built.url + "?x=1"],
  ]) {
    const r = await jar.call("POST", "/api/qa", { sku, url, kind: "exact" });
    check(r.status === 400, `qa refuses ${name} → ${r.status}`);
  }
  const q = await jar.call("POST", "/api/qa", { sku, url: built.url, kind: "exact" });
  const qa = q.json.qa as { status: string; matched: string[]; reasons: string[] };
  check(q.status === 200 && (qa?.status === "approved" || qa?.status === "rejected"), `exact QA → ${q.status} (${q.ms} ms) ${qa?.status} ${JSON.stringify(qa?.matched)} tokens=${q.json.tokens}`);
}

step("pack");
{
  const bad = await jar.call("POST", "/api/pack", { sku, heroUrl: "https://evil.example/x.jpg", sceneSlug: "diwali-teak-42" });
  check(bad.status === 400, `pack refuses a foreign hero URL → ${bad.status}`);
  const p = await jar.call("POST", "/api/pack", { sku, heroUrl: built.url, sceneSlug: "diwali-teak-42", offer: { english: "Festive price" }, textZone: "top" });
  check(p.status === 200, `POST /api/pack → ${p.status} (${p.ms} ms) hero=${p.json.heroPublicId} pending=${JSON.stringify(p.json.pending)}`);
  let zip = "";
  for (let i = 0; i < 20 && !zip; i++) {
    const s = await jar.call("GET", `/api/pack/${sku}`);
    console.log(`  GET /api/pack/${sku} → ${s.status} (${s.ms} ms) pending=${JSON.stringify(s.json.pending)}`);
    if (s.json.zipUrl) zip = String(s.json.zipUrl);
    else await sleep(2000);
  }
  const z = await fetch(zip);
  const buf = Buffer.from(await z.arrayBuffer());
  check(z.status === 200 && buf.subarray(0, 2).toString() === "PK", `zip → ${z.status} ${buf.length} B`);
  const done = (await jar.call("GET", `/api/pack/${sku}`)).json.assets as { id: string; url: string }[];
  const story = done.find((a) => a.id === "story");
  check(Boolean(story && /\/f_auto,q_auto\/v\d+\/snap2shelf\/products\/[a-z0-9]{8}\/pack\/story$/.test(story.url)), `finished formats are served from their materialised copy (${story?.url.split("/upload/")[1]})`);

  // The sample product (no raw upload) answers its prebuilt pack: no Cloudinary call, no transformation.
  const sampleHero = `https://res.cloudinary.com/${cloud}/image/upload/f_jpg,q_90/snap2shelf/spikes/heroes/shoe_diwali`;
  const sp = await jar.call("POST", "/api/pack", { sku: "sneaker1", heroUrl: sampleHero, sceneSlug: "diwali-teak" });
  const ss = await jar.call("GET", "/api/pack/sneaker1");
  check(sp.status === 200 && (sp.json.pending as string[]).length === 0 && ss.status === 200, `sample pack → ${sp.status} (${sp.ms} ms) ${(sp.json.assets as unknown[])?.length} prebuilt formats; status → ${ss.status} (${ss.ms} ms)`);
}

step("generate + jobs");
{
  const anon = new Jar();
  const locked = await anon.call("POST", "/api/generate", { sku, kind: "creative", model: "flux-2-flash-edit", seed: 11 });
  check(locked.status === 403 && locked.json.code === "locked", `generate without access → ${locked.status} ${locked.json.code}`);
  const tampered = new Jar();
  tampered.cookie = jar.cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  const t = await tampered.call("POST", "/api/generate", { sku, kind: "creative", model: "flux-2-flash-edit", seed: 11 });
  check(t.status === 403, `generate with a tampered cookie → ${t.status} (treated as a new, locked session)`);
  const badModel = await jar.call("POST", "/api/generate", { sku, kind: "creative", model: "gpt-image-2", seed: 11 });
  check(badModel.status === 400, `generate with a model outside the allowlist → ${badModel.status}`);
  const nojob = await jar.call("GET", "/api/jobs/not-a-real-token");
  check(nojob.status === 404, `unknown job token → ${nojob.status}`);

  if (!values["no-generate"]) {
    const g = await jar.call("POST", "/api/generate", { sku, kind: "creative", model: "flux-2-flash-edit", seed: 11, prompt: "on a white marble slab with soft window light" });
    check(g.status === 200 && typeof g.json.job === "string", `generate → ${g.status} (${g.ms} ms)`);
    const job = String(g.json.job);
    const forged = job.slice(0, -3) + (job.endsWith("AAA") ? "BBB" : "AAA");
    const f = await jar.call("GET", `/api/jobs/${forged}`);
    check(f.status === 404, `tampered job token → ${f.status}`);
    const t0 = Date.now();
    for (let i = 0; i < 40; i++) {
      const r = await jar.call("GET", `/api/jobs/${job}`);
      if (r.json.status === "completed" || r.json.status === "failed" || r.status !== 200) {
        const asset = r.json.asset as { publicId: string; qa: unknown; url: string } | undefined;
        check(r.status === 200 && r.json.status === "completed", `job → ${r.json.status} after ${Date.now() - t0} ms: ${asset?.publicId} qa=${JSON.stringify(asset?.qa)} credits=${r.json.credits}`);
        break;
      }
      await sleep(2000);
    }
    const u = await jar.call("GET", "/api/usage");
    check((u.json.session as { generationsLeft: number }).generationsLeft === 3, `usage after one generation → generationsLeft=${(u.json.session as { generationsLeft: number }).generationsLeft}`);
  }
}

step("");
console.log("\n▶ Admin API calls to main (dev-server counter)");
for (const s of admin.steps) console.log(`  ${String(s.calls).padStart(3)}  ${s.step}  (${(s.ms / 1000).toFixed(1)} s)`);
console.log(`  ${String((admin.last || 0) - (admin.first || 0)).padStart(3)}  total after the first response (process counter was ${admin.first} then)`);

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

console.log(`\n${failures ? `${failures} FAILED` : "all checks passed"}  (sku ${sku})`);
process.exit(failures ? 1 : 0);
