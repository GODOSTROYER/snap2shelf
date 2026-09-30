// Admin-API diet + credit floor, against an in-memory fake Cloudinary (no network):
// product facts, pack materialisation, cost ledger, budget guard, prebuilt answers,
// and a simulated kit that must make ZERO Admin API calls.
//   node --conditions=react-server --import tsx --test tests/server4.test.mts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Placeholder values only, never real keys. Main account only (no pool accounts).
process.env.CLOUDINARY_CLOUD_NAME = "maincloud";
process.env.CLOUDINARY_API_KEY = "k0-placeholder";
process.env.CLOUDINARY_API_SECRET = "s0-placeholder";
delete process.env.LIVE_TX_MAX_USED;

const { v2: cloudinary } = await import("cloudinary");

// ------------------------------------------------------------------ fake Cloudinary

type Asset = {
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
};
const store = new Map<string, Asset>();
const key = (rt: string, id: string) => `${rt}:${id}`;
let clock = 1_790_800_000;
const calls = { admin: 0, adminUsage: 0, explicit: 0, upload: 0, uploadsByPublicId: [] as string[], probes: [] as string[], removeTag: 0 };
let usageDoc = { credits: { usage: 16.3, limit: 25 } };
/** Delivery URLs answering 423 (still generating) this many more times. */
const busy = new Map<string, number>();
let adminBehaviour: "ok" | "420" = "ok";

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
  secure_url: `https://res.cloudinary.com/maincloud/${a.resource_type}/upload/v${a.version}/${a.public_id}`,
  ...(Object.keys(a.context).length ? { context: { custom: { ...a.context } } } : {}),
});

function put(rt: "image" | "raw", id: string, patch: Partial<Asset> = {}): Asset {
  const a: Asset = {
    public_id: id,
    resource_type: rt,
    version: ++clock,
    width: 1080,
    height: 1350,
    bytes: 1234,
    format: rt === "raw" ? "" : "jpg",
    tags: [],
    context: {},
    created_at: new Date(clock * 1000).toISOString(),
    ...patch,
  };
  store.set(key(rt, id), a);
  return a;
}

const notFound = (id: string) => ({ message: `Resource not found - ${id}`, http_code: 404 });
const tagsOf = (t: unknown) => (Array.isArray(t) ? (t as string[]) : typeof t === "string" ? t.split(",") : []);

const up = cloudinary.uploader as unknown as Record<string, unknown>;
up.explicit = async (id: string, o: { resource_type?: string; quality_analysis?: boolean }) => {
  calls.explicit++;
  const a = store.get(key(o.resource_type ?? "image", id));
  if (!a) throw notFound(id);
  const r: Record<string, unknown> = toRes(a);
  delete r.context; // explicit doesn't return context
  return o.quality_analysis ? { ...r, quality_analysis: { focus: 0.7 } } : r;
};
up.upload = async (file: string, o: { resource_type?: "image" | "raw"; public_id: string; overwrite?: boolean; tags?: unknown; context?: Record<string, string> }) => {
  calls.upload++;
  calls.uploadsByPublicId.push(o.public_id);
  const rt = o.resource_type ?? "image";
  const existing = store.get(key(rt, o.public_id));
  if (existing && o.overwrite === false) return { ...toRes(existing), existing: true };
  const data = file.startsWith("data:application/json;base64,") ? Buffer.from(file.split(",")[1], "base64").toString() : undefined;
  const isCutout = o.public_id.endsWith("/cutout");
  const a = put(rt, o.public_id, {
    tags: tagsOf(o.tags),
    context: { ...(o.context ?? {}) },
    data,
    ...(isCutout ? { width: 976, height: 523, format: "png" } : {}),
    ...(rt === "raw" ? { bytes: data?.length ?? 0 } : {}),
  });
  return toRes(a);
};
up.add_context = async (ctx: Record<string, string>, ids: string[]) => {
  for (const id of ids) {
    const a = store.get(key("image", id));
    if (a) Object.assign(a.context, ctx);
  }
  return { public_ids: ids };
};
up.add_tag = async (tag: string, ids: string[]) => {
  for (const id of ids) {
    const a = store.get(key("image", id));
    if (a && !a.tags.includes(tag)) a.tags.push(tag);
  }
  return { public_ids: ids };
};
up.remove_tag = async (tag: string, ids: string[]) => {
  calls.removeTag++;
  for (const id of ids) {
    const a = store.get(key("image", id));
    if (a) a.tags = a.tags.filter((t) => t !== tag);
  }
  return { public_ids: ids };
};
const api = cloudinary.api as unknown as Record<string, unknown>;
api.resource = async (id: string) => {
  calls.admin++;
  if (adminBehaviour === "420") throw { error: { message: "Rate Limit Exceeded. Limit of 500 api operations reached. Try again on 2099-01-01 00:00:00 UTC", http_code: 420 }, request_options: { auth: "k0-placeholder:s0-placeholder" } };
  const a = store.get(key("image", id));
  if (!a) throw { error: notFound(id) };
  return { ...toRes(a), rate_limit_remaining: 400 };
};
api.resources = async () => {
  calls.admin++;
  throw new Error("resources listing must not be used");
};

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = init?.method ?? "GET";
  let m: RegExpExecArray | null;
  if ((m = /^https:\/\/res\.cloudinary\.com\/maincloud\/raw\/upload\/v(\d+)\/(.+)$/.exec(url))) {
    const a = store.get(key("raw", m[2]));
    return a?.data ? new Response(a.data, { status: 200, headers: { "content-type": "application/json" } }) : new Response("", { status: 404 });
  }
  if ((m = /^https:\/\/res\.cloudinary\.com\/maincloud\/image\/list\/(.+)\.json$/.exec(url))) {
    const list = [...store.values()].filter((a) => a.resource_type === "image" && a.tags.includes(m![1])).map(toRes);
    return list.length ? new Response(JSON.stringify({ resources: list }), { status: 200 }) : new Response("{}", { status: 404 });
  }
  if ((m = /^https:\/\/api\.cloudinary\.com\/v1_1\/maincloud\/raw\/(explicit|upload)$/.exec(url))) {
    const body = new URLSearchParams(String(init?.body ?? ""));
    const id = body.get("public_id")!;
    if (m[1] === "explicit") {
      const a = store.get(key("raw", id));
      return a ? new Response(JSON.stringify(toRes(a)), { status: 200 }) : new Response(JSON.stringify({ error: notFound(id) }), { status: 404 });
    }
    const data = Buffer.from(body.get("file")!.split(",")[1], "base64").toString();
    const a = put("raw", id, { data, bytes: data.length });
    return new Response(JSON.stringify(toRes(a)), { status: 200 });
  }
  if (/^https:\/\/api\.cloudinary\.com\/v1_1\/maincloud\/usage$/.test(url)) {
    calls.adminUsage++;
    return new Response(JSON.stringify({ ...usageDoc, image_generation: { usage: 10, limit: 50 }, ai_vision: { usage: 1000, limit: 100000 } }), {
      status: 200,
      headers: { "x-featureratelimit-remaining": "450", "x-featureratelimit-limit": "500" },
    });
  }
  if (url.startsWith("https://res.cloudinary.com/maincloud/image/upload/")) {
    calls.probes.push(url);
    const left = busy.get(url) ?? 0;
    if (left > 0) {
      busy.set(url, left - 1);
      return new Response(null, { status: 423 });
    }
    return new Response(method === "HEAD" ? null : "img", { status: 200, headers: { "content-type": "image/avif", "content-length": "54321" } });
  }
  throw new Error("unexpected fetch " + method + " " + url);
}) as typeof fetch;

const admin = await import("../lib/cloudinary/admin.ts");
const pool = await import("../lib/cloudinary/pool.ts");
const facts = await import("../lib/server/facts.ts");
const budget = await import("../lib/server/budget.ts");
const products = await import("../lib/server/products.ts");
const pack = await import("../lib/server/pack.ts");
const cost = await import("../lib/server/cost.ts");
const prebuilt = await import("../lib/server/prebuilt.ts");
const http = await import("../lib/server/http.ts");
const shared = await import("../lib/cloudinary/shared-usage.ts");
const { channelAssets } = await import("../lib/transform/channels.ts");

beforeEach(() => {
  store.clear();
  busy.clear();
  Object.assign(calls, { admin: 0, adminUsage: 0, explicit: 0, upload: 0, uploadsByPublicId: [], probes: [], removeTag: 0 });
  usageDoc = { credits: { usage: 16.3, limit: 25 } };
  adminBehaviour = "ok";
  admin.__resetAdminState();
  pool.__resetPoolState();
  facts.__resetFactsCache();
  delete process.env.LIVE_TX_MAX_USED;
});

const SKU = "abcd1234";
const rawId = `snap2shelf/products/${SKU}/raw`;
const heroUrl = "https://res.cloudinary.com/maincloud/image/upload/c_fill,w_1080,h_1350/l_snap2shelf:products:abcd1234:cutout/fl_layer_apply/f_jpg,q_90/snap2shelf/scenes/diwali/final-59f4388a";

// ------------------------------------------------------------------ pure helpers

test("budget: credit floor decision (default 21 of 25), unknown fails open, 0 switches off", () => {
  assert.equal(budget.liveTxMaxUsed(), 21);
  assert.deepEqual(budget.txBudgetDecision({ used: 16.5, limit: 25 }, 21), { livePipeline: true, reason: "ok" });
  assert.deepEqual(budget.txBudgetDecision({ used: 20.99, limit: 25 }, 21), { livePipeline: true, reason: "ok" });
  assert.deepEqual(budget.txBudgetDecision({ used: 21, limit: 25 }, 21), { livePipeline: false, reason: "floor" });
  assert.deepEqual(budget.txBudgetDecision({ used: 24.2, limit: 25 }, 21), { livePipeline: false, reason: "floor" });
  assert.deepEqual(budget.txBudgetDecision({ used: 10, limit: 10 }, 21), { livePipeline: false, reason: "floor" }, "a smaller plan that is used up");
  assert.deepEqual(budget.txBudgetDecision(null, 21), { livePipeline: true, reason: "unknown" });
  assert.deepEqual(budget.txBudgetDecision({ used: 1, limit: 25 }, 0), { livePipeline: false, reason: "off" });
  process.env.LIVE_TX_MAX_USED = "19.5";
  assert.equal(budget.liveTxMaxUsed(), 19.5);
  process.env.LIVE_TX_MAX_USED = "nonsense";
  assert.equal(budget.liveTxMaxUsed(), 21);
  // Pool offload on: a kit costs main ~7 transformations, so the default floor rises to 24.
  const prevOffload = process.env.S2S_OFFLOAD_POOL;
  process.env.S2S_OFFLOAD_POOL = "1";
  assert.equal(budget.liveTxMaxUsed(), 24);
  process.env.LIVE_TX_MAX_USED = "22";
  assert.equal(budget.liveTxMaxUsed(), 22, "an explicit floor still wins");
  if (prevOffload === undefined) delete process.env.S2S_OFFLOAD_POOL;
  else process.env.S2S_OFFLOAD_POOL = prevOffload;
  process.env.LIVE_TX_MAX_USED = "nonsense";
});

test("facts: parse rejects foreign / malformed docs; factsFromList migrates a legacy product", () => {
  assert.equal(facts.parseFacts({ s: 1, sku: "other123", ctx: {}, at: 0 }, SKU), null);
  assert.equal(facts.parseFacts({ s: 2, sku: SKU, ctx: {}, at: 0 }, SKU), null);
  assert.equal(facts.parseFacts({ s: 1, sku: SKU, ctx: { a: 1 }, at: 0 }, SKU), null);
  assert.ok(facts.parseFacts({ s: 1, sku: SKU, ctx: { a: "1" }, at: 0 }, SKU));

  const p = (leaf: string, ctx: Record<string, string> = {}, v = 100) => ({ public_id: `snap2shelf/products/${SKU}/${leaf}`, version: v, width: 10, height: 20, created_at: "2026-09-30T04:08:10Z", context: { custom: ctx } });
  const hero = `snap2shelf/products/${SKU}/hero-marble-x-1`;
  const f = facts.factsFromList(SKU, [
    p("raw", { analyzed: "1", u_name: "Bottle", hero }),
    p("cutout", { ms: "4200" }),
    p("hero-marble-x-1"),
    p("pack/feed", { hero }, 201),
    p("pack/story", { hero }, 202),
    p("pack/banner", { hero: "an-older-hero" }, 203),
    p("creative-flux-2-flash-edit-7", { qa_status: "approved" }),
    { public_id: "snap2shelf/products/zzzz9999/raw", version: 1 },
  ]);
  assert.equal(f.ctx.u_name, "Bottle");
  assert.equal(f.cutout?.ctx?.ms, "4200");
  assert.ok(f.heroes?.[hero]);
  assert.deepEqual(Object.keys(f.pack!.done).sort(), ["feed", "story"], "only formats of the current hero");
  assert.equal(f.pack!.done.story.v, 202);
  assert.equal(f.creatives?.["creative-flux-2-flash-edit-7"]?.ctx?.qa_status, "approved");
  assert.equal(facts.hasPipelineState(f), true);
  assert.equal(facts.hasPipelineState(facts.factsFromList(SKU, [p("raw", { origin: "phone" })])), false, "upload-time context only");
});

test("pack: recipe-aware reuse, materialised URLs, feed copied from the stored hero", () => {
  const assets = channelAssets({ heroPublicId: "H", cutoutPublicId: "C", alt: "a", offer: { english: "20% off" }, swatches: ["0f766e"], cloud: "maincloud" });
  const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
  const done = Object.fromEntries(assets.map((a) => [a.id, { v: 5, at: 1, h: pack.recipeHash(a.url) }]));
  // same hero, same recipes → everything reusable
  assert.deepEqual(pack.reusableDone({ pack: { hero: "H", done } }, "H", assets).stale, []);
  // edited offer line → only "offer" is redone (it used to be kept, stale, because only the hero was compared)
  const edited = channelAssets({ heroPublicId: "H", cutoutPublicId: "C", alt: "a", offer: { english: "30% off" }, swatches: ["0f766e"], cloud: "maincloud" });
  const r = pack.reusableDone({ pack: { hero: "H", done } }, "H", edited);
  assert.deepEqual(r.stale, ["offer"]);
  assert.ok(!r.done.offer && r.done.story);
  // new hero → all stale; legacy entries without a hash still count for the same hero
  assert.equal(pack.reusableDone({ pack: { hero: "OLD", done } }, "H", assets).stale.length, assets.length);
  assert.ok(pack.reusableDone({ pack: { hero: "H", done: { story: { v: 1, at: 1 } } } }, "H", assets).done.story);

  const fin = pack.finishedAsset(byId.story, "P/story", 77);
  assert.equal(fin.url, "https://res.cloudinary.com/maincloud/image/upload/f_auto,q_auto/v77/P/story", "same URL the kit page builds");
  assert.equal(fin.xray, byId.story.xray, "X-ray keeps the recipe");
  assert.equal(pack.finishedAsset(byId.marketplace, "P/m", 77).url, byId.marketplace.url, "f_jpg format keeps the exact derivative it was made from");
  assert.equal(pack.materialiseSource(byId.feed, "H"), "https://res.cloudinary.com/maincloud/image/upload/H");
  assert.match(pack.materialiseSource(byId.story, "H"), /b_gen_fill,c_pad,w_1080\/f_jpg,q_auto\/H$/);
});

test("cost: ledger from facts only (pack counted for the current hero)", () => {
  const hero = `snap2shelf/products/${SKU}/hero-x-1`;
  const f = {
    s: 1 as const,
    sku: SKU,
    ctx: { analyzed: "1", t_an: "690", ms_an: "4000", hero, fix_plan: "none" },
    raw: { width: 1000, height: 1000, bytes: 2_000_000, format: "png", version: 1790800000, createdAt: "2026-09-30T05:00:00Z" },
    cutout: { publicId: `snap2shelf/products/${SKU}/cutout`, width: 1, height: 1, version: 2, at: Date.parse("2026-09-30T05:00:20Z"), ctx: { ms: "5000" } },
    heroes: { [hero]: { publicId: hero, width: 1080, height: 1350, version: 3, at: Date.parse("2026-09-30T05:01:00Z") } },
    pack: { hero, done: { feed: { v: 4, at: Date.parse("2026-09-30T05:01:30Z") }, story: { v: 5, at: Date.parse("2026-09-30T05:01:40Z") } } },
    at: 0,
  };
  const c = cost.computeCost({ sku: SKU, assets: cost.productAssetsFromFacts(SKU, f), deliveredBytes: 100 });
  const tx = Object.fromEntries(c.breakdown.transformations.map((t) => [t.label, t.tx]));
  assert.equal(tx["Cutout (background removal + trim)"], 76);
  assert.equal(tx["Pack · story"], 51);
  assert.equal(tx["Pack · feed"], 1);
  assert.equal(c.cost.aiVisionTokens, 690);
  assert.equal(c.wallClockSeconds, 100);
});

test("prebuilt: raw-less sample always answers its prebuilt pack; showcase only for its own composite", () => {
  const s = prebuilt.prebuiltPackFor("sneaker1", "https://res.cloudinary.com/x/image/upload/anything");
  assert.ok(s && s.assets.length >= 5 && s.assets.every((a) => a.format !== "hero"));
  assert.ok(prebuilt.isRawlessSample("sneaker1"));
  assert.equal(prebuilt.isRawlessSample("shmessy1"), false);
  assert.equal(prebuilt.prebuiltPackFor("shmessy1", heroUrl), null, "a different composite runs live");
  assert.equal(prebuilt.prebuiltPackFor(SKU, heroUrl), null);
});

test("shared usage doc: strict parsing", () => {
  assert.ok(shared.parseSharedUsage({ s: 1, at: 1, addons: { ai_vision: { used: 1, limit: 2 } }, credits: { used: 1, limit: 25 } }));
  assert.equal(shared.parseSharedUsage({ s: 1, at: 1, addons: { ai_vision: { used: "1", limit: 2 } } }), null);
  assert.equal(shared.parseSharedUsage({ s: 1, at: 1, addons: {}, credits: { used: null, limit: 25 } }), null);
  assert.equal(shared.parseSharedUsage(null), null);
});

// ------------------------------------------------------------------ against the fake

test("facts: fresh product → no doc until the first write; writes merge and bump the version; reads are cached by version", async () => {
  // as the phone page uploads it: sku tag + upload-time context (signed allowlist: origin, capture)
  put("image", rawId, { width: 1122, height: 1402, bytes: 2_000_000, format: "png", tags: ["s2s", "s2s-raw", `s2s-sku-${SKU}`], context: { origin: "phone" } });
  const first = await facts.loadProduct(SKU);
  assert.equal(first.version, 0);
  assert.equal(first.raw.width, 1122);
  assert.deepEqual(first.facts.ctx, { origin: "phone" }, "upload-time context is carried, nothing migrated");
  assert.ok(!store.has(key("raw", facts.factsId(SKU))), "no write for a fresh upload");

  await facts.updateProduct(SKU, { ctx: { analyzed: "1", caption: "a\nb" } });
  await facts.updateProduct(SKU, { mutate: (f) => void (f.cutout = { publicId: "c", width: 1, height: 2, version: 3, at: 4 }) });
  const doc = store.get(key("raw", facts.factsId(SKU)))!;
  const parsed = JSON.parse(doc.data!);
  assert.equal(parsed.ctx.analyzed, "1");
  assert.equal(parsed.ctx.caption, "a b", "cleaned like add_context");
  assert.equal(parsed.cutout.publicId, "c");
  assert.equal(parsed.raw.width, 1122);
  assert.equal(store.get(key("image", rawId))!.context.analyzed, "1", "mirrored to the raw's context");
  assert.ok(store.get(key("image", rawId))!.tags.includes(`s2s-sku-${SKU}`), "raw joins the public sku list");

  const before = calls.explicit;
  const again = await facts.loadProduct(SKU);
  assert.equal(again.facts.ctx.analyzed, "1");
  assert.equal(again.version, doc.version);
  assert.equal(calls.explicit - before, 1, "one explicit (facts version), raw info cached");
  assert.equal(calls.admin, 0);

  await assert.rejects(facts.loadProduct("zzzz0000"), (e: unknown) => (e as { status?: number }).status === 404);
});

test("facts: no doc is ever created for a sku that was never uploaded", async () => {
  assert.equal(await facts.updateProduct("zzzz0000", { ctx: { sc_saved: "5" } }, { critical: false }), null);
  await assert.rejects(facts.updateProduct("zzzz0000", { ctx: { hero: "x" } }), (e: unknown) => (e as { status?: number }).status === 404);
  assert.ok(!store.has(key("raw", facts.factsId("zzzz0000"))));
});

test("facts: concurrent writes in one process are serialised (no lost update)", async () => {
  put("image", rawId);
  await Promise.all(Array.from({ length: 6 }, (_, i) => facts.updateProduct(SKU, { ctx: { [`k${i}`]: String(i) } })));
  const parsed = JSON.parse(store.get(key("raw", facts.factsId(SKU)))!.data!);
  assert.deepEqual(Object.keys(parsed.ctx).sort(), ["k0", "k1", "k2", "k3", "k4", "k5"]);
});

test("facts: legacy product migrates once from the public list, with no Admin call", async () => {
  const hero = `snap2shelf/products/${SKU}/hero-marble-x-1`;
  put("image", rawId, { version: 1_790_740_389, tags: [`s2s-sku-${SKU}`], context: { analyzed: "1", u_name: "Bottle", u_place: "standing", hero } });
  put("image", `snap2shelf/products/${SKU}/cutout`, { tags: [`s2s-sku-${SKU}`], width: 317, height: 1182, format: "png" });
  put("image", `snap2shelf/products/${SKU}/pack/story`, { tags: [`s2s-sku-${SKU}`, `s2s-pack-${SKU}`], context: { hero } });
  const p = await facts.loadProduct(SKU);
  assert.equal(p.facts.migrated, "list");
  assert.equal(p.raw.context.u_name, "Bottle");
  assert.equal((await products.getCutout(SKU, p))?.width, 317);
  assert.ok(p.facts.pack?.done.story);
  assert.ok(store.has(key("raw", facts.factsId(SKU))), "migration persisted: next time it's a plain read");
  assert.equal(calls.admin, 0);
});

test("facts: an old raw missing from the list costs ONE Admin lookup; a 420 there opens the breaker and the product still loads", async () => {
  put("image", rawId, { version: 1_790_740_000, context: { analyzed: "1", u_name: "Old", u_place: "standing" } });
  const p = await facts.loadProduct(SKU);
  assert.equal(p.facts.migrated, "admin");
  assert.equal(p.raw.context.u_name, "Old");
  assert.equal(calls.admin, 1);

  store.clear();
  facts.__resetFactsCache();
  adminBehaviour = "420";
  put("image", rawId, { version: 1_790_740_000, context: { analyzed: "1" } });
  const q = await facts.loadProduct(SKU);
  assert.deepEqual(q.facts.ctx, {}, "no context, but no failure either");
  assert.ok(admin.adminPausedFor("main") > 60_000);
  const sent = calls.admin;
  facts.__resetFactsCache();
  await facts.loadProduct(SKU);
  assert.equal(calls.admin, sent, "breaker open: no further Admin call");
});

test("budget guard: reads main's credits through the shared usage doc; at the floor the live pipeline answers quota_low", async () => {
  // First instance: shared doc missing → one Admin usage call, then it publishes the reading.
  const b1 = await budget.txBudget();
  assert.equal(calls.adminUsage, 1);
  assert.equal(b1.usedCredits, 16.3);
  assert.equal(b1.livePipeline, true);
  assert.ok(store.has(key("raw", shared.SHARED_USAGE_ID)), "reading shared for other instances");

  // Another instance (fresh state): adopts the shared reading, no Admin call.
  pool.__resetPoolState();
  const b2 = await budget.txBudget();
  assert.equal(calls.adminUsage, 1);
  assert.equal(b2.usedCredits, 16.3);

  // At the floor: new derivatives are refused with a friendly quota_low.
  pool.__resetPoolState();
  store.delete(key("raw", shared.SHARED_USAGE_ID));
  usageDoc = { credits: { usage: 21.2, limit: 25 } };
  put("image", rawId);
  await assert.rejects(products.ensureCutout(SKU), (e: unknown) => {
    const h = http.toHttpError(e);
    return h?.status === 503 && h.code === "quota_low" && /showcase|saved examples/i.test(h.publicMessage);
  });
  assert.equal(calls.probes.length, 0, "nothing was derived");
  // …but an existing cutout is still served.
  put("image", `snap2shelf/products/${SKU}/cutout`, { width: 9, height: 9 });
  assert.equal((await products.ensureCutout(SKU)).response.cutout.width, 9);

  // Usage while Cloudinary's Admin API is rate limited: cached numbers, marked stale, no throw.
  admin.__resetAdminState();
  pool.__resetPoolState();
  store.delete(key("raw", shared.SHARED_USAGE_ID));
  admin.openBreaker("main", Date.now() + 30 * 60_000);
  const b3 = await budget.txBudget();
  assert.equal(b3.usedCredits, null);
  assert.equal(b3.livePipeline, true, "unknown fails open");
  assert.equal(pool.usageIsStale(), true);
});

test("simulated live kit: cutout → pack → status → cost makes ZERO Admin API calls", async () => {
  put("image", rawId, { width: 1122, height: 1402, bytes: 2_000_000, format: "png" });
  await facts.updateProduct(SKU, { ctx: { analyzed: "1", caption: "A sneaker", u_name: "Sneaker", u_place: "standing", u_part: "laces" } });

  const cut = await products.ensureCutout(SKU);
  assert.equal(cut.created, true);
  assert.equal((await products.ensureCutout(SKU)).created, false, "second call answers from facts");

  // story + banner still generating on the first pass
  const assets = channelAssets({ heroPublicId: pack.heroPublicId(SKU, "diwali-final", heroUrl), cutoutPublicId: `snap2shelf/products/${SKU}/cutout`, alt: "A sneaker", recolorPart: "laces", swatches: ["0f766e"], offer: { english: "20% off" }, cloud: "maincloud" });
  for (const a of assets) if (a.id === "story" || a.id === "banner") busy.set(a.url.replace("f_auto,q_auto", "f_jpg,q_auto"), 1);

  const started = await pack.startPack({ sku: SKU, heroUrl, sceneSlug: "diwali-final", offer: { english: "20% off" }, recolor: ["0f766e"] });
  assert.deepEqual(started.pending.sort(), ["banner", "story"]);
  const feed = started.assets.find((a) => a.id === "feed")!;
  assert.match(feed.url, /\/f_auto,q_auto\/v\d+\/snap2shelf\/products\/abcd1234\/pack\/feed$/);
  assert.ok(calls.probes.includes(`https://res.cloudinary.com/maincloud/image/upload/${started.heroPublicId}`), "feed copied from the stored hero");

  const status = await pack.packStatus(SKU);
  assert.deepEqual(status.pending, []);
  assert.ok(status.zipUrl);
  const storyUploads = calls.uploadsByPublicId.filter((id) => id.endsWith("/pack/story")).length;
  assert.equal(storyUploads, 1);

  // polling again re-renders nothing
  const uploadsBefore = calls.upload;
  const probesBefore = calls.probes.length;
  const again = await pack.packStatus(SKU);
  assert.deepEqual(again.pending, []);
  assert.equal(calls.probes.length, probesBefore, "no probe");
  assert.equal(calls.upload, uploadsBefore, "no upload");

  const c = await cost.costForProduct(SKU);
  assert.equal(c.delivered.from, "hero");
  assert.match(c.delivered.url, /\/f_auto,q_auto\/v\d+\/snap2shelf\/products\/abcd1234\/hero-/);
  assert.ok(c.breakdown.transformations.some((t) => t.label === "Pack · story"));

  // same hero, edited offer → only the offer format is redone, and the old one leaves the ZIP tag first
  busy.clear();
  const edited = await pack.startPack({ sku: SKU, heroUrl, sceneSlug: "diwali-final", offer: { english: "30% off" }, recolor: ["0f766e"] });
  assert.deepEqual(edited.pending, []);
  assert.equal(calls.uploadsByPublicId.filter((id) => id.endsWith("/pack/offer")).length, 2);
  assert.equal(calls.uploadsByPublicId.filter((id) => id.endsWith("/pack/story")).length, 1);

  assert.equal(calls.admin, 0, "no Admin API resource/resources call");
  assert.equal(admin.adminStats("main").calls, 1, "only the (shared, amortised) usage reading for the credit floor");
});

test("raw-less sample pack and its status answer from prebuilt data with no Cloudinary call", async () => {
  const s = await pack.startPack({ sku: "sneaker1", heroUrl, sceneSlug: "x" });
  assert.ok(s.assets.length >= 5);
  assert.deepEqual(s.pending, []);
  const st = await pack.packStatus("sneaker1");
  assert.deepEqual(st.pending, []);
  assert.equal(st.zipUrl, undefined, "nothing materialised under the sample sku");
  assert.equal(calls.explicit + calls.upload + calls.admin + calls.probes.length, 0);
});
