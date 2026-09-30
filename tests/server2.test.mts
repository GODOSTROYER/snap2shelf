// Pipeline v2 unit tests (pure logic only, no network):
//   node --conditions=react-server --import tsx --test tests/server2.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";

// Placeholder values only, never real keys.
process.env.CLOUDINARY_CLOUD_NAME = "maincloud";
process.env.CLOUDINARY_API_KEY = "k0";
process.env.CLOUDINARY_API_SECRET = "s0-placeholder";

const festivals = await import("../lib/festivals.ts");
const types = await import("../lib/types.ts");
const brief = await import("../lib/server/brief.ts");
const plan = await import("../lib/server/retouch-plan.ts");
const scenes = await import("../lib/server/scenes.ts");
const sceneJobs = await import("../lib/server/scene-jobs.ts");
const sceneToken = await import("../lib/server/scene-job-token.ts");
const jobToken = await import("../lib/server/job-token.ts");
const cost = await import("../lib/server/cost.ts");
const crypto = await import("../lib/server/crypto.ts");

const standing = { placement: "standing" as const, suggestedThemes: ["kitchen", "cafe", "marble"] };
const flat = { placement: "flatlay" as const, suggestedThemes: ["flatlay-linen"] };

// ------------------------------------------------------------------ festivals

test("festivals: every preset maps to real themes for both views, hex palettes, short offers", () => {
  for (const f of festivals.FESTIVALS) {
    const eye = types.SCENE_THEMES.find((t) => t.slug === f.theme);
    const top = types.SCENE_THEMES.find((t) => t.slug === f.flatlayTheme);
    assert.equal(eye?.view, "eye-level", `${f.slug} theme`);
    assert.equal(top?.view, "top-down", `${f.slug} flatlay theme`);
    assert.ok(f.palette.length >= 1 && f.palette.length <= 4 && f.palette.every((h) => /^[0-9a-f]{6}$/.test(h)), `${f.slug} palette`);
    assert.match(f.hindi, /[ऀ-ॿ]/, `${f.slug} hindi is Devanagari`);
    for (const d of [null, { kind: "percent", value: 20 }, { kind: "flat", value: 1500 }, { kind: "bogo" }, { kind: "free-delivery" }] as const) {
      const o = festivals.offerLines(f, d, ["hindi", "english"]);
      assert.ok(o.hindi && o.hindi.length <= festivals.OFFER_MAX, `${f.slug} hindi ≤ 40: ${o.hindi}`);
      assert.ok(o.english && o.english.length <= festivals.OFFER_MAX, `${f.slug} english ≤ 40: ${o.english}`);
    }
  }
  assert.deepEqual([...festivals.FESTIVAL_SLUGS].sort(), festivals.FESTIVALS.map((f) => f.slug).sort());
});

test("festivals: detection by keyword, word boundaries, Devanagari, longest match", () => {
  const d = (t: string) => festivals.detectFestival(t)?.slug ?? null;
  assert.equal(d("Diwali sale ad"), "diwali");
  assert.equal(d("दिवाली ऑफ़र"), "diwali");
  assert.equal(d("xmas gifting"), "christmas");
  assert.equal(d("Eid special"), "eid");
  assert.equal(d("a weird bottle"), null, "eid inside another word");
  assert.equal(d("Durga Puja collection"), "durga-puja");
  assert.equal(d("Makar Sankranti kites"), "pongal");
  assert.equal(d("new year party"), "new-year");
  assert.equal(d("BLACK FRIDAY doorbuster"), "black-friday");
  assert.equal(d("summer launch"), null);
  assert.equal(d("christmas then diwali"), "christmas", "first mentioned wins");
  assert.equal(festivals.festivalTheme(festivals.festivalBySlug("diwali")!, "flatlay"), "flatlay-festive");
});

test("festivals: offer templates", () => {
  const diwali = festivals.festivalBySlug("diwali");
  assert.deepEqual(festivals.offerLines(diwali, { kind: "percent", value: 20 }, ["hindi", "english"]), { hindi: "दिवाली सेल · 20% छूट", english: "Diwali Sale · 20% off" });
  assert.deepEqual(festivals.offerLines(null, { kind: "flat", value: 200 }, ["hindi"]), { hindi: "सेल · ₹200 की छूट" });
  assert.deepEqual(festivals.offerLines(null, null, ["english"]), {});
});

// ------------------------------------------------------------------ brief bar

test("brief: the headline example maps to the Diwali kit without any AI", () => {
  const rules = brief.parseBriefRules("Diwali sale ad, 20% off, Hindi, for WhatsApp + Instagram");
  assert.equal(rules.festival?.slug, "diwali");
  assert.deepEqual(rules.discount, { kind: "percent", value: 20 });
  assert.deepEqual(rules.languages, ["hindi", "english"]);
  assert.deepEqual(rules.channels, ["whatsapp", "feed", "story"]);
  const m = brief.mergeKit(rules, null, standing);
  assert.deepEqual(m.kit, {
    theme: "diwali",
    offer: { hindi: "दिवाली सेल · 20% छूट", english: "Diwali Sale · 20% off" },
    channels: ["whatsapp", "feed", "story"],
    swatches: ["f59e0b", "b91c1c", "7c2d12", "fde68a"],
    tone: "festive",
  });
  assert.deepEqual(m.sources, { theme: "festival", offer: "festival", channels: "brief", swatches: "festival", tone: "festival" });
  assert.ok(m.scenePrompt?.includes("diyas"));
  // a flat-lay product gets the top-down festive theme
  assert.equal(brief.mergeKit(rules, null, flat).kit.theme, "flatlay-festive");
});

test("brief: AI answer fields are validated one by one; bad fields fall back", () => {
  const answer = '```json\n{"theme":"space-station","offer":{"english":"Fresh drop!","hindi":"Fresh drop"},"channels":["Instagram","story","tiktok"],"swatches":["#FF0000","blue","00ff00","00ff00"],"tone":"sarcastic","scene_prompt":"a sunny kitchen shelf with lemons"}\n```';
  const ai = brief.parseAiKit(answer);
  assert.ok(ai);
  const rules = brief.parseBriefRules("new launch, hindi please");
  const m = brief.mergeKit(rules, ai, standing);
  assert.equal(m.kit.theme, "kitchen", "invalid AI theme → product suggestion");
  assert.equal(m.sources.theme, "product");
  assert.deepEqual(m.kit.offer, { english: "Fresh drop!" }, "Latin text is not accepted as the Hindi line");
  assert.deepEqual(m.kit.channels, ["story"]);
  assert.deepEqual(m.kit.swatches, ["ff0000", "00ff00"]);
  assert.equal(m.kit.tone, "warm", "unknown tone → default");
  assert.equal(m.scenePrompt, "a sunny kitchen shelf with lemons");
});

test("brief: unusable AI output → full deterministic fallback", () => {
  assert.equal(brief.parseAiKit("Sorry, I can't help with that."), null);
  const m = brief.mergeKit(brief.parseBriefRules("something nice"), null, standing);
  assert.deepEqual(m.kit, { theme: "kitchen", offer: {}, channels: ["feed", "story", "whatsapp"], swatches: [], tone: "warm" });
  assert.equal(m.sources.channels, "default");
  const empty = brief.mergeKit(brief.parseBriefRules("x"), null, { placement: "standing", suggestedThemes: [] });
  assert.equal(empty.kit.theme, "marble");
  assert.equal(brief.mergeKit(brief.parseBriefRules("x"), null, { placement: "flatlay", suggestedThemes: [] }).kit.theme, "flatlay-linen");
});

test("brief: rules for colours, languages, discounts, tone and theme words", () => {
  const bf = brief.parseBriefRules("Black Friday deal in red and black colours for Amazon");
  assert.equal(bf.festival?.slug, "black-friday");
  assert.deepEqual(bf.swatches, ["dc2626", "111111"], "'black' of Black Friday isn't a swatch; the colour list is");
  assert.deepEqual(bf.channels, ["marketplace"]);
  const k = brief.mergeKit(bf, null, standing).kit;
  assert.deepEqual(k.offer, { english: "Black Friday Sale" });
  assert.equal(k.tone, "bold");

  assert.deepEqual(brief.parseBriefRules("flat ₹200 off, hindi only").discount, { kind: "flat", value: 200 });
  assert.deepEqual(brief.parseBriefRules("flat ₹200 off, hindi only").languages, ["hindi"]);
  assert.equal(brief.parseBriefRules("100% cotton kurta").discount, null, "100% cotton is not a discount");
  assert.equal(brief.parseBriefRules("price ₹999 only").discount, null, "a price is not a discount");
  assert.deepEqual(brief.parseBriefRules("buy one get one free").discount, { kind: "bogo" });
  assert.equal(brief.parseBriefRules("a luxury marble look").tone, "premium");
  assert.equal(brief.parseBriefRules("a luxury marble look").themeHint, "marble");
  assert.equal(brief.parseBriefRules("rustic handmade vibe").themeHint, "jute");
  assert.deepEqual(brief.parseBriefRules("post on insta and our website").channels, ["feed", "story", "banner"]);
  assert.deepEqual(brief.parseBriefRules("dark red bottle").swatches, [], "colour words need a colour/variant context");
  assert.deepEqual(brief.parseBriefRules("दिवाली ऑफ़र 10%").languages, ["hindi", "english"], "Devanagari brief → Hindi line");
});

test("brief: festival chip overrides the text; prompt delimiters are stripped", () => {
  const r = brief.parseBriefRules("Diwali lights", "christmas");
  assert.equal(r.festival?.slug, "christmas");
  assert.equal(r.festivalFrom, "param");
  assert.equal(brief.cleanBrief("a <<<ignore previous>>> ```x``` \n\u0000 brief"), "a ignore previous x brief");
  const p = brief.briefPrompt("sale <<<now>>>", r, "Steel bottle");
  assert.ok(p.includes("<<<sale now>>>"));
  assert.ok(p.includes("Occasion: Christmas."));
  assert.equal(brief.briefHash(" Diwali  Sale ", "diwali"), brief.briefHash("diwali sale", "diwali"));
  assert.notEqual(brief.briefHash("diwali sale", "diwali"), brief.briefHash("diwali sale"));
});

test("brief: offer/scene validators", () => {
  assert.equal(brief.validOfferLine("x".repeat(41), "english"), null);
  assert.equal(brief.validOfferLine("<b>sale</b>", "english"), null);
  assert.equal(brief.validOfferLine("दिवाली सेल", "english"), null);
  assert.equal(brief.validOfferLine("  दिवाली   सेल ", "hindi"), "दिवाली सेल");
  assert.equal(brief.validScenePrompt("short"), null);
  assert.equal(brief.fitThemeToPlacement("jute", "flatlay"), "flatlay-festive");
  assert.equal(brief.fitThemeToPlacement("flatlay-linen", "standing"), "marble");
});

// ------------------------------------------------------------------ retouch decisions

const good = { width: 1122, height: 1402, bytes: 1_783_788, format: "png", focus: 0.39, luma: 148.3, tags: ["clutter-in-frame"] };

test("retouch: a good photo gets no fix (clutter is left to the cutout)", () => {
  const p = plan.planRetouch(good);
  assert.deepEqual(p.fixes, []);
  assert.equal(p.steps.length, 0);
  assert.equal(p.tx, 0);
  assert.equal(plan.retouchChain(p), "");
  assert.match(p.notes[0], /no fix needed/);
  assert.ok(p.notes.some((n) => /cutout removes it/.test(n)));
});

test("retouch: a dim photo (measured luma, no AI tag) → e_improve only, 1 tx", () => {
  const p = plan.planRetouch({ ...good, luma: 105 });
  assert.deepEqual(p.fixes, ["brightness"]);
  assert.ok(p.detected.includes("dim"));
  assert.equal(plan.retouchChain(p), `e_improve/${plan.RETOUCH_OUTPUT}`);
  assert.equal(p.tx, 1);
});

test("retouch: small + JPEG-damaged + dim → restore, brighten, upscale in that order", () => {
  const p = plan.planRetouch({ width: 640, height: 800, bytes: 15_000, format: "jpg", focus: null, luma: 100, tags: [] });
  assert.deepEqual(p.fixes, ["restore", "brightness", "resolution"]);
  assert.deepEqual(p.detected.sort(), ["dim", "heavy-compression", "small"]);
  assert.equal(plan.retouchChain(p), `e_gen_restore/e_improve/e_upscale/${plan.RETOUCH_OUTPUT}`);
  assert.equal(p.tx, 1 + 100 + 0 + 100, "640x800 = 0.51 MP → upscale counts 100");
  const tiny = plan.planRetouch({ width: 400, height: 500, bytes: 60_000, format: "jpg", focus: null, luma: 140, tags: [] });
  assert.deepEqual(tiny.fixes, ["resolution"]);
  assert.equal(tiny.tx, 1 + 10, "< 0.25 MP → upscale counts 10");
});

test("retouch: hand / price tag → generative remove first; bright → e_enhance; cast → e_improve", () => {
  const p = plan.planRetouch({ ...good, tags: ["hand-in-frame", "price-tag-visible", "blurry"] });
  assert.deepEqual(p.fixes, ["cleanup", "restore"]);
  assert.equal(plan.retouchChain(p), `e_gen_remove:prompt_(hand;price%20tag)/e_gen_restore/${plan.RETOUCH_OUTPUT}`);
  assert.equal(p.tx, 1 + 50 + 100);
  const bright = plan.planRetouch({ ...good, luma: 230 });
  assert.equal(bright.steps[0].component, "e_enhance");
  assert.deepEqual(bright.fixes, ["brightness"]);
  const cast = plan.planRetouch({ ...good, tags: ["color-cast"] });
  assert.deepEqual(cast.fixes, ["color"]);
  assert.equal(cast.steps[0].component, "e_improve");
  // unknown tags from the model are ignored; big photos are never upscaled
  assert.deepEqual(plan.planRetouch({ ...good, tags: ["made-up"], width: 3000, height: 4000 }).fixes, []);
});

test("retouch: X-ray labels every component", () => {
  const p = plan.planRetouch({ ...good, luma: 90, tags: ["price-tag-visible"] });
  const x = plan.retouchXray("https://res.cloudinary.com/maincloud/image/upload/x/raw", p, "snap2shelf/products/abcdefgh/raw");
  assert.deepEqual(x.segments.map((s) => s.kind), ["gen-ai", "effect", "format", "asset"]);
  assert.match(x.segments[1].label, /no extra tx/);
});

test("retouch: BMP mean luma (24 bpp with row padding)", () => {
  // 2x2 pixels, 24 bpp → rows of 6 bytes padded to 8; bottom-up doesn't matter for a mean.
  const w = 2, h = 2, row = 8, off = 54;
  const buf = new Uint8Array(off + row * h);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x42; buf[1] = 0x4d;
  dv.setUint32(10, off, true); dv.setInt32(18, w, true); dv.setInt32(22, h, true); dv.setUint16(28, 24, true); dv.setUint32(30, 0, true);
  const px: [number, number, number][] = [[255, 255, 255], [0, 0, 0], [255, 0, 0], [0, 0, 255]]; // RGB
  px.forEach(([r, g, b], i) => {
    const at = off + Math.floor(i / 2) * row + (i % 2) * 3;
    buf[at] = b; buf[at + 1] = g; buf[at + 2] = r;
  });
  const expected = (255 + 0 + 0.2126 * 255 + 0.0722 * 255) / 4;
  assert.ok(Math.abs(plan.bmpMeanLuma(buf)! - expected) < 1e-6);
  assert.equal(plan.bmpMeanLuma(new Uint8Array(10)), null);
  assert.equal(plan.bmpMeanLuma(buf.slice(0, 60)), null, "truncated pixel data");
});

test("retouch: context codec → AnalyzeResponse.fixes", () => {
  const ctx = { fix_plan: "restore,brightness", fix_tags: "blurry,made-up", fix_luma: "101.5", fix_chain: "e_gen_restore/e_improve", fix_tx: "101", fix_id: "snap2shelf/products/abcdefgh/retouched" };
  const s = plan.retouchStateFromContext(ctx);
  assert.deepEqual(s.fixes, ["restore", "brightness"]);
  assert.deepEqual(s.tags, ["blurry"]);
  assert.equal(s.luma, 101.5);
  assert.deepEqual(plan.fixesFromContext(ctx, "snap2shelf/products/abcdefgh/retouched"), { applied: ["restore", "brightness"], retouchedPublicId: "snap2shelf/products/abcdefgh/retouched" });
  assert.deepEqual(plan.fixesFromContext(ctx, "snap2shelf/products/zzzzzzzz/retouched"), { applied: [] }, "fix_id must be this product's");
  assert.deepEqual(plan.fixesFromContext({ ...ctx, fix_err: "1" }), { applied: [] });
  assert.deepEqual(plan.fixesFromContext({}), { applied: [] });
  assert.equal(plan.retouchStateFromContext({ fix_plan: "none" }).planned, true);
});

// ------------------------------------------------------------------ scenes: prompt hash + reuse

test("scenes: theme-only specs hash to the ids already in the library (seeded 30 Sep)", () => {
  const id = (theme: string, tier: "draft" | "final") => scenes.scenePublicId(scenes.sceneSpec({ theme, tier })!);
  assert.equal(id("diwali", "draft"), "snap2shelf/scenes/diwali/draft-c0707bbf");
  assert.equal(id("diwali", "final"), "snap2shelf/scenes/diwali/final-59f4388a");
  assert.equal(id("marble", "final"), "snap2shelf/scenes/marble/final-ca4c3ac1");
  assert.equal(id("flatlay-linen", "draft"), "snap2shelf/scenes/flatlay-linen/draft-d66e1285");
  assert.equal(scenes.sceneSpec({ theme: "moon", tier: "draft" }), null);
});

test("scenes: custom prompts normalise before hashing; tier and view change the id", () => {
  const a = scenes.sceneSpec({ prompt: "  Rustic pine table,   red baubles.  ", theme: "cafe", tier: "draft" })!;
  const b = scenes.sceneSpec({ prompt: "rustic pine table, red baubles", theme: "cafe", tier: "draft" })!;
  assert.equal(scenes.scenePublicId(a), scenes.scenePublicId(b));
  assert.match(scenes.scenePublicId(a), /^snap2shelf\/scenes\/cafe\/draft-[a-f0-9]{8}$/);
  assert.notEqual(scenes.scenePublicId(a), scenes.scenePublicId({ ...a, tier: "final" }));
  const top = scenes.sceneSpec({ prompt: "rustic pine table, red baubles", theme: "cafe", view: "top-down", tier: "draft" })!;
  assert.notEqual(scenes.scenePublicId(top), scenes.scenePublicId(a));
  assert.match(top.prompt, /top-down flat-lay/);
  assert.match(a.prompt, /No products, no bottles, no packaging, no people/);
  const custom = scenes.sceneSpec({ prompt: "a quiet teal studio wall", theme: "not-a-theme", tier: "final" })!;
  assert.equal(custom.theme, "custom");
  assert.equal(custom.title, "A quiet teal studio wall");
  assert.equal(scenes.titleFrom("a rustic pine-wood tabletop, pine branches, red and gold baubles"), "A rustic pine-wood tabletop");
  assert.equal(scenes.titleFrom("an extraordinarily long single clause describing many wonderful things"), "An extraordinarily long single clause");
  assert.equal(scenes.sceneSpec({ prompt: "tiny", tier: "draft" }), null);
  assert.equal(scenes.cleanSceneText("<script>a</script> {x}"), "script a /script x");
});

test("scenes: generate request pins the model and a per-hash temporary target", () => {
  const s = scenes.sceneSpec({ theme: "pastel", tier: "draft" })!;
  const r = scenes.sceneGenerateRequest(s);
  assert.deepEqual(r.model, { id: "flux-2-flash" });
  assert.deepEqual(r.image_size, { aspect_ratio: "3:4", resolution: "1K" });
  assert.equal(r.seed, 42);
  assert.ok(r.target && "public_id" in r.target && r.target.public_id?.endsWith(scenes.sceneHash(s.prompt, "draft", 42)));
  assert.deepEqual(scenes.sceneGenerateRequest({ ...s, tier: "final" }).model, { id: "gpt-image-2.5-flare" });
  assert.deepEqual(scenes.decideSceneQa([]).status, "approved");
  assert.deepEqual(scenes.decideSceneQa(["contains-text"]).reasons, ["The backdrop contains text or a logo."]);
});

test("scenes: sealed job token round-trips, rebuilds the same plate id, and rejects tampering", () => {
  const spec = scenes.sceneSpec({ prompt: "rustic pine table, red baubles", theme: "cafe", tier: "draft" })!;
  const claims = { a: "main", t: "abc123", th: spec.theme, vw: spec.view, ti: spec.tier, x: spec.text, seed: spec.seed, id: scenes.scenePublicId(spec), sku: "abcdefgh", sid: "sid12345", iat: Date.now() };
  const token = sceneToken.encodeSceneJob(claims);
  const back = sceneToken.decodeSceneJob(token)!;
  assert.equal(back.id, claims.id);
  assert.ok(!token.includes("main") && !token.includes("abc123"), "opaque");
  assert.equal(sceneJobs.specFromClaims(back)?.prompt, spec.prompt);
  assert.equal(sceneJobs.specFromClaims({ ...back, x: "something else entirely" }), null, "text no longer matches the id");
  const [iv, ct, tag] = token.split(".");
  assert.equal(sceneToken.decodeSceneJob(`${iv}.${ct.slice(0, -2)}AA.${tag}`), null);
  assert.equal(sceneToken.decodeSceneJob(token, crypto.deriveKey("s2s-job")), null, "a creative-job key can't open it");
  assert.equal(jobToken.decodeJob(token), null, "and a scene token is not a creative job");
  assert.equal(sceneToken.decodeSceneJob(sceneToken.encodeSceneJob({ ...claims, iat: Date.now() - 3 * 3600_000 })), null, "expired");
});

const scene = (publicId: string, theme: string, view: "eye-level" | "top-down", title: string, prompt: string, temperature: "warm" | "neutral" | "cool" = "neutral", credits = 4) => ({
  publicId,
  theme,
  view,
  title,
  prompt,
  modelId: "m",
  credits,
  dna: { anchor_x: 0.5, anchor_y: 0.65, surface_width: 0.8, light_azimuth: 315, light_elevation: 45, temperature, glossy: false, text_zone: "top" as const },
});
const COMMON = "Photorealistic empty product-photography backdrop. The surface is clear. Soft light. No products, no text.";
const LIB = [
  scene("snap2shelf/scenes/diwali/final-11111111", "diwali", "eye-level", "Diwali glow", `${COMMON} Teak table, brass diyas, marigold garlands.`, "warm"),
  scene("snap2shelf/scenes/diwali/draft-22222222", "diwali", "eye-level", "Diwali glow", `${COMMON} Teak table, brass diyas, marigold garlands.`, "warm", 9),
  scene("snap2shelf/scenes/marble/final-33333333", "marble", "eye-level", "Marble studio", `${COMMON} White Carrara marble, grey veins, window shadow.`, "cool"),
  scene("snap2shelf/scenes/kitchen/final-44444444", "kitchen", "eye-level", "Kitchen counter", `${COMMON} Light oak countertop, white tiles, fresh herbs.`),
  scene("snap2shelf/scenes/flatlay-linen/final-55555555", "flatlay-linen", "top-down", "Linen flat-lay", `${COMMON} Ivory linen, dried flowers, eucalyptus.`),
];

test("scenes: match ranks theme, distinctive keywords (IDF), festival, warmth; filters view", () => {
  const byTheme = scenes.rankScenes(LIB, { theme: "marble" });
  assert.equal(byTheme[0].scene.theme, "marble");
  const byWords = scenes.rankScenes(LIB, { text: "oak counter with herbs" });
  assert.equal(byWords[0].scene.theme, "kitchen");
  assert.match(byWords[0].reasons.join(" "), /oak/);
  const common = scenes.rankScenes(LIB, { text: "backdrop surface light" });
  assert.ok(common.every((m) => m.score <= 0.5), "words every scene shares carry no weight");
  const fest = scenes.rankScenes(LIB, { text: "Diwali sale, warm and festive" });
  assert.equal(fest[0].scene.publicId, "snap2shelf/scenes/diwali/final-11111111", "final tier wins a tie");
  assert.ok(fest[0].reasons.includes("Diwali theme") && fest[0].reasons.includes("warm light"));
  const top = scenes.rankScenes(LIB, { theme: "marble", view: "top-down" });
  assert.deepEqual(top.map((m) => m.scene.view), ["top-down"]);
  assert.equal(scenes.rankScenes(LIB, {}, 2).length, 2);
});

// ------------------------------------------------------------------ cost ledger math

const SKU = "abcdefgh";
const P = (leaf: string) => `snap2shelf/products/${SKU}/${leaf}`;
const asset = (leaf: string, context: Record<string, string> = {}, createdAt = "2026-09-30T10:00:00Z", bytes = 1000) => ({ publicId: P(leaf), bytes, format: "jpg", createdAt, context });

test("cost: credits, reuse savings, tokens, transformation estimate and seconds from context", () => {
  const assets = [
    asset("raw", { analyzed: "1", t_an: "700", ms_an: "5200", fix_plan: "brightness", fix_tx: "1", t_fix: "730", ms_fix: "8100", t_brief: "900", ms_brief: "3100", sc_saved: "4", hero: P("hero-diwali-aaaa") }, "2026-09-30T10:00:00Z", 2_138_355),
    asset("retouched", { fixes: "brightness" }, "2026-09-30T10:00:20Z"),
    asset("cutout", { ms: "4300" }, "2026-09-30T10:00:30Z"),
    asset("creative-flux-2-flash-edit-7", { credits: "1", qa_tokens: "1000", latency_ms: "22741", model: "flux-2-flash-edit" }, "2026-09-30T10:01:00Z"),
    asset("hero-diwali-aaaa", { scene: "diwali" }, "2026-09-30T10:02:00Z"),
    asset("pack/feed", {}, "2026-09-30T10:02:10Z"),
    asset("pack/story", {}, "2026-09-30T10:02:12Z"),
    asset("pack/banner", {}, "2026-09-30T10:02:12Z"),
    asset("pack/recolor-2563eb", {}, "2026-09-30T10:02:15Z"),
  ];
  const c = cost.computeCost({ sku: SKU, assets, deliveredBytes: 61_234 });
  assert.equal(c.cost.generationCredits, 1);
  assert.equal(c.cost.creditsSavedByReuse, 4);
  assert.equal(c.cost.aiVisionTokens, 700 + 730 + 900 + 1000);
  // analysis jpg 1 + luma 1 + retouch 1 + cutout 76 + fidelity sheet 1 + hero 1 + feed 1 + story 51 + banner 51 + recolor 51 + delivered 1
  assert.equal(c.cost.transformationsEstimate, 1 + 1 + 1 + 76 + 1 + 1 + 1 + 51 + 51 + 51 + 1);
  assert.equal(c.cost.bytesOriginal, 2_138_355);
  assert.equal(c.cost.bytesDelivered, 61_234);
  assert.equal(c.cost.seconds, Math.round((5200 + 8100 + 4300 + 3100 + 22741) / 100) / 10);
  assert.equal(c.wallClockSeconds, 135);
  assert.equal(c.estimated, true);

  // staged on a library scene: its credits are saved…
  const lib = LIB[0];
  assert.equal(cost.computeCost({ sku: SKU, assets, scene: lib, deliveredBytes: 1 }).cost.creditsSavedByReuse, 4);
  // …unless that scene was generated for this very product (then it counts as spent)
  const own = assets.map((a) => (a.publicId === P("raw") ? { ...a, context: { ...a.context, sc_id: lib.publicId, sc_spent: "1", t_scene: "1300" } } : a));
  const c2 = cost.computeCost({ sku: SKU, assets: own, scene: lib, deliveredBytes: 1 });
  assert.equal(c2.cost.creditsSavedByReuse, 0);
  assert.equal(c2.cost.generationCredits, 2);
  assert.equal(c2.cost.aiVisionTokens, 700 + 730 + 900 + 1000 + 1300);

  assert.throws(() => cost.computeCost({ sku: SKU, assets: assets.slice(1), deliveredBytes: 0 }), /No upload/);
  assert.equal(cost.computeCost({ sku: SKU, assets: [assets[0]], deliveredBytes: 0 }).wallClockSeconds, null);
});

test("cost: pack format counts and scene id validation", () => {
  assert.equal(cost.packFormatTx("story"), 51);
  assert.equal(cost.packFormatTx("recolor-ff0000"), 51);
  assert.equal(cost.packFormatTx("whatsapp"), 1);
  assert.ok(cost.isScenePublicId("snap2shelf/scenes/diwali/final-59f4388a"));
  assert.ok(!cost.isScenePublicId("snap2shelf/products/abcdefgh/raw"));
  assert.ok(!cost.isScenePublicId("snap2shelf/scenes/../x"));
});
