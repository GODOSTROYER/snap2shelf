import "server-only";
import { assetInfo, mainCloud, uploadRawJsonOnce } from "./cld";
import { b64url, deriveKey, hmac } from "./crypto";

/**
 * First-writer-wins locks kept in Cloudinary itself (no database):
 *   snap2shelf/locks/shelf-<shop>.json     who created shelf <shop>
 *   snap2shelf/locks/capture-<sku>.json    which session is waiting for phone capture <sku>
 *
 * Claim = Upload API upload with a deterministic public id and overwrite: false.
 * Cloudinary creates the asset for exactly one of any number of concurrent
 * claimers and hands the others the existing asset, so the claim is atomic,
 * unlike a check against the CDN tag list (cached ~60 s). The document holds a
 * keyed hash of the owning session id (not the id itself: raw uploads are
 * publicly deliverable), and the claimer reads it back at the stored version to
 * learn whether the lock is its own (a fresh version URL is a new CDN cache key,
 * the same trick product facts use). Locks are never overwritten, so a known
 * owner is cached for the life of the process.
 *
 * Cost: one Upload API call (+ one CDN GET) per claim; zero Admin API calls.
 * Raw files are not image transformations, so no transformation credits.
 */

export type LockKind = "shelf" | "capture";

export const lockId = (kind: LockKind, subject: string) => `snap2shelf/locks/${kind}-${subject}.json`;
export const LOCK_TAG = "s2s-lock";

/** Keyed hash of a session id, as stored in a lock document. */
export const ownerTag = (sid: string) => b64url(hmac(deriveKey("s2s-lock-owner"), sid)).slice(0, 22);

interface LockDoc {
  v: 1;
  kind: LockKind;
  o: string;
  at: number;
}

const G = globalThis as unknown as { __s2sLocks?: Map<string, string> };
const owners = (G.__s2sLocks ??= new Map());
const OWNERS_MAX = 1000;

function remember(id: string, owner: string) {
  owners.delete(id);
  owners.set(id, owner);
  if (owners.size > OWNERS_MAX) owners.delete(owners.keys().next().value as string);
}

/** Test hook. */
export function __resetLocks(): void {
  owners.clear();
}

async function readOwner(id: string, version: number): Promise<string> {
  const url = `https://res.cloudinary.com/${mainCloud()}/raw/upload/v${version}/${id}`;
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const doc = (await res.json()) as Partial<LockDoc> | null;
        if (doc && typeof doc.o === "string" && doc.o) return doc.o;
        throw new Error("lock document is malformed");
      }
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = String((err as Error)?.message ?? err).slice(0, 120);
    }
    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
  // Never guess: an unreadable lock must not be treated as ours (or as free).
  throw new Error(`lock read failed: ${last}`);
}

/**
 * Claim the lock for this session. true: the lock is this session's (just created,
 * or created by it earlier); false: another session holds it.
 */
export async function claimLock(kind: LockKind, subject: string, sid: string, now = Date.now()): Promise<boolean> {
  const id = lockId(kind, subject);
  const mine = ownerTag(sid);
  const known = owners.get(id);
  if (known) return known === mine;
  const doc: LockDoc = { v: 1, kind, o: mine, at: now };
  const { version, existing } = await uploadRawJsonOnce(id, doc, [LOCK_TAG]);
  const owner = existing || !version ? await readOwner(id, version || (await lockVersion(id))) : mine;
  remember(id, owner);
  return owner === mine;
}

async function lockVersion(id: string): Promise<number> {
  const info = await assetInfo(id, "raw");
  if (!info) throw new Error("lock vanished");
  return info.version;
}

/**
 * Read-only check (never creates the lock): true when this session holds it,
 * false when another session does, null when nobody has claimed it.
 */
export async function holdsLock(kind: LockKind, subject: string, sid: string): Promise<boolean | null> {
  const id = lockId(kind, subject);
  const known = owners.get(id);
  if (known) return known === ownerTag(sid);
  const info = await assetInfo(id, "raw");
  if (!info) return null;
  const owner = await readOwner(id, info.version);
  remember(id, owner);
  return owner === ownerTag(sid);
}
