import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Small crypto helpers for stateless server state (session cookie, job tokens).
 * Every key is derived from CLOUDINARY_API_SECRET with a purpose label, so no
 * extra secret has to be configured and rotating the API secret invalidates
 * every cookie and token at once.
 */

export const b64url = (buf: Buffer) => buf.toString("base64url");
export const fromB64url = (s: string) => Buffer.from(s, "base64url");

/** 32-byte key for one purpose, e.g. deriveKey("s2s-session"). Throws if the secret is missing. */
export function deriveKey(purpose: string, secret = process.env.CLOUDINARY_API_SECRET): Buffer {
  if (!secret) throw new Error("Server secret is not configured.");
  return createHash("sha256").update(`${purpose}:${secret}`).digest();
}

export function hmac(key: Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** Constant-time string comparison (length leaks, content does not). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab); // keep timing roughly equal
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** `<payload b64url>.<hmac b64url>`: readable but tamper-proof. */
export function signJson(key: Buffer, value: unknown): string {
  const payload = b64url(Buffer.from(JSON.stringify(value)));
  return `${payload}.${b64url(hmac(key, payload))}`;
}

export function verifyJson<T = unknown>(key: Buffer, token: string | undefined | null): T | null {
  if (!token || token.length > 4096) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!safeEqual(sig, b64url(hmac(key, payload)))) return null;
  try {
    return JSON.parse(fromB64url(payload).toString("utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Authenticated encryption (AES-256-GCM): the token is opaque (the client can't
 * read which account runs a job) and any modification fails the auth tag.
 * Format: `<iv b64url>.<ciphertext b64url>.<tag b64url>`.
 */
export function seal(key: Buffer, value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `${b64url(iv)}.${b64url(ct)}.${b64url(cipher.getAuthTag())}`;
}

export function unseal<T = unknown>(key: Buffer, token: string | undefined | null): T | null {
  if (!token || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return null;
  try {
    const [iv, ct, tag] = parts.map(fromB64url);
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(pt.toString("utf8")) as T;
  } catch {
    return null;
  }
}
