import { test } from "node:test";
import assert from "node:assert/strict";

// Placeholder values only, never real keys.
process.env.CLOUDINARY_CLOUD_NAME = "maincloud";
process.env.CLOUDINARY_API_KEY = "k0";
process.env.CLOUDINARY_API_SECRET = "s0-placeholder";

const session = await import("../lib/server/session.ts");
const crypto = await import("../lib/server/crypto.ts");
const sign = await import("../lib/server/upload-sign.ts");
const jobs = await import("../lib/server/job-token.ts");
const guard = await import("../lib/server/guard.ts");
const qa = await import("../lib/server/qa.ts");
const products = await import("../lib/server/products.ts");
const capture = await import("../lib/capture.ts");

// ------------------------------------------------------------------ session cookie

test("session: round-trips and rejects tampering", () => {
  const s = { ...session.newSession(), u: true, g: 2, o: 5 };
  const token = session.encodeSession(s);
  assert.deepEqual(session.decodeSession(token), s);

  const [payload, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...s, g: 0 })).toString("base64url");
  assert.equal(session.decodeSession(`${forged}.${sig}`), null, "edited payload");
  assert.equal(session.decodeSession(`${payload}.${sig.slice(0, -2)}xx`), null, "edited signature");
  assert.equal(session.decodeSession(`${payload}.`), null);
  assert.equal(session.decodeSession(`${payload}.${sig}.extra`), null);
  assert.equal(session.decodeSession(""), null);
  assert.equal(session.decodeSession(undefined), null);
  assert.equal(session.decodeSession("not-a-token"), null);
});

test("session: a cookie signed with another secret is rejected", () => {
  const s = session.newSession();
  const other = crypto.deriveKey("s2s-session", "some-other-secret");
  assert.equal(session.decodeSession(session.encodeSession(s, other)), null);
});

test("session: signed but malformed or expired payloads are rejected", () => {
  const key = session.sessionKey();
  assert.equal(session.decodeSession(crypto.signJson(key, { sid: "x", u: "yes" }), key), null);
  const old = { ...session.newSession(), iat: Math.floor(Date.now() / 1000) - 8 * 24 * 3600 };
  assert.equal(session.decodeSession(session.encodeSession(old, key), key), null);
});

test("session: generation allowance needs the unlock and respects LIVE_GEN_CAP", () => {
  process.env.LIVE_GEN_CAP = "4";
  assert.equal(session.generationsLeft({ ...session.newSession(), u: false }), 0);
  assert.equal(session.generationsLeft({ ...session.newSession(), u: true, g: 1 }), 3);
  assert.equal(session.generationsLeft({ ...session.newSession(), u: true, g: 9 }), 0);
  delete process.env.LIVE_GEN_CAP;
});

// ------------------------------------------------------------------ sign-upload allowlist

const now = () => Math.floor(Date.now() / 1000);
const good = () => ({
  timestamp: now(),
  source: "uw",
  upload_preset: "s2s_ingest",
  public_id: "snap2shelf/products/k3v9x2ab/raw",
  tags: "s2s,s2s-raw,s2s-sku-k3v9x2ab",
  context: "origin=phone",
});

test("sign-upload: accepts the widget's canonical params and signs them like the SDK", () => {
  const r = sign.checkParamsToSign(good());
  assert.ok(r.ok);
  const sig = sign.signParams(r.params);
  assert.match(sig, /^[a-f0-9]{40}$/);
  // minimal set (no source/tags/context) is fine too
  assert.ok(sign.checkParamsToSign({ timestamp: String(now()), upload_preset: "s2s_ingest", public_id: "snap2shelf/products/abcdefgh/raw" }).ok);
});

test("sign-upload: refuses anything outside the allowlist", () => {
  const bad: [string, Record<string, unknown>][] = [
    ["extra param overwrite", { ...good(), overwrite: true }],
    ["extra param folder", { ...good(), folder: "x" }],
    ["extra param eager", { ...good(), eager: "e_background_removal" }],
    ["extra param notification_url", { ...good(), notification_url: "https://evil.example" }],
    ["extra param type", { ...good(), type: "authenticated" }],
    ["wrong preset", { ...good(), upload_preset: "ml_default" }],
    ["missing preset", { ...good(), upload_preset: undefined }],
    ["missing public_id", { ...good(), public_id: undefined }],
    ["other folder", { ...good(), public_id: "snap2shelf/scenes/diwali/x" }],
    ["cutout id", { ...good(), public_id: "snap2shelf/products/k3v9x2ab/cutout" }],
    ["traversal", { ...good(), public_id: "snap2shelf/products/../k3v9x2ab/raw" }],
    ["upper-case sku", { ...good(), public_id: "snap2shelf/products/K3V9X2AB/raw" }],
    ["short sku", { ...good(), public_id: "snap2shelf/products/k3v9/raw" }],
    ["stale timestamp", { ...good(), timestamp: now() - 3600 }],
    ["future timestamp", { ...good(), timestamp: now() + 3600 }],
    ["non-numeric timestamp", { ...good(), timestamp: "soon" }],
    ["foreign sku tag", { ...good(), tags: "s2s,s2s-raw,s2s-sku-zzzzzzzz" }],
    ["arbitrary tag", { ...good(), tags: "s2s,s2s-raw,s2s-scene" }],
    ["missing raw tag", { ...good(), tags: "s2s" }],
    ["spoofed analysis context", { ...good(), context: "analyzed=1|u_name=Hacked" }],
    ["context with markup", { ...good(), context: "origin=<script>" }],
    ["other source", { ...good(), source: "api" }],
    ["object value", { ...good(), tags: ["s2s"] }],
    ["array input", [] as unknown as Record<string, unknown>],
  ];
  for (const [name, params] of bad) {
    const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
    assert.equal(sign.checkParamsToSign(Array.isArray(params) ? params : clean).ok, false, name);
  }
});

// ------------------------------------------------------------------ job tokens

const claims = { a: "pool2", t: "abc123", s: "k3v9x2ab", m: "flux-2-flash-edit", seed: 7, cv: 1790000000, p: "on a teak table", sid: "sess12345", iat: Date.now() };

test("job token: round-trips and is opaque (no account label or task id readable)", () => {
  const token = jobs.encodeJob(claims);
  assert.deepEqual(jobs.decodeJob(token), { v: 1, ...claims });
  const visible = token + token.split(".").map((p) => Buffer.from(p, "base64url").toString("latin1")).join("");
  assert.ok(!visible.includes("pool2") && !visible.includes("abc123") && !visible.includes("teak"));
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "URL-safe");
});

test("job token: any modification, a foreign key, or expiry is rejected", () => {
  const token = jobs.encodeJob(claims);
  const [iv, ct, tag] = token.split(".");
  const flip = (s: string, i: number) => {
    const b = Buffer.from(s, "base64url");
    b[i % b.length] ^= 0x01;
    return b.toString("base64url");
  };
  assert.equal(jobs.decodeJob(`${iv}.${flip(ct, 3)}.${tag}`), null, "ciphertext bit flip");
  assert.equal(jobs.decodeJob(`${flip(iv, 0)}.${ct}.${tag}`), null, "iv bit flip");
  assert.equal(jobs.decodeJob(`${iv}.${ct}.${flip(tag, 5)}`), null, "tag bit flip");
  assert.equal(jobs.decodeJob(`${iv}.${ct}`), null, "truncated");
  assert.equal(jobs.decodeJob("garbage"), null);
  assert.equal(jobs.decodeJob(jobs.encodeJob(claims, crypto.deriveKey("s2s-job", "other"))), null, "other key");
  assert.equal(jobs.decodeJob(jobs.encodeJob({ ...claims, iat: Date.now() - 3 * 3600_000 })), null, "expired");
  // a session cookie is not a job token (different key and format)
  assert.equal(jobs.decodeJob(session.encodeSession(session.newSession())), null);
});

// ------------------------------------------------------------------ SSRF guard

const B = "https://res.cloudinary.com/maincloud/image/upload";
const composite = `${B}/c_fill,w_1080,h_1350/l_snap2shelf:products:k3v9x2ab:cutout/c_scale,w_497/fl_layer_apply,g_north_west,x_292,y_510/f_auto,q_auto/snap2shelf/scenes/diwali/teak-42`;

test("guard: accepts our own delivery URLs (composite, creative asset, versioned)", () => {
  for (const u of [
    composite,
    `${B}/c_fill,w_1080,h_1350,g_auto/f_auto,q_auto/snap2shelf/products/k3v9x2ab/creative-flux-2-flash-edit-7`,
    `${B}/v1790706059/snap2shelf/spikes/scenes/diwali_teak_42.png`,
  ]) {
    const r = guard.checkMainImageUrl(u, "maincloud");
    assert.ok(r.ok, u);
  }
});

test("guard: refuses other hosts, clouds, schemes, fetch layers and paid generative effects", () => {
  const bad: [string, unknown][] = [
    ["http", composite.replace("https:", "http:")],
    ["other cloud", composite.replace("/maincloud/", "/othercloud/")],
    ["other host", composite.replace("res.cloudinary.com", "evil.example")],
    ["lookalike host", composite.replace("res.cloudinary.com", "res.cloudinary.com.evil.example")],
    ["userinfo", composite.replace("https://", "https://res.cloudinary.com@")],
    ["port", composite.replace("res.cloudinary.com", "res.cloudinary.com:8443")],
    ["query", composite + "?x=1"],
    ["fragment", composite + "#x"],
    ["fetch delivery", `https://res.cloudinary.com/maincloud/image/fetch/https://evil.example/a.jpg`],
    ["fetch layer", `${B}/l_fetch:aHR0cHM6Ly9ldmlsLmV4YW1wbGUvYS5qcGc=/fl_layer_apply/snap2shelf/products/k3v9x2ab/raw`],
    ["gen recolor", `${B}/e_gen_recolor:prompt_shoe;to-color_ff0000/snap2shelf/products/k3v9x2ab/raw`],
    ["gen fill", `${B}/ar_9:16,b_gen_fill,c_pad,w_1080/snap2shelf/products/k3v9x2ab/raw`],
    ["bg removal", `${B}/e_background_removal/snap2shelf/products/k3v9x2ab/raw`],
    ["upscale", `${B}/e_upscale/snap2shelf/products/k3v9x2ab/raw`],
    ["traversal", `${B}/../../othercloud/image/upload/snap2shelf/products/k3v9x2ab/raw`],
    ["encoded traversal", `${B}/%2e%2e/%2e%2e/x/snap2shelf/products/k3v9x2ab/raw`],
    ["backslash", `${B}\\snap2shelf/products/k3v9x2ab/raw`],
    ["foreign asset", `${B}/f_auto/sample`],
    ["video", `https://res.cloudinary.com/maincloud/video/upload/snap2shelf/products/k3v9x2ab/raw`],
    ["too long", `${B}/${"c_scale,w_100/".repeat(200)}snap2shelf/products/k3v9x2ab/raw`],
    ["not a string", 42],
    ["javascript", "javascript:alert(1)"],
  ];
  for (const [name, u] of bad) assert.equal(guard.checkMainImageUrl(u, "maincloud").ok, false, name);
});

test("guard: pinJpeg swaps f_auto for f_jpg (and q_auto when asked) only as whole components", () => {
  assert.equal(guard.pinJpeg(`${B}/c_fill,w_600/f_auto,q_auto:eco/x`), `${B}/c_fill,w_600/f_jpg,q_auto:eco/x`);
  assert.equal(guard.pinJpeg(`${B}/f_auto,q_auto/x`, "q_90"), `${B}/f_jpg,q_90/x`);
  assert.equal(guard.pinJpeg(`${B}/f_auto/x`), `${B}/f_jpg/x`);
  assert.equal(guard.pinJpeg(`${B}/f_jpg,q_auto:best/x`), `${B}/f_jpg,q_auto:best/x`);
});

// ------------------------------------------------------------------ QA decisions + analysis parsing

test("qa: exact decision needs product-visible and no reject tag", () => {
  assert.equal(qa.decideExact(["product-visible"]).status, "approved");
  assert.equal(qa.decideExact([]).status, "rejected");
  const r = qa.decideExact(["product-visible", "product-floating"]);
  assert.equal(r.status, "rejected");
  assert.equal(r.reasons.length, 1);
});

test("qa: fidelity decision uses tags plus the same_product verdict, not the score", () => {
  assert.equal(qa.decideFidelity(["same-product"], { same_product: true, fidelity_score: 40, differences: [] }).status, "approved");
  const r = qa.decideFidelity(["product-redesigned", "garbled-text"], { same_product: false, fidelity_score: 85, differences: ["added side logo badge"] });
  assert.equal(r.status, "rejected");
  assert.ok(r.reasons.includes("added side logo badge"));
  assert.equal(r.fidelity, 85);
  assert.equal(qa.decideFidelity([], null).status, "rejected");
  const round = qa.qaFromContext(qa.qaToContext(r));
  assert.deepEqual(round?.matched, r.matched);
  assert.deepEqual(round?.reasons, r.reasons);
});

test("analyze: product JSON is validated; themes are limited to SCENE_THEMES for the placement", () => {
  const ok = products.parseUnderstanding(
    '```json\n{"name":"Steel bottle","category":"drinkware","primary_color":"silver","material":"steel","recolorable_part":"bottle body","placement":"standing","suggested_themes":["marble","flatlay-linen","moon"]}\n```',
    "",
  );
  assert.equal(ok.fromAi, true);
  assert.deepEqual(ok.understanding.suggested_themes, ["marble"]);
  const fb = products.parseUnderstanding("I cannot help with that", "A folded cotton kurta on a bed");
  assert.equal(fb.fromAi, false);
  assert.equal(fb.understanding.placement, "flatlay");
  assert.deepEqual(fb.understanding.suggested_themes, ["flatlay-festive", "flatlay-linen"]);
});

test("capture: probe URL busts caches with a unique version component", () => {
  const a = capture.captureProbeUrl("maincloud", "k3v9x2ab");
  const b = capture.captureProbeUrl("maincloud", "k3v9x2ab");
  assert.match(a, /^https:\/\/res\.cloudinary\.com\/maincloud\/image\/upload\/v\d+\/snap2shelf\/products\/k3v9x2ab\/raw$/);
  assert.notEqual(a, b);
  assert.throws(() => capture.captureProbeUrl("maincloud", "../x"));
});
