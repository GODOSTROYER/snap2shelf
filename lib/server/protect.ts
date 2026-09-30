import "server-only";
import { DEMO_SHELF } from "../claims";
import { SAMPLES } from "../showcase";
import { SHOWCASE } from "../showcase-data";
import { SKU_RE, type Sku } from "../types";
import { HttpError } from "./http";
import { ownsSku, SHELVES_MAX, type Session } from "./session";

/**
 * Write locks for the public showcase (judges use the live site unattended).
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
 * Other browsers' products: one-click readiness fixes, collections and shelves
 * change what a product's public pages show, so without the access code they
 * need the product to have been created in THIS browser (session.k, recorded
 * when /api/sign-upload signs the first upload of a raw that didn't exist yet,
 * or when /api/capture sees a phone upload land within CLAIM_WINDOW_S).
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

/** May this session write to (or spend AI on) this product? Everyone may, except on protected products without the access code. */
export const canWrite = (s: Session, sku: Sku) => s.u || !isProtectedSku(sku);

/** Created in this browser, or the access code is entered. Never true for a protected product without the code. */
export const canChange = (s: Session, sku: Sku) => s.u || (!isProtectedSku(sku) && ownsSku(s, sku));

// ------------------------------------------------------------------ answers (shown by the UI as written)

export const READ_ONLY_FIX = "Samples are read-only — upload your photo to try one-click fixes.";
export const READ_ONLY_SAMPLE = "Samples are read-only — upload your photo to build your own kit.";
export const READ_ONLY_NOT_YOURS = "Only the browser that uploaded this photo can change its kit — upload your own photo to try it.";
export const READ_ONLY_DEMO_SHELF = "The demo shelf is read-only — publish your products under a new shelf name.";
export const READ_ONLY_SHELF_TAKEN = "That shelf name is already taken — pick another name.";
export const SHELF_CAP_MESSAGE = "This session has already published its free shelves. Update one of them, or enter the demo access code.";

export const readOnly = (message = READ_ONLY_SAMPLE) => new HttpError(403, "read_only", message);

/** Throw 403 read_only unless this session may write to the product (sample / showcase lock). */
export function assertCanWrite(s: Session, sku: Sku, message = READ_ONLY_SAMPLE): void {
  if (!canWrite(s, sku)) throw readOnly(message);
}

/** Throw 403 read_only unless the product was created in this browser (or the access code is entered). */
export function assertCanChange(s: Session, sku: Sku, sampleMessage = READ_ONLY_SAMPLE): void {
  if (!canWrite(s, sku)) throw readOnly(sampleMessage);
  if (!canChange(s, sku)) throw readOnly(READ_ONLY_NOT_YOURS);
}

/**
 * Who may write shelf `shop`, given the heroes already on it (pure; unit-tested). With the access
 * code: anything. Without it:
 *  - never the demo shelf, nor any shelf that already holds a sample / showcase product;
 *  - a shelf that already exists only if this browser created it (session.sp);
 *  - a new shelf only while this browser has created fewer than SHELVES_MAX.
 * The products being published are checked separately (assertCanChange: created in this browser).
 */
export function authorizeShelf(s: Session, shop: string, members: { sku: string }[]): void {
  if (s.u) return;
  if (isProtectedShop(shop) || members.some((m) => isProtectedSku(m.sku))) throw readOnly(READ_ONLY_DEMO_SHELF);
  if (s.sp?.includes(shop)) return;
  if (members.length) throw readOnly(READ_ONLY_SHELF_TAKEN);
  if ((s.sp?.length ?? 0) >= SHELVES_MAX) throw new HttpError(429, "cap_reached", SHELF_CAP_MESSAGE);
}

/** A phone capture seen landing this recently (raw version = upload time, s) is claimed by the browser polling for it. */
export const CLAIM_WINDOW_S = 30 * 60;

export function canClaimCapture(sku: Sku, rawVersion: number, now = Date.now()): boolean {
  const age = Math.floor(now / 1000) - rawVersion;
  return !isProtectedSku(sku) && Number.isFinite(age) && age >= -300 && age <= CLAIM_WINDOW_S;
}
