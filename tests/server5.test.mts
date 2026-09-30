// Showcase write locks, ownership proofs, session races, shelf-name locks, staged creative polls and the
// AI Vision token ledger, against an in-memory fake Cloudinary (no network).
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
const calls = { admin: 0, explicit: 0, upload: 0, addContext: 0, addTag: 0, removeTag: 0, vision: 0, visionGeneral: 0, task: 0, uploads: [] as string[] };
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
/** The generation task GET /v2/generate/{cloud}/tasks/:id answers (null = expired / unknown). */
let genTask: { status: string; assets?: unknown[] } | null = null;
/** HTTP status of the fidelity sheet derivation (423 = still rendering). */
let sheetStatus = 200;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = init?.method ?? "GET";
  let m: RegExpExecArray | null;
  if ((m = new RegExp(`^https://api\\.cloudinary\\.com/v2/generate/${CLOUD}/tasks/([a-f0-9]+)$`).exec(url))) {
    calls.task++;
    if (!genTask) return new Response(JSON.stringify({ error: { message: "Task not found" } }), { status: 404 });
    return new Response(
      JSON.stringify({ data: { task_id: m[1], status: genTask.status, result: genTask.assets ? { assets: genTask.assets } : null }, limits: { addons_quota: [{ type: "image_generation", used_by_request: 1, remaining: 40, limit: 50 }] } }),
      { status: 200 },
    );
  }
  if (new RegExp(`^https://api\\.cloudinary\\.com/v2/analysis/${CLOUD}/analyze/ai_vision_general$`).test(url)) {
    calls.visionGeneral++;
    return new Response(
      JSON.stringify({
        data: { analysis: { responses: [{ value: '{"same_product": true, "fidelity_score": 91, "differences": []}' }] } },
        limits: { addons_quota: [{ type: "ai_vision", used_by_request: 700, remaining: 90_000, limit: 100_000 }] },
      }),
      { status: 200 },
    );
  }
  if (url.startsWith(`https://res.cloudinary.com/${CLOUD}/image/upload/`) && url.includes("c_pad,w_1024,h_683")) {
    return new Response(null, { status: sheetStatus }); // the fidelity sheet (reference | take)
  }
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
  if ((m = new RegExp(`^https://res\\.cloudinary\\.com/${CLOUD}/image/upload/v\\d+/(snap2shelf/products/[a-z0-9]{8}/raw)$`).exec(url))) {
    // the capture probe: the untransformed raw, there or not
    return new Response(method === "HEAD" ? null : "img", { status: store.has(key("image", m[1])) ? 200 : 404 });
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
const ownership = await import("../lib/server/proofs.ts");
const locks = await import("../lib/server/locks.ts");
const sign = await import("../lib/server/upload-sign.ts");
const cost = await import("../lib/server/cost.ts");
const creativeLib = await import("../lib/server/creative.ts");
const jobToken = await import("../lib/server/job-token.ts");
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
  access: await import("../app/api/access/route.ts"),
  usage: await import("../app/api/usage/route.ts"),
  jobs: await import("../app/api/jobs/[job]/route.ts"),
  capture: await import("../app/api/capture/[sku]/route.ts"),
  cost: await import("../app/api/cost/[sku]/route.ts"),
};

beforeEach(() => {
  store.clear();
  Object.assign(calls, { admin: 0, explicit: 0, upload: 0, addContext: 0, addTag: 0, removeTag: 0, vision: 0, visionGeneral: 0, task: 0, uploads: [] });
  visionTokens = 612;
  genTask = null;
  sheetStatus = 200;
  admin.__resetAdminState();
  pool.__resetPoolState();
  facts.__resetFactsCache();
  locks.__resetLocks();
});

// ------------------------------------------------------------------ helpers

type S = import("../lib/server/session.ts").Session;
const anon = (patch: Partial<S> = {}): S => ({ ...session.newSession(), ...patch });
const unlocked = (patch: Partial<S> = {}): S => anon({ u: true, ...patch });
const cookieOf = (s: S) => `s2s_access=${session.encodeSession(s)}`;

/** `s` null = a visitor's first request (no session cookie). `extra`: more cookies, "name=value". */
function req(path: string, s: S | null, body?: unknown, extra: string[] = []) {
  const cookie = [...(s ? [cookieOf(s)] : []), ...extra].join("; ");
  return new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const ctx = <P,>(params: P) => ({ params: Promise.resolve(params) });

type SetCookie = { name: string; value: string; path?: string; maxAge?: number; httpOnly?: boolean; sameSite?: unknown; secure?: boolean };
async function answer(res: Response) {
  const json = (await res.json()) as Record<string, unknown>;
  const all = (res as unknown as { cookies: { getAll(): SetCookie[] } }).cookies.getAll();
  const set = all.find((c) => c.name === "s2s_access")?.value;
  return { status: res.status, json, session: set ? session.decodeSession(set) : null, cookies: new Map(all.map((c) => [c.name, c])) };
}

/** A product proof cookie for `sku`, as the server mints it ("name=value"). */
const proofCookie = (sku: string, sid = "proof-sid-1", now = Date.now()) => `s2s_p_${sku}=${ownership.mintProof("product", sku, sid, now)}`;
/** Cookie header entries a browser would send back after this answer (set, not deleted). */
const kept = (a: { cookies: Map<string, SetCookie> }) => [...a.cookies.values()].filter((c) => c.name !== "s2s_access" && c.maxAge !== 0).map((c) => `${c.name}=${c.value}`);

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

test("protect: protected products need the access code; a live product needs this browser's proof, code or not", () => {
  const none: ReadonlySet<string> = new Set();
  assert.equal(protect.canWrite(anon(), "shbottle", none), false);
  assert.equal(protect.canWrite(unlocked(), "shbottle", none), true);
  assert.equal(protect.canWrite(anon(), LIVE, none), false, "another browser's live product");
  assert.equal(protect.canWrite(unlocked(), LIVE, none), false, "the access code doesn't open other people's products");
  assert.equal(protect.canWrite(anon(), LIVE, new Set([LIVE])), true, "product proof cookie");
  assert.equal(protect.canWrite(unlocked(), LIVE, new Set([LIVE])), true);
  assert.equal(protect.canWrite(anon({ k: [LIVE] }), LIVE, none), true, "legacy session list still accepted");
  assert.equal(protect.canWrite(anon({ k: ["shbottle"] }), "shbottle", new Set(["shbottle"])), false, "a claim on a sample never counts");
  assert.equal(protect.ownsProduct(anon(), LIVE, new Set(["abcdefgh"])), false, "a proof for another product");
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

test("shelf rules: demo shelf and showcase shelves reserved, existing shelves verified, new names claimed, capped per session", () => {
  const plan = (fn: () => string) => {
    try {
      return fn();
    } catch (e) {
      return `${(e as { status: number }).status} ${(e as { code: string }).code}`;
    }
  };
  const none = { owned: false, held: 0 };
  assert.equal(plan(() => protect.authorizeShelf(anon(), "demo-studio", [], none)), "403 read_only");
  assert.equal(plan(() => protect.authorizeShelf(anon(), "fresh-shop", [{ sku: "s2candle" }], none)), "403 read_only");
  assert.equal(plan(() => protect.authorizeShelf(anon(), "taken-shop", [{ sku: LIVE }], none)), "verify", "someone's shelf: only its lock's session");
  assert.equal(plan(() => protect.authorizeShelf(anon(), "taken-shop", [{ sku: LIVE }], { owned: true, held: 1 })), "owned", "its own shelf");
  assert.equal(plan(() => protect.authorizeShelf(anon(), "fresh-shop", [], none)), "claim", "a name that looks free is still claimed atomically");
  assert.equal(plan(() => protect.authorizeShelf(anon(), "fresh-shop", [], { owned: false, held: 3 })), "429 cap_reached");
  assert.equal(plan(() => protect.authorizeShelf(unlocked(), "demo-studio", [{ sku: "s2candle" }], none)), "owned");
  assert.equal(plan(() => protect.authorizeShelf(unlocked(), "fresh-shop", [], { owned: false, held: 9 })), "claim", "the code isn't capped, but still claims");
});

test("capture claim: only the waiting session's unexpired ticket, a raw that landed after it, within 10 minutes", () => {
  const now = Date.now();
  const t = Math.floor(now / 1000);
  const ticket = (sid: string, iat: number) => ownership.openProof("capture", LIVE, ownership.mintProof("capture", LIVE, sid, iat * 1000), now);
  const mine = ticket("laptop-sid-1", t - 120);
  assert.ok(mine);
  assert.equal(protect.CLAIM_WINDOW_S, 600);
  assert.equal(protect.canClaimCapture(LIVE, mine, "laptop-sid-1", t - 60, now), true);
  assert.equal(protect.canClaimCapture(LIVE, null, "laptop-sid-1", t - 60, now), false, "no ticket, no claim");
  assert.equal(protect.canClaimCapture(LIVE, mine, "other-sid-22", t - 60, now), false, "ticket bound to the session that waited");
  assert.equal(protect.canClaimCapture("abcdefgh", mine, "laptop-sid-1", t - 60, now), false, "ticket for another sku");
  assert.equal(protect.canClaimCapture(LIVE, ticket("laptop-sid-1", t - 60), "laptop-sid-1", t - 300, now), false, "raw uploaded before the ticket");
  const old = ticket("laptop-sid-1", t - 700);
  assert.equal(old, null, "tickets expire after 10 minutes");
  const edge = { kind: "capture" as const, subject: LIVE, sid: "laptop-sid-1", iat: t - 601 };
  assert.equal(protect.canClaimCapture(LIVE, edge, "laptop-sid-1", t - 30, now), false, "claim window is 10 minutes after the ticket");
  const fresh = ticket("laptop-sid-1", t - 30);
  assert.equal(protect.canClaimCapture(LIVE, fresh, "laptop-sid-1", t - 601, now), false, "a raw older than 10 minutes");
  const sample = { kind: "capture" as const, subject: "shbottle", sid: "laptop-sid-1", iat: t - 30 };
  assert.equal(protect.canClaimCapture("shbottle", sample, "laptop-sid-1", t - 10, now), false, "never a protected product");
});

// ------------------------------------------------------------------ proof cookies (lib/server/proofs.ts)

test("proofs: sealed per subject and kind; forged, renamed, cross-kind and expired values are refused", () => {
  const now = Date.now();
  const v = ownership.mintProof("product", LIVE, "sess-abc-123", now);
  assert.match(v, /^sess-abc-123\.\d+\.[A-Za-z0-9_-]{22}$/);
  assert.ok(v.length < 64, "small enough to keep 20 of them");
  assert.deepEqual(ownership.openProof("product", LIVE, v, now), { kind: "product", subject: LIVE, sid: "sess-abc-123", iat: Math.floor(now / 1000) });
  assert.equal(ownership.openProof("product", "abcdefgh", v, now), null, "renamed to another sku");
  assert.equal(ownership.openProof("capture", LIVE, v, now), null, "a product proof isn't a capture ticket");
  assert.equal(ownership.openProof("product", LIVE, v.replace(/.$/, (c) => (c === "A" ? "B" : "A")), now), null, "forged mac");
  assert.equal(ownership.openProof("product", LIVE, v.replace("sess-abc-123", "sess-abc-999"), now), null, "another session id");
  assert.equal(ownership.openProof("product", LIVE, v, now + 8 * 24 * 3600_000), null, "expired after 7 days");
  assert.equal(ownership.openProof("product", LIVE, "garbage", now), null);
  assert.throws(() => ownership.mintProof("product", "BAD", "sess-abc-123"));
});

test("proofs: granting keeps at most 20 product proofs (oldest evicted), drops invalid ones, never evicts generations", () => {
  const now = Date.now();
  const skus = Array.from({ length: 20 }, (_, i) => `sku${String(i).padStart(5, "0")}`);
  const jar = skus.map((s, i) => ({ name: `s2s_p_${s}`, value: ownership.mintProof("product", s, "sess-abc-123", now - (30 - i) * 1000) }));
  jar.push({ name: "s2s_p_zzzzzzzz", value: "forged.1.xxxxxxxxxxxxxxxxxxxxxx" });
  const writes = ownership.grantProof({ cookies: { getAll: () => jar } }, "product", LIVE, "sess-abc-123", now);
  assert.equal(writes[0].name, `s2s_p_${LIVE}`);
  assert.equal(writes[0].path, "/api");
  assert.ok(writes[0].maxAge > 0);
  const deleted = writes.filter((w) => w.maxAge === 0).map((w) => w.name).sort();
  assert.deepEqual(deleted, ["s2s_p_sku00000", "s2s_p_zzzzzzzz"], "the oldest proof and the forged cookie");
  // generations: bound to the session, never evicted
  const gens = Array.from({ length: 6 }, (_, i) => ({ name: `s2s_g_gen0000${i}`, value: ownership.mintProof("gen", `gen0000${i}`, "sess-abc-123", now - i * 1000) }));
  gens.push({ name: "s2s_g_oldsess1", value: ownership.mintProof("gen", "oldsess1", "sess-old-999", now) });
  const g = ownership.grantProof({ cookies: { getAll: () => gens } }, "gen", "newgen01", "sess-abc-123", now);
  assert.deepEqual(g.filter((w) => w.maxAge === 0).map((w) => w.name), ["s2s_g_oldsess1"], "only another session's leftovers go");
  assert.equal(ownership.readProofs({ cookies: { getAll: () => gens } }, "gen", { sid: "sess-abc-123", now }).length, 6, "bound kinds count for their session only");
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

test("readiness fix: a live product needs to be created in this browser (the access code doesn't replace that)", async () => {
  const other = await answer(await routes.readiness.POST(req(`/api/readiness/${LIVE}`, anon(), { fixes: ["repad"] }), ctx({ sku: LIVE })));
  assert.equal(other.status, 403);
  assert.equal(other.json.code, "read_only");
  assert.equal(other.json.error, protect.READ_ONLY_NOT_YOURS);
  const code = await answer(await routes.readiness.POST(req(`/api/readiness/${LIVE}`, unlocked(), { fixes: ["repad"] }), ctx({ sku: LIVE })));
  assert.equal(code.status, 403, "the access code alone doesn't make someone else's product yours");
  assert.equal(code.json.error, protect.READ_ONLY_NOT_YOURS);
  // the creating browser passes the lock (and then meets the product: none uploaded here → 404)
  const mine = await answer(await routes.readiness.POST(req(`/api/readiness/${LIVE}`, anon(), { fixes: ["repad"] }, [proofCookie(LIVE)]), ctx({ sku: LIVE })));
  assert.equal(mine.status, 404);
  const legacy = await answer(await routes.readiness.POST(req(`/api/readiness/${LIVE}`, anon({ k: [LIVE] }), { fixes: ["repad"] }), ctx({ sku: LIVE })));
  assert.equal(legacy.status, 404, "a session cookie from before proof cookies still counts");
  const forged = await answer(await routes.readiness.POST(req(`/api/readiness/${LIVE}`, anon(), { fixes: ["repad"] }, [`s2s_p_${LIVE}=${ownership.mintProof("product", "abcdefgh", "proof-sid-1")}`]), ctx({ sku: LIVE })));
  assert.equal(forged.status, 403, "another product's proof renamed to this sku");
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

test("readiness GET: another browser's product is scored from what is stored; the owner's text check runs once and its tokens reach the ledger", async () => {
  await product(LIVE, { cutout: true, ctx: { t_an: "669" } });
  const other = await answer(await routes.readiness.GET(req(`/api/readiness/${LIVE}`, unlocked()), ctx({ sku: LIVE })));
  assert.equal(other.status, 200);
  assert.equal(other.json.canFix, false, "another browser's product");
  assert.equal(calls.vision, 0, "no AI Vision spent on someone else's product");
  assert.equal(NOT_WRITTEN(), 0);
  assert.equal(other.session, null, "nothing charged, so the session cookie isn't re-issued");
  const r = await answer(await routes.readiness.GET(req(`/api/readiness/${LIVE}`, anon(), undefined, [proofCookie(LIVE)]), ctx({ sku: LIVE })));
  assert.equal(r.json.canFix, true);
  assert.equal(calls.vision, 1);
  const again = await answer(await routes.readiness.GET(req(`/api/readiness/${LIVE}`, anon({ k: [LIVE] })), ctx({ sku: LIVE })));
  assert.equal(again.json.canFix, true);
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
  // someone else's live product: same answer, nothing written to it
  await product(LIVE);
  const other = await answer(await routes.scenes.POST(req("/api/scenes/generate", anon(), { theme: "diwali", tier: "final", sku: LIVE })));
  assert.equal(other.json.reused, true);
  assert.equal(NOT_WRITTEN(), 0);
  // the owner's product still gets its "credits saved" entry
  await routes.scenes.POST(req("/api/scenes/generate", anon(), { theme: "diwali", tier: "final", sku: LIVE }, [proofCookie(LIVE)]));
  assert.ok(calls.uploads.includes(facts.factsId(LIVE)));
});

const signParamsFor = (sku: string) => ({ timestamp: Math.floor(Date.now() / 1000), upload_preset: "s2s_ingest", public_id: `snap2shelf/products/${sku}/raw`, tags: `s2s,s2s-raw,s2s-sku-${sku}` });

test("sign-upload route: grants a product proof cookie for a sku this browser creates, not one that exists, never a sample", async () => {
  const fresh = await answer(await routes.sign.POST(req("/api/sign-upload", anon(), { paramsToSign: signParamsFor(LIVE) })));
  assert.equal(fresh.status, 200);
  assert.match(String(fresh.json.signature), /^[a-f0-9]{40}$/);
  const proof = fresh.cookies.get(`s2s_p_${LIVE}`)!;
  assert.ok(proof, "product proof cookie set");
  assert.equal(proof.httpOnly, true);
  assert.equal(String(proof.sameSite).toLowerCase(), "lax");
  assert.equal(proof.path, "/api");
  assert.ok(ownership.openProof("product", LIVE, proof.value));
  assert.equal(fresh.session, null, "the session cookie isn't re-issued to record ownership");
  put("image", P("abcdefgh", "raw"));
  const existing = await answer(await routes.sign.POST(req("/api/sign-upload", anon(), { paramsToSign: signParamsFor("abcdefgh") })));
  assert.equal(existing.status, 200);
  assert.equal(existing.cookies.size, 0, "someone else's raw grants nothing");
  const sample = await answer(await routes.sign.POST(req("/api/sign-upload", unlocked(), { paramsToSign: signParamsFor("sneaker1") })));
  assert.equal(sample.status, 400, "not even with the access code");
  assert.equal(calls.upload, 0);
});

test("ownership race: concurrent grants from one browser each set their own cookie, so neither is lost", async () => {
  const me = anon();
  const skus = ["race0001", "race0002", "race0003"];
  // three uploads signed at once from the same page, all reading the same cookie jar
  const answers = await Promise.all(skus.map((sku) => routes.sign.POST(req("/api/sign-upload", me, { paramsToSign: signParamsFor(sku) })).then(answer)));
  for (const a of answers) assert.equal(a.session, null, "no response re-issues the session cookie");
  // the browser applies the responses in any order: every proof survives
  for (const order of [[0, 1, 2], [2, 1, 0], [1, 2, 0]]) {
    const jar = new Map<string, string>();
    for (const i of order) {
      for (const c of answers[i].cookies.values()) {
        if (c.maxAge === 0) jar.delete(c.name);
        else jar.set(c.name, c.value);
      }
    }
    const cookies = [...jar].map(([n, v]) => `${n}=${v}`);
    for (const sku of skus) {
      const r = await answer(await routes.readiness.POST(req(`/api/readiness/${sku}`, me, { fixes: ["repad"] }, cookies), ctx({ sku })));
      assert.equal(r.status, 404, `${sku} still owned (passes the lock, then: no product uploaded here)`);
    }
  }
  // a slow request that read the jar before the grants and charges an op re-issues only s2s_access: proofs untouched
  await product("race0001", { cutout: true });
  const slow = await answer(await routes.readiness.GET(req("/api/readiness/race0001", me, undefined, [proofCookie("race0001")]), ctx({ sku: "race0001" })));
  assert.ok(slow.session, "charged: s2s_access re-issued");
  assert.equal([...slow.cookies.keys()].filter((n) => n.startsWith("s2s_p_")).length, 0, "and no proof cookie touched");
});

test("capture route: the waiting laptop gets a single-use, session-bound ticket; the claim needs it", async () => {
  const laptop = anon();
  const t0 = Math.floor(Date.now() / 1000);
  // first poll before the phone uploads: lock claimed, ticket issued
  const wait = await answer(await routes.capture.GET(req(`/api/capture/${LIVE}`, laptop), ctx({ sku: LIVE })));
  assert.equal(wait.json.ready, false);
  const ticket = wait.cookies.get(`s2s_c_${LIVE}`)!;
  assert.ok(ticket, "capture ticket issued");
  assert.equal(ticket.path, "/api/capture");
  assert.equal(ticket.maxAge, 600, "10 minutes");
  assert.equal(ticket.httpOnly, true);
  assert.deepEqual(calls.uploads, [locks.lockId("capture", LIVE)], "one lock upload, no Admin API");
  assert.equal(calls.admin, 0);
  const withTicket = [`s2s_c_${LIVE}=${ticket.value}`];
  // later polls with the ticket: no more Cloudinary writes
  const again = await answer(await routes.capture.GET(req(`/api/capture/${LIVE}`, laptop, undefined, withTicket), ctx({ sku: LIVE })));
  assert.equal(again.cookies.size, 0);
  assert.equal(calls.upload, 1);
  // another browser that learned the sku can't get a ticket, and a first request (no session yet) doesn't try
  const snoop = anon();
  const s1 = await answer(await routes.capture.GET(req(`/api/capture/${LIVE}`, snoop), ctx({ sku: LIVE })));
  assert.equal(s1.cookies.has(`s2s_c_${LIVE}`), false, "the lock already names the laptop's session");
  const first = await answer(await routes.capture.GET(req(`/api/capture/${LIVE}`, null), ctx({ sku: LIVE })));
  assert.equal(first.cookies.has(`s2s_c_${LIVE}`), false);

  // the phone uploads
  await product(LIVE, { rawVersion: t0 + 5 });
  // the snooper, even replaying the laptop's ticket value: no claim (bound to the laptop's session)
  const stolen = await answer(await routes.capture.GET(req(`/api/capture/${LIVE}`, snoop, undefined, withTicket), ctx({ sku: LIVE })));
  assert.equal(stolen.json.ready, true);
  assert.equal(stolen.cookies.has(`s2s_p_${LIVE}`), false);
  // the laptop claims: product proof set, ticket deleted in the same response
  const claim = await answer(await routes.capture.GET(req(`/api/capture/${LIVE}`, laptop, undefined, withTicket), ctx({ sku: LIVE })));
  assert.equal(claim.json.ready, true);
  assert.ok(ownership.openProof("product", LIVE, claim.cookies.get(`s2s_p_${LIVE}`)?.value));
  assert.equal(claim.cookies.get(`s2s_c_${LIVE}`)?.maxAge, 0, "ticket consumed");
  // single-use: once the raw exists no new ticket is issued, so a later poll without it claims nothing
  const later = await answer(await routes.capture.GET(req(`/api/capture/${LIVE}`, laptop), ctx({ sku: LIVE })));
  assert.equal(later.cookies.size, 0);
  // the claimed proof works on the pipeline routes
  const fix = await answer(await routes.readiness.GET(req(`/api/readiness/${LIVE}`, laptop, undefined, kept(claim)), ctx({ sku: LIVE })));
  assert.equal(fix.json.canFix, true);
});

test("capture route: no claim for an upload older than 10 minutes, or without a ticket", async () => {
  const laptop = anon();
  await product("abcdefgh", { rawVersion: Math.floor(Date.now() / 1000) - 3 * 3600 });
  const old = await answer(await routes.capture.GET(req("/api/capture/abcdefgh", laptop), ctx({ sku: "abcdefgh" })));
  assert.equal(old.json.ready, true);
  assert.equal(old.cookies.size, 0, "an existing upload never issues a ticket or a claim");
  // a ticket (valid, this session) but a raw that landed long before it
  const ticket = `s2s_c_abcdefgh=${ownership.mintProof("capture", "abcdefgh", laptop.sid)}`;
  const stale = await answer(await routes.capture.GET(req("/api/capture/abcdefgh", laptop, undefined, [ticket]), ctx({ sku: "abcdefgh" })));
  assert.equal(stale.cookies.has("s2s_p_abcdefgh"), false);
  assert.equal(calls.upload, 0, "and nothing written");
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
  const other = await answer(await routes.qa.POST(req("/api/qa", unlocked(), { sku: LIVE, url, kind: "exact" })));
  assert.equal(other.status, 403, "no AI Vision spent on (or billed to) another browser's product");
  assert.equal(other.json.error, protect.READ_ONLY_NOT_YOURS);
  assert.equal(calls.vision, 0);
  const q = await answer(await routes.qa.POST(req("/api/qa", anon(), { sku: LIVE, url, kind: "exact" }, [proofCookie(LIVE)])));
  assert.equal(q.status, 200);
  assert.equal(q.json.tokens, 612);
  const c = await answer(await routes.cost.GET(req(`/api/cost/${LIVE}`, anon()), ctx({ sku: LIVE })));
  assert.equal(c.status, 200);
  assert.equal((c.json.cost as { aiVisionTokens: number }).aiVisionTokens, 669 + 729 + 612);
  // a composite of another product's cutout is not billed to this one
  visionTokens = 500;
  const foreign = url.replace(`products:${LIVE}:cutout`, "products:abcdefgh:cutout");
  await routes.qa.POST(req("/api/qa", anon(), { sku: LIVE, url: foreign, kind: "exact" }, [proofCookie(LIVE)]));
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

// ------------------------------------------------------------------ shelf names: authoritative, atomic creation

/** A product with a saved hero, the way stageCollection / pack leave it. */
async function heroProduct(sku: string) {
  await product(sku, { cutout: true, ctx: { hero: P(sku, "hero-cafe-1"), u_name: "Candle", u_place: "standing" } });
  put("image", P(sku, "hero-cafe-1"), { tags: ["s2s", "s2s-hero", `s2s-sku-${sku}`], context: { geo: "300,400,480,600" } });
  calls.upload = 0;
  calls.uploads = [];
}
const shelfTagged = (shop: string) => [...store.values()].filter((a) => a.tags.includes(`s2s-shop-${shop}`)).map((a) => a.public_id);

test("shelf lock: the first claim wins in Cloudinary itself; later claims read the owner back, never the cached list", async () => {
  const a = anon();
  const b = anon();
  assert.equal(await locks.claimLock("shelf", "twin-shop", a.sid), true, "created");
  locks.__resetLocks(); // another server instance: no in-process memory of the owner
  assert.equal(await locks.claimLock("shelf", "twin-shop", b.sid), false, "existing: someone else's");
  locks.__resetLocks();
  assert.equal(await locks.claimLock("shelf", "twin-shop", a.sid), true, "existing: its own (e.g. a retry)");
  assert.equal(await locks.holdsLock("shelf", "twin-shop", b.sid), false);
  assert.equal(await locks.holdsLock("shelf", "free-shop", a.sid), null, "nobody claimed it");
  assert.equal(calls.admin, 0, "Upload API + CDN only");
  const doc = store.get(key("raw", locks.lockId("shelf", "twin-shop")))!;
  assert.equal(doc.data!.includes(a.sid), false, "the lock stores a keyed hash, not the session id");
});

test("shelf create: two browsers publishing the same new name at once → exactly one wins, the other writes nothing", async () => {
  await heroProduct("shelfaa1");
  await heroProduct("shelfbb2");
  const a = anon();
  const b = anon();
  const body = (sku: string) => ({ shop: "twin-shop", title: "Mine", skus: [sku] });
  const [ra, rb] = await Promise.all([
    routes.shelf.POST(req("/api/shelf", a, body("shelfaa1"), [proofCookie("shelfaa1")])).then(answer),
    routes.shelf.POST(req("/api/shelf", b, body("shelfbb2"), [proofCookie("shelfbb2")])).then(answer),
  ]);
  const [win, lose, winSku, loseSku] = ra.status === 200 ? [ra, rb, "shelfaa1", "shelfbb2"] : [rb, ra, "shelfbb2", "shelfaa1"];
  assert.equal(win.status, 200);
  assert.equal(lose.status, 403);
  assert.equal(lose.json.code, "read_only");
  assert.equal(lose.json.error, protect.READ_ONLY_SHELF_TAKEN);
  assert.deepEqual(shelfTagged("twin-shop"), [P(winSku, "hero-cafe-1")], "only the winner's hero is on the shelf");
  assert.equal(store.get(key("image", P(loseSku, "hero-cafe-1")))!.context.st_twin_shop, undefined, "the loser wrote no context");
  const proof = win.cookies.get("s2s_s_twin-shop")!;
  assert.ok(ownership.openProof("shelf", "twin-shop", proof.value));
  assert.equal(proof.path, "/api/shelf");
  assert.equal(lose.cookies.has("s2s_s_twin-shop"), false);
});

test("shelf create: a name claimed a moment ago but not yet on the (cached) list is still refused", async () => {
  await heroProduct("shelfaa1");
  const a = anon();
  const b = anon();
  assert.equal(await locks.claimLock("shelf", "fresh-name", a.sid), true); // A is mid-publish: lock taken, no hero tagged yet
  locks.__resetLocks();
  const r = await answer(await routes.shelf.POST(req("/api/shelf", b, { shop: "fresh-name", title: "Mine", skus: ["shelfaa1"] }, [proofCookie("shelfaa1")])));
  assert.equal(r.status, 403);
  assert.equal(r.json.error, protect.READ_ONLY_SHELF_TAKEN);
  assert.equal(calls.addContext + calls.addTag + calls.removeTag, 0);
});

test("shelf update: the creator updates with its shelf cookie (no lock call), or by its session if the cookie was lost; others can't", async () => {
  await heroProduct("shelfaa1");
  const a = anon();
  const first = await answer(await routes.shelf.POST(req("/api/shelf", a, { shop: "meeras-shop", title: "Meera", skus: ["shelfaa1"] }, [proofCookie("shelfaa1")])));
  assert.equal(first.status, 200);
  const jar = [proofCookie("shelfaa1"), ...kept(first)];
  locks.__resetLocks();
  calls.uploads = [];
  const update = await answer(await routes.shelf.POST(req("/api/shelf", a, { shop: "meeras-shop", title: "Meera's", skus: ["shelfaa1"] }, jar)));
  assert.equal(update.status, 200);
  assert.equal(calls.uploads.filter((id) => id.startsWith("snap2shelf/locks/")).length, 0, "proof cookie: no lock call");
  const lost = await answer(await routes.shelf.POST(req("/api/shelf", a, { shop: "meeras-shop", title: "Meera's", skus: ["shelfaa1"] }, [proofCookie("shelfaa1")])));
  assert.equal(lost.status, 200, "same session, cookie lost: the lock names it");
  assert.ok(lost.cookies.has("s2s_s_meeras-shop"), "and the proof is re-issued");
  const other = await answer(await routes.shelf.POST(req("/api/shelf", anon(), { shop: "meeras-shop", title: "Mine", skus: ["shelfaa1"] }, [proofCookie("shelfaa1")])));
  assert.equal(other.status, 403);
  assert.equal(other.json.error, protect.READ_ONLY_SHELF_TAKEN);
});

// ------------------------------------------------------------------ session state: no stale overwrite

const ACCESS = "placeholder-access-code";

/** Cookie header entries after a browser applies these answers in order (deletions honoured). */
function jarAfter(start: string[], ...answers: { cookies: Map<string, SetCookie> }[]): string[] {
  const jar = new Map(start.map((c) => [c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1)]));
  for (const a of answers) {
    for (const c of a.cookies.values()) {
      if (c.maxAge === 0) jar.delete(c.name);
      else jar.set(c.name, c.value);
    }
  }
  return [...jar].map(([n, v]) => `${n}=${v}`);
}
function reqJar(path: string, jar: string[], body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { cookie: jar.join("; "), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("session race: a slow request that read the session before the access code was entered can't wipe the unlock", async () => {
  process.env.DEMO_ACCESS_CODE = ACCESS;
  const KIT = "racekit1"; // its own sku: the readiness text check is memoised per process
  await product(KIT, { cutout: true });
  const start = [cookieOf(anon({ o: 5 })), proofCookie(KIT)];
  // the kit lands: GET /api/readiness starts (reads the locked session) and takes ~12 s ...
  const slowReq = reqJar(`/api/readiness/${KIT}`, start);
  // ... meanwhile the visitor enters the access code
  const unlock = await answer(await routes.access.POST(reqJar("/api/access", start, { code: ACCESS })));
  assert.equal(unlock.status, 200);
  assert.equal(unlock.json.generationsLeft, 4);
  assert.equal(unlock.session, null, "unlocking doesn't re-issue the session cookie");
  assert.ok(unlock.cookies.get("s2s_unlock")?.httpOnly);
  // ... and the slow request finishes last, re-issuing s2s_access (it charged an AI Vision op)
  const slow = await answer(await routes.readiness.GET(slowReq, ctx({ sku: KIT })));
  assert.equal(slow.session?.o, 6);
  const jar = jarAfter(start, unlock, slow);
  const usage = await answer(await routes.usage.GET(reqJar("/api/usage", jar)));
  assert.deepEqual(usage.json.session, { unlocked: true, generationsLeft: 4 }, "still unlocked after the stale write");
  assert.equal(usage.session, null, "a read-only route never re-issues the session cookie");
  delete process.env.DEMO_ACCESS_CODE;
});

test("session race: generations are counted per cookie: no stale write rolls them back, re-entering the code doesn't reset them", async () => {
  process.env.DEMO_ACCESS_CODE = ACCESS;
  const s0 = anon();
  const start = [cookieOf(s0)];
  const unlock = await answer(await routes.access.POST(reqJar("/api/access", start, { code: ACCESS })));
  let jar = jarAfter(start, unlock);
  // two generations started concurrently from the same jar (what /api/generate and /api/scenes/generate record)
  const stateNow = session.readSessionState(reqJar("/api/generate", jar));
  const g1 = session.countGeneration(reqJar("/api/generate", jar), stateNow.session);
  const g2 = session.countGeneration(reqJar("/api/generate", jar), stateNow.session);
  jar = jarAfter(jar, { cookies: new Map(g1.map((c) => [c.name, c])) }, { cookies: new Map(g2.map((c) => [c.name, c])) });
  assert.equal(session.readSessionState(reqJar("/api", jar)).session.g, 2, "both concurrent starts count");
  // a stale s2s_access (read before both generations) written afterwards changes nothing
  const stale = jar.map((c) => (c.startsWith("s2s_access=") ? `s2s_access=${session.encodeSession({ ...s0, o: 9 })}` : c));
  assert.equal(session.readSessionState(reqJar("/api", stale)).session.g, 2);
  // re-entering the code: still 2 used
  const again = await answer(await routes.access.POST(reqJar("/api/access", stale, { code: ACCESS })));
  assert.equal(again.json.generationsLeft, 2);
  const usage = await answer(await routes.usage.GET(reqJar("/api/usage", jarAfter(stale, again))));
  assert.deepEqual(usage.json.session, { unlocked: true, generationsLeft: 2 });
  // proofs are bound to the session: a new session (cleared cookies) starts locked, with none used
  const fresh = session.readSessionState(reqJar("/api", [cookieOf(anon()), ...jar.filter((c) => !c.startsWith("s2s_access="))]));
  assert.equal(fresh.session.u, false);
  assert.equal(fresh.session.g, 0);
  // a cookie from before proof cookies (u / g inside s2s_access) keeps its unlock and count
  const legacy = session.readSessionState(reqJar("/api", [cookieOf(anon({ u: true, g: 3 }))]));
  assert.equal(legacy.session.u, true);
  assert.equal(session.generationsLeft(legacy.session), 1);
  delete process.env.DEMO_ACCESS_CODE;
});

test("session cookie: re-issued only when the open-op count changes or the visitor has no valid session", async () => {
  const s = anon({ o: 2 });
  const read = await answer(await routes.capture.GET(req(`/api/capture/${LIVE}`, s), ctx({ sku: LIVE })));
  assert.equal(read.session, null, "established session, nothing changed");
  const firstVisit = await answer(await routes.usage.GET(req("/api/usage", null)));
  assert.ok(firstVisit.session?.sid, "a first visit gets a session");
  const tampered = await answer(await routes.usage.GET(reqJar("/api/usage", [`s2s_access=${session.encodeSession(s).replace(/.$/, "x")}`])));
  assert.ok(tampered.session?.sid, "an invalid cookie is replaced (it used to be kept, minting a new sid on every request)");
  assert.notEqual(tampered.session!.sid, s.sid);
});

// ------------------------------------------------------------------ creative jobs: one slow step per poll

const genAsset = { storage: { storage_type: "upload", secure_url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1/tmp/generated-take.png` }, model: { id: "flux-2-flash-edit" } };

test("creative poll: generating → copy (checking) → fidelity check (completed), each slow step on its own poll", async () => {
  await product(LIVE, { cutout: true, ctx: { u_name: "Steel water bottle", u_place: "standing", caption: "A bottle on a white countertop next to a green potted plant" } });
  const s = anon();
  const token = jobToken.encodeJob({ a: "main", t: "abc123", s: LIVE, m: "flux-2-flash-edit", seed: 7, cv: 1, p: "on a carved teak table beside brass diyas, warm evening light", sid: s.sid, iat: Date.now() - 20_000 });
  const poll = async () => answer(await routes.jobs.GET(req(`/api/jobs/${token}`, s), ctx({ job: token })));
  const creativeId = creativeLib.creativeId(LIVE, "flux-2-flash-edit", 7);

  genTask = { status: "processing" };
  const p1 = await poll();
  assert.equal(p1.json.status, "processing");
  assert.equal(calls.upload + calls.vision + calls.visionGeneral, 0);

  genTask = { status: "completed", assets: [genAsset] };
  const p2 = await poll();
  assert.equal(p2.json.status, "checking", "copied into main; the check runs on the next poll");
  assert.ok(calls.uploads.includes(creativeId), "copied");
  assert.equal(calls.vision + calls.visionGeneral, 0, "no AI Vision in the copy poll");
  const { facts: afterCopy } = await facts.readFacts(LIVE);
  assert.ok(afterCopy!.creatives?.[`creative-flux-2-flash-edit-7`], "progress recorded in the product's facts");

  sheetStatus = 423; // the reference-vs-take sheet is still deriving
  const p3 = await poll();
  assert.equal(p3.json.status, "checking");
  assert.equal(calls.vision + calls.visionGeneral, 0);

  sheetStatus = 200;
  genTask = null; // the task may even have expired by now: progress lives in Cloudinary
  const uploadsBefore = calls.uploads.filter((id) => id === creativeId).length;
  const p4 = await poll();
  assert.equal(p4.json.status, "completed");
  assert.equal(calls.uploads.filter((id) => id === creativeId).length, uploadsBefore, "no second copy in the check poll");
  assert.equal(calls.vision, 1);
  assert.equal(calls.visionGeneral, 1);
  const asset = p4.json.asset as { qa: { status: string }; alt: string; publicId: string };
  assert.equal(asset.qa.status, "approved");
  assert.equal(asset.publicId, creativeId);
  assert.equal(asset.alt, "Steel water bottle on a carved teak table beside brass diyas, warm evening light", "describes the take, not the original photo");

  const p5 = await poll();
  assert.equal(p5.json.status, "completed");
  assert.equal(calls.vision + calls.visionGeneral, 2, "answered from the stored verdict");
  assert.equal((p5.json.asset as { alt: string }).alt, asset.alt);
});

test("creative alt text: product name + scene prompt, never the original photo's caption", () => {
  assert.equal(creativeLib.creativeAlt("Kurta", "festive flatlay with marigolds and brass lamps."), "Kurta on festive flatlay with marigolds and brass lamps");
  assert.equal(creativeLib.creativeAlt("Mug", "in a sunlit cafe window"), "Mug in a sunlit cafe window");
  assert.equal(creativeLib.creativeAlt(undefined, ""), "Product on a warm, softly lit tabletop styled for a festive Indian home, shallow depth of field");
  assert.ok(creativeLib.creativeAlt("Bottle", "x".repeat(300)).length <= 200);
});
