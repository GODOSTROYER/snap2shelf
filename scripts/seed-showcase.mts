// Showcase mode: fully prebuilt kits for the SAMPLE products (synthetic test photos, not real
// seller photos), so the live site shows a finished kit in under 5 s with zero quota use.
// Runs the same library functions as the API routes:
//   upload raw → analyze → cutout → pick 2 library scenes → Exact composite → exact QA (retry on
//   rejection: nudge controls, then the other scene) → pack (hero + channels + offer + recolors)
//   → stored ZIP → Kit Reel (lib/transform/reel.ts, stored clips only) ; plus Creative takes with fidelity QA.
// Output: data/showcase.json (typed by lib/showcase-data.ts) and contact sheets in scripts/spikes/out/view/.
//
//   node --conditions=react-server --import tsx scripts/seed-showcase.mts [--refresh] [--only shbottle,shkurta1]
//        [--preview] [--no-creative] [--sheet-only] [--photos Z:/Projects/Cloudinary/photos]
//
// Idempotent: fixed skus reuse every stored asset (raw, analysis, cutout, creative takes are never redone).
//   (default)   build kits that are missing; keep existing ones (adding a reel if one is missing).
//   --refresh   re-stage every kit with the CURRENT lib/transform (composite → QA → pack → ZIP → reel).
//               Costs per kit when the composite changed: ~680 AI Vision tokens per QA attempt,
//               2 x b_gen_fill + n x e_gen_recolor (50 tx each: a new hero means new derivatives), one reel
//               render. An unchanged composite costs nothing: same hero id, pack skipped, QA verdict cached
//               in scripts/spikes/out/qa-cache.json. Never uploads, analyses, cuts out or generates.
//   ZIP links are signed private downloads valid for ZIP_DAYS (90): re-run with --refresh before they
//   lapse (with unchanged composites that only re-zips and re-signs).
//   --preview   upload/analyze/cutout if needed, then render every candidate scene per product (plain
//               transformations, no QA, no pack) to scripts/spikes/out/view/preview-sheet.jpg.
//   --sheet-only  rebuild the contact sheets from data/showcase.json.
// Creative takes are generated at most once per (sku, model, seed): an existing asset is reused (0 credits).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { v2 as cloudinary } from "cloudinary";
import { loadEnv } from "./lib/env.mjs";
import type { BuiltUrl, CompositeControls, CutoutRecord, KitAsset, Placement, ProductUnderstanding, QaResult, Scene } from "../lib/types.ts";
import type { ShowcaseBeforeAfter, ShowcaseCreative, ShowcaseData, ShowcaseKit, ShowcaseQaAttempt, ShowcaseTimings } from "../lib/showcase-data.ts";

loadEnv();
const { values: args } = parseArgs({
  options: {
    refresh: { type: "boolean", default: false },
    only: { type: "string" },
    preview: { type: "boolean", default: false },
    "no-creative": { type: "boolean", default: false },
    "sheet-only": { type: "boolean", default: false },
    photos: { type: "string", default: "Z:/Projects/Cloudinary/photos" },
  },
});

const { analyzeProduct, ensureCutout, getCutout, productRecord, rawId, cutoutId, skuTag } = await import("../lib/server/products.ts");
const { exactQa, fidelityQa, fidelitySheetUrl, qaFromContext, qaToContext } = await import("../lib/server/qa.ts");
const { startPack, packStatus, packPrefix, packTag, heroPublicId: heroIdFor } = await import("../lib/server/pack.ts");
const { startCreative, pollCreative, creativeId, buildCreativeRequest } = await import("../lib/server/creative.ts");
const { decodeJob } = await import("../lib/server/job-token.ts");
const { HttpError } = await import("../lib/server/http.ts");
const { addContext, deliveryUrl, getResource, listByPrefix, mainAuth, mainCloud, probe } = await import("../lib/server/cld.ts");
const { pinJpeg } = await import("../lib/server/guard.ts");
const composite = await import("../lib/transform/composite.ts");
const { defaultControls, geometry, quantise } = composite;
const { encodeOverlayText } = await import("../lib/transform/channels.ts");
// Kit Reel (lib/transform/reel.ts): skipped, not failed, on a branch that doesn't have it yet.
type ReelFn = (i: { images: string[]; offer?: { hindi?: string; english?: string }; cloud?: string }) => BuiltUrl & { seconds: number };
const reelPath = "../lib/transform/reel.ts";
const reelUrl: ReelFn | null = await import(reelPath).then((m: { reelUrl?: ReelFn }) => m.reelUrl ?? null, () => null);
const { sceneFromListResource, sceneListUrl } = await import("../lib/scenes.ts");
const { PLATE, VIEW_FOR_PLACEMENT } = await import("../lib/types.ts");
const { poolSummary, refreshUsage } = await import("../lib/cloudinary/pool.ts");

const OUT_JSON = "data/showcase.json";
const VIEW = "scripts/spikes/out/view";
const TILES = `${VIEW}/tiles`;
mkdirSync("data", { recursive: true });
mkdirSync(TILES, { recursive: true });
const cloud = mainCloud();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

// ------------------------------------------------------------------ art direction

/** Offer on every kit (Devanagari + Latin, rendered with Google fonts via l_text). */
const OFFER = { hindi: "दिवाली सेल", english: "Diwali Sale · 20% off" };

/** Names match the UI's swatch presets (lib/client/swatches.ts on feat/ui). */
const SWATCH_NAMES: Record<string, string> = {
  "0f766e": "Teal",
  "2563eb": "Royal blue",
  b91c1c: "Crimson",
  "1f2937": "Charcoal",
  a16207: "Mustard",
  "7c3aed": "Violet",
};

/**
 * Library plates that read best (reviewed on contact sheets). Order = preference when AI
 * suggestions and hints tie; finals before drafts.
 */
const PREFERRED_SCENES = [
  "snap2shelf/scenes/diwali/final-59f4388a",
  "snap2shelf/scenes/kitchen/final-bd611466",
  "snap2shelf/scenes/jute/final-eb20e69e",
  "snap2shelf/scenes/cafe/final-04757f01",
  "snap2shelf/scenes/jute/draft-6b0c36d3",
  // clean studio plate; glossy, so the product is grounded by its reflection (reviewed 30 Sep)
  "snap2shelf/scenes/marble/final-ca4c3ac1",
  "snap2shelf/scenes/flatlay-festive/final-ed645adc",
  "snap2shelf/scenes/flatlay-linen/final-c9e88705",
];

interface ProductSpec {
  sku: string; // fixed, so reruns reuse every stored asset
  file: string; // relative to --photos
  kind: "decent" | "messy";
  title: string;
  placement: Placement; // how the sample was shot / should be staged (wins over AI Vision if they differ)
  /**
   * Recolour variants that suit the product. Empty where e_gen_recolor can't isolate a part on
   * this hero (checked 30 Sep): every sneaker prompt ("upper panels", "grey suede of the sneaker",
   * "white mesh", "laces", "sneaker") flooded the whole shoe flat or hit the backdrop, and the
   * pouch prompts recoloured the table or the nuts behind the window. Food packaging colour
   * isn't a product variant anyway.
   */
  swatches: string[];
  sceneHints: string[]; // theme slugs to prefer (art direction; breaks ties with AI Vision's suggestions)
  recolorPart?: string; // only if AI Vision's part name recolours badly
  beforeAfter?: boolean;
}

const PRODUCTS: ProductSpec[] = [
  { sku: "shmessy1", file: "messy/01_steel_bottle.png", kind: "messy", title: "Steel water bottle", placement: "standing", swatches: ["1f2937", "0f766e", "b91c1c"], sceneHints: ["marble", "cafe"], beforeAfter: true },
  { sku: "shbottle", file: "decent/06_steel_bottle.png", kind: "decent", title: "Steel water bottle", placement: "standing", swatches: ["0f766e", "b91c1c"], sceneHints: ["cafe", "jute"] },
  { sku: "shsneakr", file: "decent/09_neutral_sneaker.png", kind: "decent", title: "Everyday sneaker", placement: "standing", swatches: [], sceneHints: ["diwali", "cafe"] },
  { sku: "shtrail1", file: "decent/10_trail_mix_pouch.png", kind: "decent", title: "Trail mix pouch", placement: "standing", swatches: [], sceneHints: ["jute", "kitchen"] },
  { sku: "shkurta1", file: "decent/07_olive_kurta.png", kind: "decent", title: "Olive chikankari kurta", placement: "flatlay", swatches: ["b91c1c", "2563eb"], sceneHints: ["flatlay-festive", "flatlay-linen"] },
];

/** Creative takes: nano-banana-2-edit is expected to pass fidelity QA; flux-2-flash-edit is the draft tier that redesigns. */
const CREATIVE_JOBS = [
  { sku: "shbottle", model: "nano-banana-2-edit", seed: 7, prompt: "on a sunlit wooden kitchen windowsill beside a small potted basil plant and a folded linen towel, soft morning light, shallow depth of field" },
  { sku: "shsneakr", model: "nano-banana-2-edit", seed: 7, prompt: "on a weathered sandstone step in a sunlit Rajasthani courtyard, warm late-afternoon light, soft natural shadows" },
  { sku: "shsneakr", model: "flux-2-flash-edit", seed: 7, prompt: "on a weathered sandstone step in a sunlit Rajasthani courtyard, warm late-afternoon light, soft natural shadows" },
];
const GEN_BUDGET = 20; // hard cap on image-generation credits for this script
const qaBudget = { used: 0, max: 12_000 }; // AI Vision tokens this run may spend on exact-QA attempts

/** Exact-QA verdicts by composite URL (git-ignored): an identical composite is never judged twice. */
const QA_CACHE = "scripts/spikes/out/qa-cache.json";
type QaVerdict = { qa: QaResult; tokens: number; ms: number };
const qaCache: Record<string, QaVerdict> = existsSync(QA_CACHE) ? JSON.parse(readFileSync(QA_CACHE, "utf8")) : {};
async function judge(url: string): Promise<QaVerdict & { cached: boolean }> {
  const hit = qaCache[url];
  if (hit) return { ...hit, cached: true };
  const t0 = now();
  const out = await retryPending(() => exactQa(url));
  qaCache[url] = { qa: out.qa, tokens: out.tokens, ms: now() - t0 };
  writeFileSync(QA_CACHE, JSON.stringify(qaCache, null, 1));
  return { ...qaCache[url], cached: false };
}

// ------------------------------------------------------------------ helpers

const selected = (sku: string) => !args.only || args.only.split(",").includes(sku);
const prev: ShowcaseData | null = existsSync(OUT_JSON) ? (JSON.parse(readFileSync(OUT_JSON, "utf8")) as ShowcaseData) : null;
const prevKit = (sku: string) => prev?.kits.find((k) => k.sku === sku);

async function step<R>(label: string, fn: () => Promise<R>): Promise<{ r: R; ms: number }> {
  const t0 = now();
  const r = await fn();
  const ms = now() - t0;
  console.log(`  ✓ ${label} ${ms} ms`);
  return { r, ms };
}

async function retryPending<R>(fn: () => Promise<R>, tries = 20): Promise<R> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof HttpError && err.code === "pending" && i < tries) {
        await sleep(err.retryAfterMs ?? 2000);
        continue;
      }
      throw err;
    }
  }
}

async function download(url: string, file: string, headers: Record<string, string> = {}, timeoutMs = 60_000) {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    const buf = Buffer.from(await res.arrayBuffer());
    if (res.status === 423 || res.status === 420) {
      await sleep(2000);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.headers.get("x-cld-error") ?? ""} for ${url.slice(0, 160)}`);
    writeFileSync(file, buf);
    return { bytes: buf.length, type: res.headers.get("content-type") ?? "" };
  }
  throw new Error(`still processing after retries: ${url.slice(0, 160)}`);
}

const PHONE_HEADERS = {
  Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
};

async function loadScenes(): Promise<Scene[]> {
  const res = await fetch(sceneListUrl(cloud), { cache: "no-store" });
  if (!res.ok) throw new Error(`scene list HTTP ${res.status}`);
  const body = (await res.json()) as { resources: { public_id: string; context?: { custom?: Record<string, string> } }[] };
  return body.resources.map(sceneFromListResource).filter((s): s is Scene => Boolean(s));
}

/**
 * The 2 best library scenes for a product: right camera view for the placement, the showcase's
 * art-direction hints first, AI Vision's suggested themes as the tie-breaker, and a penalty for
 * scenes other kits already use so the shelf shows variety. The second pick prefers a different theme.
 */
function pickScenes(spec: ProductSpec, u: ProductUnderstanding, placement: Placement, scenes: Scene[], used: Map<string, number>) {
  const view = VIEW_FOR_PLACEMENT[placement];
  const pool = scenes.filter((s) => s.view === view && PREFERRED_SCENES.includes(s.publicId));
  const scored = pool
    .map((s) => {
      const ai = u.suggested_themes.indexOf(s.theme);
      const hint = spec.sceneHints.indexOf(s.theme);
      // art direction leads (a shelf of five kitchen counters is dull), AI suggestions break ties
      const score = (hint >= 0 ? 10 - 4 * hint : 0) + (ai >= 0 ? 3 - ai : 0) + (PREFERRED_SCENES.length - PREFERRED_SCENES.indexOf(s.publicId)) * 0.1 - (used.get(s.publicId) ?? 0) * 8;
      const why = [ai >= 0 ? `AI suggested "${s.theme}" (#${ai + 1})` : null, hint >= 0 ? `art-direction hint #${hint + 1}` : null, used.get(s.publicId) ? "already used on the shelf" : null]
        .filter(Boolean)
        .join(", ");
      return { scene: s, score, why: why || "preferred library plate" };
    })
    .sort((a, b) => b.score - a.score);
  if (!scored.length) throw new Error(`no ${view} scenes in the library`);
  const first = scored[0];
  const second = scored.find((x) => x !== first && x.scene.theme !== first.scene.theme) ?? scored.find((x) => x !== first);
  return second ? [first, second] : [first];
}

/**
 * Controls to try after a rejection, from the QA tags that fired (what a seller would do with the
 * sliders). null = nothing sensible left to change on this scene.
 *  compositing-artifact → the contact shadow is the usual culprit (a dark band under the base),
 *                         then the cast shadow
 *  product-floating     → contact shadow back on (unless it was the artifact) and 10 px lower
 *  scale-implausible    → smaller
 */
function nudge(c: CompositeControls, matched: string[]): { controls: CompositeControls; note: string } | null {
  const next = { ...c };
  const notes: string[] = [];
  const artifact = matched.includes("compositing-artifact");
  if (artifact && c.contact) {
    next.contact = false;
    notes.push("contact shadow off (compositing-artifact)");
  } else if (artifact && c.shadow) {
    next.shadow = false;
    notes.push("cast shadow off (compositing-artifact)");
  }
  if (matched.includes("product-floating")) {
    if (!artifact && !c.contact) next.contact = true;
    next.offsetY = c.offsetY + 10;
    notes.push(`${!artifact && !c.contact ? "contact shadow on, " : ""}10 px lower (product-floating)`);
  }
  if (matched.includes("scale-implausible")) {
    next.scale = Math.max(0.2, Math.round((c.scale - 0.06) * 50) / 50);
    notes.push("smaller (scale-implausible)");
  }
  return notes.length ? { controls: next, note: `retry: ${notes.join("; ")}` } : null;
}

const sceneSlug = (s: Scene) => `${s.theme}-${s.publicId.split("/").pop()!.replace(/^(final|draft)-/, "")}`;

function assetAlt(name: string, scene: Scene, a: KitAsset): string {
  const on = `on the ${scene.title} scene`;
  switch (a.format) {
    case "feed":
      return `${name} ${on}, 4:5 feed post`;
    case "marketplace":
      return `${name} on a pure white background, marketplace main image`;
    case "story":
      return `${name} ${on}, scene extended to a 9:16 story`;
    case "banner":
      return `${name} ${on}, scene extended to a 16:9 web banner`;
    case "whatsapp":
      return `${name} ${on}, square catalog tile`;
    case "recolor": {
      const hex = a.id.replace(/^recolor-/, "");
      return `${name} in ${(SWATCH_NAMES[hex] ?? `#${hex}`).toLowerCase()}, ${on}`;
    }
    case "offer":
      return `${name} ${on} with the offer "${OFFER.english}" in Hindi and English`;
    default:
      return `${name} ${on}`;
  }
}

function assetLabel(a: KitAsset): string {
  if (a.format !== "recolor") return a.label;
  const hex = a.id.replace(/^recolor-/, "");
  return `${SWATCH_NAMES[hex] ?? `#${hex}`} variant`;
}

/**
 * Documented per-effect transformation counts (SPIKES.md, Cloudinary pricing): background
 * removal 75, generative fill / recolor 50 each, everything else 1 per derived image.
 */
function txEstimate(attempts: number, pack: KitAsset[], reel: boolean) {
  const ai = pack.filter((a) => a.format === "story" || a.format === "banner" || a.format === "recolor").length;
  const plain = pack.length - ai;
  return 75 + 1 /* analysis jpg */ + attempts * 2 /* composite + pinned jpg for QA */ + 1 /* hero save */ + ai * 50 + plain + pack.length /* f_auto delivery */ + 1 + (reel ? 1 : 0);
}

// ------------------------------------------------------------------ stages

async function ensureRaw(spec: ProductSpec) {
  const existing = await getResource(rawId(spec.sku));
  if (existing) return { raw: existing, uploaded: false, ms: 0 };
  const file = join(args.photos!, spec.file);
  const t0 = now();
  await cloudinary.uploader.upload(file, {
    ...mainAuth(),
    upload_preset: "s2s_ingest",
    public_id: rawId(spec.sku),
    unique_filename: false,
    overwrite: false,
    resource_type: "image",
    tags: ["s2s", "s2s-raw", skuTag(spec.sku), "s2s-showcase"],
    context: { origin: "showcase", sample: "1", photo: spec.kind },
  });
  const ms = now() - t0;
  const raw = await getResource(rawId(spec.sku));
  if (!raw) throw new Error(`upload of ${spec.sku} not visible`);
  return { raw, uploaded: true, ms };
}

async function prepareProduct(spec: ProductSpec) {
  console.log(`\n▶ ${spec.sku} ${spec.title} (${spec.kind}: ${spec.file})`);
  const up = await ensureRaw(spec);
  console.log(`  raw ${up.raw.width}x${up.raw.height} ${up.raw.bytes} B ${up.uploaded ? `uploaded in ${up.ms} ms` : "(reused)"}`);

  const an = await step("analyze", () => analyzeProduct(spec.sku));
  const u = an.r.response.understanding;
  console.log(`  cached=${an.r.cached} tokens=${an.r.response.tokens} caption="${an.r.response.caption}"`);
  console.log(`  understanding=${JSON.stringify(u)}`);

  const cut = await step("cutout", () =>
    retryPending(async () => {
      const o = await ensureCutout(spec.sku);
      return { ...o.response.cutout, created: o.created };
    }),
  );
  console.log(`  cutout ${cut.r.width}x${cut.r.height} v${cut.r.version}${cut.r.created ? "" : " (reused)"}`);

  const overrides: string[] = [];
  let understanding = u;
  if (u.placement !== spec.placement) {
    overrides.push(`placement: AI Vision said "${u.placement}", staged as "${spec.placement}" (art direction)`);
    understanding = { ...u, placement: spec.placement };
    await addContext([rawId(spec.sku)], { u_place: spec.placement });
  }
  if (spec.recolorPart && spec.recolorPart !== u.recolorable_part) {
    overrides.push(`recolor part: AI Vision said "${u.recolorable_part}", using "${spec.recolorPart}"`);
    understanding = { ...understanding, recolorable_part: spec.recolorPart };
    await addContext([rawId(spec.sku)], { u_part: spec.recolorPart });
  }

  // Stage measurements live on the raw asset (m_* context), written when the stage really ran,
  // so a rerun that reuses the upload / analysis / cutout still reports how long they took.
  const measured: Record<string, string> = {};
  if (up.uploaded) measured.m_upload = String(up.ms);
  if (!an.r.cached) Object.assign(measured, { m_analyze: String(an.ms), m_tokens: String(an.r.response.tokens) });
  if (cut.r.created) measured.m_cutout = String(cut.ms);
  if (Object.keys(measured).length) await addContext([rawId(spec.sku)], measured);
  const raw = (await getResource(rawId(spec.sku)))!;
  const m = (k: string, fallback: number) => (Number.isFinite(Number(raw.context[k])) && raw.context[k] ? Number(raw.context[k]) : fallback);
  return {
    raw,
    cutout: { publicId: cut.r.publicId, width: cut.r.width, height: cut.r.height, version: cut.r.version } as CutoutRecord,
    understanding,
    caption: an.r.response.caption,
    overrides,
    tokens: m("m_tokens", an.r.response.tokens),
    timings: { upload: m("m_upload", up.ms), analyze: m("m_analyze", an.ms), cutout: m("m_cutout", cut.ms) },
  };
}

function compose(scene: Scene, cutout: CutoutRecord, placement: Placement, controls: CompositeControls, extra: { width?: number; format?: string } = {}) {
  return composite.compositeUrl({ scenePublicId: scene.publicId, dna: scene.dna, cutout, placement, controls, cloud, ...extra });
}

async function stageAndQa(spec: ProductSpec, p: Awaited<ReturnType<typeof prepareProduct>>, candidates: ReturnType<typeof pickScenes>) {
  const attempts: ShowcaseQaAttempt[] = [];
  let stageMs = 0;
  let qaMs = 0;
  const placement = p.understanding.placement;
  for (const [ci, cand] of candidates.entries()) {
    let controls = defaultControls(placement, cand.scene.dna, p.cutout);
    let note = ci === 0 ? `first choice: ${cand.why}` : `fallback scene after rejection: ${cand.why}`;
    const tried = new Set<string>();
    for (let k = 0; k < 3 && !tried.has(JSON.stringify(controls)); k++) {
      if (qaBudget.used >= qaBudget.max) {
        console.log(`    ✗ exact-QA token guard reached (${qaBudget.used}/${qaBudget.max}), no more attempts`);
        return { attempts, scene: null, controls: null, built: null, stageMs, qaMs };
      }
      tried.add(JSON.stringify(controls));
      const built = compose(cand.scene, p.cutout, placement, controls);
      const t0 = now();
      const r = await probe(pinJpeg(built.url), 20_000, "GET");
      const renderMs = now() - t0;
      if (r.status !== 200) throw new Error(`composite render HTTP ${r.status} ${r.error ?? ""}`);
      const q = { r: await judge(built.url) };
      console.log(`  ✓ exact QA on ${cand.scene.title}${k ? " (nudged)" : ""} ${q.r.ms} ms${q.r.cached ? " (verdict cached from an earlier run on this exact URL)" : ""}`);
      qaMs += q.r.ms; // time of the call that actually produced the verdict
      if (!q.r.cached) qaBudget.used += q.r.tokens;
      attempts.push({ scenePublicId: cand.scene.publicId, sceneTitle: cand.scene.title, controls, url: built.url, qa: q.r.qa, tokens: q.r.tokens, note });
      console.log(`    ${q.r.qa.status} matched=${JSON.stringify(q.r.qa.matched)} tokens=${q.r.tokens} render=${renderMs} ms${q.r.qa.reasons.length ? ` reasons=${JSON.stringify(q.r.qa.reasons)}` : ""}`);
      if (q.r.qa.status === "approved") {
        stageMs = renderMs;
        return { attempts, scene: cand.scene, controls, built, stageMs, qaMs };
      }
      const n = nudge(controls, q.r.qa.matched);
      if (!n) break;
      controls = n.controls;
      note = n.note;
    }
  }
  return { attempts, scene: null, controls: null, built: null, stageMs, qaMs };
}

async function buildPack(spec: ProductSpec, scene: Scene, heroUrl: string, productBox: ReturnType<typeof geometry>) {
  const t0 = now();
  const started = await startPack({ sku: spec.sku, heroUrl, sceneSlug: sceneSlug(scene), offer: OFFER, recolor: spec.swatches, textZone: scene.dna.text_zone, productBox });
  console.log(`  pack started: hero=${started.heroPublicId} pending=[${started.pending.join(",")}]`);
  let status = await packStatus(spec.sku);
  for (let i = 0; status.pending.length && i < 60; i++) {
    await sleep(2000);
    status = await packStatus(spec.sku);
    if (i % 5 === 4) console.log(`    pending=[${status.pending.join(",")}]`);
  }
  if (status.pending.length) throw new Error(`pack for ${spec.sku} still pending: ${status.pending.join(",")}`);
  const ms = now() - t0;
  console.log(`  ✓ pack ${ms} ms failed=[${status.failed.join(",")}]`);
  return { status, ms };
}

/**
 * The pack as a stored ZIP (raw asset), handed out through a signed private-download URL with a
 * long expiry: this Free cloud blocks public delivery of .zip files (HTTP 401), and the live API's
 * download_zip_url lasts 1 h and re-archives on every click. The URL carries only the public API
 * key and a signature. Regenerate before it expires (ZIP_DAYS).
 */
const ZIP_DAYS = 90;
async function buildZip(sku: string) {
  const t0 = now();
  const publicId = `snap2shelf/products/${sku}/channel-pack.zip`;
  const res = (await cloudinary.uploader.create_zip({
    ...mainAuth(),
    tags: [packTag(sku)],
    resource_type: "image",
    flatten_folders: true,
    target_public_id: publicId,
    overwrite: true,
    invalidate: true,
  } as Parameters<typeof cloudinary.uploader.create_zip>[0])) as { bytes: number; resource_count?: number; file_count?: number };
  const url = cloudinary.utils.private_download_url(publicId, "", {
    ...mainAuth(),
    resource_type: "raw",
    type: "upload",
    expires_at: Math.floor(Date.now() / 1000) + ZIP_DAYS * 86400,
  } as Parameters<typeof cloudinary.utils.private_download_url>[2]);
  const r = await fetch(url);
  const buf = Buffer.from(await r.arrayBuffer());
  const ms = now() - t0;
  console.log(`  ✓ zip ${ms} ms ${res.bytes} B files=${res.file_count ?? res.resource_count ?? "?"} download ${r.status} ${r.headers.get("content-type")} magic=${buf.subarray(0, 2).toString()}`);
  if (!r.ok || buf.subarray(0, 2).toString() !== "PK") throw new Error(`zip download failed: HTTP ${r.status}`);
  return { url, ms };
}

async function buildReel(sku: string, assets: KitAsset[], creativeIds: string[]) {
  if (!reelUrl) return undefined;
  const pick = (id: string) => assets.find((a) => a.id === id)?.publicId;
  // story first (already 9:16), then colour variants and an approved creative take; banner/feed fill
  // up to 3 clips. Never the offer asset: the reel lays its own offer card over every clip.
  const primary = [pick("story"), ...assets.filter((a) => a.format === "recolor").slice(0, 2).map((a) => a.publicId), ...creativeIds.slice(0, 1)];
  const images = [...primary, pick("banner"), pick("feed")].filter((x): x is string => Boolean(x)).slice(0, Math.max(3, primary.filter(Boolean).length));
  const r = reelUrl({ images: images.slice(0, 4), offer: OFFER, cloud });
  const t0 = now();
  const file = `${TILES}/${sku}-reel.mp4`;
  const d = await download(r.url, file, {}, 180_000);
  const ms = now() - t0;
  console.log(`  ✓ reel ${ms} ms ${d.bytes} B ${d.type} ${r.seconds} s`);
  return { reel: { url: r.url, xray: { url: r.url, transformation: r.transformation, segments: r.segments }, seconds: r.seconds }, ms };
}

async function measureDelivered(heroPublicId: string) {
  const url = deliveryUrl(heroPublicId, "f_auto,q_auto");
  const res = await fetch(url, { headers: PHONE_HEADERS });
  const buf = Buffer.from(await res.arrayBuffer());
  return { url, bytes: buf.length, type: res.headers.get("content-type") ?? "" };
}

/**
 * Where the trimmed cutout sits in the raw photo (the cutout is a pixel-exact crop of it where
 * alpha is solid), by coarse-to-fine template matching. Needs sharp (ships with Next); null without it.
 */
async function locateInRaw(rawFile: string, cutoutPublicId: string, cw: number, ch: number): Promise<{ x: number; y: number } | null> {
  if (!existsSync(rawFile)) return null;
  let sharp: typeof import("sharp");
  try {
    sharp = (await import("sharp")).default as unknown as typeof import("sharp");
  } catch {
    return null;
  }
  const cutBuf = Buffer.from(await (await fetch(deliveryUrl(cutoutPublicId))).arrayBuffer());
  const meta = await sharp(rawFile).metadata();
  const RW = meta.width!;
  const RH = meta.height!;
  const match = async (S: number, xs: [number, number], ys: [number, number]) => {
    const rw = Math.round(RW / S);
    const rh = Math.round(RH / S);
    const raw = await sharp(rawFile).removeAlpha().resize(rw, rh, { fit: "fill" }).raw().toBuffer();
    const tw = Math.max(1, Math.round(cw / S));
    const th = Math.max(1, Math.round(ch / S));
    const tpl = await sharp(cutBuf).ensureAlpha().resize(tw, th, { fit: "fill" }).raw().toBuffer();
    const pts: number[] = [];
    for (let i = 0; i < tw * th; i++) if (tpl[i * 4 + 3] > 245) pts.push(i);
    const stride = Math.max(1, Math.floor(pts.length / 4000));
    const use = pts.filter((_, i) => i % stride === 0);
    let best = { x: 0, y: 0, sad: Infinity };
    for (let y = Math.max(0, ys[0]); y <= Math.min(rh - th, ys[1]); y++) {
      for (let x = Math.max(0, xs[0]); x <= Math.min(rw - tw, xs[1]); x++) {
        let sad = 0;
        for (const i of use) {
          const tx = i % tw;
          const ty = (i - tx) / tw;
          const ri = ((y + ty) * rw + (x + tx)) * 3;
          const ti = i * 4;
          sad += Math.abs(raw[ri] - tpl[ti]) + Math.abs(raw[ri + 1] - tpl[ti + 1]) + Math.abs(raw[ri + 2] - tpl[ti + 2]);
          if (sad >= best.sad) break;
        }
        if (sad < best.sad) best = { x, y, sad };
      }
    }
    return best;
  };
  const S = 4;
  const coarse = await match(S, [0, 1e9], [0, 1e9]);
  const fine = await match(1, [coarse.x * S - 2 * S, coarse.x * S + 2 * S], [coarse.y * S - 2 * S, coarse.y * S + 2 * S]);
  return { x: fine.x, y: fine.y };
}

/** Crop the raw so the product lands where the hero puts it (c_mpad first when the crop leaves the photo). */
function alignRawTransformation(raw: { width: number; height: number }, loc: { x: number; y: number }, cutout: CutoutRecord, kit: ShowcaseKit): string | null {
  const g = geometry(cutout, kit.scene!.dna, quantise(kit.controls!), kit.product.understanding!.placement);
  const s = g.pw / cutout.width;
  const cx = loc.x - g.px / s;
  const cy = loc.y - g.py / s;
  const cw = PLATE.width / s;
  const chh = PLATE.height / s;
  const padX = Math.ceil(Math.max(0, -cx, cx + cw - raw.width));
  const padY = Math.ceil(Math.max(0, -cy, cy + chh - raw.height));
  // a heavily padded raw (hero product much smaller than in the photo) reads as a framed thumbnail, not a photo
  if (padX > raw.width * 0.08 || padY > raw.height * 0.08) return null;
  const crop = `c_crop,x_${Math.round(cx + padX)},y_${Math.round(cy + padY)},w_${Math.round(cw)},h_${Math.round(chh)}`;
  return padX || padY ? `c_mpad,w_${raw.width + 2 * padX},h_${raw.height + 2 * padY},b_auto:border/${crop}` : crop;
}

// ------------------------------------------------------------------ kit

async function buildKit(spec: ProductSpec, scenes: Scene[], used: Map<string, number>, creativeIds: string[]): Promise<ShowcaseKit> {
  const tStart = now();
  const p = await prepareProduct(spec);
  const candidates = pickScenes(spec, p.understanding, p.understanding.placement, scenes, used);
  console.log(`  scenes: ${candidates.map((c) => `${c.scene.title} [${c.scene.publicId.split("/").slice(-2).join("/")}] (${c.why})`).join(" | ")}`);

  const st = await stageAndQa(spec, p, candidates);
  if (!st.scene || !st.built || !st.controls) {
    throw new Error(`${spec.sku}: no composite passed exact QA after ${st.attempts.length} attempts: ${st.attempts.map((a) => a.qa.matched.join("+")).join(" | ")}`);
  }
  const approvedAt = now();
  used.set(st.scene.publicId, (used.get(st.scene.publicId) ?? 0) + 1);

  // product box on the plate: keeps the offer text off the product, centres the WhatsApp crop
  const box = geometry(p.cutout, st.scene.dna, quantise(st.controls), p.understanding.placement);
  // hero ids hash the composite URL: an existing hero means this exact kit was packed before,
  // and Cloudinary's caches would make the pack look instant; keep the times measured back then
  const heroBefore = await getResource(heroIdFor(spec.sku, sceneSlug(st.scene), st.built.url));
  const pk = await buildPack(spec, st.scene, st.built.url, box);
  const zip = await buildZip(spec.sku);
  const tDone = now();

  const versions = new Map((await listByPrefix(packPrefix(spec.sku))).map((a) => [a.publicId, a.version]));
  const name = p.understanding.name;
  const assets: KitAsset[] = pk.status.assets.map((a) => {
    const v = a.publicId ? versions.get(a.publicId) : undefined;
    return {
      ...a,
      label: assetLabel(a),
      alt: assetAlt(name, st.scene!, a),
      // stored asset + plain f_auto/q_auto: viewing never re-runs gen_fill / gen_recolor
      url: a.publicId ? deliveryUrl(`${v ? `v${v}/` : ""}${a.publicId}`, "f_auto,q_auto") : a.url,
    };
  });
  const heroPublicId = pk.status.heroPublicId;
  const approved = st.attempts[st.attempts.length - 1].qa;
  const hero: KitAsset = {
    id: "hero",
    format: "hero",
    label: "Hero 4:5",
    url: deliveryUrl(heroPublicId, "f_auto,q_auto"),
    width: PLATE.width,
    height: PLATE.height,
    frame: "feed-post",
    alt: `${name}, staged on the ${st.scene.title} scene`,
    xray: st.built,
    publicId: heroPublicId,
    qa: approved,
  };

  const reel = await buildReel(spec.sku, assets, creativeIds);
  if (reel) {
    // a reel URL rendered before comes back from the CDN instantly: keep its first-render time (on the hero)
    const h = createHash("sha1").update(reel.reel.url).digest("hex").slice(0, 8);
    const hero = await getResource(heroPublicId);
    if (hero?.context.m_reel_url === h && Number(hero.context.m_reel) > 0) reel.ms = Number(hero.context.m_reel);
    else await addContext([heroPublicId], { m_reel: String(reel.ms), m_reel_url: h });
  }
  const delivered = await measureDelivered(heroPublicId);
  console.log(`  hero delivered to a phone: ${delivered.bytes} B ${delivered.type} (raw ${p.raw.bytes} B)`);

  const hm = (k: string) => (heroBefore && Number(heroBefore.context[k]) > 0 ? Number(heroBefore.context[k]) : null);
  const stageMs = hm("m_stage") ?? st.stageMs;
  const packMs = hm("m_pack") ?? pk.ms;
  if (!heroBefore) await addContext([heroPublicId], { m_stage: String(stageMs), m_pack: String(packMs) });
  const timings: ShowcaseTimings = {
    upload: p.timings.upload,
    analyze: p.timings.analyze,
    cutout: p.timings.cutout,
    stage: stageMs,
    qa: st.qaMs,
    pack: packMs,
    zip: zip.ms,
    ...(reel ? { reel: reel.ms } : {}),
    toApprovedHero: 0,
    total: 0,
  };
  // Stages ran back to back, so the photo → kit wall-clock is the sum of the stage times
  // (stages reused from an earlier run keep the time measured when they actually ran).
  timings.toApprovedHero = timings.upload + timings.analyze + timings.cutout + timings.qa + timings.stage;
  timings.total = timings.toApprovedHero + timings.pack + timings.zip;
  console.log(`  wall-clock this run: ${tDone - tStart} ms (hero approved after ${approvedAt - tStart} ms); photo → kit ${timings.total} ms`);

  const tokens = p.tokens + st.attempts.reduce((s, a) => s + a.tokens, 0);
  return {
    sku: spec.sku,
    title: spec.title,
    sample: true,
    photo: { kind: spec.kind, file: basename(spec.file) },
    product: { ...productRecord(spec.sku, p.raw, p.cutout), understanding: p.understanding },
    mode: "exact",
    scene: st.scene,
    controls: st.controls,
    hero,
    assets,
    ...(reel ? { reel: reel.reel } : {}),
    zipUrl: zip.url,
    cost: {
      generationCredits: 0, // Exact mode: the product is never generated
      creditsSavedByReuse: st.scene.credits, // the library scene was generated once, reused here for free
      aiVisionTokens: tokens,
      transformationsEstimate: txEstimate(st.attempts.length, assets, !!reel),
      bytesOriginal: p.raw.bytes,
      bytesDelivered: delivered.bytes,
      seconds: Math.round(timings.total / 100) / 10,
    },
    createdAt: new Date().toISOString(),
    timings,
    attempts: st.attempts,
    overrides: p.overrides,
    packFailed: pk.status.failed,
  };
}

/** Existing kit, plus a reel if reel.ts has landed since it was built. */
async function keepKit(old: ShowcaseKit, creativeIds: string[]): Promise<ShowcaseKit> {
  if (old.reel || !reelUrl) return old;
  console.log(`\n▶ ${old.sku}: adding reel`);
  const reel = await buildReel(old.sku, old.assets, creativeIds);
  return reel ? { ...old, reel: reel.reel, timings: { ...old.timings, reel: reel.ms } } : old;
}

// ------------------------------------------------------------------ creative

async function runCreative(job: (typeof CREATIVE_JOBS)[number], spent: { credits: number }): Promise<ShowcaseCreative | null> {
  const publicId = creativeId(job.sku, job.model, job.seed);
  const old = prev?.creative.find((c) => c.publicId === publicId);
  const existing = await getResource(publicId);
  const cutout = await getCutout(job.sku);
  if (!cutout) throw new Error(`creative ${job.sku}: no cutout`);
  const request = { endpoint: "POST /v2/generate/{cloud}/image_to_image", body: buildCreativeRequest(job.sku, deliveryUrl(`v${cutout.version ?? 0}/${cutoutId(job.sku)}`), job.model, job.seed, job.prompt) };
  const url = deliveryUrl(publicId, `c_fill,w_${PLATE.width},h_${PLATE.height},g_auto/f_auto,q_auto`);

  if (existing) {
    let qa = qaFromContext(existing.context);
    let qaTokens = Number(existing.context.qa_tokens ?? 0);
    if (!qa) {
      console.log(`  ${publicId}: stored without a verdict, running fidelity QA`);
      const out = await retryPending(() => fidelityQa(job.sku, publicId));
      await addContext([publicId], { ...qaToContext(out.qa), qa_tokens: String(out.tokens) });
      qa = out.qa;
      qaTokens = out.tokens;
    }
    console.log(`  ↺ ${job.model} on ${job.sku}: reused (${qa.status}), 0 credits now`);
    return {
      sku: job.sku,
      model: existing.context.model ?? job.model,
      seed: job.seed,
      prompt: job.prompt,
      publicId,
      url,
      qa,
      sheetUrl: fidelitySheetUrl(job.sku, publicId),
      credits: Number(existing.context.credits ?? old?.credits ?? 0),
      latencyMs: Number(existing.context.latency_ms ?? old?.latencyMs ?? 0),
      qaTokens: qaTokens || old?.qaTokens || 0,
      request: old?.request ?? request,
    };
  }

  const cost = job.model === "nano-banana-2-edit" ? 9 : 1;
  if (spent.credits + cost > GEN_BUDGET) {
    console.log(`  ✗ ${job.model} on ${job.sku}: skipped, would exceed the ${GEN_BUDGET}-credit budget (spent ${spent.credits})`);
    return null;
  }
  const usable = await poolSummary("image_generation");
  if (usable.usable < cost) {
    console.log(`  ✗ ${job.model} on ${job.sku}: skipped, pool has ${usable.usable} usable credits`);
    return null;
  }
  const t0 = now();
  const token = await startCreative({ sku: job.sku, model: job.model, seed: job.seed, prompt: job.prompt, sid: "showcase" });
  const claims = decodeJob(token)!;
  let r: Awaited<ReturnType<typeof pollCreative>> | null = null;
  for (let i = 0; i < 90; i++) {
    r = await pollCreative(claims);
    if (r.status === "completed" || r.status === "failed") break;
    await sleep(2000);
  }
  if (!r || r.status !== "completed" || !r.asset?.qa) throw new Error(`creative ${job.model} on ${job.sku}: ${r?.status} ${r?.error ?? ""}`);
  spent.credits += r.credits ?? cost;
  console.log(`  ✓ ${job.model} on ${job.sku}: ${r.asset.qa.status} credits=${r.credits} latency=${r.latencyMs} ms (with copy + QA ${now() - t0} ms) matched=${JSON.stringify(r.asset.qa.matched)} reasons=${JSON.stringify(r.asset.qa.reasons)}`);
  return {
    sku: job.sku,
    model: r.modelId ?? job.model,
    seed: job.seed,
    prompt: job.prompt,
    publicId,
    url,
    qa: r.asset.qa,
    sheetUrl: fidelitySheetUrl(job.sku, publicId),
    credits: r.credits ?? cost,
    latencyMs: r.latencyMs ?? now() - t0,
    qaTokens: r.tokens ?? 0,
    request: r.request ?? request,
  };
}

// ------------------------------------------------------------------ contact sheets

function label(text: string, size = 20) {
  return `l_text:Arial_${size}_bold:${encodeOverlayText(text)},co_white,b_rgb:000000b0/fl_layer_apply,fl_no_overflow,g_south_west,x_0,y_0`;
}

/** Tiles are w x h, rows are padded to the widest row; ffmpeg needs even sizes and one pixel format. */
function sheet(rows: string[][], out: string, w: number, h: number) {
  const inputs = rows.flat();
  const cols = Math.max(...rows.map((r) => r.length));
  const parts: string[] = [];
  let k = 0;
  const rowLabels: string[] = [];
  rows.forEach((row, ri) => {
    const labels = row.map(() => {
      const l = `t${k}`;
      parts.push(`[${k}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=0x111111,format=rgb24[${l}]`);
      k++;
      return `[${l}]`;
    });
    const rl = `r${ri}`;
    if (labels.length === 1) parts.push(`${labels[0]}pad=${cols * w}:${h}:0:0:color=0x111111[${rl}]`);
    else parts.push(`${labels.join("")}hstack=inputs=${labels.length},pad=${cols * w}:${h}:0:0:color=0x111111[${rl}]`);
    rowLabels.push(`[${rl}]`);
  });
  if (rowLabels.length === 1) parts.push(`${rowLabels[0]}copy[out]`);
  else parts.push(`${rowLabels.join("")}vstack=inputs=${rowLabels.length}[out]`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs.flatMap((f) => ["-i", f]), "-filter_complex", parts.join(";"), "-map", "[out]", "-q:v", "3", out]);
  console.log(`  sheet → ${out}`);
}

async function tile(publicId: string, text: string, file: string, w = 360, h = 450, crop = "c_fill") {
  const t = `${crop},w_${w},h_${h}${crop === "c_pad" ? ",b_rgb:111111" : ""}/${label(text, w < 330 ? 16 : 20)}/f_jpg,q_80`;
  await download(deliveryUrl(publicId, t), file);
  return file;
}

async function contactSheets(data: ShowcaseData) {
  console.log("\n▶ contact sheets");
  const heroes: string[] = [];
  for (const k of data.kits) {
    heroes.push(await tile(k.hero.publicId!, `${k.sku} · ${k.scene!.title} · QA ${k.hero.qa!.status}`, `${TILES}/hero-${k.sku}.jpg`));
  }
  const second: string[] = [];
  for (const c of data.creative) {
    second.push(await tile(c.publicId, `${c.model} · ${c.sku} · ${c.qa.status}`, `${TILES}/creative-${c.model}-${c.sku}.jpg`));
  }
  for (const b of data.beforeAfter) {
    const rawPid = rawId(b.sku);
    second.push(await tile(rawPid, `${b.sku} · raw phone photo`, `${TILES}/raw-${b.sku}.jpg`));
    if (b.alignRaw) {
      await download(deliveryUrl(rawPid, `${b.alignRaw}/c_scale,w_360,h_450/${label(`${b.sku} · raw aligned`)}/f_jpg,q_80`), `${TILES}/rawal-${b.sku}.jpg`);
      second.push(`${TILES}/rawal-${b.sku}.jpg`);
    }
  }
  sheet([heroes, second].filter((r) => r.length), `${VIEW}/showcase-sheet.jpg`, 360, 450);

  // every pack format per kit, letterboxed into squares
  const rows: string[][] = [];
  for (const k of data.kits) {
    const row: string[] = [await tile(k.hero.publicId!, `${k.sku} hero`, `${TILES}/p-${k.sku}-hero.jpg`, 300, 300, "c_pad")];
    for (const a of k.assets) {
      if (!a.publicId) continue;
      row.push(await tile(a.publicId, `${a.id}`, `${TILES}/p-${k.sku}-${a.id}.jpg`, 300, 300, "c_pad"));
    }
    rows.push(row);
  }
  sheet(rows, `${VIEW}/showcase-packs.jpg`, 300, 300);
}

// ------------------------------------------------------------------ preview

async function preview(scenes: Scene[]) {
  const rows: string[][] = [];
  for (const spec of PRODUCTS.filter((s) => selected(s.sku))) {
    const p = await prepareProduct(spec);
    const view = VIEW_FOR_PLACEMENT[p.understanding.placement];
    const row: string[] = [];
    // the cutout on magenta shows holes (e.g. a transparent pouch window) at a glance
    const cf = `${TILES}/pv-${spec.sku}-cutout.jpg`;
    await download(deliveryUrl(cutoutId(spec.sku), `c_pad,w_360,h_450,b_rgb:ff00ff/${label(`${spec.sku} cutout`)}/f_jpg,q_80`), cf);
    row.push(cf);
    for (const s of scenes.filter((x) => x.view === view && (PREFERRED_SCENES.includes(x.publicId) || x.publicId.includes("/final-")))) {
      const built = compose(s, p.cutout, p.understanding.placement, defaultControls(p.understanding.placement, s.dna, p.cutout), { width: 360, format: "f_jpg,q_80" });
      const f = `${TILES}/pv-${spec.sku}-${sceneSlug(s)}.jpg`;
      await download(built.url, f);
      row.push(f);
    }
    rows.push(row);
  }
  sheet(rows, `${VIEW}/preview-sheet.jpg`, 360, 450);
}

// ------------------------------------------------------------------ main

async function main() {
  if (args["sheet-only"]) {
    if (!prev) throw new Error(`${OUT_JSON} not found`);
    await contactSheets(prev);
    return;
  }
  await refreshUsage(true);
  const before = { gen: await poolSummary("image_generation"), vision: await poolSummary("ai_vision") };
  const scenes = await loadScenes();
  console.log(`scene library: ${scenes.length} plates; reel.ts ${reelUrl ? "present" : "absent (reel left undefined; --refresh adds it later)"}`);
  if (args.preview) return preview(scenes);

  // creative first: the approved take joins that product's reel
  const creative: ShowcaseCreative[] = [];
  const spent = { credits: 0 };
  if (!args["no-creative"]) {
    console.log("\n▶ creative takes");
    for (const job of CREATIVE_JOBS) {
      // the sku must be analysed + cut out before image_to_image can use it as the reference
      if (!(await getCutout(job.sku))) await prepareProduct(PRODUCTS.find((s) => s.sku === job.sku)!);
      const c = await runCreative(job, spent);
      if (c) creative.push(c);
    }
  } else if (prev) creative.push(...prev.creative);

  const used = new Map<string, number>();
  const kits: ShowcaseKit[] = [];
  const failures: string[] = [];
  for (const spec of PRODUCTS) {
    const old = prevKit(spec.sku);
    const approvedCreative = creative.filter((c) => c.sku === spec.sku && c.qa.status === "approved").map((c) => c.publicId);
    if (!selected(spec.sku) || (old && !args.refresh)) {
      if (old) {
        kits.push(await keepKit(old, approvedCreative));
        if (old.scene) used.set(old.scene.publicId, (used.get(old.scene.publicId) ?? 0) + 1);
      }
      continue;
    }
    try {
      kits.push(await buildKit(spec, scenes, used, approvedCreative));
    } catch (err) {
      failures.push(`${spec.sku}: ${(err as Error).message}`);
      console.error(`  ✗ ${spec.sku}: ${(err as Error).message}`);
      if (old) kits.push(old); // keep the last good kit rather than dropping it from the shelf
    }
  }

  const beforeAfter: ShowcaseBeforeAfter[] = [];
  for (const spec of PRODUCTS.filter((s) => s.beforeAfter)) {
    const k = kits.find((x) => x.sku === spec.sku);
    if (!k) continue;
    const loc = await locateInRaw(join(args.photos!, spec.file), k.product.cutout!.publicId, k.product.cutout!.width, k.product.cutout!.height);
    const alignRaw = (loc && alignRawTransformation({ width: k.product.rawWidth, height: k.product.rawHeight }, loc, k.product.cutout!, k)) || undefined;
    if (loc) console.log(`  ${spec.sku}: product found in the raw at (${loc.x}, ${loc.y}); alignRaw=${alignRaw ?? "none (would need heavy padding: the hero stages the product much smaller)"}`);
    beforeAfter.push({
      sku: spec.sku,
      rawUrl: deliveryUrl(k.product.rawPublicId, `c_fill,w_${PLATE.width},h_${PLATE.height},g_auto/f_auto,q_auto`),
      heroUrl: k.hero.url,
      alt: `Before: the original phone photo${k.product.caption ? ` (${k.product.caption.replace(/\.$/, "")})` : ""}. After: the same ${k.product.understanding?.name.toLowerCase() ?? "product"}, staged on the ${k.scene!.title} scene.`,
      ...(alignRaw ? { alignRaw, rawAlignedUrl: deliveryUrl(k.product.rawPublicId, `${alignRaw}/c_scale,w_${PLATE.width},h_${PLATE.height}/f_auto,q_auto`) } : {}),
    });
  }

  const data: ShowcaseData = {
    generatedAt: new Date().toISOString(),
    note: "Sample products: synthetic test photos made for this demo, not real seller photos. Every URL points at an asset already stored on the demo cloud.",
    kits,
    creative,
    beforeAfter,
    totals: {
      generationCredits: creative.reduce((s, c) => s + c.credits, 0),
      aiVisionTokens: kits.reduce((s, k) => s + k.cost.aiVisionTokens, 0) + creative.reduce((s, c) => s + c.qaTokens, 0),
      transformationsEstimate: kits.reduce((s, k) => s + k.cost.transformationsEstimate, 0),
      creditsSavedByReuse: kits.reduce((s, k) => s + k.cost.creditsSavedByReuse, 0),
    },
  };
  writeFileSync(OUT_JSON, JSON.stringify(data, null, 2) + "\n");
  console.log(`\n✓ wrote ${OUT_JSON}: ${kits.length} kits, ${creative.length} creative takes, ${beforeAfter.length} before/after`);

  await contactSheets(data);

  await refreshUsage(true);
  const after = { gen: await poolSummary("image_generation"), vision: await poolSummary("ai_vision") };
  console.log("\n== summary");
  for (const k of kits) {
    console.log(
      `${k.sku} ${k.title}: ${k.scene?.title} QA ${k.hero.qa?.status} after ${k.attempts.length} attempt(s); photo→kit ${k.cost.seconds} s; tokens ${k.cost.aiVisionTokens}; tx≈${k.cost.transformationsEstimate}; ${k.cost.bytesOriginal}→${k.cost.bytesDelivered} B; reel ${k.reel ? "yes" : "no"}`,
    );
  }
  for (const c of creative) console.log(`creative ${c.model} on ${c.sku}: ${c.qa.status} (${c.credits} credits, ${c.latencyMs} ms) ${c.qa.reasons.join(" | ")}`);
  console.log(`generation credits spent this run: ${spent.credits}; totals: ${JSON.stringify(data.totals)}`);
  console.log(`pool (live readings, totals only): generation ${before.gen.remaining}→${after.gen.remaining}, ai_vision ${before.vision.remaining}→${after.vision.remaining}`);
  console.log(`exact-QA tokens this run: ${qaBudget.used}`);
  if (failures.length) {
    console.error(`\n${failures.length} kit(s) failed:\n  ${failures.join("\n  ")}`);
    process.exitCode = 1;
  }
}

await main();
