// node --conditions=react-server --import tsx --test tests/showcase.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";

const { SAMPLES, LISTED_SAMPLES, FEATURED, getSample } = await import("../lib/showcase.ts");
const { sampleCost, sampleReadiness } = await import("../lib/client/sample-data.ts");
const { canRecolor } = await import("../lib/client/swatches.ts");

test("samples: the featured sneaker first, the seeded kits after it, bottle01 retired", () => {
  assert.equal(FEATURED.sku, "sneaker1");
  assert.equal(getSample("bottle01"), undefined);
  assert.deepEqual(
    LISTED_SAMPLES.map((s) => s.sku),
    ["sneaker1", "shbottle", "shtrail1", "shkurta1", "shmessy1"],
  );
  // the duplicate photo stays reachable by link
  assert.ok(getSample("shsneakr") && !getSample("shsneakr")!.listed);
});

test("seeded samples replay stored results: zip, reel, hero, offer lines", () => {
  for (const s of SAMPLES.filter((x) => x.sku.startsWith("sh"))) {
    assert.ok(s.kit.zipUrl, `${s.sku} has a zip`);
    assert.ok(s.kit.reel?.url, `${s.sku} has a reel`);
    assert.ok(s.heroPublicId.startsWith(`snap2shelf/products/${s.sku}/hero-`), s.sku);
    assert.match(s.offer.hindi, /[ऀ-ॿ]/, `${s.sku} Hindi offer`);
    assert.ok(s.offer.english.length > 0, `${s.sku} English offer`);
    assert.equal(s.qa.status, "approved");
    // the Kit handed to the browser carries no seed-only fields
    assert.equal("attempts" in s.kit, false);
  }
});

test("the messy bottle retells its real QA rejection", () => {
  const s = getSample("shmessy1")!;
  assert.ok(s.qaStory);
  assert.equal(s.qaStory!.rejected.status, "rejected");
  assert.match(s.qaStory!.caught, /floating/);
  assert.match(s.qaStory!.fix, /20 px lower/);
  assert.equal(s.qaStory!.attempts, 3);
  assert.equal(getSample("shbottle")!.qaStory, undefined);
});

test("sample cost ledger: real totals, itemised lines add up, no request", () => {
  const s = getSample("shbottle")!;
  const c = sampleCost(s);
  assert.equal(c.cost.aiVisionTokens, s.kit.cost.aiVisionTokens);
  assert.equal(c.breakdown.transformations.reduce((n, t) => n + t.tx, 0), s.kit.cost.transformationsEstimate);
  assert.equal(c.breakdown.tokens.reduce((n, t) => n + t.tokens, 0), s.kit.cost.aiVisionTokens);
  assert.equal(c.wallClockSeconds, Math.round(s.timings!.total / 1000));
  assert.equal(c.breakdown.generation.length, 0);
});

test("sample readiness ships with the page (the featured sneaker shares shsneakr's pixels)", async () => {
  for (const s of LISTED_SAMPLES) {
    const r = await sampleReadiness(s.sku);
    assert.ok(r && r.score > 0 && r.checks.length === 6, s.sku);
  }
});

test("recolor is offered only where a part (or a whole shoe) can be repainted", () => {
  assert.equal(canRecolor({ category: "food", recolorable_part: "bottom panel", name: "Trail mix pouch" }), false);
  assert.equal(canRecolor({ category: "snacks", recolorable_part: "pouch" }), false);
  assert.equal(canRecolor({ category: "drinkware", recolorable_part: "bottle body" }), true);
  assert.equal(canRecolor({ category: "footwear", recolorable_part: "upper panels" }), true);
  assert.equal(canRecolor({ category: "clothing", recolorable_part: "tunic fabric" }), true);
  assert.equal(canRecolor(undefined), true);
});
