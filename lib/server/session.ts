import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { NextResponse } from "next/server";
import { poolSummary } from "../cloudinary/pool";
import { SKU_RE } from "../types";
import { liveGenCap, liveGenMin } from "./config";
import { deriveKey, signJson, verifyJson } from "./crypto";

/**
 * Stateless session in an httpOnly cookie `s2s_access`, HMAC-signed with a key
 * derived from the API secret. It holds:
 *   sid  random session id (logging / job binding)
 *   u    unlocked with the demo access code
 *   g    live generations started
 *   o    open paid operations used (analyze, cutout, QA, pack)
 *   iat  issued-at (seconds); sessions older than MAX_AGE are replaced
 *   k    (optional) skus this browser created: a signed upload of a raw that
 *        didn't exist yet, or a phone capture it saw land (lib/server/protect.ts)
 *   sp   (optional) shelves this browser created without the access code
 * Both lists are optional so cookies issued before they existed stay valid.
 * Clearing cookies resets the counters but also drops the unlock, so the
 * generation cap can only be reset by re-entering the access code; the pool
 * quota floor (LIVE_GEN_MIN) is the hard backstop either way.
 */
export const SESSION_COOKIE = "s2s_access";
const MAX_AGE_S = 7 * 24 * 3600;

/** Most skus / shelves a session remembers (oldest dropped first); keeps the cookie small. */
export const OWNED_MAX = 20;
export const SHELVES_MAX = 3;

const sessionSchema = z.object({
  sid: z.string().regex(/^[A-Za-z0-9_-]{8,32}$/),
  u: z.boolean(),
  g: z.number().int().min(0).max(10_000),
  o: z.number().int().min(0).max(1_000_000),
  iat: z.number().int(),
  k: z.array(z.string().regex(SKU_RE)).max(OWNED_MAX).optional(),
  sp: z.array(z.string().regex(/^[a-z0-9-]{3,32}$/)).max(SHELVES_MAX).optional(),
});
export type Session = z.infer<typeof sessionSchema>;

/** Did this browser create the sku (signed its first upload, or saw its phone capture land)? */
export const ownsSku = (s: Session, sku: string) => s.k?.includes(sku) ?? false;

/** The session with `sku` recorded as created here (most recent last, at most OWNED_MAX). */
export function withOwnedSku(s: Session, sku: string): Session {
  if (!SKU_RE.test(sku)) return s;
  const k = [...(s.k ?? []).filter((x) => x !== sku), sku].slice(-OWNED_MAX);
  return { ...s, k };
}

/** The session with `shop` recorded as a shelf it created (callers enforce SHELVES_MAX first). */
export function withShelf(s: Session, shop: string): Session {
  if (s.sp?.includes(shop)) return s;
  return { ...s, sp: [...(s.sp ?? []), shop].slice(-SHELVES_MAX) };
}

export const sessionKey = () => deriveKey("s2s-session");

export function newSession(now = Date.now()): Session {
  return { sid: randomBytes(9).toString("base64url"), u: false, g: 0, o: 0, iat: Math.floor(now / 1000) };
}

export function encodeSession(s: Session, key = sessionKey()): string {
  return signJson(key, s);
}

/** Returns null for a missing, tampered, malformed or expired cookie. */
export function decodeSession(token: string | undefined | null, key = sessionKey(), now = Date.now()): Session | null {
  const raw = verifyJson(key, token);
  const parsed = sessionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const age = Math.floor(now / 1000) - parsed.data.iat;
  if (age < -300 || age > MAX_AGE_S) return null;
  return parsed.data;
}

type CookieReader = { cookies: { get(name: string): { value: string } | undefined } };

/** The request's session, or a fresh anonymous one. */
export function readSession(req: CookieReader): Session {
  return decodeSession(req.cookies.get(SESSION_COOKIE)?.value) ?? newSession();
}

export function writeSession(res: NextResponse, s: Session): NextResponse {
  res.cookies.set(SESSION_COOKIE, encodeSession(s), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  });
  return res;
}

export const generationsLeft = (s: Session) => (s.u ? Math.max(0, liveGenCap() - s.g) : 0);

/** Live generation is on only while the pool keeps at least LIVE_GEN_MIN usable credits. */
export async function liveGenerationEnabled(): Promise<{ enabled: boolean; usable: number }> {
  const s = await poolSummary("image_generation");
  return { enabled: s.known && s.usable >= liveGenMin(), usable: s.usable };
}
