// Offload (S2S_OFFLOAD_POOL=1): the cutout and generative pack formats render on a key-pool
// account and main stores the results; fallback to main on any pool failure; pool cloud
// names never reach outputs. Against an in-memory fake of three Cloudinary accounts (no network).
//   node --conditions=react-server --import tsx --test tests/offload.test.mts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Placeholder values only, never real keys.
process.env.CLOUDINARY_CLOUD_NAME = "maincloud";
process.env.CLOUDINARY_API_KEY = "k0-placeholder";
process.env.CLOUDINARY_API_SECRET = "s0-placeholder";
process.env.CLOUDINARY_POOL_1_CLOUD_NAME = "poolone";
process.env.CLOUDINARY_POOL_1_API_KEY = "k1-placeholder";
process.env.CLOUDINARY_POOL_1_API_SECRET = "s1-placeholder";
process.env.CLOUDINARY_POOL_2_CLOUD_NAME = "pooltwo";
process.env.CLOUDINARY_POOL_2_API_KEY = "k2-placeholder";
process.env.CLOUDINARY_POOL_2_API_SECRET = "s2-placeholder";
delete process.env.LIVE_TX_MAX_USED;
delete process.env.S2S_OFFLOAD_POOL;

const POOLS = ["poolone", "pooltwo"];
const SECRETS = ["k0-placeholder", "s0-placeholder", "k1-placeholder", "s1-placeholder", "k2-placeholder", "s2-placeholder"];

const { v2: cloudinary } = await import("cloudinary");

// ------------------------------------------------------------------ fake Cloudinary (main + 2 pools)

type Asset = {
  cloud: string;
  public_id: string;
  resource_type: "image" | "raw";
  version: number;
  width: number;
  height: number;
  bytes: number;
  format: string;
  tags: string[];
  context: Record<string, string>;
  created_at: string;
  data?: string;
  from?: string; // upload source (URL / data URI)
};
const store = new Map<string, Asset>();
const key = (cloud: string, rt: string, id: string) => `${cloud}:${rt}:${id}`;
let clock = 1_790_800_000;
const calls = {
  admin: 0,
  usage: [] as string[],
  uploads: [] as { cloud: string; public_id: string; file: string; overwrite?: boolean; tags: string[]; context: Record<string, string> }[],
  probes: [] as string[],
};
const credits: Record<string, { usage: number; limit: number }> = {};
/** Delivery URLs matching `re` answer 423 (still generating) `left` more times. */
const busy: { re: RegExp; left: number }[] = [];
/** Clouds whose derivations fail with this HTTP status. */
const failDerive = new Map<string, number>();
/** Clouds whose Upload API rejects (with a credential-laden SDK error object, as the real SDK does). */
const failUpload = new Set<string>();

const toRes = (a: Asset) => ({
  public_id: a.public_id,
  asset_id: "id-" + a.public_id,
  version: a.version,
  width: a.width,
  height: a.height,
  bytes: a.bytes,
  format: a.format,
  tags: [...a.tags],
  created_at: a.created_at,
  secure_url: `https://res.cloudinary.com/${a.cloud}/${a.resource_type}/upload/v${a.version}/${a.public_id}`,
  ...(Object.keys(a.context).length ? { context: { custom: { ...a.context } } } : {}),
});

function put(cloud: string, rt: "image" | "raw", id: string, patch: Partial<Asset> = {}): Asset {
  const a: Asset = { cloud, public_id: id, resource_type: rt, version: ++clock, width: 1080, height: 1350, bytes: 1234, format: rt === "raw" ? "" : "jpg", tags: [], context: {}, created_at: new Date(clock * 1000).toISOString(), ...patch };
  store.set(key(cloud, rt, id), a);
  return a;
}

const notFound = (id: string) => ({ message: `Resource not found - ${id}`, http_code: 404 });
const tagsOf = (t: unknown) => (Array.isArray(t) ? (t as string[]) : typeof t === "string" ? t.split(",") : []);
type Opts = { cloud_name?: string; api_key?: string; api_secret?: string; resource_type?: "image" | "raw"; public_id: string; overwrite?: boolean; tags?: unknown; context?: Record<string, string>; quality_analysis?: boolean };

const up = cloudinary.uploader as unknown as Record<string, unknown>;
up.explicit = async (id: string, o: Opts) => {
  const a = store.get(key(o.cloud_name ?? "?", o.resource_type ?? "image", id));
  if (!a) throw notFound(id);
  const r: Record<string, unknown> = toRes(a);
  delete r.context;
  return r;
};
up.upload = async (file: string, o: Opts) => {
  const cloud = o.cloud_name ?? "?";
  if (failUpload.has(cloud)) {
    throw { error: { message: `Invalid Signature for api_key ${o.api_key} and api_secret=${o.api_secret}`, http_code: 401 }, request_options: { auth: `${o.api_key}:${o.api_secret}` } };
  }
  const rt = o.resource_type ?? "image";
  calls.uploads.push({ cloud, public_id: o.public_id, file, overwrite: o.overwrite, tags: tagsOf(o.tags), context: { ...(o.context ?? {}) } });
  const existing = store.get(key(cloud, rt, o.public_id));
  if (existing && o.overwrite === false) return { ...toRes(existing), existing: true };
  const data = file.startsWith("data:application/json;base64,") ? Buffer.from(file.split(",")[1], "base64").toString() : undefined;
  const isCutout = o.public_id.endsWith("/cutout");
  const a = put(cloud, rt, o.public_id, {
    tags: tagsOf(o.tags),
    context: { ...(o.context ?? {}) },
    data,
    from: file,
    ...(isCutout ? { width: 976, height: 523, format: "png" } : {}),
    ...(rt === "raw" ? { bytes: data?.length ?? 0 } : {}),
  });
  return toRes(a);
};
up.add_context = async (ctx: Record<string, string>, ids: string[]) => {
  for (const id of ids) {
    const a = store.get(key("maincloud", "image", id));
    if (a) Object.assign(a.context, ctx);
  }
  return { public_ids: ids };
};
up.add_tag = async (tag: string, ids: string[]) => {
  for (const id of ids) {
    const a = store.get(key("maincloud", "image", id));
    if (a && !a.tags.includes(tag)) a.tags.push(tag);
  }
  return { public_ids: ids };
};
up.remove_tag = async (tag: string, ids: string[]) => {
  for (const id of ids) {
    const a = store.get(key("maincloud", "image", id));
    if (a) a.tags = a.tags.filter((t) => t !== tag);
  }
  return { public_ids: ids };
};
const api = cloudinary.api as unknown as Record<string, unknown>;
api.resource = async () => {
  calls.admin++;
  throw new Error("no Admin resource call expected");
};
api.resources = async () => {
  calls.admin++;
  throw new Error("no Admin resources call expected");
};

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = init?.method ?? "GET";
  let m: RegExpExecArray | null;
  if ((m = /^https:\/\/res\.cloudinary\.com\/maincloud\/raw\/upload\/v(\d+)\/(.+)$/.exec(url))) {
    const a = store.get(key("maincloud", "raw", m[2]));
    return a?.data ? new Response(a.data, { status: 200, headers: { "content-type": "application/json" } }) : new Response("", { status: 404 });
  }
  if ((m = /^https:\/\/api\.cloudinary\.com\/v1_1\/maincloud\/raw\/(explicit|upload)$/.exec(url))) {
    const body = new URLSearchParams(String(init?.body ?? ""));
    const id = body.get("public_id")!;
    if (m[1] === "explicit") {
      const a = store.get(key("maincloud", "raw", id));
      return a ? new Response(JSON.stringify(toRes(a)), { status: 200 }) : new Response(JSON.stringify({ error: notFound(id) }), { status: 404 });
    }
    const data = Buffer.from(body.get("file")!.split(",")[1], "base64").toString();
    const a = put("maincloud", "raw", id, { data, bytes: data.length });
    return new Response(JSON.stringify(toRes(a)), { status: 200 });
  }
  if ((m = /^https:\/\/api\.cloudinary\.com\/v1_1\/([a-z]+)\/usage$/.exec(url))) {
    calls.usage.push(m[1]);
    return new Response(JSON.stringify({ credits: credits[m[1]], image_generation: { usage: 0, limit: 50 }, ai_vision: { usage: 0, limit: 100000 } }), {
      status: 200,
      headers: { "x-featureratelimit-remaining": "450", "x-featureratelimit-limit": "500" },
    });
  }
  if ((m = /^https:\/\/res\.cloudinary\.com\/([a-z]+)\/image\/upload\/(.+)$/.exec(url))) {
    const cloud = m[1];
    calls.probes.push(url);
    const b = busy.find((x) => x.left > 0 && x.re.test(url));
    if (b) {
      b.left--;
      return new Response(null, { status: 423 });
    }
    const fail = failDerive.get(cloud);
    if (fail && /e_background_removal|b_gen_fill|e_gen_/.test(m[2])) return new Response(null, { status: fail, headers: { "x-cld-error": `derivation failed on ${cloud}` } });
    return new Response(method === "HEAD" ? null : "img", { status: 200, headers: { "content-type": "image/jpeg", "content-length": "54321" } });
  }
  throw new Error("unexpected fetch " + method + " " + url);
}) as typeof fetch;

const admin = await import("../lib/cloudinary/admin.ts");
const pool = await import("../lib/cloudinary/pool.ts");
const cldOffload = await import("../lib/cloudinary/offload.ts");
const facts = await import("../lib/server/facts.ts");
const products = await import("../lib/server/products.ts");
const pack = await import("../lib/server/pack.ts");
const cost = await import("../lib/server/cost.ts");
const offload = await import("../lib/server/offload.ts");
const { channelAssets } = await import("../lib/transform/channels.ts");

const logs: string[] = [];
for (const level of ["info", "warn", "error"] as const) {
  console[level] = (...args: unknown[]) => void logs.push(args.map(String).join(" "));
}

beforeEach(() => {
  store.clear();
  busy.length = 0;
  failDerive.clear();
  failUpload.clear();
  logs.length = 0;
  Object.assign(calls, { admin: 0, usage: [], uploads: [], probes: [] });
  credits.maincloud = { usage: 19.24, limit: 25 };
  credits.poolone = { usage: 3, limit: 25 };
  credits.pooltwo = { usage: 0.2, limit: 25 }; // most left: ranked first
  admin.__resetAdminState();
  pool.__resetPoolState();
  facts.__resetFactsCache();
  cldOffload.__resetPoolCopies();
  offload.__resetOffloadState();
  delete process.env.S2S_OFFLOAD_POOL;
});

const SKU = "abcd1234";
const rawId = `snap2shelf/products/${SKU}/raw`;
const cutId = `snap2shelf/products/${SKU}/cutout`;
const heroUrl = "https://res.cloudinary.com/maincloud/image/upload/c_fill,w_1080,h_1350/l_snap2shelf:products:abcd1234:cutout/fl_layer_apply/f_jpg,q_90/snap2shelf/scenes/diwali/final-59f4388a";
const GEN = /e_background_removal|b_gen_fill|e_gen_/;

async function seedProduct() {
  put("maincloud", "image", rawId, { width: 1122, height: 1402, bytes: 2_000_000, format: "png" });
  await facts.updateProduct(SKU, { ctx: { analyzed: "1", caption: "A sneaker", u_name: "Sneaker", u_place: "standing", u_part: "upper body" } });
}
const mainUploads = (suffix: string) => calls.uploads.filter((u) => u.cloud === "maincloud" && u.public_id.endsWith(suffix));
const poolUploads = () => calls.uploads.filter((u) => POOLS.includes(u.cloud));
const noPoolNames = (s: string) => !POOLS.some((c) => s.includes(c)) && !/\bpool\d\b/.test(s);
const factsDoc = () => store.get(key("maincloud", "raw", facts.factsId(SKU)))!.data!;

// ------------------------------------------------------------------ pure

test("poolRecipe: generative recipes move to the pool copy; everything else stays on main", () => {
  const hero = `snap2shelf/products/${SKU}/hero-diwali-1a2b3c4d`;
  const assets = channelAssets({ heroPublicId: hero, cutoutPublicId: cutId, alt: "a", recolorPart: "upper body", swatches: ["0f766e"], offer: { english: "20% off" }, cloud: "maincloud" });
  const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
  assert.equal(offload.poolRecipe(byId.story.url, hero), "ar_9:16,b_gen_fill,c_pad,w_1080/f_auto,q_auto");
  assert.equal(offload.poolRecipe(byId.banner.url, hero), "ar_16:9,b_gen_fill,c_pad,w_1920/f_auto,q_auto");
  assert.equal(offload.poolRecipe(byId["recolor-0f766e"].url, hero), "e_gen_recolor:prompt_upper%20body;to-color_0f766e/f_auto,q_auto");
  for (const id of ["feed", "marketplace", "whatsapp", "offer"]) assert.equal(offload.poolRecipe(byId[id].url, hero), null, id);

  const base = "https://res.cloudinary.com/maincloud/image/upload";
  // a layer of the source itself follows it to the pool copy; any other layer or a named transformation stays on main
  assert.equal(
    offload.poolRecipe(`${base}/b_gen_fill,ar_1:1,c_pad/l_${hero.replace(/\//g, ":")}/fl_layer_apply/${hero}`, hero),
    `b_gen_fill,ar_1:1,c_pad/l_s2s-offload:${hero.replace(/\//g, ":")}/fl_layer_apply`,
  );
  assert.equal(offload.poolRecipe(`${base}/b_gen_fill,ar_1:1,c_pad/l_snap2shelf:other/fl_layer_apply/${hero}`, hero), null);
  assert.equal(offload.poolRecipe(`${base}/e_gen_recolor:prompt_x;to-color_ff0000/l_text:Noto%20Sans@google_40:Hi,co_white/fl_layer_apply/${hero}`, hero)?.includes("l_text:"), true);
  assert.equal(offload.poolRecipe(`${base}/t_s2s_story/e_gen_restore/${hero}`, hero), null);
  assert.equal(offload.poolRecipe(`https://res.cloudinary.com/othercloud/image/upload/b_gen_fill,ar_1:1/${hero}`, hero), null);
  assert.equal(offload.poolRecipe(`${base}/b_gen_fill,ar_1:1/some/other/id`, hero), null);
  assert.ok(offload.isExpensiveTransformation(products.CUTOUT_CHAIN));
  assert.ok(!offload.isExpensiveTransformation("c_fill,w_600,h_600,g_auto/f_auto,q_auto"));
});

test("pool: `transformations` ranks by plan credits left, floor 2", async () => {
  const ranked = await pool.rankAccounts("transformations", 0.1);
  assert.deepEqual(ranked.map((a) => a.label), ["pool2", "pool1", "main"]);
  pool.__resetPoolState();
  credits.pooltwo = { usage: 23.5, limit: 25 }; // 1.5 left < floor
  assert.deepEqual((await pool.rankAccounts("transformations", 0.1)).map((a) => a.label), ["pool1", "main"]);
});

// ------------------------------------------------------------------ flag off: nothing changes

test("flag off: cutout and pack render on main exactly as before; no pool call", async () => {
  await seedProduct();
  const cut = await products.ensureCutout(SKU);
  assert.equal(cut.created, true);
  const started = await pack.startPack({ sku: SKU, heroUrl, sceneSlug: "diwali-final", offer: { english: "20% off" }, recolor: ["0f766e"] });
  assert.deepEqual(started.pending, []);
  assert.equal(poolUploads().length, 0);
  assert.ok(calls.probes.every((u) => u.startsWith("https://res.cloudinary.com/maincloud/")));
  assert.ok(calls.probes.some((u) => /\/e_background_removal\/e_trim\/f_png\/snap2shelf\/products\/abcd1234\/raw$/.test(u)));
  assert.ok(calls.probes.some((u) => u.includes("b_gen_fill")) && calls.probes.some((u) => u.includes("e_gen_recolor")));
  assert.equal(JSON.parse(factsDoc()).cutout.o, undefined);
});

// ------------------------------------------------------------------ flag on

test("flag on: cutout renders on the pool account with most credits; main stores it under the same id, tags and context", async () => {
  process.env.S2S_OFFLOAD_POOL = "1";
  await seedProduct();
  const cut = await products.ensureCutout(SKU);
  assert.equal(cut.created, true);
  assert.equal(cut.response.cutout.publicId, cutId);

  const copies = poolUploads();
  assert.equal(copies.length, 1);
  assert.deepEqual(
    { cloud: copies[0].cloud, public_id: copies[0].public_id, file: copies[0].file, overwrite: copies[0].overwrite },
    { cloud: "pooltwo", public_id: `s2s-offload/${rawId}`, file: `https://res.cloudinary.com/maincloud/image/upload/${rawId}`, overwrite: false },
    "plain copy of main's original (no transformation on main)",
  );
  const saved = mainUploads("/cutout");
  assert.equal(saved.length, 1);
  assert.match(saved[0].file, /^https:\/\/res\.cloudinary\.com\/pooltwo\/image\/upload\/e_background_removal\/e_trim\/f_png\/v\d+\/s2s-offload\/snap2shelf\/products\/abcd1234\/raw$/);
  assert.equal(saved[0].overwrite, false);
  assert.deepEqual(saved[0].tags, ["s2s", "s2s-cutout", `s2s-sku-${SKU}`]);
  assert.deepEqual(Object.keys(saved[0].context).sort(), ["chain", "ms", "source"]);
  assert.equal(saved[0].context.source, rawId);
  assert.equal(saved[0].context.chain, products.CUTOUT_CHAIN);

  assert.ok(!calls.probes.some((u) => u.startsWith("https://res.cloudinary.com/maincloud/") && GEN.test(u)), "main derived no background removal");
  const doc = JSON.parse(factsDoc());
  assert.equal(doc.cutout.o, 1);
  assert.ok(noPoolNames(factsDoc()), "facts hold no pool name");
  assert.ok(noPoolNames(JSON.stringify(cut)), "response holds no pool name");
  assert.ok(noPoolNames(JSON.stringify(store.get(key("maincloud", "image", cutId))!.context)));

  const c = await cost.costForProduct(SKU);
  assert.ok(c.breakdown.transformations.some((t) => t.label === "Cutout (background removal + trim) · key pool"));
  assert.ok(noPoolNames(JSON.stringify(c)));
  assert.equal(calls.admin, 0, "no Admin resource/resources call");
  assert.deepEqual([...new Set(calls.usage)].sort(), ["maincloud", "poolone", "pooltwo"], "ranking uses the usage reading the credit floor already makes");
  assert.equal(calls.usage.length, 3, "one reading per account");
  assert.ok(logs.some((l) => l.includes("[offload] cutout: rendered on pool2")));
});

test("flag on: a cutout still rendering answers pending, and the retry polls the same pool account", async () => {
  process.env.S2S_OFFLOAD_POOL = "1";
  await seedProduct();
  busy.push({ re: /\/pooltwo\/.*e_background_removal/, left: 2 });
  await assert.rejects(products.ensureCutout(SKU, 3000), (e: unknown) => (e as { code?: string }).code === "pending");
  assert.equal(mainUploads("/cutout").length, 0);
  // pool two now looks worse than pool one, but the render under way stays where it started
  pool.__resetPoolState();
  credits.pooltwo = { usage: 10, limit: 25 };
  const cut = await products.ensureCutout(SKU);
  assert.equal(cut.created, true);
  assert.deepEqual(poolUploads().map((u) => u.cloud), ["pooltwo"], "one copy, on the account that started the render");
  assert.match(mainUploads("/cutout")[0].file, /\/pooltwo\//);
});

test("flag on: pack renders gen fill + recolor on the pool (one hero copy), the rest on main; ZIP and assets stay on main", async () => {
  process.env.S2S_OFFLOAD_POOL = "1";
  await seedProduct();
  await products.ensureCutout(SKU);
  const hero = pack.heroPublicId(SKU, "diwali-final", heroUrl);
  const started0 = calls.uploads.length;
  // story still generating on the pool at first
  busy.push({ re: /\/pooltwo\/image\/upload\/ar_9:16,b_gen_fill/, left: 1 });

  const started = await pack.startPack({ sku: SKU, heroUrl, sceneSlug: "diwali-final", offer: { english: "20% off" }, recolor: ["0f766e"] });
  assert.deepEqual(started.pending, ["story"], "story still rendering on the pool: the client polls");
  const status = await pack.packStatus(SKU);
  const final = status;
  assert.deepEqual(final.pending, []);
  assert.deepEqual(final.failed, []);

  const heroCopies = poolUploads().filter((u) => u.public_id === `s2s-offload/${hero}`);
  assert.equal(heroCopies.length, 1, "story, banner and recolor share one pool copy of the hero");
  assert.equal(heroCopies[0].file, `https://res.cloudinary.com/maincloud/image/upload/${hero}`);
  for (const id of ["story", "banner", "recolor-0f766e"]) {
    const u = mainUploads(`/pack/${id}`);
    assert.equal(u.length, 1, id);
    assert.match(u[0].file, /^https:\/\/res\.cloudinary\.com\/pooltwo\/image\/upload\/.+\/f_jpg,q_auto\/v\d+\/s2s-offload\//, id);
    assert.deepEqual(u[0].context, { hero, format: id.startsWith("recolor") ? "recolor" : id, label: u[0].context.label }, id);
    assert.ok(u[0].tags.includes(`s2s-pack-${SKU}`), id);
  }
  for (const id of ["feed", "marketplace", "whatsapp", "offer"]) {
    const u = mainUploads(`/pack/${id}`);
    assert.equal(u.length, 1, id);
    assert.match(u[0].file, /^https:\/\/res\.cloudinary\.com\/maincloud\//, id);
  }
  assert.ok(!calls.probes.some((u) => u.startsWith("https://res.cloudinary.com/maincloud/") && GEN.test(u)), "main derived nothing generative");
  assert.ok(calls.uploads.length > started0);

  // everything the client gets is on main: materialised f_auto URLs, a main ZIP by tag
  assert.ok(final.assets.every((a) => a.url.startsWith("https://res.cloudinary.com/maincloud/")));
  const story = final.assets.find((a) => a.id === "story")!;
  assert.match(story.url, /\/f_auto,q_auto\/v\d+\/snap2shelf\/products\/abcd1234\/pack\/story$/);
  const zip = status.zipUrl!;
  assert.match(zip, /^https:\/\/api\.cloudinary\.com\/v1_1\/maincloud\/image\/generate_archive\?/);
  assert.ok(!/transformations|b_gen_fill|e_gen_/.test(decodeURIComponent(zip)), "ZIP of stored assets: no derivation");
  assert.ok(noPoolNames(JSON.stringify({ started, status, zip })), "no pool name in any response");

  const doc = JSON.parse(factsDoc());
  assert.equal(doc.pack.done.story.o, 1);
  assert.equal(doc.pack.done["recolor-0f766e"].o, 1);
  assert.equal(doc.pack.done.marketplace.o, undefined);
  assert.ok(noPoolNames(factsDoc()));

  const c = await cost.costForProduct(SKU);
  const labels = c.breakdown.transformations.map((t) => t.label);
  assert.ok(labels.includes("Pack · story · key pool") && labels.includes("Pack · recolor-0f766e · key pool") && labels.includes("Pack · marketplace"));
  assert.equal(calls.admin, 0);
});

// ------------------------------------------------------------------ fallback

test("fallback: a failing pool account is benched and the next one renders; secrets and pool names stay out of the logs", async () => {
  process.env.S2S_OFFLOAD_POOL = "1";
  await seedProduct();
  failUpload.add("pooltwo"); // e.g. revoked key: the SDK error object carries the credentials
  const cut = await products.ensureCutout(SKU);
  assert.equal(cut.created, true);
  assert.match(mainUploads("/cutout")[0].file, /\/poolone\//);
  assert.deepEqual((await pool.rankAccounts("transformations", 0.1)).map((a) => a.label), ["pool1", "main"], "pool2 benched");
  const text = logs.join("\n");
  assert.ok(/\[offload\] cutout: pool2 failed .*trying the next pool account/.test(text), text);
  assert.ok(!SECRETS.some((s) => text.includes(s)), "no key or secret in logs");
  assert.ok(!POOLS.some((c) => text.includes(c)), "logs name pool accounts by label only");
});

test("fallback: when every pool account fails, main renders the cutout and the pack as before", async () => {
  process.env.S2S_OFFLOAD_POOL = "1";
  await seedProduct();
  failDerive.set("pooltwo", 503);
  failDerive.set("poolone", 500);
  const cut = await products.ensureCutout(SKU);
  assert.equal(cut.created, true);
  assert.match(mainUploads("/cutout")[0].file, /^https:\/\/res\.cloudinary\.com\/maincloud\/image\/upload\/e_background_removal\/e_trim\/f_png\//);
  assert.equal(JSON.parse(factsDoc()).cutout.o, undefined, "made on main");
  assert.ok(logs.some((l) => /\[offload\] cutout: pool1 failed .*main renders it/.test(l)));

  // both pools are benched now: the pack goes straight to main
  const started = await pack.startPack({ sku: SKU, heroUrl, sceneSlug: "diwali-final", recolor: ["0f766e"] });
  assert.deepEqual(started.pending, []);
  assert.deepEqual(started.failed, []);
  assert.match(mainUploads("/pack/story")[0].file, /^https:\/\/res\.cloudinary\.com\/maincloud\/.*b_gen_fill/);
  assert.ok(logs.some((l) => /\[offload\] pack story: no pool account available; main renders it/.test(l)));
  assert.ok(noPoolNames(JSON.stringify(started)));
});

test("fallback: pools below the floor are never used, and main is never an offload target", async () => {
  process.env.S2S_OFFLOAD_POOL = "1";
  credits.poolone = { usage: 24, limit: 25 };
  credits.pooltwo = { usage: 23.5, limit: 25 };
  await seedProduct();
  await products.ensureCutout(SKU);
  assert.equal(poolUploads().length, 0);
  assert.match(mainUploads("/cutout")[0].file, /^https:\/\/res\.cloudinary\.com\/maincloud\//);
});

test("fallback: if main can't store the pool render, main renders it itself (the pool is not benched)", async () => {
  process.env.S2S_OFFLOAD_POOL = "1";
  await seedProduct();
  const orig = up.upload as (file: string, o: Opts) => Promise<unknown>;
  let refused = 0;
  up.upload = async (file: string, o: Opts) => {
    if (o.cloud_name === "maincloud" && o.public_id === cutId && file.includes("/pooltwo/")) {
      refused++;
      throw { error: { message: "Error in loading remote resource", http_code: 400 } };
    }
    return orig(file, o);
  };
  try {
    const cut = await products.ensureCutout(SKU);
    assert.equal(cut.created, true);
  } finally {
    up.upload = orig;
  }
  assert.equal(refused, 1);
  assert.match(mainUploads("/cutout")[0].file, /^https:\/\/res\.cloudinary\.com\/maincloud\//);
  assert.deepEqual((await pool.rankAccounts("transformations", 0.1)).map((a) => a.label), ["pool2", "pool1", "main"], "pool2 not benched");
});

test("fallback: a 400 from the derivation is about this image: no bench, no second pool account, main's path decides", async () => {
  process.env.S2S_OFFLOAD_POOL = "1";
  await seedProduct();
  await products.ensureCutout(SKU);
  failDerive.set("pooltwo", 400); // e.g. "Invalid input for gen_recolor"
  failDerive.set("maincloud", 400);
  const started = await pack.startPack({ sku: SKU, heroUrl, sceneSlug: "diwali-final", recolor: ["0f766e"] });
  assert.deepEqual(started.failed.sort(), ["banner", "recolor-0f766e", "story"], "as without offload: main answers 400 too");
  assert.equal(poolUploads().filter((u) => u.cloud === "poolone").length, 0, "the other pool account was not tried");
  assert.deepEqual((await pool.rankAccounts("transformations", 0.1)).map((a) => a.label), ["pool2", "pool1", "main"], "nobody benched");
  assert.ok(logs.some((l) => /\[offload\] pack recolor-0f766e: pool2 rejected this input \(delivery HTTP 400/.test(l)));
});

test("prewarm: copies the source to the pool account the cutout will use and starts the derivation; no-op with the flag off", async () => {
  await seedProduct();
  await offload.prewarmCutout(rawId, products.CUTOUT_CHAIN);
  assert.equal(poolUploads().length + calls.probes.length, 0, "flag off: nothing");

  process.env.S2S_OFFLOAD_POOL = "1";
  await offload.prewarmCutout(rawId, products.CUTOUT_CHAIN);
  assert.deepEqual(poolUploads().map((u) => `${u.cloud} ${u.public_id}`), [`pooltwo s2s-offload/${rawId}`]);
  assert.equal(calls.probes.filter((u) => u.includes("/pooltwo/") && u.includes("e_background_removal")).length, 1, "derivation started");
  // the ranking changes, but the cutout goes where the render already started, reusing the copy
  pool.__resetPoolState();
  credits.pooltwo = { usage: 10, limit: 25 };
  const cut = await products.ensureCutout(SKU);
  assert.equal(cut.created, true);
  assert.equal(poolUploads().length, 1, "no second copy");
  assert.match(mainUploads("/cutout")[0].file, /\/pooltwo\//);
});

test("prewarm: bounded and silent when the pool is slow or failing", async () => {
  process.env.S2S_OFFLOAD_POOL = "1";
  await seedProduct();
  failUpload.add("pooltwo");
  const t0 = Date.now();
  await offload.prewarmCutout(rawId, products.CUTOUT_CHAIN, 300);
  assert.ok(Date.now() - t0 < 1000);
  assert.ok(logs.some((l) => l.startsWith("[offload] cutout prewarm:")));
  assert.ok(!SECRETS.some((x) => logs.join("\n").includes(x)));
});
