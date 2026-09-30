import "server-only";
import { getAccounts, type CloudinaryAccount } from "../cloudinary/accounts";
import { ensurePoolCopy, forgetPoolCopy, poolCopyId, poolDeliveryUrl } from "../cloudinary/offload";
import { bench, isQuotaError, QuotaError, rankAccounts } from "../cloudinary/pool";
import { scrubSecrets } from "../cloudinary/safe";
import { layerId } from "../transform/composite";
import type { KitAsset } from "../types";
import { deliveryBase, deliveryUrl, probe, sleep } from "./cld";
import { pinJpeg } from "./guard";

/**
 * Offload: render a live kit's AI transformations on a key-pool account, store
 * the results in main (S2S_OFFLOAD_POOL=1; off by default, nothing changes).
 *
 * Main's transformation credits are the scarce resource (a kit derives ~186 on
 * main: background removal 75, generative fill 2 × 50, recolor 50 each; a messy
 * photo's retouch adds gen remove 50 / gen restore 100 / upscale 10-100 / enhance
 * 100). With the flag on, for the cutout, an AI retouch chain and every
 * generative pack format:
 *   1. the pool account gets a plain copy of the source (upload by URL of main's
 *      original: bandwidth, no transformation on main; lib/cloudinary/offload.ts),
 *   2. it derives the same chain on its own credits,
 *   3. main stores the finished image by URL under the SAME public id, tags and
 *      context as before, so overlays, facts, the kit page, the ZIP and QA are
 *      unchanged. Main then only derives ordinary f_auto / width variants of it.
 *
 * Account choice: rankAccounts("transformations"): pool accounts only, most
 * plan credits left first, never below the floor; an account that fails is
 * benched (1 h on quota errors, 10 min otherwise) and the next one is tried.
 * Renders already under way stay on the account that started them. If no pool
 * account can do it (none configured, all benched or failing, a 400 about this
 * image, main unable to store the result), the caller runs today's main path:
 * a kit never fails because of offload.
 *
 * Latency: analyze starts the cutout's pool render next to its AI Vision calls
 * (prewarmCutout), and a pack's generative formats share one pool copy of the
 * hero and render in parallel.
 *
 * Upload API and delivery only: no Admin API call (the usage reading behind the
 * ranking is the one the credit floor already refreshes). Pool URLs and cloud
 * names stay on the server: they are only fetched (probe, main's upload by URL)
 * and logged by label.
 */

export const offloadEnabled = () => process.env.S2S_OFFLOAD_POOL === "1";

/** Plan credits one render is estimated to take on the pool account (ranking floor check). */
export const OFFLOAD_COST = { cutout: 0.08, format: 0.06, retouch: 0.15 } as const;

/** Effects billed at 10-100+ transformations each (documented counts, lib/server/cost.ts TX). */
const EXPENSIVE = /(?:^|[/,])(?:b_gen_fill|e_gen_[a-z_]+|e_background_removal|e_upscale|e_enhance)(?=$|[,/:;])/;
export const isExpensiveTransformation = (t: string) => EXPENSIVE.test(t);

/**
 * The transformation of a main recipe URL `<main delivery base>/<t>/<source>`,
 * rewritten to run on the pool copy of `source`; null when it isn't expensive or
 * can't run there: named transformations (t_) exist on main only, and image
 * layers other than `source` itself (rewritten to its pool copy) aren't copied.
 */
export function poolRecipe(url: string, source: string): string | null {
  const head = `${deliveryBase()}/`;
  const tail = `/${source}`;
  if (!url.startsWith(head) || !url.endsWith(tail) || url.length <= head.length + tail.length) return null;
  const t = url.slice(head.length, url.length - tail.length);
  if (!isExpensiveTransformation(t) || /(?:^|[/,])t_/.test(t)) return null;
  let portable = true;
  const out = t.replace(/(^|[/,])([lu])_([^,/]+)/g, (m, pre: string, kind: string, id: string) => {
    if (kind === "l" && id.startsWith("text:")) return m;
    if (id === layerId(source)) return `${pre}${kind}_${layerId(poolCopyId(source))}`;
    portable = false;
    return m;
  });
  return portable ? out : null;
}

// ------------------------------------------------------------------ account choice

const QUOTA_BENCH_MS = 60 * 60_000;
const ERROR_BENCH_MS = 10 * 60_000;
/** Below this much budget an attempt isn't started: the caller answers "pending" and the client retries. */
const MIN_ATTEMPT_MS = 1500;

/** Per Node process: main source id → pool account label, so renders under way are polled where they started. */
const G = globalThis as unknown as { __s2sOffloadPicks?: Map<string, string> };
const picks: Map<string, string> = (G.__s2sOffloadPicks ??= new Map());

async function candidates(key: string, cost: number): Promise<CloudinaryAccount[]> {
  const ranked = (await rankAccounts("transformations", cost)).filter((a) => !a.isMain);
  const sticky = picks.get(key);
  const i = sticky ? ranked.findIndex((a) => a.label === sticky) : -1;
  return i > 0 ? [ranked[i], ...ranked.slice(0, i), ...ranked.slice(i + 1)] : ranked;
}

/** Log text without secrets or pool cloud names (labels only). */
function clean(s: string): string {
  let out = scrubSecrets(s);
  for (const a of getAccounts()) if (!a.isMain && a.cloudName) out = out.split(a.cloudName).join(a.label);
  // "Invalid Signature <hex>. String to sign - …": the echoed request signature is not needed in a log
  return out.replace(/(signature\s+)[0-9a-f]{16,}/gi, "$1[redacted]").replace(/[\r\n]+/g, " ").slice(0, 200);
}
const msgOf = (err: unknown) => clean(String((err as Error)?.message ?? err));

/** Main's upload of the finished image failed: main's side, the pool account is not to blame. */
class SaveError extends Error {
  constructor(readonly original: unknown) {
    super(String((original as Error)?.message ?? original));
  }
}
const httpCode = (err: unknown) => (err as { http_code?: number; status?: number })?.http_code ?? (err as { status?: number })?.status;
/**
 * The derivation answered 400 (e.g. "Invalid input for gen_recolor": the named
 * part isn't found in this photo). It's about this image, not the account: no
 * bench, no second pool account; main's path decides, exactly as without offload.
 */
class InputError extends Error {}

/**
 * Run `attempt` on the best pool account, then the next one on failure (the
 * failing account is benched). "pending" = still rendering / out of time (the
 * client retries); null = not offloaded, the caller renders on main.
 */
async function onPool<T>(what: string, key: string, cost: number, deadline: number, attempt: (a: CloudinaryAccount) => Promise<T | "pending">): Promise<T | "pending" | null> {
  let list: CloudinaryAccount[];
  try {
    list = await candidates(key, cost);
  } catch (err) {
    console.warn(`[offload] ${what}: no pool ranking (${msgOf(err)}); main renders it`);
    return null;
  }
  if (!list.length) {
    console.warn(`[offload] ${what}: no pool account available; main renders it`);
    return null;
  }
  for (const [n, account] of list.entries()) {
    if (deadline - Date.now() < MIN_ATTEMPT_MS) return "pending";
    const t0 = Date.now();
    try {
      picks.set(key, account.label);
      if (picks.size > 1000) picks.delete(picks.keys().next().value as string);
      const r = await attempt(account);
      if (r !== "pending") console.info(`[offload] ${what}: rendered on ${account.label}, stored on main (${Date.now() - t0} ms)`);
      return r;
    } catch (err) {
      if (picks.get(key) === account.label) picks.delete(key);
      if (err instanceof SaveError) {
        // main's Upload API is rate limited: rendering on main would fail at the same upload, so answer
        // exactly as without offload (the route maps it to "pending" / quota_low) instead of spending main's credits
        if (httpCode(err.original) === 420 || httpCode(err.original) === 429) throw err.original;
        console.warn(`[offload] ${what}: main could not store the ${account.label} render (${msgOf(err)}); main renders it`);
        return null;
      }
      if (err instanceof InputError) {
        console.warn(`[offload] ${what}: ${account.label} rejected this input (${msgOf(err)}); main's path decides`);
        return null;
      }
      bench(account, "transformations", isQuotaError(err) ? QUOTA_BENCH_MS : ERROR_BENCH_MS);
      forgetPoolCopy(account, key); // when it's back, re-check the copy instead of trusting this process's memo
      console.warn(`[offload] ${what}: ${account.label} failed (${msgOf(err)}); ${n + 1 < list.length ? "trying the next pool account" : "main renders it"}`);
    }
  }
  return null;
}

type Probe = "ready" | "pending";

/**
 * Wait for a pool derivation: 200 ready; 423 (still processing) or a timeout is
 * "pending" once the deadline passes. `loop` keeps probing every 1.5 s until then
 * (the cutout; a pack poll probes once, like main's materialiser). Anything else
 * throws: 420 / 429 as a quota error (the account is out of credits or throttled),
 * 400 as an InputError (this image), the rest as an account failure.
 */
async function waitDerived(url: string, deadline: number, loop: boolean): Promise<Probe> {
  for (;;) {
    const left = deadline - Date.now();
    if (left < 1000) return "pending";
    const p = await probe(url, Math.max(1000, left - (loop ? 0 : 1000)));
    if (p.status === 200) return "ready";
    if (p.status === 420 || p.status === 429) throw new QuotaError(`delivery HTTP ${p.status} ${p.error ?? ""}`.trim(), p.status);
    if (p.status === 400) throw new InputError(`delivery HTTP 400 ${p.error ?? ""}`.trim());
    if (p.status !== 423 && p.status !== 0) throw new Error(`delivery HTTP ${p.status} ${p.error ?? ""}`.trim());
    if (!loop || deadline - Date.now() < 2500) return "pending";
    await sleep(1500);
  }
}

async function saveOrMark<T>(save: (src: string) => Promise<T>, src: string): Promise<T> {
  try {
    return await save(src);
  } catch (err) {
    throw new SaveError(err);
  }
}

// ------------------------------------------------------------------ public hooks

/** `chain` on a pool copy of `source`, then `save(poolUrl)` stores the result on main. */
function offloadChain<T>(what: string, cost: number, loop: boolean, o: { source: string; chain: string; deadline: number; save: (src: string) => Promise<T> }): Promise<T | "pending" | null> {
  return onPool(what, o.source, cost, o.deadline, async (account) => {
    const copy = await ensurePoolCopy(account, deliveryUrl(o.source), o.source);
    const src = poolDeliveryUrl(account, o.chain, copy);
    if ((await waitDerived(src, o.deadline, loop)) === "pending") return "pending";
    return saveOrMark(o.save, src);
  });
}

/**
 * Cutout: `chain` (background removal + trim) on a pool copy of `source`, then
 * `save(poolUrl)` stores it on main. Returns save's result, "pending", or null
 * (flag off / no pool account / pool failed → main path).
 */
export async function offloadCutout<T>(o: { source: string; chain: string; deadline: number; save: (src: string) => Promise<T> }): Promise<T | "pending" | null> {
  if (!offloadEnabled()) return null;
  return offloadChain("cutout", OFFLOAD_COST.cutout, true, o);
}

/**
 * Q4 auto-retouch: when the planned chain has an AI effect (e_gen_remove,
 * e_gen_restore, e_upscale, e_enhance), render it on a pool copy of the raw and
 * `save(poolUrl)` the JPEG snapshot on main. A cheap chain (e_improve alone, 1 tx)
 * stays on main. One probe per call, like main's path: the first call (which also
 * planned) only needs to start the render; the client's polls finish it.
 * `tx` = the plan's documented transformation estimate (ranks against the floor).
 * Returns save's result, "pending", or null (flag off / cheap chain / no pool
 * account / pool failed → main path).
 */
export async function offloadRetouch<T>(o: { source: string; chain: string; tx: number; deadline: number; save: (src: string) => Promise<T> }): Promise<T | "pending" | null> {
  if (!offloadEnabled() || !isExpensiveTransformation(o.chain) || /(?:^|[/,])(?:[lu]|t)_/.test(o.chain)) return null;
  const cost = o.tx > 0 ? Math.max(0.01, o.tx / 1000) : OFFLOAD_COST.retouch;
  return offloadChain("retouch", cost, false, o);
}

/**
 * Start the cutout's pool render early, while analyze waits on AI Vision (≈4 s):
 * copy `source` to the pool account the cutout will use and send one HEAD, which
 * starts the derivation (it continues after the HEAD gives up), so POST /cutout
 * later finds it ready. Best effort: never throws, never takes longer than `capMs`.
 * If the cutout ends up cut from another source (a retouched photo), only pool
 * credits were spent.
 */
export async function prewarmCutout(source: string, chain: string, capMs = 3500): Promise<void> {
  if (!offloadEnabled()) return;
  const work = (async () => {
    const [account] = await candidates(source, OFFLOAD_COST.cutout);
    if (!account) return;
    picks.set(source, account.label);
    const copy = await ensurePoolCopy(account, deliveryUrl(source), source);
    await probe(poolDeliveryUrl(account, chain, copy), 800);
  })().catch((err: unknown) => console.warn(`[offload] cutout prewarm: ${msgOf(err)}`));
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise<void>((r) => (timer = setTimeout(r, capMs)))]);
  clearTimeout(timer);
}

/**
 * Pack format: when its recipe is generative (b_gen_fill, e_gen_*), render it on
 * a pool copy of the hero, pinned to JPEG like main's materialiser, then
 * `save(poolUrl)` stores it on main. Returns save's result, "pending", or null
 * (flag off / not generative / no pool account / pool failed → main path).
 */
export async function offloadPackFormat<T>(o: { asset: Pick<KitAsset, "id" | "url">; hero: string; deadline: number; save: (src: string) => Promise<T> }): Promise<T | "pending" | null> {
  if (!offloadEnabled()) return null;
  const t = poolRecipe(o.asset.url, o.hero);
  if (!t) return null;
  return onPool(`pack ${o.asset.id}`, o.hero, OFFLOAD_COST.format, o.deadline, async (account) => {
    const copy = await ensurePoolCopy(account, deliveryUrl(o.hero), o.hero);
    const src = pinJpeg(poolDeliveryUrl(account, t, copy));
    if ((await waitDerived(src, o.deadline, false)) === "pending") return "pending";
    return saveOrMark(o.save, src);
  });
}

/** Test hook. */
export function __resetOffloadState(): void {
  picks.clear();
}
