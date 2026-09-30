// node --conditions=react-server --import tsx --test tests/transform.test.mts
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "democloud";

const { compositeUrl, defaultControls, geometry, quantise, layerId, harmoniseTone } = await import("../lib/transform/composite.ts");
const { channelAssets, encodeOverlayText, offerLayout, CHANNEL_CHAINS } = await import("../lib/transform/channels.ts");
const { reelUrl, REEL_MOVES } = await import("../lib/transform/reel.ts");
const { NAMED_TRANSFORMATIONS, namedUrlPart } = await import("../lib/transform/named.ts");
const { describeTransformation, XRAY_KINDS, xrayLegend } = await import("../lib/transform/xray.ts");
type SceneDNA = import("../lib/types.ts").SceneDNA;
type CompositeControls = import("../lib/types.ts").CompositeControls;

const DNA: SceneDNA = { anchor_x: 0.5, anchor_y: 0.65, surface_width: 1, light_azimuth: 315, light_elevation: 45, temperature: "warm", glossy: false, text_zone: "top" };
const GLOSSY: SceneDNA = { ...DNA, glossy: true, temperature: "neutral", light_azimuth: 270 };
const FLAT: SceneDNA = { ...DNA, anchor_y: 0.5, light_azimuth: 0, light_elevation: 60 };
const BOTTLE = { publicId: "snap2shelf/products/abcd1234/cutout", width: 309, height: 1223 };
const SHOE = { publicId: "snap2shelf/products/abcd1234/cutout", width: 976, height: 523 };
const KURTA = { publicId: "snap2shelf/products/kurta001/cutout", width: 822, height: 1085 };
const SCENE = "snap2shelf/scenes/diwali/final-59f4388a";

const build = (controls: CompositeControls, dna = DNA, cutout = BOTTLE, placement: "standing" | "flatlay" = "standing") =>
  compositeUrl({ scenePublicId: SCENE, dna, cutout, placement, controls });

/** x_/y_/w_/h_ values of one URL component (not inside e_… effect arguments). */
function geomNumbers(component: string) {
  return component
    .split(",")
    .filter((t) => /^[xywh]_-?[\d.]+$/.test(t))
    .map((t) => t.slice(2));
}

test("composite URL is deterministic for identical input", () => {
  const c = defaultControls("standing", DNA, BOTTLE);
  assert.equal(build(c).url, build({ ...c }).url);
});

test("nearby slider positions quantise to the same URL (one billed derived image)", () => {
  const c = defaultControls("standing", DNA, BOTTLE);
  const a = build({ ...c, scale: 0.461, offsetX: 12, offsetY: -4 }).url;
  const b = build({ ...c, scale: 0.459, offsetX: 8, offsetY: 3 }).url;
  assert.equal(a, b);
  assert.notEqual(a, build({ ...c, scale: 0.5 }).url);
});

test("quantise snaps and clamps every slider", () => {
  const q = quantise({ scale: 0.97, offsetX: -999, offsetY: 44, shadow: true, contact: true, reflection: "auto", harmonise: true });
  assert.equal(q.scale, 0.8);
  assert.equal(q.offsetX, -300);
  assert.equal(q.offsetY, 40);
  assert.equal(quantise({ ...q, scale: 0.05 }).scale, 0.2);
  assert.equal(quantise({ ...q, scale: 0.333 }).scale, 0.34);
});

test("placement numbers are integers and never mix ints and floats in a component", () => {
  for (const [dna, cutout, placement] of [
    [DNA, BOTTLE, "standing"],
    [GLOSSY, SHOE, "standing"],
    [{ ...DNA, light_azimuth: 90, light_elevation: 20 }, SHOE, "standing"],
    [FLAT, KURTA, "flatlay"],
  ] as const) {
    const c = { ...defaultControls(placement, dna, cutout), reflection: "on" as const };
    const b = compositeUrl({ scenePublicId: SCENE, dna, cutout, placement, controls: c, width: 720 });
    for (const comp of b.transformation.split("/")) {
      const nums = geomNumbers(comp);
      if (!nums.length) continue;
      const ints = nums.filter((n) => /^-?\d+$/.test(n)).length;
      assert.ok(ints === 0 || ints === nums.length, `mixed int/float in ${comp}`);
      if (comp.includes("fl_layer_apply") || comp.startsWith("c_")) assert.equal(ints, nums.length, `non-integer placement in ${comp}`);
    }
    const distort = /e_distort:([-\d:]+)/.exec(b.transformation);
    if (distort) assert.ok(distort[1].split(":").every((n) => /^-?\d+$/.test(n)));
  }
});

test("every spill-prone layer keeps the canvas at the plate size", () => {
  const b = build({ ...defaultControls("standing", GLOSSY, SHOE), reflection: "on" }, GLOSSY, SHOE);
  const layers = b.segments.filter((s) => s.kind === "shadow" || s.kind === "reflection");
  assert.ok(layers.length >= 3);
  for (const s of layers) assert.match(s.text, /fl_no_overflow/);
  // blurred layers are padded with transparency before the blur
  for (const s of layers) if (s.text.includes("e_blur")) assert.match(s.text, /c_mpad,[^/]*b_transparent\/(e_blur|.*e_blur)/);
});

test("default size follows the product's shape and fits above the surface", () => {
  assert.ok(defaultControls("standing", DNA, BOTTLE).scale > defaultControls("standing", DNA, { width: 700, height: 1000 }).scale);
  assert.ok(defaultControls("standing", DNA, SHOE).scale > defaultControls("standing", DNA, { width: 700, height: 1000 }).scale);
  // backwards compatible 2-arg call
  assert.equal(typeof defaultControls("standing", DNA).scale, "number");
  // scale slider stays live for tall products (fit-box semantics)
  const g1 = geometry(BOTTLE, DNA, quantise({ ...defaultControls("standing", DNA, BOTTLE), scale: 0.4 }), "standing");
  const g2 = geometry(BOTTLE, DNA, quantise({ ...defaultControls("standing", DNA, BOTTLE), scale: 0.5 }), "standing");
  assert.ok(g2.ph > g1.ph);
  // a huge product on a high anchor shrinks instead of leaving the plate
  const g = geometry(BOTTLE, { ...DNA, anchor_y: 0.4 }, quantise({ ...defaultControls("standing", DNA, BOTTLE), scale: 0.8 }), "standing");
  assert.ok(g.py >= 0 && g.baseY <= 1350 && g.px >= 0 && g.px + g.pw <= 1080);
});

test("flat-lay: lift shadows, no contact shadow or reflection", () => {
  const b = build({ ...defaultControls("flatlay", FLAT, KURTA), reflection: "on" }, FLAT, KURTA, "flatlay");
  assert.equal(b.segments.filter((s) => s.kind === "reflection").length, 0);
  assert.ok(!b.transformation.includes("e_distort"));
  assert.equal(b.segments.filter((s) => s.kind === "shadow").length, 2);
});

test("harmonise is subtle and uses e_tint colours without an rgb: prefix", () => {
  const warmLow = harmoniseTone({ ...DNA, light_elevation: 20 }).tone;
  const warmHigh = harmoniseTone({ ...DNA, light_elevation: 60 }).tone;
  assert.match(warmLow, /^e_tint:\d+:[0-9a-f]{6}\/e_brightness:-\d+$/);
  assert.ok(Number(/e_tint:(\d+)/.exec(warmLow)![1]) > Number(/e_tint:(\d+)/.exec(warmHigh)![1]));
  assert.equal(harmoniseTone({ ...DNA, temperature: "neutral" }).wash, null);
  const off = build({ ...defaultControls("standing", DNA, BOTTLE), harmonise: false });
  assert.ok(!off.transformation.includes("e_tint") && !off.transformation.includes("e_screen"));
});

test("layerId turns folders into colons", () => {
  assert.equal(layerId("snap2shelf/products/x/cutout"), "snap2shelf:products:x:cutout");
});

test("encodeOverlayText double-encodes % , / and keeps Devanagari as UTF-8", () => {
  assert.equal(encodeOverlayText("20% off"), "20%2525%20off");
  assert.equal(encodeOverlayText("a,b"), "a%252Cb");
  assert.equal(encodeOverlayText("a/b"), "a%252Fb");
  const hi = "दिवाली सेल · 20% छूट";
  const enc = encodeOverlayText(hi);
  assert.ok(!/[^\x21-\x7e]/.test(enc), "ASCII only");
  assert.equal(decodeURIComponent(decodeURIComponent(enc)), hi);
});

test("channel pack: marketplace pads without re-scaling, formats and sizes", () => {
  const box = geometry(BOTTLE, DNA, quantise(defaultControls("standing", DNA, BOTTLE)), "standing");
  const assets = channelAssets({
    heroPublicId: "snap2shelf/products/abcd1234/hero-diwali",
    cutoutPublicId: BOTTLE.publicId,
    alt: "Steel bottle",
    recolorPart: "bottle body",
    swatches: ["#0F766E", "zzz", "1e3a8a"],
    offer: { hindi: "दिवाली सेल", english: "20% off, this week" },
    textZone: "top",
    productBox: box,
  });
  const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
  assert.match(byId.marketplace.url, /c_fit,w_1700,h_1700\/c_mpad,w_2000,h_2000,b_white\/f_jpg/);
  assert.equal(CHANNEL_CHAINS.marketplace.includes("c_pad"), false);
  assert.ok(byId["recolor-0f766e"] && byId["recolor-1e3a8a"] && !byId["recolor-zzz"]);
  assert.match(byId["recolor-0f766e"].url, /e_gen_recolor:prompt_bottle%20body;to-color_0f766e/);
  const wa = /c_crop,g_north_west,x_(\d+),y_(\d+),w_(\d+),h_(\d+)/.exec(byId.whatsapp.url)!;
  const [x, y, w, h] = wa.slice(1).map(Number);
  assert.equal(w, h);
  assert.ok(x >= 0 && y >= 0 && x + w <= 1080 && y + h <= 1350);
  assert.ok(box.px >= x && box.px + box.pw <= x + w && box.py >= y && box.baseY <= y + h, "product inside the tile");
  assert.deepEqual([byId.story.width, byId.story.height, byId.banner.width, byId.banner.height], [1080, 1920, 1920, 1080]);
});

test("offer card never covers the product when there is room anywhere", () => {
  const tall = { pw: 200, ph: 800, px: 440, py: 212, baseY: 1012 }; // top band too small
  const L = offerLayout("top", tall, { hindi: "दिवाली सेल", english: "20% off" });
  assert.equal(L.band, "bottom");
  assert.ok(L.card.y >= tall.baseY);
  assert.equal(L.overlapsProduct, false);
  const short = { pw: 500, ph: 300, px: 290, py: 600, baseY: 900 };
  const T = offerLayout("top", short, { hindi: "दिवाली सेल", english: "20% off" });
  assert.equal(T.band, "top");
  assert.ok(T.card.y + T.card.h <= short.py);
  assert.equal(offerLayout("top_left", short, { english: "Sale" }).align, "left");
});

test("named transformations share the verified chains and keep f_auto outside", () => {
  for (const chain of Object.values(NAMED_TRANSFORMATIONS)) assert.ok(!/f_auto|q_auto|dpr_auto/.test(chain));
  assert.equal(NAMED_TRANSFORMATIONS.s2s_story, CHANNEL_CHAINS.story);
  assert.equal(namedUrlPart("s2s_story"), "t_s2s_story/f_auto,q_auto");
  const named = channelAssets({ heroPublicId: "h", cutoutPublicId: "c", alt: "", named: true });
  assert.match(named.find((a) => a.id === "story")!.url, /\/t_s2s_story\/f_auto,q_auto\/h$/);
});

test("reel: one clip per image, varied moves, persistent offer, mp4", () => {
  const imgs = ["a/one", "a/two", "a/three", "a/four", "a/five", "a/six"];
  const r = reelUrl({ images: imgs, offer: { hindi: "सेल", english: "20% off" }, clipSeconds: 3, fadeSeconds: 0.4 });
  assert.equal(r.clips, 5);
  assert.equal(r.seconds, 15);
  assert.match(r.url, /^https:\/\/res\.cloudinary\.com\/democloud\/image\/upload\/.+\/a\/one\.mp4$/);
  const zoom = r.segments.filter((s) => s.text.includes("e_zoompan"));
  assert.equal(zoom.length, 5);
  assert.equal(new Set(zoom.map((s) => /from_\([^)]*\);to_\([^)]*\)/.exec(s.text)![0])).size, 5, "every clip moves differently");
  const splices = r.segments.filter((s) => s.text.startsWith("fl_splice,l_"));
  assert.equal(splices.length, 4);
  for (const s of splices) assert.match(s.text, /\/c_scale,w_720,h_1280\/e_fade:400\/fl_layer_apply$/);
  // offer layers come after the last splice so they span the whole timeline
  const lastSplice = r.segments.lastIndexOf(splices[3]);
  const text = r.segments.findIndex((s) => s.kind === "text");
  assert.ok(text > lastSplice);
  assert.equal(r.segments.at(-1)!.kind, "asset");
  assert.equal(REEL_MOVES.length, 5);
  assert.throws(() => reelUrl({ images: [] }));
});

test("x-ray: describeTransformation splits our URLs into the same layer blocks", () => {
  const b = build({ ...defaultControls("standing", GLOSSY, SHOE), reflection: "on" }, GLOSSY, SHOE);
  const d = describeTransformation(b.url);
  assert.equal(d.transformation, b.transformation);
  assert.deepEqual(
    d.segments.map((s) => s.text),
    b.segments.map((s) => s.text),
  );
  assert.equal(d.segments.at(-1)!.kind, "asset");
  assert.ok(d.segments.some((s) => s.kind === "shadow") && d.segments.some((s) => s.kind === "reflection"));
  // generic URLs, versions, folders with underscores
  const g = describeTransformation("https://res.cloudinary.com/demo/image/upload/c_fill,w_400,h_300,g_auto/e_gen_recolor:prompt_shoe;to-color_red/f_auto,q_auto/v1712/my_folder/sample.jpg");
  assert.deepEqual(g.segments.map((s) => s.kind), ["crop", "gen-ai", "format", "asset"]);
  assert.equal(g.segments.at(-1)!.text, "v1712/my_folder/sample.jpg");
  const r = describeTransformation(reelUrl({ images: ["x/a", "x/b", "x/c"] }).url);
  assert.equal(r.segments.filter((s) => s.kind === "video").length, 3);
  assert.equal(describeTransformation("https://example.com/cat.jpg").segments[0].kind, "asset");
  for (const k of Object.keys(XRAY_KINDS)) assert.match(XRAY_KINDS[k as keyof typeof XRAY_KINDS].token, /^--xray-/);
  assert.ok(xrayLegend(d.segments).length >= 4);
});

test("og image: up to 4 centred tiles, JPEG, Devanagari font for Hindi names", async () => {
  const { ogImageUrl, OG } = await import("../lib/transform/og.ts");
  const b = ogImageUrl({ heroes: ["h/1", "h/2", "h/3", "h/4", "h/5"], shopName: "Meera's, Home / Store" });
  assert.equal(b.segments.filter((s) => s.kind === "layer").length, 4);
  assert.match(b.url, /f_jpg,q_80\/h\/1$/);
  const xs = [...b.transformation.matchAll(/g_north_west,x_(\d+),y_(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(xs[0] >= 0 && xs[3] + 272 <= OG.width);
  assert.match(b.transformation, /Meera's%252C%20Home%20%252F%20Store/);
  assert.match(ogImageUrl({ heroes: ["h/1"], shopName: "मीरा होम स्टोर" }).transformation, /Noto%20Sans%20Devanagari@google_64_700/);
  assert.throws(() => ogImageUrl({ heroes: [], shopName: "x" }));
});
