// node --conditions=react-server --import tsx --test tests/showcase.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";

const { SAMPLES, LISTED_SAMPLES, FEATURED, PRIMARY_SAMPLE, SHOWCASE_SAMPLE, getSample } = await import("../lib/showcase.ts");
const { sampleCost, sampleReadiness } = await import("../lib/client/sample-data.ts");
const { canRecolor } = await import("../lib/client/swatches.ts");
const { PRIMARY_SAMPLE_SKU, PRODUCT_NAMES, SHOWCASE_KIT_SKU } = await import("../lib/claims.ts");
const { sizedUrl, snapWidth, WIDTHS } = await import("../lib/client/img.ts");
const { beforeAt, heroAt } = await import("../lib/showcase.ts");

test("samples: the picker leads with the QA-catch sample; every listed kit has a ZIP; bottle01 retired", () => {
  assert.equal(FEATURED.sku, "sneaker1"); // the landing hero's before/after
  assert.equal(PRIMARY_SAMPLE.sku, PRIMARY_SAMPLE_SKU);
  assert.equal(SHOWCASE_SAMPLE.sku, SHOWCASE_KIT_SKU);
  assert.equal(getSample("bottle01"), undefined);
  assert.deepEqual(
    LISTED_SAMPLES.map((s) => s.sku),
    ["shmessy1", "shbottle", "shtrail1", "shkurta1", "shsneakr"],
  );
  for (const s of LISTED_SAMPLES) assert.ok(s.kit.zipUrl, `${s.sku} is offered, so it has a zip`);
  // the hand-built landing sneaker has no zip: reachable by link, never offered in the picker
  assert.ok(getSample("sneaker1") && !getSample("sneaker1")!.listed && !getSample("sneaker1")!.kit.zipUrl);
  assert.ok(PRIMARY_SAMPLE.qaStory && PRIMARY_SAMPLE.kit.zipUrl);
});

test("samples go by their canonical names, and never call the AI-generated input a phone photo", () => {
  for (const s of SAMPLES) {
    assert.equal(s.title, PRODUCT_NAMES[s.sku], s.sku);
    assert.doesNotMatch(s.blurb, /phone/i, s.sku);
    assert.equal(s.kit.product.understanding?.name, PRODUCT_NAMES[s.sku], `${s.sku} product name`);
    for (const a of [s.kit.hero, ...s.kit.assets]) assert.ok(!/Embroidered linen tunic|Stainless steel water bottle/.test(a.alt), `${s.sku} ${a.id} alt`);
  }
  // the two bottle kits share a listing name; the picker tells them apart by their photos
  assert.equal(getSample("shmessy1")!.title, getSample("shbottle")!.title);
  assert.notEqual(getSample("shmessy1")!.blurb, getSample("shbottle")!.blurb);
});

test("display widths come from one fixed set", () => {
  assert.deepEqual([...WIDTHS], [360, 480, 720, 1080]);
  assert.equal(snapWidth(48), 360);
  assert.equal(snapWidth(400), 480);
  assert.equal(snapWidth(1280), 1080);
  for (const s of SAMPLES) {
    // whatever width a layout asks for, the URL carries a fixed one
    assert.match(heroAt(s.kit, 400), /\/c_limit,w_480\/f_auto,q_auto\//, s.sku);
    assert.match(beforeAt(s, 1300), /w_1080\//, s.sku);
    for (const a of s.kit.assets) {
      const u = sizedUrl(a, 250);
      assert.ok(u === a.url || u.includes("/c_limit,w_360/f_auto,q_auto/"), `${s.sku} ${a.id}: ${u.slice(-90)}`);
    }
  }
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
  // the itemised steps add up to the "Cloudinary processing" line (every step after the upload)
  const steps = c.breakdown.steps.reduce((n, x) => n + x.ms, 0);
  assert.equal(Math.round(steps / 100) / 10, c.cost.seconds);
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
