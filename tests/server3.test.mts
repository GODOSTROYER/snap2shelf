// Hardening tests (no network): SDK error sanitising, Admin API circuit breaker,
// rate-limit → ApiError mapping.
//   node --conditions=react-server --import tsx --test tests/server3.test.mts
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";

// Placeholder values only, never real keys.
const SECRET = "s3cretPlaceholderValue42";
const KEY = "123456789012345";
process.env.CLOUDINARY_CLOUD_NAME = "maincloud";
process.env.CLOUDINARY_API_KEY = KEY;
process.env.CLOUDINARY_API_SECRET = SECRET;

const safe = await import("../lib/cloudinary/safe.ts");
const admin = await import("../lib/cloudinary/admin.ts");
const http = await import("../lib/server/http.ts");
const pool = await import("../lib/cloudinary/pool.ts");

beforeEach(() => {
  admin.__resetAdminState();
});

/** What the Node SDK rejects an Admin API call with (execute_request.js): the request options ride along. */
function fakeAdminRejection(message: string, http_code: number) {
  return {
    request_options: {
      method: "GET",
      auth: `${KEY}:${SECRET}`,
      headers: { Authorization: "Basic " + Buffer.from(`${KEY}:${SECRET}`).toString("base64"), "User-Agent": "CloudinaryNodeJS" },
      host: "api.cloudinary.com",
    },
    query_params: { context: true, api_key: KEY, api_secret: SECRET },
    error: { message, http_code },
  };
}

const leaks = (s: string) => [SECRET, KEY, Buffer.from(`${KEY}:${SECRET}`).toString("base64"), "request_options", "query_params"].filter((x) => s.includes(x));

function assertClean(e: unknown, what: string) {
  const views = [String(e), JSON.stringify(e), inspect(e, { depth: 10, showHidden: true }), (e as Error)?.stack ?? "", (e as Error)?.message ?? ""];
  for (const v of views) assert.deepEqual(leaks(v), [], `${what}: leaked in ${v.slice(0, 200)}`);
}

// ------------------------------------------------------------------ sanitising

test("sanitizeCldError keeps message + http_code only, drops request_options/auth deeply", () => {
  const raw = fakeAdminRejection("Resource not found - snap2shelf/products/x/raw", 404);
  const e = safe.sanitizeCldError(raw, "resource");
  assert.ok(e instanceof Error);
  assert.equal(e.name, "CloudinarySdkError");
  assert.equal(e.http_code, 404);
  assert.equal(e.message, "Resource not found - snap2shelf/products/x/raw");
  assert.equal((e as unknown as { cause?: unknown }).cause, undefined, "original object not kept as cause");
  assertClean(e, "admin rejection");
  assert.equal(http.cldHttpCode(e), 404, "existing 404 handling still works");
});

test("sanitizeCldError scrubs secrets that appear inside the message itself", () => {
  const e = safe.sanitizeCldError({ error: { message: `bad auth ${KEY}:${SECRET} api_secret=${SECRET} https://${KEY}:${SECRET}@api.cloudinary.com Basic ${Buffer.from("a:b").toString("base64")}xyz`, http_code: 401 } });
  assertClean(e, "message");
  assert.match(e.message, /\[redacted\]/);
  assert.equal(e.http_code, 401);
});

test("sanitizeCldError handles uploader, network and odd shapes", () => {
  const up = safe.sanitizeCldError({ message: "Invalid image file", http_code: 400 });
  assert.equal(up.message, "Invalid image file");
  assert.equal(up.http_code, 400);
  const net = safe.sanitizeCldError({ error: { message: new Error("socket hang up"), http_code: 499, request_options: { auth: `${KEY}:${SECRET}` } } });
  assert.equal(net.message, "socket hang up");
  assertClean(net, "network error");
  assert.equal(safe.sanitizeCldError(null).message, "Cloudinary request failed");
  assert.equal(safe.sanitizeCldError({ weird: { auth: SECRET } }).message, "Cloudinary request failed");
});

test("cldSafe re-throws a clean error; results pass through", async () => {
  await assert.rejects(
    safe.cldSafe("upload", async () => {
      throw fakeAdminRejection("Upload failed", 500);
    }),
    (e: unknown) => {
      assertClean(e, "cldSafe");
      return (e as { http_code?: number }).http_code === 500;
    },
  );
  assert.equal(await safe.cldSafe("x", async () => 7), 7);
});

test("apiError never logs or returns SDK internals", async () => {
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.map(String).join(" "));
  try {
    const res = http.apiError(fakeAdminRejection(`boom ${SECRET}`, 500), "test");
    const body = await res.text();
    assert.equal(res.status, 502);
    assert.deepEqual(leaks(body), []);
    assert.deepEqual(leaks(logged.join("\n")), [], "server log is clean too");
  } finally {
    console.error = orig;
  }
});

// ------------------------------------------------------------------ breaker

test("parseRateLimitReset reads the reset time in several formats, else the next hour", () => {
  const now = Date.parse("2026-09-30T04:31:10Z");
  const at = Date.parse("2026-09-30T05:00:00Z");
  for (const msg of [
    "Rate Limit Exceeded. Try again on 2026-09-30 05:00:00 UTC",
    "Rate Limit Exceeded, reset at 2026-09-30T05:00:00Z",
    "Rate Limit Exceeded until Wed, 30 Sep 2026 05:00:00 GMT",
    "Rate Limit Exceeded - try again on Wed Sep 30 05:00:00 UTC 2026",
    "Rate Limit Exceeded 2026-09-30 05:00:00 +0000",
  ]) {
    assert.equal(admin.parseRateLimitReset(msg, now), at, msg);
  }
  assert.equal(admin.parseRateLimitReset("Rate Limit Exceeded", now), at + 2000, "no time → next full hour");
  assert.equal(admin.parseRateLimitReset("Rate Limit Exceeded", now, "Wed, 30 Sep 2026 05:00:00 GMT"), at, "header wins");
  // absurd times are ignored; result always within 5 s .. 65 min
  assert.equal(admin.parseRateLimitReset("try again on 2030-01-01 00:00:00 UTC", now), at + 2000);
  const soon = admin.parseRateLimitReset("try again on 2026-09-30 04:31:11 UTC", now);
  assert.equal(soon, now + 5000);
});

test("breaker: one 420 stops all Admin calls until the reset; other accounts unaffected", async () => {
  const soon = new Date(Date.now() + 20 * 60_000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
  let sent = 0;
  const limitedCall = () =>
    admin.adminCall("resource", async () => {
      sent++;
      throw fakeAdminRejection(`Rate Limit Exceeded. Try again on ${soon}`, 420);
    });
  await assert.rejects(limitedCall(), (e: unknown) => {
    assertClean(e, "420");
    assert.ok(e instanceof admin.AdminLimitedError);
    assert.ok(e.retryAfterMs > 19 * 60_000 && e.retryAfterMs <= 20 * 60_000 + 1000, `retryAfterMs ${e.retryAfterMs}`);
    return true;
  });
  assert.equal(sent, 1);
  // further calls fail fast without touching Cloudinary
  for (let i = 0; i < 3; i++) await assert.rejects(admin.adminCall("resources", async () => void sent++), admin.AdminLimitedError);
  assert.equal(sent, 1, "no call sent while the breaker is open");
  assert.equal(admin.adminStats("main").refused, 3);
  assert.ok(admin.adminPausedFor("main") > 19 * 60_000);
  // a pool account keeps working
  assert.equal(await admin.adminCall("usage", async () => "ok", "pool1"), "ok");
});

test("breaker: 429 behaves like 420; non-rate-limit errors don't open it", async () => {
  await assert.rejects(admin.adminCall("x", async () => Promise.reject(fakeAdminRejection("Not found", 404))), (e: unknown) => (e as { http_code: number }).http_code === 404);
  assert.equal(admin.adminPausedFor("main"), 0);
  await assert.rejects(admin.adminCall("x", async () => Promise.reject(fakeAdminRejection("Too many requests", 429))), admin.AdminLimitedError);
  assert.ok(admin.adminPausedFor("main") > 0);
});

test("breaker: opens pre-emptively when x-featureratelimit-remaining reaches the reserve", async () => {
  process.env.ADMIN_API_RESERVE = "5";
  const reset = new Date(Date.now() + 10 * 60_000);
  await admin.adminCall("resource", async () => ({ ok: 1, rate_limit_remaining: 6, rate_limit_allowed: 500, rate_limit_reset_at: reset }));
  assert.equal(admin.adminPausedFor("main"), 0);
  assert.equal(admin.adminStats("main").remaining, 6);
  await admin.adminCall("resource", async () => ({ ok: 1, rate_limit_remaining: 5, rate_limit_allowed: 500, rate_limit_reset_at: reset }));
  const paused = admin.adminPausedFor("main");
  assert.ok(paused > 9 * 60_000 && paused <= 10 * 60_000 + 3000, `paused ${paused}`);
  await assert.rejects(admin.adminCall("resource", async () => ({})), admin.AdminLimitedError);
  delete process.env.ADMIN_API_RESERVE;
});

test("adminFetch: reads rate-limit headers and maps a 420 response", async () => {
  const ok = await admin.adminFetch("usage", "main", async () => new Response("{}", { status: 200, headers: { "x-featureratelimit-remaining": "321", "x-featureratelimit-limit": "500" } }));
  assert.equal(ok.status, 200);
  assert.equal(admin.adminStats("main").remaining, 321);
  const reset = new Date(Date.now() + 5 * 60_000).toUTCString();
  await assert.rejects(
    admin.adminFetch("usage", "main", async () => new Response(JSON.stringify({ error: { message: "Rate Limit Exceeded" } }), { status: 420, headers: { "x-featureratelimit-reset": reset } })),
    (e: unknown) => e instanceof admin.AdminLimitedError && e.retryAfterMs > 4 * 60_000 && e.retryAfterMs <= 5 * 60_000,
  );
  let called = false;
  await assert.rejects(admin.adminFetch("usage", "main", async () => ((called = true), new Response("{}"))), admin.AdminLimitedError);
  assert.equal(called, false);
});

// ------------------------------------------------------------------ error mapping

test("rate limits map to quota_low / pending with retryAfterMs, never 5xx upstream", async () => {
  const long = http.toHttpError(new admin.AdminLimitedError(25 * 60_000, "main"));
  assert.equal(long?.status, 503);
  assert.equal(long?.code, "quota_low");
  assert.equal(long?.retryAfterMs, 25 * 60_000);
  assert.match(long!.publicMessage, /25 minutes/);

  const shortRetriable = http.toHttpError(new admin.AdminLimitedError(8_000, "main"), true);
  assert.equal(shortRetriable?.status, 202);
  assert.equal(shortRetriable?.code, "pending");
  assert.equal(shortRetriable?.retryAfterMs, 8_000);
  const shortPlain = http.toHttpError(new admin.AdminLimitedError(8_000, "main"), false);
  assert.equal(shortPlain?.code, "quota_low", "non-retriable routes never answer 202");

  // a raw 429 / 420 from any Cloudinary API (not through the breaker)
  const raw429 = http.toHttpError({ error: { message: "Too many concurrent requests", http_code: 429 } }, true);
  assert.equal(raw429?.code, "pending");
  const raw420 = http.toHttpError(safe.sanitizeCldError(fakeAdminRejection(`Rate Limit Exceeded. Try again on ${new Date(Date.now() + 30 * 60_000).toISOString()}`, 420)));
  assert.equal(raw420?.code, "quota_low");
  assert.ok((raw420?.retryAfterMs ?? 0) > 29 * 60_000);

  assert.equal(http.toHttpError(new pool.PoolExhaustedError("image_generation"))?.code, "quota_low");
  assert.equal(http.toHttpError(new pool.QuotaError("quota exceeded", 429))?.code, "quota_low");
  assert.equal(http.toHttpError(new Error("boom")), null);

  const res = http.apiError(new admin.AdminLimitedError(10 * 60_000, "main"), "t");
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("retry-after"), "600");
  const body = (await res.json()) as { code: string; retryAfterMs: number; error: string };
  assert.equal(body.code, "quota_low");
  assert.equal(body.retryAfterMs, 600_000);
  assert.doesNotMatch(body.error, /main|pool/i, "no account names in the message");
});
