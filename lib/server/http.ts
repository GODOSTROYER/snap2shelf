import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { ApiError } from "../api-contract";
import { SKU_RE, type Sku } from "../types";
import { PoolExhaustedError } from "../cloudinary/pool";
import { openOpCap } from "./config";
import { readSession, writeSession, type Session } from "./session";

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

/** Cloudinary SDK rejections are plain objects: { error: { message, http_code } }. */
export function cldHttpCode(err: unknown): number | undefined {
  const e = err as { error?: { http_code?: number }; http_code?: number; status?: number } | null;
  return e?.error?.http_code ?? e?.http_code ?? e?.status;
}

function cldMessage(err: unknown): string {
  const e = err as { error?: { message?: string }; message?: string } | null;
  return String(e?.error?.message ?? e?.message ?? err).slice(0, 300);
}

export function apiError(err: unknown, route: string): NextResponse {
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
  if (err instanceof PoolExhaustedError) {
    return NextResponse.json(
      { error: "AI quota is running low right now. Showing saved examples instead.", code: "quota_low" } satisfies ApiError,
      { status: 503 },
    );
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

type Handler = (req: NextRequest, session: Session) => Promise<{ body: unknown; status?: number; session?: Session; headers?: Record<string, string> }>;

/**
 * Route wrapper: reads the session, maps thrown errors to ApiError JSON, and
 * writes the session cookie back when the handler returns an updated one (or
 * when the visitor had none yet).
 */
export function route(name: string, handler: Handler) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const session = readSession(req);
    try {
      const out = await handler(req, session);
      const res = NextResponse.json(out.body, { status: out.status ?? 200 });
      for (const [k, v] of Object.entries(out.headers ?? {})) res.headers.set(k, v);
      if (!res.headers.has("Cache-Control")) res.headers.set("Cache-Control", "no-store");
      const hadCookie = Boolean(req.cookies.get("s2s_access"));
      if (out.session || !hadCookie) writeSession(res, out.session ?? session);
      return res;
    } catch (err) {
      const res = apiError(err, name);
      res.headers.set("Cache-Control", "no-store");
      return res;
    }
  };
}

/** Same as route(), for dynamic segments: `params` is a Promise in Next.js 16. */
export function routeWithParams<P>(
  name: string,
  handler: (req: NextRequest, session: Session, params: P) => ReturnType<Handler>,
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<NextResponse> => {
    const params = await ctx.params;
    return route(name, (r, s) => handler(r, s, params))(req);
  };
}
