import "server-only";
import { sanitizeCldError } from "./safe";

/**
 * Admin API gateway: every Admin API call (SDK `cloudinary.api.*` or a raw
 * fetch to /v1_1/<cloud>/usage etc.) goes through adminCall() / adminFetch().
 *
 *  - Rejections are sanitised (no request_options / auth can escape).
 *  - Circuit breaker per account: after one HTTP 420 / 429 the process makes
 *    no further Admin calls to that account until the reset time Cloudinary
 *    names (else the next full hour, when the hourly window resets). Calls
 *    while open fail fast with AdminLimitedError, which routes map to
 *    {code:"pending"|"quota_low", retryAfterMs}, never a 500.
 *  - The rate-limit headers of successful calls (x-featureratelimit-*) are
 *    tracked too, and the breaker opens pre-emptively when the hourly
 *    allowance drops to ADMIN_API_RESERVE (default 5).
 *  - A per-account call counter (dev instrumentation, x-s2s-admin-calls).
 *
 * State is per server instance, like the key pool.
 */

export class AdminLimitedError extends Error {
  readonly http_code = 420;
  constructor(
    public readonly retryAfterMs: number,
    public readonly account: string,
  ) {
    super("Cloudinary Admin API rate limit reached; paused until the hourly reset.");
    this.name = "AdminLimitedError";
  }
  toJSON() {
    return { name: this.name, message: this.message, retryAfterMs: this.retryAfterMs };
  }
}

interface Breaker {
  openUntil: number;
  calls: number; // Admin calls actually sent
  refused: number; // calls refused while open
  remaining: number | null; // from x-featureratelimit-remaining
  limit: number | null;
  resetAt: number | null;
  lastLimitedAt: number | null;
}

/** Per Node process (globalThis), shared by every route bundle: one 420 pauses them all. */
const G = globalThis as unknown as { __s2sAdminBreakers?: Map<string, Breaker> };
const breakers: Map<string, Breaker> = (G.__s2sAdminBreakers ??= new Map());

function breaker(account: string): Breaker {
  let b = breakers.get(account);
  if (!b) breakers.set(account, (b = { openUntil: 0, calls: 0, refused: 0, remaining: null, limit: null, resetAt: null, lastLimitedAt: null }));
  return b;
}

const intEnv = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

/** Stop calling an account's Admin API once its hourly allowance is down to this many calls. */
export const adminReserve = () => intEnv("ADMIN_API_RESERVE", 5);

const MIN_OPEN_MS = 5_000;
const MAX_OPEN_MS = 65 * 60_000;

/** Next full UTC hour (+2 s): when Cloudinary's hourly Admin window resets. */
export function nextHourBoundary(now = Date.now()): number {
  return Math.floor(now / 3_600_000) * 3_600_000 + 3_600_000 + 2_000;
}

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
const DATE_PATTERNS: RegExp[] = [
  // 2026-09-30T05:00:00Z, 2026-09-30 05:00:00 UTC, 2026-09-30 05:00:00 +0000
  /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?\s*(?:Z|UTC|GMT|[+-]\d{2}:?\d{2})?/i,
  // Wed, 30 Sep 2026 05:00:00 GMT
  new RegExp(`\\d{1,2} (?:${MONTHS})[a-z]* \\d{4} \\d{2}:\\d{2}(?::\\d{2})?(?: (?:GMT|UTC|[+-]\\d{4}))?`, "i"),
  // Wed Sep 30 05:00:00 UTC 2026
  new RegExp(`(?:${MONTHS})[a-z]* \\d{1,2} \\d{2}:\\d{2}(?::\\d{2})? (?:UTC|GMT) \\d{4}`, "i"),
];

function parseDate(s: string): number {
  let t = s.trim();
  const iso = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*(Z|UTC|GMT|[+-]\d{2}:?\d{2})?$/i.exec(t);
  if (iso) {
    const zone = !iso[3] || /^(z|utc|gmt)$/i.test(iso[3]) ? "Z" : iso[3].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
    t = `${iso[1]}T${iso[2]}${zone}`;
  }
  const m = /^((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*) (\d{1,2}) (\d{2}:\d{2}(?::\d{2})?) (UTC|GMT) (\d{4})$/i.exec(t);
  if (m) t = `${m[2]} ${m[1]} ${m[5]} ${m[3]} GMT`;
  return Date.parse(t);
}

/**
 * When a 420 / 429 lifts: the reset time named in Cloudinary's message (or the
 * x-featureratelimit-reset header), else the next full hour. Clamped to 5 s..65 min.
 */
export function parseRateLimitReset(message: string | null | undefined, now = Date.now(), header?: string | Date | null): number {
  const candidates: number[] = [];
  if (header) candidates.push(header instanceof Date ? header.getTime() : parseDate(String(header)));
  const text = String(message ?? "");
  for (const re of DATE_PATTERNS) {
    const hit = re.exec(text);
    if (hit) candidates.push(parseDate(hit[0]));
  }
  const at = candidates.find((t) => Number.isFinite(t) && t > now - 60_000 && t <= now + 2 * 3_600_000);
  const until = at ?? nextHourBoundary(now);
  return Math.min(now + MAX_OPEN_MS, Math.max(now + MIN_OPEN_MS, until));
}

/** Milliseconds until the account's breaker closes (0 = closed). */
export function adminPausedFor(account = "main", now = Date.now()): number {
  return Math.max(0, breaker(account).openUntil - now);
}

export function openBreaker(account: string, until: number): void {
  const b = breaker(account);
  b.openUntil = Math.max(b.openUntil, until);
  b.lastLimitedAt = Date.now();
  console.warn(`[admin] ${account}: Admin API paused for ${Math.round((b.openUntil - Date.now()) / 1000)} s`);
}

/** Record a successful call's rate-limit reading; opens the breaker when the reserve is reached. */
export function noteRateLimit(account: string, r: { remaining?: number | null; limit?: number | null; resetAt?: Date | string | number | null }, now = Date.now()): void {
  const b = breaker(account);
  if (typeof r.remaining === "number" && Number.isFinite(r.remaining)) b.remaining = r.remaining;
  if (typeof r.limit === "number" && Number.isFinite(r.limit)) b.limit = r.limit;
  const reset = r.resetAt instanceof Date ? r.resetAt.getTime() : typeof r.resetAt === "number" ? r.resetAt : r.resetAt ? parseDate(r.resetAt) : NaN;
  if (Number.isFinite(reset)) b.resetAt = reset;
  if (b.remaining !== null && b.remaining <= adminReserve()) {
    openBreaker(account, Math.min(now + MAX_OPEN_MS, Math.max(now + MIN_OPEN_MS, b.resetAt && b.resetAt > now ? b.resetAt + 2_000 : nextHourBoundary(now))));
  }
}

const debug = () => process.env.NODE_ENV !== "production" || process.env.S2S_DEBUG_ADMIN === "1";

function before(account: string, op: string): void {
  const b = breaker(account);
  const wait = b.openUntil - Date.now();
  if (wait > 0) {
    b.refused++;
    throw new AdminLimitedError(wait, account);
  }
  b.calls++;
  if (debug()) console.info(`[admin] ${account} ${op} (#${b.calls} this process)`);
}

function limited(account: string, message: string, header?: string | null): AdminLimitedError {
  const until = parseRateLimitReset(message, Date.now(), header);
  openBreaker(account, until);
  return new AdminLimitedError(Math.max(0, until - Date.now()), account);
}

type RateLimited = { rate_limit_remaining?: number; rate_limit_allowed?: number; rate_limit_reset_at?: Date };

/** One SDK Admin API call (`cloudinary.api.*`) on `account`, through the breaker. */
export async function adminCall<T>(op: string, fn: () => Promise<T>, account = "main"): Promise<T> {
  before(account, op);
  try {
    const res = await fn();
    const r = res as RateLimited | null;
    if (r && typeof r === "object") noteRateLimit(account, { remaining: r.rate_limit_remaining, limit: r.rate_limit_allowed, resetAt: r.rate_limit_reset_at });
    return res;
  } catch (err) {
    const safe = sanitizeCldError(err, op);
    if (safe.http_code === 420 || safe.http_code === 429) throw limited(account, safe.message);
    throw safe;
  }
}

/** One raw-fetch Admin API call (e.g. GET /v1_1/<cloud>/usage), through the breaker. Returns the Response for 2xx/4xx other than 420/429. */
export async function adminFetch(op: string, account: string, doFetch: () => Promise<Response>): Promise<Response> {
  before(account, op);
  let res: Response;
  try {
    res = await doFetch();
  } catch (err) {
    throw sanitizeCldError(err, op);
  }
  const h = (n: string) => res.headers.get(n);
  const remaining = h("x-featureratelimit-remaining");
  const limit = h("x-featureratelimit-limit");
  if (res.status === 420 || res.status === 429) {
    const body = await res.text().catch(() => "");
    let message = body;
    try {
      message = String((JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body);
    } catch {
      // not JSON
    }
    throw limited(account, message.slice(0, 300), h("x-featureratelimit-reset"));
  }
  noteRateLimit(account, {
    remaining: remaining === null ? null : Number(remaining),
    limit: limit === null ? null : Number(limit),
    resetAt: h("x-featureratelimit-reset"),
  });
  return res;
}

export interface AdminStats {
  calls: number;
  refused: number;
  remaining: number | null;
  limit: number | null;
  pausedForMs: number;
}

/** Counters for one account (dev header, logs, tests). */
export function adminStats(account = "main"): AdminStats {
  const b = breaker(account);
  return { calls: b.calls, refused: b.refused, remaining: b.remaining, limit: b.limit, pausedForMs: adminPausedFor(account) };
}

/** Test hook. */
export function __resetAdminState(): void {
  breakers.clear();
}
