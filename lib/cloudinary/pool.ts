import "server-only";
import { basicAuth, getAccounts, type CloudinaryAccount } from "./accounts";

/**
 * Key pool for add-on quota.
 *
 * Image generation and AI Vision calls may run on any configured product
 * environment (main + CLOUDINARY_POOL_<n>_*). Each call goes to the account with
 * the most remaining quota for that capability; accounts at or below the floor
 * are skipped, and an account that answers with a quota error is benched and
 * the call moves on to the next one. Generated results are copied into `main`
 * by the caller (see copyToMain), so storage, layers, search and delivery all
 * live in one place.
 *
 * Quota knowledge comes from two sources:
 *  - Admin API `usage` (per add-on {usage, limit}); refreshed at most every
 *    10 minutes, but Cloudinary only recomputes it about once a day.
 *  - The `limits` block returned by each generate / analyze response, which is
 *    real time. recordQuota() stores it; the lower of the two estimates wins.
 *
 * State is per server instance. On serverless that means each instance learns
 * independently, which is fine: the worst case is one extra quota error that
 * benches the account on that instance.
 */

/**
 * Add-on quotas the pool balances. `object_detection` is the quota type that the
 * captioning endpoint reports (AI Content Analysis, 500 detections/month on Free).
 */
export type PooledCapability = "image_generation" | "ai_vision" | "object_detection";

export interface QuotaSnapshot {
  limit: number | null;
  used: number | null;
  remaining: number | null;
  at: number;
}

/** Units that must stay unused on each account before it stops receiving work. */
export const QUOTA_FLOOR: Record<PooledCapability, number> = {
  image_generation: 2,
  ai_vision: 2_000,
  object_detection: 5,
};

const USAGE_TTL_MS = 10 * 60_000;
const BENCH_MS = 60 * 60_000;

interface AccountState {
  usage?: QuotaSnapshot;
  live?: QuotaSnapshot;
  benchedUntil?: number;
}

const state = new Map<string, AccountState>();
let usageFetchedAt = 0;
let usageInFlight: Promise<void> | null = null;

const stateKey = (label: string, cap: PooledCapability) => `${label}:${cap}`;
const getState = (label: string, cap: PooledCapability) => {
  const k = stateKey(label, cap);
  let s = state.get(k);
  if (!s) state.set(k, (s = {}));
  return s;
};

export class PoolExhaustedError extends Error {
  constructor(public readonly capability: PooledCapability) {
    super(`No Cloudinary account has ${capability} quota left above the floor.`);
    this.name = "PoolExhaustedError";
  }
}

/** Thrown by pooled calls when an account reports it is out of quota (or rate limited). */
export class QuotaError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "QuotaError";
  }
}

const QUOTA_PATTERN = /quota|limit (?:exceeded|reached)|exceeded|insufficient|not enough credits|upgrade your plan/i;

export function isQuotaError(err: unknown): boolean {
  if (err instanceof QuotaError) return true;
  const status = (err as { status?: number })?.status;
  if (status === 402 || status === 429) return true;
  const message = err instanceof Error ? err.message : String(err ?? "");
  return (status === 400 || status === 403 || status === undefined) && QUOTA_PATTERN.test(message);
}

function remainingOf(s: AccountState): number | null {
  const estimates = [s.usage?.remaining, s.live?.remaining].filter((n): n is number => typeof n === "number");
  return estimates.length ? Math.min(...estimates) : null;
}

/** Store a real-time quota reading taken from a generate / analyze response. */
export function recordQuota(account: CloudinaryAccount | string, cap: PooledCapability, q: Partial<QuotaSnapshot>): void {
  const label = typeof account === "string" ? account : account.label;
  const s = getState(label, cap);
  const limit = q.limit ?? s.live?.limit ?? s.usage?.limit ?? null;
  const used = q.used ?? null;
  const remaining = q.remaining ?? (limit !== null && used !== null ? Math.max(0, limit - used) : null);
  s.live = { limit, used, remaining, at: Date.now() };
}

/** Take an account out of rotation for a capability (after a quota error). */
export function bench(account: CloudinaryAccount | string, cap: PooledCapability, ms = BENCH_MS): void {
  const label = typeof account === "string" ? account : account.label;
  getState(label, cap).benchedUntil = Date.now() + ms;
}

async function fetchUsage(account: CloudinaryAccount): Promise<void> {
  const res = await fetch(`https://api.cloudinary.com/v1_1/${account.cloudName}/usage`, {
    headers: { Authorization: basicAuth(account) },
    cache: "no-store",
  });
  if (!res.ok) return; // keep whatever we knew; a failing usage call must not block generation
  const body = (await res.json()) as Record<string, { usage?: number; limit?: number } | unknown>;
  for (const cap of ["image_generation", "ai_vision", "object_detection"] as const) {
    const entry = body[cap] as { usage?: number; limit?: number } | undefined;
    if (!entry || typeof entry.limit !== "number") continue;
    const used = typeof entry.usage === "number" ? entry.usage : 0;
    getState(account.label, cap).usage = {
      limit: entry.limit,
      used,
      remaining: Math.max(0, entry.limit - used),
      at: Date.now(),
    };
  }
}

export async function refreshUsage(force = false): Promise<void> {
  if (!force && Date.now() - usageFetchedAt < USAGE_TTL_MS) return;
  if (!usageInFlight) {
    usageInFlight = Promise.allSettled(getAccounts().map(fetchUsage))
      .then(() => {
        usageFetchedAt = Date.now();
      })
      .finally(() => {
        usageInFlight = null;
      });
  }
  await usageInFlight;
}

/**
 * Accounts eligible for a capability, best first: most remaining quota, then
 * main before pool accounts (a result made on main needs no copy step).
 * Accounts whose quota is unknown stay eligible but rank last.
 */
export async function rankAccounts(cap: PooledCapability, cost = 1): Promise<CloudinaryAccount[]> {
  await refreshUsage();
  const now = Date.now();
  return getAccounts()
    .map((account, order) => ({ account, order, s: getState(account.label, cap) }))
    .filter(({ s }) => (s.benchedUntil ?? 0) <= now)
    .map((x) => ({ ...x, remaining: remainingOf(x.s) }))
    .filter(({ remaining }) => remaining === null || remaining - cost >= QUOTA_FLOOR[cap])
    .sort((a, b) => {
      if (a.remaining === null && b.remaining !== null) return 1;
      if (b.remaining === null && a.remaining !== null) return -1;
      if (a.remaining !== b.remaining) return (b.remaining ?? 0) - (a.remaining ?? 0);
      return a.order - b.order;
    })
    .map(({ account }) => account);
}

/**
 * Run `fn` on the best account for `cap`. On a quota error the account is
 * benched and the next one is tried. Any other error is rethrown unchanged.
 */
export async function withPooledAccount<T>(
  cap: PooledCapability,
  fn: (account: CloudinaryAccount) => Promise<T>,
  opts: { cost?: number } = {},
): Promise<{ result: T; account: CloudinaryAccount }> {
  const candidates = await rankAccounts(cap, opts.cost ?? 1);
  for (const account of candidates) {
    try {
      return { result: await fn(account), account };
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      bench(account, cap);
    }
  }
  throw new PoolExhaustedError(cap);
}

/**
 * Aggregate quota across the pool, for the cost meter and the showcase
 * fallback. Deliberately exposes totals only, never account names.
 */
export async function poolSummary(cap: PooledCapability): Promise<{ remaining: number; limit: number; usable: number; known: boolean }> {
  await refreshUsage();
  const now = Date.now();
  let remaining = 0;
  let limit = 0;
  let usable = 0;
  let known = false;
  for (const account of getAccounts()) {
    const s = getState(account.label, cap);
    const r = remainingOf(s);
    const l = s.live?.limit ?? s.usage?.limit ?? null;
    if (r !== null) {
      known = true;
      remaining += r;
      if ((s.benchedUntil ?? 0) <= now) usable += Math.max(0, r - QUOTA_FLOOR[cap]);
    }
    if (l !== null) limit += l;
  }
  return { remaining, limit, usable, known };
}

/** Test hook: forget all learned quota state. */
export function __resetPoolState(): void {
  state.clear();
  usageFetchedAt = 0;
}
