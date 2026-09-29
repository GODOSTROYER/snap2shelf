import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Three fake accounts; values are placeholders, never real keys.
process.env.CLOUDINARY_CLOUD_NAME = "maincloud";
process.env.CLOUDINARY_API_KEY = "k0";
process.env.CLOUDINARY_API_SECRET = "s0";
process.env.CLOUDINARY_POOL_1_CLOUD_NAME = "poolone";
process.env.CLOUDINARY_POOL_1_API_KEY = "k1";
process.env.CLOUDINARY_POOL_1_API_SECRET = "s1";
process.env.CLOUDINARY_POOL_2_CLOUD_NAME = "pooltwo";
process.env.CLOUDINARY_POOL_2_API_KEY = "k2";
process.env.CLOUDINARY_POOL_2_API_SECRET = "s2";

const usage: Record<string, { image_generation: { usage: number; limit: number }; ai_vision: { usage: number; limit: number } }> = {};
let usageCalls = 0;
globalThis.fetch = (async (url: string) => {
  const cloud = /v1_1\/([^/]+)\/usage/.exec(String(url))?.[1];
  if (!cloud) throw new Error("unexpected fetch " + url);
  usageCalls++;
  return new Response(JSON.stringify(usage[cloud]), { status: 200 });
}) as typeof fetch;

const pool = await import("../lib/cloudinary/pool.ts");
const { QuotaError, PoolExhaustedError } = pool;

beforeEach(() => {
  pool.__resetPoolState();
  usageCalls = 0;
  usage.maincloud = { image_generation: { usage: 10, limit: 50 }, ai_vision: { usage: 0, limit: 100000 } };
  usage.poolone = { image_generation: { usage: 0, limit: 50 }, ai_vision: { usage: 0, limit: 100000 } };
  usage.pooltwo = { image_generation: { usage: 49, limit: 50 }, ai_vision: { usage: 0, limit: 100000 } };
});

test("ranks by remaining quota and drops accounts below the floor", async () => {
  const ranked = await pool.rankAccounts("image_generation", 1);
  assert.deepEqual(ranked.map((a) => a.label), ["pool1", "main"]); // pool2 has 1 left < floor
  assert.equal(usageCalls, 3);
});

test("ties go to main first (no copy step needed)", async () => {
  const ranked = await pool.rankAccounts("ai_vision", 500);
  assert.deepEqual(ranked.map((a) => a.label), ["main", "pool1", "pool2"]);
});

test("usage is cached between calls", async () => {
  await pool.rankAccounts("image_generation");
  await pool.rankAccounts("image_generation");
  assert.equal(usageCalls, 3);
});

test("live quota readings override the stale usage numbers", async () => {
  await pool.rankAccounts("image_generation");
  pool.recordQuota("pool1", "image_generation", { remaining: 3, limit: 50 });
  const ranked = await pool.rankAccounts("image_generation", 1);
  assert.deepEqual(ranked.map((a) => a.label), ["main", "pool1"]);
  const r2 = await pool.rankAccounts("image_generation", 5); // pool1: 3-5 < floor
  assert.deepEqual(r2.map((a) => a.label), ["main"]);
});

test("a quota error benches the account and the call moves on", async () => {
  const tried: string[] = [];
  const { result, account } = await pool.withPooledAccount("image_generation", async (a) => {
    tried.push(a.label);
    if (a.label === "pool1") throw new QuotaError("Daily generation limit exceeded", 429);
    return "ok";
  });
  assert.equal(result, "ok");
  assert.equal(account.label, "main");
  assert.deepEqual(tried, ["pool1", "main"]);
  const ranked = await pool.rankAccounts("image_generation");
  assert.deepEqual(ranked.map((a) => a.label), ["main"]); // pool1 benched
});

test("non-quota errors are rethrown without trying other accounts", async () => {
  const tried: string[] = [];
  await assert.rejects(
    pool.withPooledAccount("ai_vision", async (a) => {
      tried.push(a.label);
      throw Object.assign(new Error("Invalid prompt"), { status: 400 });
    }),
    /Invalid prompt/,
  );
  assert.equal(tried.length, 1);
});

test("throws PoolExhaustedError when every account is out", async () => {
  usage.maincloud.image_generation.usage = 50;
  usage.poolone.image_generation.usage = 49;
  await assert.rejects(pool.withPooledAccount("image_generation", async () => "never"), PoolExhaustedError);
});

test("summary exposes totals only", async () => {
  const s = await pool.poolSummary("image_generation");
  assert.deepEqual(s, { remaining: 40 + 50 + 1, limit: 150, usable: 38 + 48 + 0, known: true });
});
