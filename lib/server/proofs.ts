import "server-only";
import { randomBytes } from "node:crypto";
import type { NextResponse } from "next/server";
import { SKU_RE } from "../types";
import { b64url, deriveKey, hmac, safeEqual } from "./crypto";

/**
 * Proof cookies: one small signed httpOnly cookie per fact the server vouches for,
 * instead of lists inside the session cookie (no database either way).
 *
 *   s2s_p_<sku>   product: this browser created the product (signed its first upload,
 *                 or claimed the phone capture it was waiting for)
 *   s2s_s_<shop>  shelf: this browser created the shelf
 *   s2s_c_<sku>   capture ticket: this session is the one waiting for a phone upload
 *                 of <sku> (single-use, 10 minutes)
 *   s2s_unlock    this session entered the demo access code
 *   s2s_g_<id>    one live generation this session started (one cookie per generation)
 *
 * Why: every route that changed the session used to re-issue the WHOLE session
 * cookie from the copy it read when the request started. Concurrent requests each
 * wrote back their own copy and the browser kept the last one, so a slow request
 * (GET /api/readiness, ~12 s) could wipe an unlock entered meanwhile, roll the
 * generation count back (cap bypass), or drop a product's ownership. A proof cookie
 * is written once, under its own name, and never rewritten by an unrelated request,
 * so no stale response can undo it. The session cookie now carries only the id and
 * the open-operation counter (lib/server/session.ts).
 *
 * Value: `<sid>.<iat>.<mac>`; mac = HMAC-SHA256(key(kind), kind|subject|sid|iat)
 * truncated to 128 bits. The subject (sku / shop / id) comes from the cookie name and
 * is inside the MAC, so a proof can't be renamed to another product, and each kind has
 * its own key, so e.g. a capture ticket can't be replayed as a product proof. ~60 bytes
 * per cookie; each kind keeps at most `max` (oldest evicted; generations never are).
 *
 * `sid` is the session that earned the proof. "Bound" kinds (capture, unlock, gen) only
 * count for that session: clearing cookies starts a new session without them, as
 * before. Product and shelf proofs are not bound: possession of the server-minted
 * cookie is the proof, so a session cookie re-issued by a concurrent first request
 * (new sid) or the session's own 7-day expiry can't orphan a product.
 */

export type ProofKind = "product" | "shelf" | "capture" | "unlock" | "gen";

interface KindSpec {
  prefix: string;
  /** Cookie path: only the routes that read the proof receive it. */
  path: string;
  ttlS: number;
  max: number;
  subject: RegExp;
  /** Counts only for the session (sid) that earned it. */
  bound: boolean;
  /** Oldest proofs are deleted beyond `max` (never for generations: the count must only grow). */
  evict: boolean;
}

const DAY_S = 24 * 3600;
const SESSION_TTL_S = 7 * DAY_S;

export const PROOF_SPEC: Readonly<Record<ProofKind, KindSpec>> = {
  product: { prefix: "s2s_p_", path: "/api", ttlS: SESSION_TTL_S, max: 20, subject: SKU_RE, bound: false, evict: true },
  shelf: { prefix: "s2s_s_", path: "/api/shelf", ttlS: SESSION_TTL_S, max: 3, subject: /^[a-z0-9-]{3,32}$/, bound: false, evict: true },
  capture: { prefix: "s2s_c_", path: "/api/capture", ttlS: 10 * 60, max: 3, subject: SKU_RE, bound: true, evict: true },
  unlock: { prefix: "s2s_unlock", path: "/api", ttlS: SESSION_TTL_S, max: 1, subject: /^$/, bound: true, evict: true },
  gen: { prefix: "s2s_g_", path: "/api", ttlS: SESSION_TTL_S, max: 100, subject: /^[a-z0-9]{8}$/, bound: true, evict: false },
};

/** A capture ticket (and the claim it allows) lasts this long. */
export const CAPTURE_TTL_S = PROOF_SPEC.capture.ttlS;

const SID_RE = /^[A-Za-z0-9_-]{8,32}$/;
const MAC_LEN = 22; // base64url chars ≈ 128 bits

const proofKey = (kind: ProofKind) => deriveKey(`s2s-proof-${kind}`);
const macOf = (kind: ProofKind, subject: string, sid: string, iat: number) => b64url(hmac(proofKey(kind), `${kind}|${subject}|${sid}|${iat}`)).slice(0, MAC_LEN);

export const proofCookieName = (kind: ProofKind, subject = "") => `${PROOF_SPEC[kind].prefix}${subject}`;

export interface Proof {
  kind: ProofKind;
  subject: string;
  sid: string;
  iat: number; // seconds
}

export function mintProof(kind: ProofKind, subject: string, sid: string, now = Date.now()): string {
  if (!PROOF_SPEC[kind].subject.test(subject) || !SID_RE.test(sid)) throw new Error("invalid proof subject");
  const iat = Math.floor(now / 1000);
  return `${sid}.${iat}.${macOf(kind, subject, sid, iat)}`;
}

/** The proof in a cookie value, or null when it is malformed, forged, for another subject, or expired. */
export function openProof(kind: ProofKind, subject: string, value: string | undefined | null, now = Date.now()): Proof | null {
  const spec = PROOF_SPEC[kind];
  if (!value || value.length > 128 || !spec.subject.test(subject)) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [sid, iatS, mac] = parts;
  if (!SID_RE.test(sid) || !/^\d{1,12}$/.test(iatS)) return null;
  const iat = Number(iatS);
  if (!safeEqual(mac, macOf(kind, subject, sid, iat))) return null;
  const age = Math.floor(now / 1000) - iat;
  if (age < -300 || age > spec.ttlS) return null;
  return { kind, subject, sid, iat };
}

export type ProofJar = { cookies: { getAll(): { name: string; value: string }[] } };

/**
 * Every valid proof of `kind` the request carries (invalid / expired cookies are ignored).
 * For bound kinds pass the caller's `sid`: proofs earned by another session don't count.
 */
export function readProofs(req: ProofJar, kind: ProofKind, opts: { sid?: string; now?: number } = {}): Proof[] {
  const spec = PROOF_SPEC[kind];
  const out: Proof[] = [];
  for (const c of req.cookies.getAll()) {
    if (!c.name.startsWith(spec.prefix)) continue;
    const p = openProof(kind, c.name.slice(spec.prefix.length), c.value, opts.now);
    if (p && (!spec.bound || p.sid === opts.sid)) out.push(p);
  }
  return out;
}

export const proofFor = (req: ProofJar, kind: ProofKind, subject: string, opts: { sid?: string; now?: number } = {}): Proof | null =>
  readProofs(req, kind, opts).find((p) => p.subject === subject) ?? null;

/** Skus this browser holds a product proof for. */
export const provenSkus = (req: ProofJar, now = Date.now()): ReadonlySet<string> => new Set(readProofs(req, "product", { now }).map((p) => p.subject));

/** Shops this browser holds a shelf proof for. */
export const provenShops = (req: ProofJar, now = Date.now()): ReadonlySet<string> => new Set(readProofs(req, "shelf", { now }).map((p) => p.subject));

/** A fresh id for a generation cookie (s2s_g_<id>). */
export const newGenId = () => [...randomBytes(8)].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

/** A cookie to set (maxAge > 0) or delete (maxAge 0) on the response. */
export interface CookieWrite {
  name: string;
  value: string;
  path: string;
  maxAge: number;
}

export const revokeProof = (kind: ProofKind, subject = ""): CookieWrite => ({ name: proofCookieName(kind, subject), value: "", path: PROOF_SPEC[kind].path, maxAge: 0 });

/**
 * Cookie writes that grant `subject` to this browser: the new proof, plus deletions of
 * cookies with the same prefix that no longer count (forged / expired, or bound to
 * another session) and, for evicting kinds, of the oldest proofs so at most `max` stay.
 */
export function grantProof(req: ProofJar, kind: ProofKind, subject: string, sid: string, now = Date.now()): CookieWrite[] {
  const spec = PROOF_SPEC[kind];
  const writes: CookieWrite[] = [{ name: proofCookieName(kind, subject), value: mintProof(kind, subject, sid, now), path: spec.path, maxAge: spec.ttlS }];
  const valid: Proof[] = [];
  for (const c of req.cookies.getAll()) {
    if (!c.name.startsWith(spec.prefix)) continue;
    const other = c.name.slice(spec.prefix.length);
    if (other === subject || !spec.subject.test(other)) continue;
    const p = openProof(kind, other, c.value, now);
    if (p && (!spec.bound || p.sid === sid)) valid.push(p);
    else writes.push(revokeProof(kind, other));
  }
  if (spec.evict) {
    valid.sort((a, b) => a.iat - b.iat || a.subject.localeCompare(b.subject));
    for (const p of valid.slice(0, Math.max(0, valid.length - (spec.max - 1)))) writes.push(revokeProof(kind, p.subject));
  }
  return writes;
}

export function applyCookieWrites(res: NextResponse, writes: CookieWrite[] | undefined): void {
  for (const w of writes ?? []) {
    res.cookies.set(w.name, w.value, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: w.path,
      maxAge: w.maxAge,
    });
  }
}
