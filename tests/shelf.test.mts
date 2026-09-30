// node --conditions=react-server --import tsx --test tests/shelf.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";

const slug = await import("../lib/shelf/slug.ts");
const og = await import("../lib/shelf/og.ts");
const images = await import("../lib/shelf/images.ts");
const r = await import("../lib/readiness.ts");

// ------------------------------------------------------------------ shop slugs

test("shop slug: accepts ^[a-z0-9-]{3,32}$ shapes", () => {
  for (const ok of ["demo-studio", "abc", "meeras-candles-2026", "a".repeat(32), "123"]) assert.equal(slug.checkShop(ok).ok, true, ok);
});

test("shop slug: rejects bad shapes, edge hyphens, doubles and reserved names", () => {
  for (const bad of ["ab", "a".repeat(33), "Demo", "demo_studio", "demo studio", "-demo", "demo-", "de--mo", "---", "api", "shelf", "", "émoji", "demo/x", "demo.x"]) {
    assert.equal(slug.checkShop(bad).ok, false, bad);
  }
  assert.equal(slug.checkShop(42).ok, false);
  assert.equal(slug.checkShop(undefined).ok, false);
});

test("shop slug: slugify gives a valid slug from a shop name", () => {
  assert.equal(slug.slugify("Meera's Candles & Diyas"), "meeras-candles-diyas");
  assert.equal(slug.slugify("  Café   Crème  "), "cafe-creme");
  assert.equal(slug.checkShop(slug.slugify("Demo Studio")).ok, true);
  assert.ok(slug.slugify("x".repeat(80)).length <= 32);
});

test("shop slug: derived tag, context keys and share link", () => {
  assert.equal(slug.shopTag("demo-studio"), "s2s-shop-demo-studio");
  assert.deepEqual(slug.shopContextKeys("demo-studio"), { title: "st_demo_studio", order: "so_demo_studio", tagline: "sl_demo_studio" });
  const wa = new URL(slug.whatsappShareUrl("Hello & welcome", "https://x.test/shelf/demo-studio"));
  assert.equal(wa.origin, "https://wa.me");
  assert.equal(wa.searchParams.get("text"), "Hello & welcome\nhttps://x.test/shelf/demo-studio");
});

// ------------------------------------------------------------------ OG collage URL

const heroes = [
  { publicId: "snap2shelf/products/aaaaaaaa/hero-diwali-1", geo: { px: 353, py: 392, pw: 375, ph: 486 } },
  { publicId: "snap2shelf/products/bbbbbbbb/hero-diwali-2" },
  { publicId: "snap2shelf/products/cccccccc/hero-diwali-3", geo: { px: 452, py: 177, pw: 177, ph: 701 } },
  { publicId: "snap2shelf/products/dddddddd/hero-diwali-4", geo: { px: 238, py: 554, pw: 605, ph: 324 } },
  { publicId: "snap2shelf/products/eeeeeeee/hero-diwali-5" },
];

test("og: 1200x630 JPEG on the first hero, at most 4 hero layers", () => {
  const b = og.ogCollageUrl({ title: "Demo Studio", heroes, cloud: "democloud" });
  const u = new URL(b.url);
  assert.equal(u.hostname, "res.cloudinary.com");
  assert.ok(u.pathname.startsWith("/democloud/image/upload/c_fill,w_1200,h_630,g_auto/"));
  assert.ok(u.pathname.endsWith("/f_jpg,q_auto/snap2shelf/products/aaaaaaaa/hero-diwali-1"));
  const cards = b.segments.filter((s) => s.kind === "layer" && s.text.includes("e_shadow"));
  assert.equal(cards.length, 4, "4 cards even with 5 heroes");
  assert.ok(!b.url.includes("eeeeeeee"));
  // layer ids use colons, never slashes
  for (const c of cards) assert.match(c.text, /^l_snap2shelf:products:[a-z]{8}:hero-diwali-\d\//);
  assert.equal(b.segments.at(-1)?.kind, "asset");
});

test("og: text layers use Google fonts and double-encode commas/slashes", () => {
  const b = og.ogCollageUrl({ title: "Tea, Spice / More", tagline: "50% off, today", heroes: heroes.slice(0, 2), cloud: "c" });
  assert.ok(b.url.includes("l_text:Fraunces@google_"));
  assert.ok(b.url.includes("l_text:Inter@google_"));
  assert.ok(b.url.includes("Tea%252C%20Spice%20%252F%20More"), "comma and slash double-encoded");
  assert.ok(b.url.includes("50%2525%20off%252C%20today"), "percent double-encoded");
  assert.ok(!/[\s]/.test(b.url));
});

test("og: product-focused crop stays 4:5 and inside the plate", () => {
  for (const g of heroes.filter((h) => h.geo).map((h) => h.geo!)) {
    const m = /^c_crop,w_(\d+),h_(\d+),x_(\d+),y_(\d+)$/.exec(og.productCrop(g));
    assert.ok(m, og.productCrop(g));
    const [w, h, x, y] = m!.slice(1).map(Number);
    assert.ok(Math.abs(w / h - 0.8) < 0.01, "4:5");
    assert.ok(x >= 0 && y >= 0 && x + w <= 1080 && y + h <= 1350, "inside plate");
    assert.ok(g.px >= x && g.px + g.pw <= x + w && g.py >= y && g.py + g.ph <= y + h, "product inside the crop");
  }
  const b = og.ogCollageUrl({ title: "X", heroes: heroes.slice(0, 3), cloud: "c" });
  assert.equal(b.segments.filter((s) => s.text.includes("c_crop")).length, 2, "only heroes with geo are cropped");
});

test("og: card layouts exist for 1-4 heroes and titles size down with length", () => {
  for (const n of [1, 2, 3, 4] as const) assert.equal(og.CARD_LAYOUTS[n].length, n);
  assert.ok(og.titleSize("Demo") > og.titleSize("Meera's Handmade Candles & Diyas"));
  assert.ok(og.titleHeight("Meera's Handmade Candles & Diyas") > og.titleHeight("Demo"));
  assert.equal(og.ogCollageUrl({ title: "Empty", heroes: [], cloud: "c" }).url, "");
});

test("images: srcset never upscales past the crop window", () => {
  const set = images.heroSrcSet("snap2shelf/products/aaaaaaaa/hero-1", { version: 123, cloud: "c", geo: { px: 353, py: 392, pw: 375, ph: 486 } });
  const widths = set.split(", ").map((e) => Number(e.split(" ")[1].replace("w", "")));
  assert.deepEqual(widths, [...widths].sort((a, b) => a - b));
  assert.ok(Math.max(...widths) <= images.sourceWidth({ px: 353, py: 392, pw: 375, ph: 486 }));
  assert.ok(set.includes("/v123/snap2shelf/products/aaaaaaaa/hero-1"));
  assert.ok(set.includes("f_auto,q_auto"));
});

// ------------------------------------------------------------------ readiness

/** Minimal 24-bit or 32-bit BMP writer, bottom-up, like Cloudinary's f_bmp. */
function bmp(w: number, h: number, px: (x: number, y: number) => [number, number, number, number?], bpp: 24 | 32 = 24): Uint8Array {
  const stride = Math.ceil((bpp * w) / 32) * 4;
  const header = bpp === 32 ? 138 : 54;
  const buf = new Uint8Array(header + stride * h);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x42;
  buf[1] = 0x4d;
  dv.setUint32(2, buf.length, true);
  dv.setUint32(10, header, true);
  dv.setUint32(14, bpp === 32 ? 124 : 40, true);
  dv.setInt32(18, w, true);
  dv.setInt32(22, h, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, bpp, true);
  dv.setUint32(30, bpp === 32 ? 3 : 0, true);
  if (bpp === 32) {
    dv.setUint32(54, 0x00ff0000, true);
    dv.setUint32(58, 0x0000ff00, true);
    dv.setUint32(62, 0x000000ff, true);
    dv.setUint32(66, 0xff000000, true);
  }
  for (let y = 0; y < h; y++) {
    const row = header + (h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      const [R, G, B, A = 255] = px(x, y);
      if (bpp === 24) buf.set([B, G, R], row + x * 3);
      else dv.setUint32(row + x * 4, ((A << 24) | (R << 16) | (G << 8) | B) >>> 0, true);
    }
  }
  return buf;
}

test("bmp: decodes 24-bit bottom-up rows with padding, top-left origin", () => {
  const p = r.decodeBmp(bmp(3, 2, (x, y) => (y === 0 ? [255, 0, 0] : [0, x * 100, 0])));
  assert.equal(p.width, 3);
  assert.equal(p.height, 2);
  assert.deepEqual([...p.rgb.slice(0, 3)], [255, 0, 0], "top-left is the first row written as the top");
  assert.deepEqual([...p.rgb.slice(3 * 3 + 3, 3 * 3 + 6)], [0, 100, 0]);
});

test("bmp: 32-bit bitfields with alpha composite over white", () => {
  const p = r.decodeBmp(bmp(2, 1, (x) => (x === 0 ? [0, 0, 0, 0] : [0, 0, 0, 255]), 32));
  assert.deepEqual([...p.rgb], [255, 255, 255, 0, 0, 0]);
  assert.throws(() => r.decodeBmp(new Uint8Array([1, 2, 3])));
});

test("readiness: white border and fill measured from pixels", () => {
  // 50x50 white canvas with a dark product box covering 85% of the height
  const img = r.decodeBmp(bmp(50, 50, (x, y) => (x >= 18 && x < 32 && y >= 4 && y < 46 ? [60, 60, 60] : [255, 255, 255])));
  const border = r.borderStats(img, 2);
  assert.equal(border.whiteShare, 1);
  assert.equal(border.meanHex, "ffffff");
  assert.equal(r.checkWhiteBackground(border).status, "pass");
  const box = r.contentBox(img)!;
  const fill = Math.max(box.x1 - box.x0, box.y1 - box.y0);
  assert.ok(Math.abs(fill - 0.84) < 0.001);
  assert.equal(r.checkFill(fill).status, "pass");

  const grey = r.borderStats(r.decodeBmp(bmp(20, 20, () => [180, 175, 160])), 2);
  const c = r.checkWhiteBackground(grey, "https://fix");
  assert.equal(c.status, "fail");
  assert.equal(c.fix?.kind, "transformation");
  assert.equal(c.fix?.kind === "transformation" && c.fix.apply, "repad");
});

test("readiness: fill, resolution and sharpness thresholds", () => {
  assert.equal(r.checkFill(0.85).status, "pass");
  assert.equal(r.checkFill(0.75).status, "warn");
  assert.equal(r.checkFill(1).status, "fail");
  assert.equal(r.checkFill(0.5).status, "fail");
  assert.equal(r.checkFill(null).status, "unknown");

  assert.equal(r.checkResolution(2000, 1223).status, "pass");
  assert.equal(r.checkResolution(2000, 976).status, "warn");
  assert.equal(r.checkResolution(2000, 400).status, "fail");
  assert.equal(r.checkResolution(1402, 1402).status, "warn");
  assert.equal(r.checkResolution(800, null).status, "fail");
  const up = r.checkResolution(2000, 400).fix;
  assert.ok(up?.kind === "transformation" && up.paid, "upscale is flagged as paid");

  assert.equal(r.checkSharpness(0.77).status, "pass");
  assert.equal(r.checkSharpness(0.39).status, "warn");
  assert.equal(r.checkSharpness(0.39, undefined, true).status, "pass", "sharpened counts");
  assert.equal(r.checkSharpness(0.2).fix?.kind, "retake");
  assert.equal(r.checkSharpness(null).status, "unknown");
});

test("readiness: AI Vision tags and safe zones", () => {
  assert.equal(r.checkNoText(["product-visible"]).status, "pass");
  assert.equal(r.checkNoText(["product-visible", "watermark"]).status, "fail");
  assert.equal(r.checkNoText([]).status, "warn");
  assert.equal(r.checkNoText(null).status, "unknown");
  for (const t of r.TEXT_TAGS) assert.match(t.name, /^[a-z0-9-]+$/, "AI Vision tag names: lower-case and hyphens only");

  // candle staged mid-plate: clear everywhere
  assert.equal(r.checkSafeZone({ px: 353, py: 392, pw: 375, ph: 486 }, { hasOffer: true }).status, "pass");
  // tall bottle near the top with a top offer: bottom is clear, so the fix moves the text
  const tall = r.checkSafeZone({ px: 452, py: 177, pw: 177, ph: 701 }, { hasOffer: true, textZone: "top" });
  assert.equal(tall.status, "warn");
  assert.deepEqual(tall.fix, { kind: "repack", label: "Move the offer text to the bottom", textZone: "bottom" });
  // no offer → the same bottle is fine
  assert.equal(r.checkSafeZone({ px: 452, py: 177, pw: 177, ph: 701 }).status, "pass");
  // base under the story reply bar → move up
  const low = r.checkSafeZone({ px: 300, py: 900, pw: 400, ph: 400 });
  assert.equal(low.fix?.kind, "restage");
  assert.equal(r.checkSafeZone(null).status, "unknown");
  assert.deepEqual(r.parseBox("452,177,177,701,878"), { px: 452, py: 177, pw: 177, ph: 701, baseY: 878 });
  assert.equal(r.parseBox("1,2,3"), null);
  assert.equal(r.parseBox("a,b,c,d"), null);
});

test("readiness: score weights sum to 100, warn = half, unknown is rescaled out", () => {
  assert.equal(Object.values(r.WEIGHTS).reduce((a, b) => a + b, 0), 100);
  const all = [
    r.checkWhiteBackground({ samples: 10, whiteShare: 1, minChannel: 255, meanHex: "ffffff" }),
    r.checkFill(0.85),
    r.checkResolution(2000, 1500),
    r.checkSharpness(0.9),
    r.checkNoText(["product-visible"]),
    r.checkSafeZone({ px: 353, py: 392, pw: 375, ph: 486 }),
  ];
  assert.equal(r.score(all), 100);
  assert.equal(r.grade(100), "ready");
  const withWarn = all.map((c) => (c.id === "sharpness" ? r.checkSharpness(0.4) : c));
  assert.equal(r.score(withWarn), 93); // 100 - 15 + 8 (half of 15, rounded)
  const withUnknown = all.map((c) => (c.id === "no-text" ? r.checkNoText(null) : c));
  assert.equal(r.score(withUnknown), 100, "unknown checks don't count against the product");
  const baseline = [r.checkWhiteBackground({ samples: 10, whiteShare: 0, minChannel: 90, meanHex: "afaa9e" }), r.checkFill(0.87), r.checkResolution(1402, 1223), r.checkSharpness(0.39)];
  assert.equal(r.score(baseline), 44); // (0 + 15 + 10 + 8) / 75
  assert.equal(r.grade(44), "not-ready");
  assert.equal(r.grade(70), "almost");
  assert.deepEqual(r.sortChecks([...all].reverse()).map((c) => c.id), r.CHECK_ORDER);
});

test("readiness: fix recipes are allow-listed and never c_pad (which re-upscales)", () => {
  assert.ok(r.REPAD_85.includes("c_mpad,w_2000,h_2000,b_white"));
  assert.ok(!/c_pad[,/]/.test(r.REPAD_85));
  assert.deepEqual(Object.keys(r.APPLICABLE_FIXES).sort(), ["repad", "sharpen"]);
  for (const t of Object.values(r.APPLICABLE_FIXES)) assert.ok(!/e_gen_|e_upscale|b_gen_fill|l_fetch/.test(t), t);
});
