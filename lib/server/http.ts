import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { ApiError } from "../api-contract";
import { SKU_RE, type Sku } from "../types";
import { AdminLimitedError, adminStats, parseRateLimitReset } from "../cloudinary/admin";
import { PoolExhaustedError, QuotaError } from "../cloudinary/pool";
import { scrubSecrets } from "../cloudinary/safe";
import { openOpCap } from "./config";
import { applyCookieWrites, type CookieWrite } from "./proofs";
import { readSessionState, sessionToWrite, writeSession, type Session } from "./session";

/** Throw from anywhere in a route to answer with a safe ApiError. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiError["code"],
    public readonly publicMessage: string,
    public readonly retryAfterMs?: number,
  ) {
    super(publicMessage);
    this.name = "HttpError";
  }
}

export const badRequest = (msg = "Invalid request.") => new HttpError(400, "bad_request", msg);
export const notFound = (msg = "Not found.") => new HttpError(404, "not_found", msg);
export const pending = (retryAfterMs = 2000, msg = "Still processing, try again shortly.") =>
  new HttpError(202, "pending", msg, retryAfterMs);

/**
 * HTTP code of a Cloudinary failure: CloudinarySdkError / AdminLimitedError carry
 * `http_code`; raw SDK rejections are { error: { message, http_code } }.
 */
export function cldHttpCode(err: unknown): number | undefined {
  const e = err as { error?: { http_code?: number }; http_code?: number; status?: number } | null;
  return e?.error?.http_code ?? e?.http_code ?? e?.status;
}

/** A short, credential-free description (message strings only; never the object itself). */
function cldMessage(err: unknown): string {
  const e = err as { error?: { message?: unknown }; message?: unknown } | null;
  const m = [e?.error?.message, e?.message].find((x): x is string => typeof x === "string");
  return scrubSecrets(m ?? "unknown error").replace(/[\r\n]+/g, " ").slice(0, 300);
}

/** Waits up to this long are answered 202 "pending" on routes the client retries; longer ones are "quota_low". */
export const PENDING_MAX_MS = 15_000;

/**
 * Rate limit (Admin API 420 / breaker open, or a 420 / 429 from any Cloudinary
 * API) → a friendly ApiError, never a 500. Short waits on retriable routes are
 * "pending" (the client polls again); anything longer switches the UI to the
 * saved examples via "quota_low", with retryAfterMs so it can say when.
 */
export function rateLimited(retryAfterMs: number, retriable = false): HttpError {
  const ms = Math.max(1000, Math.round(retryAfterMs));
  if (retriable && ms <= PENDING_MAX_MS) return new HttpError(202, "pending", "Cloudinary is busy for a moment, retrying shortly.", ms);
  const min = Math.max(1, Math.ceil(ms / 60_000));
  return new HttpError(
    503,
    "quota_low",
    `Cloudinary's hourly API allowance is used up right now. Showing saved examples instead; live kits resume in about ${min} minute${min === 1 ? "" : "s"}.`,
    ms,
  );
}

/** Map any thrown value to a safe HttpError-shaped answer (exported for tests). */
export function toHttpError(err: unknown, retriable = false): HttpError | null {
  if (err instanceof HttpError) return err;
  if (err instanceof AdminLimitedError) return rateLimited(err.retryAfterMs, retriable);
  if (err instanceof PoolExhaustedError || err instanceof QuotaError) {
    return new HttpError(503, "quota_low", "AI quota is running low right now. Showing saved examples instead.");
  }
  const code = cldHttpCode(err);
  if (code === 420 || code === 429) {
    // Not an Admin call we routed through the breaker (Upload API, delivery): use the
    // reset time Cloudinary names, else retry shortly.
    const msg = cldMessage(err);
    const named = /\d{2}:\d{2}/.test(msg) ?parseRateLimitReset(msg) - Date.now() : 5_000;
    return rateLimited(named, retriable);
  }
  return null;
}

export function apiError(err: unknown, route: string, opts: { retriable?: boolean } = {}): NextResponse {
  const mapped = toHttpError(err, opts.retriable);
  if (mapped && !(err instanceof HttpError)) {
    console.warn(`[${route}] ${(err as { name?: string })?.name ?? "Error"} → ${mapped.status} ${mapped.code}`);
  }
  if (mapped) err = mapped;
  if (err instanceof HttpError) {
    const body: ApiError = { error: err.publicMessage, code: err.code };
    if (err.retryAfterMs !== undefined) body.retryAfterMs = err.retryAfterMs;
    const res = NextResponse.json(body, { status: err.status });
    if (err.retryAfterMs !== undefined) res.headers.set("Retry-After", String(Math.ceil(err.retryAfterMs / 1000)));
    return res;
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: "Invalid request.", code: "bad_request" } satisfies ApiError, { status: 400 });
  }
  // Log a short, credential-free description server-side; never return details to the client.
  const name = (err as { name?: string })?.name ?? "Error";
  console.error(`[${route}] ${name} (${cldHttpCode(err) ?? "-"}): ${cldMessage(err)}`);
  return NextResponse.json({ error: "Something went wrong talking to Cloudinary. Please try again.", code: "upstream" } satisfies ApiError, {
    status: 502,
  });
}

export async function readJson<T>(req: Request, schema: z.ZodType<T>, maxBytes = 16_384): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw badRequest("Request body too large.");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw badRequest("Body must be JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw badRequest();
  return parsed.data;
}

export function assertSku(sku: unknown): Sku {
  if (typeof sku !== "string" || !SKU_RE.test(sku)) throw badRequest("Invalid SKU.");
  return sku;
}

export const skuSchema = z.string().regex(SKU_RE);

/** Count one open paid operation against the session (cookie-based rate cap). */
export function chargeOpenOp(s: Session): Session {
  if (s.o >= openOpCap()) throw new HttpError(429, "cap_reached", "This session has used its free AI operations. Refresh later or use the saved examples.");
  return { ...s, o: s.o + 1 };
}

type Handler = (
  req: NextRequest,
  session: Session,
) => Promise<{
  body: unknown;
  status?: number;
  /** The session with an updated open-operation count (chargeOpenOp). Only `o` is persisted from it. */
  session?: Session;
  headers?: Record<string, string>;
  /** Proof cookies to set / delete (lib/server/proofs.ts), independent of the session cookie. */
  cookies?: CookieWrite[];
}>;

export interface RouteOptions {
  /** The client retries this route on 202 (cutout, retouch, polls): short rate-limit waits answer "pending". */
  retriable?: boolean;
}

const debugHeaders = () => process.env.NODE_ENV !== "production" || process.env.S2S_DEBUG_ADMIN === "1";

/** Dev instrumentation: cumulative Admin API calls this process sent to main (e2e reads the delta). */
function instrument(res: NextResponse): void {
  if (!debugHeaders()) return;
  const s = adminStats("main");
  res.headers.set("x-s2s-admin-calls", String(s.calls));
  if (s.remaining !== null) res.headers.set("x-s2s-admin-remaining", String(s.remaining));
}

/**
 * Route wrapper: reads the session (lib/server/session.ts: the s2s_access cookie plus
 * this session's unlock / generation proofs), maps thrown errors to ApiError JSON, and
 * writes back only what the handler changed:
 *   - s2s_access, only when the open-operation count changed or the visitor has no valid
 *     session yet (routes that change nothing never re-issue it, so a slow request can't
 *     overwrite what a concurrent one wrote);
 *   - the proof cookies the handler grants or revokes (unlock, generations, ownership).
 */
export function route(name: string, handler: Handler, opts: RouteOptions = {}) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const state = readSessionState(req);
    try {
      const out = await handler(req, state.session);
      const res = NextResponse.json(out.body, { status: out.status ?? 200 });
      for (const [k, v] of Object.entries(out.headers ?? {})) res.headers.set(k, v);
      if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-store");
      const stored = sessionToWrite(state, out.session);
      if (stored) writeSession(res, stored);
      applyCookieWrites(res, out.cookies);
      instrument(res);
      return res;
    } catch (err) {
      const res = apiError(err, name, opts);
      res.headers.set("Cache-Control", "no-store");
      instrument(res);
      return res;
    }
  };
}

/** Same as route(), for dynamic segments: `params` is a Promise in Next.js 16. */
export function routeWithParams<P>(
  name: string,
  handler: (req: NextRequest, session: Session, params: P) => ReturnType<Handler>,
  opts: RouteOptions = {},
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<NextResponse> => {
    const params = await ctx.params;
    return route(name, (r, s) => handler(r, s, params), opts)(req);
  };
}
