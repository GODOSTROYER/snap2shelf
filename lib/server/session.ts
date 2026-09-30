import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { NextResponse } from "next/server";
import { poolSummary } from "../cloudinary/pool";
import { SKU_RE } from "../types";
import { liveGenCap, liveGenMin } from "./config";
import { deriveKey, signJson, verifyJson } from "./crypto";
import { grantProof, newGenId, proofFor, readProofs, type CookieWrite, type ProofJar } from "./proofs";

/**
 * Stateless session, no database. The httpOnly cookie `s2s_access` (HMAC-signed with a
 * key derived from the API secret) holds:
 *   sid  random session id (logging / job binding / proof binding)
 *   o    open paid operations used (analyze, cutout, QA, pack): a soft per-session cap
 *   iat  issued-at (seconds); sessions older than MAX_AGE are replaced
 * and, carried forward unchanged from cookies issued before proof cookies existed:
 *   u    unlocked with the demo access code (legacy)
 *   g    live generations started (legacy base)
 *   k    skus this browser created (legacy), sp  shelves it created (legacy)
 *
 * Everything that must survive concurrent requests lives in its own cookie
 * (lib/server/proofs.ts), never in this one:
 *   the unlock        s2s_unlock, written only by POST /api/access
 *   generations       one s2s_g_<id> per generation started: the count only grows
 *   owned products    s2s_p_<sku>, owned shelves s2s_s_<shop>
 * Why: a route that re-issued this cookie wrote back the copy it read when the request
 * started, so a slow request (GET /api/readiness, ~12 s) finishing after the access code
 * was entered wiped the unlock and rolled the generation count back. Now this cookie is
 * re-issued only when a route changes `o` (or the visitor has no valid session yet), and
 * a stale write can at worst roll `o` back by the operations that overlapped it.
 * The effective session routes see (`Session`) is this cookie plus those proofs:
 *   u = legacy u || a valid unlock proof for this sid
 *   g = legacy g + the generation proofs for this sid
 * Clearing cookies resets the counters but also drops the unlock (proofs are bound to the
 * sid), so the generation cap can only be reset by re-entering the access code, and
 * re-entering it alone never resets it; the pool quota floor (LIVE_GEN_MIN) is the hard
 * backstop either way.
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

/** Legacy proof: the sku is in the session's own list (cookies issued before per-product proofs). */
export const ownsSku = (s: Session, sku: string) => s.k?.includes(sku) ?? false;

/**
 * The session with `sku` recorded as created here (most recent last, at most OWNED_MAX).
 * Legacy: routes grant product proofs instead (lib/server/proofs.ts grantProof).
 */
export function withOwnedSku(s: Session, sku: string): Session {
  if (!SKU_RE.test(sku)) return s;
  const k = [...(s.k ?? []).filter((x) => x !== sku), sku].slice(-OWNED_MAX);
  return { ...s, k };
}

/** The session with `shop` recorded as a shelf it created. Legacy: routes grant shelf proofs instead. */
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
export type SessionJar = CookieReader & ProofJar;

export interface SessionState {
  /** What the s2s_access cookie holds (a fresh session when it is missing or invalid). */
  stored: Session;
  /** What routes see: the stored session plus this session's unlock and generation proofs. */
  session: Session;
  /** The request arrived with a valid session cookie. */
  established: boolean;
}

export function readSessionState(req: SessionJar, now = Date.now()): SessionState {
  const decoded = decodeSession(req.cookies.get(SESSION_COOKIE)?.value, undefined, now);
  const stored = decoded ?? newSession(now);
  const sid = stored.sid;
  const unlocked = stored.u || proofFor(req, "unlock", "", { sid, now }) !== null;
  const generations = readProofs(req, "gen", { sid, now }).length;
  return { stored, established: decoded !== null, session: { ...stored, u: unlocked, g: Math.min(10_000, stored.g + generations) } };
}

/** The request's effective session (see SessionState), or a fresh anonymous one. */
export const readSession = (req: SessionJar): Session => readSessionState(req).session;

/**
 * The s2s_access value to write after a route ran, or null to leave the cookie alone:
 * only the open-operation count is taken from the route's session, never u / g / lists
 * (those live in proof cookies), so a route that read the session before an unlock or a
 * generation can't undo it. Written when `o` changed or the visitor has no valid session yet.
 */
export function sessionToWrite(state: SessionState, next: Session | undefined): Session | null {
  const o = next?.o ?? state.stored.o;
  if (state.established && o === state.stored.o) return null;
  return { ...state.stored, o };
}

/** Cookie write recording that this session entered the access code (POST /api/access). */
export const grantUnlock = (req: ProofJar, s: Session): CookieWrite[] => grantProof(req, "unlock", "", s.sid);

/** Cookie write counting one live generation started by this session (its own cookie: concurrent starts all count). */
export const countGeneration = (req: ProofJar, s: Session): CookieWrite[] => grantProof(req, "gen", newGenId(), s.sid);

/**
 * Did the request arrive with a valid session cookie for `s`? False for a visitor's first
 * request, whose fresh session (and sid) may still be replaced by a concurrent first request.
 */
export const sessionEstablished = (req: CookieReader, s: Session) => decodeSession(req.cookies.get(SESSION_COOKIE)?.value)?.sid === s.sid;

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
