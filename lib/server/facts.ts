import "server-only";
import { productId, type Sku } from "../types";
import { addContext, addTags, assetInfo, getResource, mainCloud, uploadRawJson, type AssetInfo, type Ctx, type ExplicitInfo } from "./cld";
import { notFound } from "./http";

/**
 * Product facts: the pipeline's state for one product, kept WITHOUT the Admin API.
 *
 * Why: the Free plan allows 500 Admin API calls/hour and every pipeline route
 * used to read the raw asset's context (Admin `resource`) and list the product
 * folder (Admin `resources`), about 20 calls per kit. Context can't be read
 * through the Upload API, and the client-side list JSON is CDN-cached for ~60 s,
 * too stale for "has the pack started?" or "was this photo analysed?".
 *
 * So the state lives in a tiny raw JSON asset per product,
 * snap2shelf/products/<sku>/facts.json:
 *   write  uploader.upload (Upload API, overwrite)                     → new version
 *   read   uploader.explicit (Upload API) → version → GET the versioned
 *          CDN URL /raw/upload/v<version>/…/facts.json (a new version is a
 *          new cache key, so the read is always fresh; ~0.2-0.4 s)
 * Both are Upload / delivery calls: zero Admin API calls per kit, and they kept
 * working during the 30 Sep Admin 420. Raw files are not image
 * transformations, so this costs no transformation credits.
 *
 * `ctx` mirrors the raw asset's context keys, which are still written too
 * (add_context, Upload API): the public tag lists (kit page) and older tooling
 * read them, and they are the recovery source if a facts write ever fails.
 * The facts doc is written only by the server (signed upload); the client can
 * neither write it nor choose its public id. Tampering is therefore not a
 * concern, and nothing in it is secret (same data as the raw's context).
 *
 * Products processed before facts existed are migrated once, on first use:
 * from the public `s2s-sku-<sku>` tag list (no Admin call), plus one Admin
 * lookup of the raw's context only when the raw is older than FACTS_EPOCH_S and
 * isn't in that list.
 */

export const FACTS_SCHEMA = 1;
export const factsId = (sku: Sku) => productId(sku, "facts.json");
const rawIdOf = (sku: Sku) => productId(sku, "raw");
const skuTagOf = (sku: Sku) => `s2s-sku-${sku}`;

/** Raws uploaded before this (Unix s, 30 Sep 2026 06:00 UTC) may carry state only in Admin-readable context. */
export const FACTS_EPOCH_S = 1_790_748_000;

export interface RawFacts {
  width: number;
  height: number;
  bytes: number;
  format: string;
  version: number;
  createdAt: string;
}

/** A derived asset the pipeline saved (cutout, retouched, hero, creative). */
export interface AssetFacts {
  publicId: string;
  width: number;
  height: number;
  version: number;
  bytes?: number;
  at: number; // saved at (ms)
  ctx?: Ctx; // the asset's own context (creative: model, credits, qa_*; cutout: ms, source)
}

/** A materialised pack format: version for the delivery URL, h = hash of the recipe it was made from. */
export interface PackDone {
  v: number;
  at: number;
  h?: string; // absent for packs migrated from before facts existed
}

export interface ProductFacts {
  s: typeof FACTS_SCHEMA;
  sku: string;
  ctx: Ctx;
  raw?: RawFacts;
  cutout?: AssetFacts;
  retouched?: AssetFacts;
  creatives?: Record<string, AssetFacts>; // creative id (creative-<model>-<seed>) → asset
  heroes?: Record<string, AssetFacts>; // hero public id → asset
  pack?: { hero: string; done: Record<string, PackDone> };
  migrated?: "list" | "admin";
  at: number;
}

export const emptyFacts = (sku: Sku, raw?: RawFacts): ProductFacts => ({ s: FACTS_SCHEMA, sku, ctx: {}, ...(raw ? { raw } : {}), at: 0 });

const rawFactsOf = (a: ExplicitInfo): RawFacts => ({
  width: a.width,
  height: a.height,
  bytes: a.bytes,
  format: a.format,
  version: a.version,
  createdAt: a.createdAt || new Date(a.version * 1000).toISOString(),
});

/** Same cleaning addContext applies, so facts and the mirrored context hold identical strings. */
export function cleanCtx(ctx: Ctx): Ctx {
  const out: Ctx = {};
  for (const [k, v] of Object.entries(ctx)) out[k] = String(v).replace(/[\r\n]+/g, " ").slice(0, 900);
  return out;
}

const isStrMap = (v: unknown): v is Ctx => !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");

/** Validate a fetched document (defensive: a broken doc must not crash a route). */
export function parseFacts(json: unknown, sku: Sku): ProductFacts | null {
  const j = json as Partial<ProductFacts> | null;
  if (!j || typeof j !== "object" || j.s !== FACTS_SCHEMA || j.sku !== sku || !isStrMap(j.ctx)) return null;
  return j as ProductFacts;
}

// ------------------------------------------------------------------ in-process cache

interface Entry {
  facts: ProductFacts;
  version: number;
}
const MAX_CACHE = 400;
/** Per Node process (globalThis), shared by every route bundle, like the per-sku write lock below. */
const G = globalThis as unknown as { __s2sFacts?: { cache: Map<string, Entry>; raw: Map<string, RawFacts>; noLegacy: Set<string>; locks: Map<string, Promise<unknown>> } };
const F = (G.__s2sFacts ??= { cache: new Map(), raw: new Map(), noLegacy: new Set(), locks: new Map() });
const cache = F.cache;
const rawCache = F.raw; // raws are immutable (preset overwrite: false)
const noLegacy = F.noLegacy;

function remember<K, V>(m: Map<K, V>, k: K, v: V) {
  m.delete(k);
  m.set(k, v);
  if (m.size > MAX_CACHE) m.delete(m.keys().next().value as K);
}

/** Test hook. */
export function __resetFactsCache(): void {
  cache.clear();
  rawCache.clear();
  noLegacy.clear();
  locks.clear();
}

// ------------------------------------------------------------------ read

const factsUrl = (sku: Sku, version: number) => `https://res.cloudinary.com/${mainCloud()}/raw/upload/v${version}/${factsId(sku)}`;

async function fetchDoc(sku: Sku, version: number): Promise<ProductFacts> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(factsUrl(sku, version), { cache: "no-store", signal: AbortSignal.timeout(5000) });
      lastStatus = res.status;
      if (res.ok) {
        const doc = parseFacts(await res.json(), sku);
        if (doc) return doc;
        throw new Error("facts document is malformed");
      }
    } catch (err) {
      if (attempt === 2) throw new Error(`facts read failed: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
    }
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
  // Never treat an unreadable doc as "no facts": a later write would clobber real state.
  throw new Error(`facts read failed: HTTP ${lastStatus}`);
}

/** Latest facts doc (null = none yet) and its version. One explicit call, plus one CDN GET when it changed. */
export async function readFacts(sku: Sku): Promise<{ facts: ProductFacts | null; version: number }> {
  const info = await assetInfo(factsId(sku), "raw");
  if (!info) return { facts: null, version: 0 };
  const hit = cache.get(sku);
  if (hit && hit.version === info.version) return hit;
  const facts = await fetchDoc(sku, info.version);
  remember(cache, sku, { facts, version: info.version });
  return { facts, version: info.version };
}

export interface LoadedProduct {
  /** The raw upload, with `context` = facts.ctx (same keys the raw asset's context has). */
  raw: AssetInfo;
  facts: ProductFacts;
  version: number; // facts doc version (0 = not written yet)
}

export function rawAsset(sku: Sku, raw: RawFacts, ctx: Ctx): AssetInfo {
  return {
    publicId: rawIdOf(sku),
    assetId: "",
    version: raw.version,
    width: raw.width,
    height: raw.height,
    bytes: raw.bytes,
    format: raw.format,
    secureUrl: `https://res.cloudinary.com/${mainCloud()}/image/upload/v${raw.version}/${rawIdOf(sku)}.${raw.format || "jpg"}`,
    tags: [],
    context: ctx,
  };
}

/**
 * The product's raw + facts without any Admin API call: explicit(facts.json)
 * (+ explicit(raw) the first time this instance sees the sku). 404 when the raw
 * hasn't been uploaded.
 */
export async function loadProduct(sku: Sku): Promise<LoadedProduct> {
  const knownRaw = rawCache.get(sku);
  const [read, info] = await Promise.all([readFacts(sku), knownRaw ? Promise.resolve(null) : assetInfo(rawIdOf(sku))]);
  const raw = read.facts?.raw ?? knownRaw ?? (info ? rawFactsOf(info) : null);
  if (!raw) throw notFound("No upload found for this product yet.");
  remember(rawCache, sku, raw);
  let facts = read.facts;
  let version = read.version;
  if (!facts) ({ facts, version } = await migrateLegacy(sku, raw));
  if (!facts.raw) facts = { ...facts, raw };
  return { raw: rawAsset(sku, raw, facts.ctx), facts, version };
}

// ------------------------------------------------------------------ legacy migration

interface ListResource {
  public_id: string;
  version?: number;
  width?: number;
  height?: number;
  bytes?: number;
  format?: string;
  created_at?: string;
  context?: { custom?: Ctx };
}

/** Facts from a product's public tag list (pure; unit-tested). */
export function factsFromList(sku: Sku, list: ListResource[], raw?: RawFacts): ProductFacts {
  const base = productId(sku, "");
  const f = emptyFacts(sku, raw);
  const asset = (r: ListResource): AssetFacts => ({
    publicId: r.public_id,
    width: Number(r.width ?? 0),
    height: Number(r.height ?? 0),
    version: Number(r.version ?? 0),
    ...(r.bytes ? { bytes: Number(r.bytes) } : {}),
    at: Date.parse(r.created_at ?? "") || Number(r.version ?? 0) * 1000,
    ...(r.context?.custom ? { ctx: { ...r.context.custom } } : {}),
  });
  const packs: ListResource[] = [];
  for (const r of list) {
    if (!r.public_id?.startsWith(base)) continue;
    const leaf = r.public_id.slice(base.length);
    if (leaf === "raw") f.ctx = { ...(r.context?.custom ?? {}) };
    else if (leaf === "cutout") f.cutout = asset(r);
    else if (leaf === "retouched") f.retouched = asset(r);
    else if (/^hero-[^/]+$/.test(leaf)) (f.heroes ??= {})[r.public_id] = asset(r);
    else if (/^creative-[^/]+$/.test(leaf)) (f.creatives ??= {})[leaf] = asset(r);
    else if (/^pack\/[^/]+$/.test(leaf)) packs.push(r);
  }
  const hero = f.ctx.hero;
  if (hero) {
    const done: Record<string, PackDone> = {};
    for (const r of packs) {
      if (r.context?.custom?.hero !== hero) continue;
      done[r.public_id.slice(base.length + "pack/".length)] = { v: Number(r.version ?? 0), at: Date.parse(r.created_at ?? "") || 0 };
    }
    f.pack = { hero, done };
  }
  return f;
}

/** Context keys a signed upload may set on the raw (lib/server/upload-sign.ts): not pipeline state. */
const UPLOAD_CONTEXT_KEYS = new Set(["origin", "capture"]);

/** Did code before facts existed leave any state for this product? (pure; unit-tested) */
export function hasPipelineState(f: ProductFacts): boolean {
  return Object.keys(f.ctx).some((k) => !UPLOAD_CONTEXT_KEYS.has(k)) || Boolean(f.cutout || f.retouched || f.heroes || f.creatives || f.pack);
}

async function tagList(tag: string): Promise<ListResource[]> {
  try {
    const res = await fetch(`https://res.cloudinary.com/${mainCloud()}/image/list/${tag}.json`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    return ((await res.json()) as { resources?: ListResource[] }).resources ?? [];
  } catch {
    return [];
  }
}

async function migrateLegacy(sku: Sku, raw: RawFacts): Promise<{ facts: ProductFacts; version: number }> {
  if (noLegacy.has(sku)) return { facts: emptyFacts(sku, raw), version: 0 };
  const list = await tagList(skuTagOf(sku));
  const facts = factsFromList(sku, list, raw);
  let source: ProductFacts["migrated"] = list.length ? "list" : undefined;
  if (!list.some((r) => r.public_id === rawIdOf(sku)) && raw.version < FACTS_EPOCH_S) {
    // Old raw that isn't in the tag list: its context (analysis, pack spec) is only readable via Admin, once.
    try {
      const a = await getResource(rawIdOf(sku));
      if (a && Object.keys(a.context).length) {
        facts.ctx = { ...a.context };
        source = "admin";
        if (a.context.hero && !facts.pack) facts.pack = { hero: a.context.hero, done: {} };
      }
    } catch (err) {
      console.warn(`[facts] ${sku}: legacy context unavailable (${String((err as Error)?.message ?? err).slice(0, 120)})`);
    }
  }
  if (!hasPipelineState(facts)) {
    // A fresh upload (its only context is what the upload itself set): nothing to migrate or write.
    if (raw.version >= FACTS_EPOCH_S) {
      noLegacy.add(sku);
      if (noLegacy.size > MAX_CACHE) noLegacy.delete(noLegacy.values().next().value as string);
    }
    return { facts, version: 0 };
  }
  facts.migrated = source;
  facts.at = Date.now();
  try {
    const { version } = await uploadRawJson(factsId(sku), facts);
    remember(cache, sku, { facts, version });
    console.info(`[facts] ${sku}: migrated from ${source}`);
    return { facts, version };
  } catch (err) {
    console.warn(`[facts] ${sku}: migration not saved (${String((err as Error)?.message ?? err).slice(0, 120)})`);
    return { facts, version: 0 };
  }
}

// ------------------------------------------------------------------ write

const locks = F.locks;

export interface FactsPatch {
  /** Keys merged into facts.ctx AND mirrored to the raw asset's context (add_context). */
  ctx?: Ctx;
  /** Structured changes (cutout, pack, heroes, creatives…) on a fresh copy of the latest doc. */
  mutate?: (f: ProductFacts) => void;
}

/**
 * Read-modify-write the product's facts (latest version, serialised per sku in
 * this process), mirroring `ctx` into the raw's context in parallel. `critical`
 * writes (pack spec, cutout) throw when the doc can't be saved; bookkeeping
 * (cost ledger, brief cache) only logs.
 */
export async function updateProduct(sku: Sku, patch: FactsPatch, opts: { critical?: boolean } = {}): Promise<ProductFacts | null> {
  const critical = opts.critical ?? true;
  const ctx = patch.ctx ? cleanCtx(patch.ctx) : null;
  const prev = locks.get(sku) ?? Promise.resolve();
  const run = prev.then(async () => {
    const mirror = ctx && Object.keys(ctx).length
      ? addContext([rawIdOf(sku)], ctx).catch((err: unknown) => console.warn(`[facts] ${sku}: context mirror failed (${String((err as Error)?.message ?? err).slice(0, 120)})`))
      : Promise.resolve();
    try {
      const cur = await readFacts(sku);
      if (!cur.facts && !rawCache.get(sku)) {
        // Never create a facts doc for a product that was never uploaded (e.g. a made-up sku in a bookkeeping call).
        const info = await assetInfo(rawIdOf(sku));
        if (!info) throw notFound("No upload found for this product yet.");
        remember(rawCache, sku, rawFactsOf(info));
      }
      const base: ProductFacts = cur.facts ?? emptyFacts(sku, rawCache.get(sku));
      const next: ProductFacts = structuredClone(base);
      if (!next.raw && rawCache.get(sku)) next.raw = rawCache.get(sku);
      if (ctx) Object.assign(next.ctx, ctx);
      patch.mutate?.(next);
      next.at = Date.now();
      let saved: { version: number } | null = null;
      for (let attempt = 0; attempt < 2 && !saved; attempt++) {
        try {
          saved = await uploadRawJson(factsId(sku), next);
        } catch (err) {
          if (attempt === 1) throw err;
        }
      }
      remember(cache, sku, { facts: next, version: saved!.version });
      noLegacy.delete(sku);
      if (cur.version === 0) {
        // First doc for this product: tag the raw so the public s2s-sku list (kit page, recovery) includes it.
        void addTags([rawIdOf(sku)], [skuTagOf(sku)]).catch(() => undefined);
      }
      return next;
    } catch (err) {
      console.error(`[facts] ${sku}: write failed (${String((err as Error)?.message ?? err).slice(0, 160)})`);
      if (critical) throw err;
      return null;
    } finally {
      await mirror;
    }
  });
  const tail = run.catch(() => undefined);
  locks.set(sku, tail);
  void tail.then(() => {
    if (locks.get(sku) === tail) locks.delete(sku);
  });
  return run;
}
