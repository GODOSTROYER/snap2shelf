// Showcase write locks + AI Vision token ledger, against an in-memory fake Cloudinary (no network).
// Route handlers are called directly with signed session cookies:
//   - sample / showcase products are read-only without the access code (403 read_only, or the stored answer);
//   - the demo shelf is reserved; anonymous shelves only from products created in this browser;
//   - /api/sign-upload never signs a showcase public id and records the skus a browser creates;
//   - QA and readiness tokens reach the cost receipt.
//   node --conditions=react-server --import tsx --test tests/server5.test.mts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Placeholder credentials only, never real keys. The cloud name is the public demo cloud, so the
// showcase's recorded URLs (data/showcase.json) pass the SSRF guard exactly as they do live.
process.env.CLOUDINARY_CLOUD_NAME = "nyxyma1i";
process.env.CLOUDINARY_API_KEY = "k0-placeholder";
process.env.CLOUDINARY_API_SECRET = "s0-placeholder";
delete process.env.LIVE_TX_MAX_USED;
delete process.env.S2S_PROTECTED_SKUS;
delete process.env.S2S_PROTECTED_SHOPS;
const CLOUD = "nyxyma1i";

const { v2: cloudinary } = await import("cloudinary");
const { NextRequest } = await import("next/server");

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
let clock = Math.floor(Date.now() / 1000) - 3600;
const calls = { admin: 0, explicit: 0, upload: 0, addContext: 0, addTag: 0, removeTag: 0, vision: 0, uploads: [] as string[] };
const NOT_WRITTEN = () => calls.upload + calls.addContext + calls.addTag + calls.removeTag;

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
  secure_url: `https://res.cloudinary.com/${CLOUD}/${a.resource_type}/upload/v${a.version}/${a.public_id}`,
  ...(Object.keys(a.context).length ? { context: { custom: { ...a.context } } } : {}),
});

function put(rt: "image" | "raw", id: string, patch: Partial<Asset> = {}): Asset {
  const version = patch.version ?? ++clock;
  const a: Asset = {
    public_id: id,
    resource_type: rt,
    width: 1080,
    height: 1350,
    bytes: 1234,
    format: rt === "raw" ? "" : "jpg",
    tags: [],
    context: {},
    created_at: new Date(version * 1000).toISOString(),
    ...patch,
    version,
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
  delete r.context;
  return r;
};
up.upload = async (file: string, o: { resource_type?: "image" | "raw"; public_id: string; overwrite?: boolean; tags?: unknown; context?: Record<string, string> }) => {
  calls.upload++;
  calls.uploads.push(o.public_id);
  const rt = o.resource_type ?? "image";
  const existing = store.get(key(rt, o.public_id));
  if (existing && o.overwrite === false) return { ...toRes(existing), existing: true };
  const data = file.startsWith("data:application/json;base64,") ? Buffer.from(file.split(",")[1], "base64").toString() : undefined;
  return toRes(put(rt, o.public_id, { tags: tagsOf(o.tags), context: { ...(o.context ?? {}) }, data, ...(rt === "raw" ? { bytes: data?.length ?? 0 } : {}) }));
};
up.add_context = async (ctx: Record<string, string>, ids: string[]) => {
  calls.addContext++;
  for (const id of ids) {
    const a = store.get(key("image", id));
    if (a) Object.assign(a.context, ctx);
  }
  return { public_ids: ids };
};
up.add_tag = async (tag: string, ids: string[]) => {
  calls.addTag++;
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
  const a = store.get(key("image", id));
  if (!a) throw { error: notFound(id) };
  return { ...toRes(a), rate_limit_remaining: 400 };
};
api.resources = async (o: { prefix?: string }) => {
  calls.admin++;
  return { resources: [...store.values()].filter((a) => a.resource_type === "image" && a.public_id.startsWith(o.prefix ?? "")).map(toRes), rate_limit_remaining: 400 };
};
api.resources_by_tag = async (tag: string) => {
  calls.admin++;
  return { resources: [...store.values()].filter((a) => a.tags.includes(tag)).map(toRes) };
};

let visionTokens = 612;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = init?.method ?? "GET";
  let m: RegExpExecArray | null;
  if ((m = new RegExp(`^https://res\\.cloudinary\\.com/${CLOUD}/raw/upload/v(\\d+)/(.+)$`).exec(url))) {
    const a = store.get(key("raw", m[2]));
    return a?.data ? new Response(a.data, { status: 200, headers: { "content-type": "application/json" } }) : new Response("", { status: 404 });
  }
  if ((m = new RegExp(`^https://res\\.cloudinary\\.com/${CLOUD}/image/list/(.+)\\.json$`).exec(url))) {
    const list = [...store.values()].filter((a) => a.resource_type === "image" && a.tags.includes(m![1])).map(toRes);
    return list.length ? new Response(JSON.stringify({ resources: list }), { status: 200 }) : new Response("{}", { status: 404 });
  }
  if ((m = new RegExp(`^https://api\\.cloudinary\\.com/v1_1/${CLOUD}/raw/(explicit|upload)$`).exec(url))) {
    const body = new URLSearchParams(String(init?.body ?? ""));
    const id = body.get("public_id")!;
    if (m[1] === "explicit") {
      const a = store.get(key("raw", id));
      return a ? new Response(JSON.stringify(toRes(a)), { status: 200 }) : new Response(JSON.stringify({ error: notFound(id) }), { status: 404 });
    }
    const data = Buffer.from(body.get("file")!.split(",")[1], "base64").toString();
    return new Response(JSON.stringify(toRes(put("raw", id, { data, bytes: data.length }))), { status: 200 });
  }
  if (new RegExp(`^https://api\\.cloudinary\\.com/v1_1/${CLOUD}/usage$`).test(url)) {
    return new Response(JSON.stringify({ credits: { usage: 12, limit: 25 }, image_generation: { usage: 10, limit: 50 }, ai_vision: { usage: 1000, limit: 100000 } }), {
      status: 200,
      headers: { "x-featureratelimit-remaining": "450", "x-featureratelimit-limit": "500" },
    });
  }
  if (new RegExp(`^https://api\\.cloudinary\\.com/v2/analysis/${CLOUD}/analyze/ai_vision_tagging$`).test(url)) {
    calls.vision++;
    return new Response(
      JSON.stringify({
        data: { analysis: { tags: [{ name: "product-visible" }] } },
        limits: { addons_quota: [{ type: "ai_vision", used_by_request: visionTokens, remaining: 90_000, limit: 100_000 }] },
      }),
      { status: 200 },
    );
  }
  if (url.startsWith(`https://res.cloudinary.com/${CLOUD}/image/upload/`)) {
    return new Response(method === "HEAD" ? null : "img", { status: 200, headers: { "content-type": "image/avif", "content-length": "54321" } });
  }
  throw new Error("unexpected fetch " + method + " " + url);
}) as typeof fetch;

const admin = await import("../lib/cloudinary/admin.ts");
const pool = await import("../lib/cloudinary/pool.ts");
const facts = await import("../lib/server/facts.ts");
const session = await import("../lib/server/session.ts");
const protect = await import("../lib/server/protect.ts");
const sign = await import("../lib/server/upload-sign.ts");
const cost = await import("../lib/server/cost.ts");
const qaLib = await import("../lib/server/qa.ts");
const scenesLib = await import("../lib/server/scenes.ts");
const { SHOWCASE } = await import("../lib/showcase-data.ts");
const { SAMPLES } = await import("../lib/showcase.ts");

const routes = {
  sign: await import("../app/api/sign-upload/route.ts"),
  readiness: await import("../app/api/readiness/[sku]/route.ts"),
  pack: await import("../app/api/pack/route.ts"),
  packStatus: await import("../app/api/pack/[sku]/route.ts"),
  shelf: await import("../app/api/shelf/route.ts"),
  analyze: await import("../app/api/products/[sku]/analyze/route.ts"),
  cutout: await import("../app/api/products/[sku]/cutout/route.ts"),
  retouch: await import("../app/api/products/[sku]/retouch/route.ts"),
  brief: await import("../app/api/brief/route.ts"),
  qa: await import("../app/api/qa/route.ts"),
  collection: await import("../app/api/collection/route.ts"),
  scenes: await import("../app/api/scenes/generate/route.ts"),
  capture: await import("../app/api/capture/[sku]/route.ts"),
  cost: await import("../app/api/cost/[sku]/route.ts"),
};

beforeEach(() => {
  store.clear();
  Object.assign(calls, { admin: 0, explicit: 0, upload: 0, addContext: 0, addTag: 0, removeTag: 0, vision: 0, uploads: [] });
  visionTokens = 612;
  admin.__resetAdminState();
  pool.__resetPoolState();
  facts.__resetFactsCache();
});

// ------------------------------------------------------------------ helpers

type S = import("../lib/server/session.ts").Session;
const anon = (patch: Partial<S> = {}): S => ({ ...session.newSession(), ...patch });
const unlocked = (patch: Partial<S> = {}): S => anon({ u: true, ...patch });
const cookieOf = (s: S) => `s2s_access=${session.encodeSession(s)}`;

function req(path: string, s: S, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie: cookieOf(s), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const ctx = <P,>(params: P) => ({ params: Promise.resolve(params) });

async function answer(res: Response) {
  const json = (await res.json()) as Record<string, unknown>;
  const set = (res as unknown as { cookies: { get(n: string): { value: string } | undefined } }).cookies.get("s2s_access")?.value;
  return { status: res.status, json, session: set ? session.decodeSession(set) : null };
}

const P = (sku: string, leaf: string) => `snap2shelf/products/${sku}/${leaf}`;
/** A product the way the pipeline leaves it: raw (+ facts doc), optionally a cutout. */
async function product(sku: string, o: { ctx?: Record<string, string>; cutout?: boolean; rawVersion?: number } = {}) {
  put("image", P(sku, "raw"), { tags: ["s2s", "s2s-raw", `s2s-sku-${sku}`], context: { ...(o.ctx ?? {}) }, ...(o.rawVersion ? { version: o.rawVersion } : {}) });
  if (o.cutout) put("image", P(sku, "cutout"), { format: "png", width: 976, height: 523, tags: ["s2s", "s2s-cutout", `s2s-sku-${sku}`] });
  const raw = store.get(key("image", P(sku, "raw")))!;
  const doc: import("../lib/server/facts.ts").ProductFacts = {
    s: 1,
    sku,
    ctx: { ...(o.ctx ?? {}) },
    raw: { width: raw.width, height: raw.height, bytes: raw.bytes, format: raw.format, version: raw.version, createdAt: raw.created_at },
    ...(o.cutout ? { cutout: { publicId: P(sku, "cutout"), width: 976, height: 523, version: raw.version + 1, at: Date.now() } } : {}),
    at: Date.now(),
  };
  put("raw", facts.factsId(sku), { data: JSON.stringify(doc) });
  calls.upload = 0;
  calls.uploads = [];
}

const LIVE = "k3v9x2ab"; // an ordinary product sku (not protected)
const approvedShbottle = SHOWCASE.kits.find((k) => k.sku === "shbottle")!.attempts.find((a) => a.qa.status === "approved")!.url;
const otherHero = `https://res.cloudinary.com/${CLOUD}/image/upload/f_jpg,q_90/snap2shelf/products/shbottle/cutout`;

// ------------------------------------------------------------------ pure rules

test("protect: samples, showcase kits, demo-shelf and site products are protected; ordinary skus are not", () => {
  for (const s of SAMPLES) assert.equal(protect.isProtectedSku(s.sku), true, s.sku);
  for (const k of SHOWCASE.kits) assert.equal(protect.isProtectedSku(k.sku), true, k.sku);
  for (const sku of ["sneaker1", "s2candle", "s2trlmix", "9uo8w8pc", "zi86lf6a"]) assert.equal(protect.isProtectedSku(sku), true, sku);
  assert.equal(protect.isProtectedSku(LIVE), false);
  process.env.S2S_PROTECTED_SKUS = "zz9zz9zz, not-a-sku";
  assert.equal(protect.isProtectedSku("zz9zz9zz"), true);
  delete process.env.S2S_PROTECTED_SKUS;
  assert.equal(protect.isProtectedShop("demo-studio"), true);
  assert.equal(protect.isProtectedShop("meeras-candles"), false);
});

test("protect: canWrite / canChange need the access code for protected skus and ownership for others", () => {
  assert.equal(protect.canWrite(anon(), "shbottle"), false);
  assert.equal(protect.canWrite(unlocked(), "shbottle"), true);
  assert.equal(protect.canWrite(anon(), LIVE), true);
  assert.equal(protect.canChange(anon(), LIVE), false);
  assert.equal(protect.canChange(anon({ k: [LIVE] }), LIVE), true);
  assert.equal(protect.canChange(anon({ k: ["shbottle"] }), "shbottle"), false, "a forged-looking claim on a sample never counts");
  assert.equal(protect.canChange(unlocked(), LIVE), true);
});

test("session: owned skus and shelves round-trip; cookies from before the fields existed still decode", async () => {
  const s = session.withShelf(session.withOwnedSku(anon(), LIVE), "meeras-shop");
  const back = session.decodeSession(session.encodeSession(s))!;
  assert.deepEqual(back.k, [LIVE]);
  assert.deepEqual(back.sp, ["meeras-shop"]);
  const legacy = { sid: "abcdefgh12", u: false, g: 0, o: 3, iat: Math.floor(Date.now() / 1000) };
  const token = (await import("../lib/server/crypto.ts")).signJson(session.sessionKey(), legacy);
  assert.equal(session.decodeSession(token)?.o, 3);
  let many = anon();
  for (let i = 0; i < 30; i++) many = session.withOwnedSku(many, `sku${String(i).padStart(5, "0")}`);
  assert.equal(many.k!.length, session.OWNED_MAX);
  assert.equal(many.k!.at(-1), "sku00029", "most recent kept");
  assert.equal(session.withOwnedSku(many, "sku00029").k!.length, session.OWNED_MAX, "no duplicates");
  assert.equal(session.withOwnedSku(anon(), "BAD").k, undefined);
});

test("sign-upload: never signs a sample / showcase public id (even well-formed)", () => {
  const now = Math.floor(Date.now() / 1000);
  for (const sku of ["sneaker1", "shbottle", "shmessy1", "s2candle", "9uo8w8pc"]) {
    const r = sign.checkParamsToSign({ timestamp: now, upload_preset: "s2s_ingest", public_id: `snap2shelf/products/${sku}/raw`, tags: `s2s,s2s-raw,s2s-sku-${sku}` });
    assert.equal(r.ok, false, sku);
  }
  const ok = sign.checkParamsToSign({ timestamp: now, upload_preset: "s2s_ingest", public_id: `snap2shelf/products/${LIVE}/raw` });
  assert.ok(ok.ok && ok.sku === LIVE);
});

test("shelf rules: demo shelf and showcase shelves reserved, taken names refused, new shelves capped per session", () => {
  const code = (fn: () => void) => {
    try {
      fn();
      return "ok";
    } catch (e) {
      return `${(e as { status: number }).status} ${(e as { code: string }).code}`;
    }
  };
  assert.equal(code(() => protect.authorizeShelf(anon(), "demo-studio", [])), "403 read_only");
  assert.equal(code(() => protect.authorizeShelf(anon(), "fresh-shop", [{ sku: "s2candle" }])), "403 read_only");
  assert.equal(code(() => protect.authorizeShelf(anon(), "taken-shop", [{ sku: LIVE }])), "403 read_only");
  assert.equal(code(() => protect.authorizeShelf(anon({ sp: ["taken-shop"] }), "taken-shop", [{ sku: LIVE }])), "ok", "its own shelf");
  assert.equal(code(() => protect.authorizeShelf(anon(), "fresh-shop", [])), "ok");
  assert.equal(code(() => protect.authorizeShelf(anon({ sp: ["a-one", "a-two", "a-three"] }), "fresh-shop", [])), "429 cap_reached");
  assert.equal(code(() => protect.authorizeShelf(unlocked(), "demo-studio", [{ sku: "s2candle" }])), "ok");
});

test("capture claim: only a fresh, unprotected raw", () => {
  const now = Date.now();
  const s = Math.floor(now / 1000);
  assert.equal(protect.canClaimCapture(LIVE, s - 60, now), true);
  assert.equal(protect.canClaimCapture(LIVE, s - protect.CLAIM_WINDOW_S - 5, now), false);
  assert.equal(protect.canClaimCapture("shbottle", s - 60, now), false);
});

// ------------------------------------------------------------------ routes: sample / showcase locks

test("readiness fix: a sample is read-only without the access code (403, friendly message, nothing written)", async () => {
  await product("shbottle", { cutout: true });
  const r = await answer(await routes.readiness.POST(req("/api/readiness/shbottle", anon(), { fixes: ["repad"] }), ctx({ sku: "shbottle" })));
  assert.equal(r.status, 403);
  assert.equal(r.json.code, "read_only");
  assert.equal(r.json.error, "Samples are read-only — upload your photo to try one-click fixes.");
  assert.equal(NOT_WRITTEN(), 0);
});

test("readiness fix: a live product needs to be created in this browser (or the access code)", async () => {
  const other = await answer(await routes.readiness.POST(req(`/api/readiness/${LIVE}`, anon(), { fixes: ["repad"] }), ctx({ sku: LIVE })));
  assert.equal(other.status, 403);
  assert.equal(other.json.code, "read_only");
  assert.equal(other.json.error, protect.READ_ONLY_NOT_YOURS);
  // the creating browser passes the lock (and then meets the product: none uploaded here → 404)
  const mine = await answer(await routes.readiness.POST(req(`/api/readiness/${LIVE}`, anon({ k: [LIVE] }), { fixes: ["repad"] }), ctx({ sku: LIVE })));
  assert.equal(mine.status, 404);
  const code = await answer(await routes.readiness.POST(req(`/api/readiness/${LIVE}`, unlocked(), { fixes: ["repad"] }), ctx({ sku: LIVE })));
  assert.equal(code.status, 404);
  // with the code a sample passes the lock too
  const sample = await answer(await routes.readiness.POST(req("/api/readiness/shbottle", unlocked(), { fixes: ["repad"] }), ctx({ sku: "shbottle" })));
  assert.notEqual(sample.status, 403);
});

test("readiness GET: a sample is scored without AI Vision or writes", async () => {
  await product("shbottle", { cutout: true });
  const r = await answer(await routes.readiness.GET(req("/api/readiness/shbottle", anon()), ctx({ sku: "shbottle" })));
  assert.equal(r.status, 200);
  assert.equal(r.json.canFix, false, "the UI can hide the fix buttons");
  assert.equal(calls.vision, 0);
  assert.equal(NOT_WRITTEN(), 0);
});

test("readiness GET: an ordinary product's text check runs once and its tokens reach the ledger", async () => {
  await product(LIVE, { cutout: true, ctx: { t_an: "669" } });
  const r = await answer(await routes.readiness.GET(req(`/api/readiness/${LIVE}`, anon()), ctx({ sku: LIVE })));
  assert.equal(r.status, 200);
  assert.equal(r.json.canFix, false, "another browser's product");
  assert.equal(calls.vision, 1);
  const own = await answer(await routes.readiness.GET(req(`/api/readiness/${LIVE}`, anon({ k: [LIVE] })), ctx({ sku: LIVE })));
  assert.equal(own.json.canFix, true);
  assert.equal(calls.vision, 1, "verdict cached: no second AI Vision call");
  assert.equal(r.json.tokens, 612);
  const { facts: f } = await facts.readFacts(LIVE);
  assert.equal(f!.ctx.t_rd, "612");
  assert.ok(f!.ctx.rd_src, "verdict cached in facts");
  assert.ok(store.get(key("image", P(LIVE, "raw")))!.context.rd_src, "and mirrored on the raw (read back from the CDN list)");
});

test("pack: a sample answers its prebuilt pack for its own composite, 403 for any other hero, zero Cloudinary calls", async () => {
  const pre = await answer(await routes.pack.POST(req("/api/pack", anon(), { sku: "shbottle", heroUrl: approvedShbottle, sceneSlug: "cafe" })));
  assert.equal(pre.status, 200);
  assert.equal(pre.json.heroPublicId, SHOWCASE.kits.find((k) => k.sku === "shbottle")!.hero.publicId);
  const live = await answer(await routes.pack.POST(req("/api/pack", anon(), { sku: "shbottle", heroUrl: otherHero, sceneSlug: "cafe" })));
  assert.equal(live.status, 403);
  assert.equal(live.json.code, "read_only");
  assert.equal(calls.explicit + NOT_WRITTEN() + calls.admin, 0);
  // the access code lifts the lock (the live pipeline then runs as for any product)
  const unlockedPack = await answer(await routes.pack.POST(req("/api/pack", unlocked(), { sku: "shbottle", heroUrl: otherHero, sceneSlug: "cafe" })));
  assert.notEqual(unlockedPack.status, 403);
});

test("pack status: a sample always reads as its prebuilt pack, even if its saved spec was changed", async () => {
  await product("shbottle", { cutout: true, ctx: { hero: P("shbottle", "hero-cafe-deadbeef") } });
  const r = await answer(await routes.packStatus.GET(req("/api/pack/shbottle", anon()), ctx({ sku: "shbottle" })));
  assert.equal(r.status, 200);
  assert.equal(r.json.heroPublicId, SHOWCASE.kits.find((k) => k.sku === "shbottle")!.hero.publicId);
  assert.deepEqual(r.json.pending, []);
  assert.equal(NOT_WRITTEN(), 0);
  // a protected product without prebuilt data (demo shelf) reports what's saved and never materialises
  await product("s2candle", { cutout: true, ctx: { hero: P("s2candle", "hero-diwali-aaaa") } });
  const d = await answer(await routes.packStatus.GET(req("/api/pack/s2candle", anon()), ctx({ sku: "s2candle" })));
  assert.equal(d.status, 200);
  assert.deepEqual(d.json.pending, []);
  assert.ok((d.json.failed as string[]).length > 0);
  assert.equal(NOT_WRITTEN(), 0);
});

test("shelf: demo-studio is reserved without the access code; nothing is read or written", async () => {
  const r = await answer(await routes.shelf.POST(req("/api/shelf", anon({ k: [LIVE] }), { shop: "demo-studio", title: "Hacked", skus: [LIVE] })));
  assert.equal(r.status, 403);
  assert.equal(r.json.code, "read_only");
  assert.equal(r.json.error, protect.READ_ONLY_DEMO_SHELF);
  assert.equal(calls.admin + calls.explicit + NOT_WRITTEN(), 0);
});

test("shelf: anonymous shelves only from products created in this browser, never samples, never a taken name", async () => {
  const sample = await answer(await routes.shelf.POST(req("/api/shelf", anon(), { shop: "my-new-shop", title: "Mine", skus: ["shbottle"] })));
  assert.equal(sample.status, 403);
  const notMine = await answer(await routes.shelf.POST(req("/api/shelf", anon(), { shop: "my-new-shop", title: "Mine", skus: [LIVE] })));
  assert.equal(notMine.status, 403);
  assert.equal(notMine.json.error, protect.READ_ONLY_NOT_YOURS);
  // a shelf name someone else already uses
  put("image", P("zzzzzzz1", "hero-x-1"), { tags: ["s2s-shop-taken-shop"], context: { sku: "zzzzzzz1", st_taken_shop: "Theirs" } });
  const taken = await answer(await routes.shelf.POST(req("/api/shelf", anon({ k: [LIVE] }), { shop: "taken-shop", title: "Mine", skus: [LIVE] })));
  assert.equal(taken.status, 403);
  assert.equal(taken.json.error, protect.READ_ONLY_SHELF_TAKEN);
  // a shelf that holds a showcase product
  put("image", P("s2candle", "hero-diwali-1"), { tags: ["s2s-shop-candles-edit"], context: { sku: "s2candle", st_candles_edit: "Candles" } });
  const showcase = await answer(await routes.shelf.POST(req("/api/shelf", anon({ k: [LIVE] }), { shop: "candles-edit", title: "Mine", skus: [LIVE] })));
  assert.equal(showcase.status, 403);
  assert.equal(showcase.json.error, protect.READ_ONLY_DEMO_SHELF);
  assert.equal(calls.addContext + calls.addTag + calls.removeTag, 0, "no tag or context written by refused publishes");
  // own product, new name: passes every lock (then: this product has no hero yet → 400)
  const fresh = await answer(await routes.shelf.POST(req("/api/shelf", anon({ k: [LIVE] }), { shop: "my-new-shop", title: "Mine", skus: [LIVE] })));
  assert.equal(fresh.status, 400);
  const capped = await answer(await routes.shelf.POST(req("/api/shelf", anon({ k: [LIVE], sp: ["a-one", "a-two", "a-three"] }), { shop: "my-new-shop", title: "Mine", skus: [LIVE] })));
  assert.equal(capped.status, 429);
});

test("analyze / cutout / retouch / brief: a sample answers only from what is stored", async () => {
  await product("shbottle");
  const a = await answer(await routes.analyze.POST(req("/api/products/shbottle/analyze", anon(), {}), ctx({ sku: "shbottle" })));
  assert.equal(a.status, 403);
  assert.equal(a.json.code, "read_only");
  const c = await answer(await routes.cutout.POST(req("/api/products/shbottle/cutout", anon(), {}), ctx({ sku: "shbottle" })));
  assert.equal(c.status, 403);
  const rt = await answer(await routes.retouch.POST(req("/api/products/shbottle/retouch", anon(), {}), ctx({ sku: "shbottle" })));
  assert.equal(rt.status, 403);
  const b = await answer(await routes.brief.POST(req("/api/brief", anon(), { sku: "shbottle", brief: "Diwali sale 20% off" })));
  assert.equal(b.status, 403);
  assert.equal(calls.vision + NOT_WRITTEN(), 0);

  // stored answers still come back
  await product("shbottle", { cutout: true, ctx: { analyzed: "1", caption: "A bottle", u_name: "Bottle", u_place: "standing", fix_plan: "none", fix_tags: "-", fix_chain: "", fix_tx: "0" } });
  const a2 = await answer(await routes.analyze.POST(req("/api/products/shbottle/analyze", anon(), {}), ctx({ sku: "shbottle" })));
  assert.equal(a2.status, 200);
  assert.equal(a2.json.tokens, 0);
  const c2 = await answer(await routes.cutout.POST(req("/api/products/shbottle/cutout", anon(), {}), ctx({ sku: "shbottle" })));
  assert.equal(c2.status, 200);
  const rt2 = await answer(await routes.retouch.POST(req("/api/products/shbottle/retouch", anon(), {}), ctx({ sku: "shbottle" })));
  assert.equal(rt2.status, 200);
  assert.equal(NOT_WRITTEN(), 0);
});

test("qa: a sample gets its recorded verdict or 403, never an AI Vision call", async () => {
  const rec = await answer(await routes.qa.POST(req("/api/qa", anon(), { sku: "shbottle", url: approvedShbottle, kind: "exact" })));
  assert.equal(rec.status, 200);
  assert.equal((rec.json.qa as { status: string }).status, "approved");
  assert.equal(rec.json.tokens, 0);
  const other = await answer(await routes.qa.POST(req("/api/qa", anon(), { sku: "shbottle", url: otherHero, kind: "exact" })));
  assert.equal(other.status, 403);
  const creative = SHOWCASE.creative[0];
  const cr = await answer(await routes.qa.POST(req("/api/qa", anon(), { sku: creative.sku, url: `https://res.cloudinary.com/${CLOUD}/image/upload/${creative.publicId}`, kind: "creative" })));
  assert.equal(cr.status, 200);
  assert.equal(calls.vision + NOT_WRITTEN(), 0);
});

test("collection: showcase products or other browsers' products are refused without the code", async () => {
  const body = (skus: string[]) => ({ skus, scenePublicId: "snap2shelf/scenes/diwali/final-59f4388a" });
  const s = await answer(await routes.collection.POST(req("/api/collection", anon({ k: [LIVE] }), body([LIVE, "shbottle"]))));
  assert.equal(s.status, 403);
  const o = await answer(await routes.collection.POST(req("/api/collection", anon({ k: [LIVE] }), body([LIVE, "abcdefgh"]))));
  assert.equal(o.status, 403);
  assert.equal(o.json.error, protect.READ_ONLY_NOT_YOURS);
  assert.equal(calls.admin + calls.explicit + NOT_WRITTEN(), 0);
});

test("scene reuse with a sample sku answers the same scene but writes nothing to the sample", async () => {
  const spec = scenesLib.sceneSpec({ theme: "diwali", tier: "final" })!;
  const id = scenesLib.scenePublicId(spec);
  put("image", id, {
    tags: ["s2s-scene"],
    context: { theme: "diwali", view: "eye-level", title: "Diwali glow", credits: "4", dna_ax: "0.5", dna_ay: "0.65", dna_sw: "1", dna_az: "270", dna_el: "20", dna_temp: "warm", dna_gloss: "0", dna_text: "none" },
  });
  await product("shbottle");
  const r = await answer(await routes.scenes.POST(req("/api/scenes/generate", anon(), { theme: "diwali", tier: "final", sku: "shbottle" })));
  assert.equal(r.status, 200);
  assert.equal(r.json.reused, true);
  assert.equal(NOT_WRITTEN(), 0);
  // an ordinary product still gets its "credits saved" entry
  await product(LIVE);
  await routes.scenes.POST(req("/api/scenes/generate", anon(), { theme: "diwali", tier: "final", sku: LIVE }));
  assert.ok(calls.uploads.includes(facts.factsId(LIVE)));
});

test("sign-upload route: records a sku this browser creates, not one that already exists, never a sample", async () => {
  const params = (sku: string) => ({ timestamp: Math.floor(Date.now() / 1000), upload_preset: "s2s_ingest", public_id: `snap2shelf/products/${sku}/raw`, tags: `s2s,s2s-raw,s2s-sku-${sku}` });
  const fresh = await answer(await routes.sign.POST(req("/api/sign-upload", anon(), { paramsToSign: params(LIVE) })));
  assert.equal(fresh.status, 200);
  assert.match(String(fresh.json.signature), /^[a-f0-9]{40}$/);
  assert.deepEqual(fresh.session?.k, [LIVE]);
  put("image", P("abcdefgh", "raw"));
  const existing = await answer(await routes.sign.POST(req("/api/sign-upload", anon(), { paramsToSign: params("abcdefgh") })));
  assert.equal(existing.status, 200);
  assert.equal(existing.session, null, "someone else's raw grants nothing");
  const sample = await answer(await routes.sign.POST(req("/api/sign-upload", unlocked(), { paramsToSign: params("sneaker1") })));
  assert.equal(sample.status, 400, "not even with the access code");
  assert.equal(calls.upload, 0);
});

test("capture route: the polling browser claims a phone upload that just landed", async () => {
  await product(LIVE, { rawVersion: Math.floor(Date.now() / 1000) - 30 });
  const r = await answer(await routes.capture.GET(req(`/api/capture/${LIVE}`, anon()), ctx({ sku: LIVE })));
  assert.equal(r.status, 200);
  assert.equal(r.json.ready, true);
  assert.deepEqual(r.session?.k, [LIVE]);
  await product("abcdefgh", { rawVersion: Math.floor(Date.now() / 1000) - 3 * 3600 });
  const old = await answer(await routes.capture.GET(req("/api/capture/abcdefgh", anon()), ctx({ sku: "abcdefgh" })));
  assert.equal(old.json.ready, true);
  assert.equal(old.session?.k, undefined, "an old upload isn't claimable");
});

// ------------------------------------------------------------------ token ledger

test("ledger: the receipt counts QA and readiness tokens next to analyze, retouch and brief", () => {
  const out = cost.computeCost({
    sku: LIVE,
    assets: [
      { publicId: P(LIVE, "raw"), bytes: 100, format: "jpg", createdAt: "2026-10-01T10:00:00Z", context: { t_an: "669", t_fix: "729", t_brief: "850", t_qa: "1224", t_rd: "540" } },
    ],
    deliveredBytes: 10,
  });
  assert.equal(out.cost.aiVisionTokens, 669 + 729 + 850 + 1224 + 540);
  const labels = out.breakdown.tokens.map((t) => t.label);
  assert.ok(labels.includes("QA checks") && labels.includes("Readiness text check"), labels.join());
});

test("ledger: concurrent token records add up (serialised on the latest facts doc)", async () => {
  await product(LIVE, { ctx: { t_an: "669" } });
  await Promise.all([facts.recordTokens(LIVE, "t_qa", 600), facts.recordTokens(LIVE, "t_qa", 624), facts.recordTokens(LIVE, "t_rd", 540)]);
  const { facts: f } = await facts.readFacts(LIVE);
  assert.equal(f!.ctx.t_qa, "1224");
  assert.equal(f!.ctx.t_rd, "540");
  assert.equal(f!.ctx.t_an, "669");
});

test("ledger: an exact QA check through the route lands on the product's cost receipt", async () => {
  await product(LIVE, { cutout: true, ctx: { analyzed: "1", t_an: "669", t_fix: "729" } });
  const url = `https://res.cloudinary.com/${CLOUD}/image/upload/c_fill,w_1080,h_1350/l_snap2shelf:products:${LIVE}:cutout/fl_layer_apply,g_north_west,x_400,y_500/f_auto,q_auto/snap2shelf/scenes/diwali/final-59f4388a`;
  const q = await answer(await routes.qa.POST(req("/api/qa", anon(), { sku: LIVE, url, kind: "exact" })));
  assert.equal(q.status, 200);
  assert.equal(q.json.tokens, 612);
  const c = await answer(await routes.cost.GET(req(`/api/cost/${LIVE}`, anon()), ctx({ sku: LIVE })));
  assert.equal(c.status, 200);
  assert.equal((c.json.cost as { aiVisionTokens: number }).aiVisionTokens, 669 + 729 + 612);
  // a composite of another product's cutout is not billed to this one
  visionTokens = 500;
  const foreign = url.replace(`products:${LIVE}:cutout`, "products:abcdefgh:cutout");
  await routes.qa.POST(req("/api/qa", anon(), { sku: LIVE, url: foreign, kind: "exact" }));
  const { facts: f } = await facts.readFacts(LIVE);
  assert.equal(f!.ctx.t_qa, "612");
});

test("ledger: imageOfProduct matches stored assets and cutout layers of that sku only", () => {
  assert.equal(qaLib.imageOfProduct(LIVE, `/${CLOUD}/image/upload/l_snap2shelf:products:${LIVE}:cutout/x/snap2shelf/scenes/a/b`), true);
  assert.equal(qaLib.imageOfProduct(LIVE, `/${CLOUD}/image/upload/f_auto/snap2shelf/products/${LIVE}/hero-a-1`), true);
  assert.equal(qaLib.imageOfProduct(LIVE, `/${CLOUD}/image/upload/l_snap2shelf:products:abcdefgh:cutout/snap2shelf/scenes/a/b`), false);
});

// ------------------------------------------------------------------ scene library hygiene

test("scenes: the Christmas café plate is offered only to Christmas briefs", () => {
  const dna = { anchor_x: 0.5, anchor_y: 0.6, surface_width: 0.9, light_azimuth: 315, light_elevation: 45, temperature: "warm" as const, glossy: false, text_zone: "none" as const };
  const mk = (publicId: string, title: string, prompt: string) => ({ publicId, theme: "cafe", view: "eye-level" as const, title, prompt, modelId: "m", credits: 1, dna });
  const lib = [
    mk("snap2shelf/scenes/cafe/final-04757f01", "Outdoor café", "outdoor cafe table, espresso cups, morning street bokeh"),
    mk("snap2shelf/scenes/cafe/draft-d9727c98", "Winter festive café", "rustic pine-wood tabletop, pine branches, red and gold baubles"),
  ];
  const ids = (text: string) => scenesLib.rankScenes(lib, { theme: "cafe", text }).map((m) => m.scene.publicId);
  assert.deepEqual(ids("coffee shop morning offer"), ["snap2shelf/scenes/cafe/final-04757f01"]);
  assert.deepEqual(ids(""), ["snap2shelf/scenes/cafe/final-04757f01"]);
  assert.ok(ids("Christmas sale with pine and baubles").includes("snap2shelf/scenes/cafe/draft-d9727c98"));
});
