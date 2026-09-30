import "server-only";
import { DEMO_SHELF } from "../claims";
import { SAMPLES } from "../showcase";
import { SHOWCASE } from "../showcase-data";
import { SKU_RE, type Sku } from "../types";
import { HttpError } from "./http";
import { CAPTURE_TTL_S, type Proof } from "./proofs";
import { ownsSku, SHELVES_MAX, type Session } from "./session";

/**
 * Write locks: who may change what (judges use the live site unattended, and
 * visitors must not be able to change each other's products).
 *
 * Protected products are everything the site shows as a finished example: the
 * sample products (lib/showcase.ts SAMPLES), the seeded showcase kits and their
 * creatives (data/showcase.json), the products on the demo shelf and the few
 * other processed products the site links to. For those, every route that would
 * WRITE to Cloudinary (uploads, context, tags, facts.json) or spend AI on them
 * needs the access session (session.u). Without it a route answers from what is
 * already stored (cached analysis, prebuilt pack / QA verdict, saved cutout) or
 * refuses with 403 {code:"read_only"}. /api/sign-upload never signs their
 * public ids, even with the access code (the raw of a sample must never change).
 *
 * Every other product is a visitor's live product. Every route that writes to it
 * or spends AI on it (analyze, retouch, cutout, brief, QA, pack, readiness, collection,
 * shelf, generate) needs proof that THIS browser created it, with or without the
 * access code (the code unlocks the showcase and live generation, not other
 * people's products). Proof = a product cookie `s2s_p_<sku>` (lib/server/proofs.ts),
 * minted when /api/sign-upload signs the first upload of a raw that didn't exist
 * yet, or when /api/capture hands a phone upload to the session that was waiting
 * for it; or, for cookies issued before per-product proofs, the sku in session.k.
 * Without proof the same read-only answers as for samples apply (stored results
 * only), with READ_ONLY_NOT_YOURS.
 */

/** Products on /shelf/demo-studio (scripts/seed-shelf.mts), the deck's hero (lib/present/data.ts) and the features lab (app/lab). */
const SITE_SKUS = ["s2candle", "s2trlmix", "9uo8w8pc", "zi86lf6a", "7chyt905", "tmixdk01", "pddaufff"];

const BUILT_IN: ReadonlySet<string> = new Set([
  ...SAMPLES.map((s) => s.sku),
  ...SHOWCASE.kits.map((k) => k.sku),
  ...SHOWCASE.creative.map((c) => c.sku),
  ...SHOWCASE.beforeAfter.map((b) => b.sku),
  ...SITE_SKUS,
]);

/** Extra protected skus / shops from the environment (comma-separated), for products seeded after this build. */
function envList(name: string, re: RegExp): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => re.test(s));
}

export function isProtectedSku(sku: string): boolean {
  return BUILT_IN.has(sku) || envList("S2S_PROTECTED_SKUS", SKU_RE).includes(sku);
}

/** Shelves whose content is part of the showcase (writes need the access code). */
export function isProtectedShop(shop: string): boolean {
  return shop === DEMO_SHELF.slug || envList("S2S_PROTECTED_SHOPS", /^[a-z0-9-]{3,32}$/).includes(shop);
}

/** Skus the request proves it created (product cookies: lib/server/proofs.ts provenSkus). */
export type Owned = ReadonlySet<string>;

/** Did this browser create the (live) product? Never true for a protected product. */
export const ownsProduct = (s: Session, sku: Sku, owned: Owned) => !isProtectedSku(sku) && (owned.has(sku) || ownsSku(s, sku));

/**
 * May this browser write to (or spend AI on) this product?
 *   protected (sample / showcase) product: only with the access code;
 *   anyone else's live product: only the browser that created it (the access code doesn't change that).
 */
export const canWrite = (s: Session, sku: Sku, owned: Owned) => (isProtectedSku(sku) ? s.u : ownsProduct(s, sku, owned));

// ------------------------------------------------------------------ answers (shown by the UI as written)

export const READ_ONLY_FIX = "Samples are read-only — upload your photo to try one-click fixes.";
export const READ_ONLY_SAMPLE = "Samples are read-only — upload your photo to build your own kit.";
export const READ_ONLY_NOT_YOURS = "Only the browser that uploaded this photo can change its kit — upload your own photo to try it.";
export const READ_ONLY_DEMO_SHELF = "The demo shelf is read-only — publish your products under a new shelf name.";
export const READ_ONLY_SHELF_TAKEN = "That shelf name is already taken — pick another name.";
export const SHELF_CAP_MESSAGE = "This session has already published its free shelves. Update one of them, or enter the demo access code.";

export const readOnly = (message = READ_ONLY_SAMPLE) => new HttpError(403, "read_only", message);

/** The read-only message for this product: the sample one for protected products, else "not yours". */
export const readOnlyMessageFor = (sku: Sku, sampleMessage = READ_ONLY_SAMPLE) => (isProtectedSku(sku) ? sampleMessage : READ_ONLY_NOT_YOURS);

/** Throw 403 read_only unless this browser may write to the product (see canWrite). */
export function assertCanWrite(s: Session, sku: Sku, owned: Owned, sampleMessage = READ_ONLY_SAMPLE): void {
  if (!canWrite(s, sku, owned)) throw readOnly(readOnlyMessageFor(sku, sampleMessage));
}

/**
 * The pipeline helpers (analyze, cutout, retouch, brief) refuse a read-only call with the
 * sample message; on someone else's live product say "not yours" instead. Use as `.catch(...)`.
 */
export function relabelReadOnly(sku: Sku): (err: unknown) => never {
  return (err: unknown) => {
    if (err instanceof HttpError && err.code === "read_only" && err.publicMessage === READ_ONLY_SAMPLE && !isProtectedSku(sku)) throw readOnly(READ_ONLY_NOT_YOURS);
    throw err;
  };
}

// ------------------------------------------------------------------ shelves

/**
 * What POST /api/shelf must still do before writing:
 *   "owned"   nothing: this browser may write the shelf;
 *   "verify"  the shelf already has heroes and this browser holds no proof for it: only
 *             the session its Cloudinary lock names may continue (lib/server/locks.ts);
 *   "claim"   a new name: claim its lock (atomic, first writer wins) right before writing.
 */
export type ShelfPlan = "owned" | "verify" | "claim";

/**
 * Who may write shelf `shop`, given the heroes already on it (pure; unit-tested).
 * `proof.owned`: this browser holds a shelf proof (cookie `s2s_s_<shop>`, or legacy session.sp);
 * `proof.held`: how many shelves it holds proofs for.
 *  - with the access code: anything (a new name is still claimed, so no visitor can take it meanwhile);
 *  - never the demo shelf, nor any shelf that already holds a sample / showcase product;
 *  - an existing shelf only if this browser created it (proof, or the lock names its session);
 *  - a new shelf only while this browser holds fewer than SHELVES_MAX, and only if its claim wins.
 * The products being published are checked separately (assertCanWrite: created in this browser).
 * `members` comes from the CDN tag list (up to ~60 s stale), which is why a name that looks
 * free there is never trusted: the lock claim is the authoritative check.
 */
export function authorizeShelf(s: Session, shop: string, members: { sku: string }[], proof: { owned: boolean; held: number }): ShelfPlan {
  if (s.u) return proof.owned || members.length ? "owned" : "claim";
  if (isProtectedShop(shop) || members.some((m) => isProtectedSku(m.sku))) throw readOnly(READ_ONLY_DEMO_SHELF);
  if (proof.owned) return "owned";
  if (members.length) return "verify";
  if (proof.held >= SHELVES_MAX) throw new HttpError(429, "cap_reached", SHELF_CAP_MESSAGE);
  return "claim";
}

// ------------------------------------------------------------------ phone capture

/** A capture claim is possible this long after the waiting browser's ticket was issued, and after the upload. */
export const CLAIM_WINDOW_S = CAPTURE_TTL_S;
/** Clock skew allowed between our clock and Cloudinary's version timestamps (s). */
const SKEW_S = 120;

/**
 * May the session holding capture `ticket` claim the phone upload of `sku` (raw version =
 * upload time, s)? Pure; unit-tested. The ticket must be this session's (the one that was
 * waiting for the sku before it existed), unexpired, and the raw must have landed after the
 * ticket was issued and within the claim window. Never a protected product.
 */
export function canClaimCapture(sku: Sku, ticket: Proof | null, sessionSid: string, rawVersion: number, now = Date.now()): boolean {
  if (!ticket || ticket.kind !== "capture" || ticket.subject !== sku || ticket.sid !== sessionSid || isProtectedSku(sku)) return false;
  const t = Math.floor(now / 1000);
  if (!Number.isFinite(rawVersion) || t - ticket.iat > CLAIM_WINDOW_S) return false;
  const age = t - rawVersion;
  return age >= -SKEW_S && age <= CLAIM_WINDOW_S && rawVersion >= ticket.iat - SKEW_S;
}
