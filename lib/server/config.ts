import "server-only";

/** Server-side knobs, all overridable by env. Values are read per call so tests can change them. */

const intEnv = (name: string, fallback: number, min = 0, max = 1_000_000) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : fallback;
};

/** Live image generations one unlocked session may start. */
export const liveGenCap = () => intEnv("LIVE_GEN_CAP", 4, 0, 100);

/** Below this many usable generation credits (pool total, above per-account floors) live generation switches off. */
export const liveGenMin = () => intEnv("LIVE_GEN_MIN", 12, 0, 10_000);

/** Open (ungated) paid operations per session cookie: analyze, cutout, QA, pack. */
export const openOpCap = () => intEnv("OPEN_OP_CAP", 60, 1, 10_000);

/** Name of the signed upload preset created by scripts/setup-cloudinary.mjs. */
export const INGEST_PRESET = "s2s_ingest";

/**
 * Image-to-image models allowed through POST /api/generate, with their credit
 * cost per image (measured in SPIKES.md §2). Anything else is rejected.
 */
export const GENERATION_MODELS: Record<string, { credits: number }> = {
  "flux-2-flash-edit": { credits: 1 },
  "nano-banana-2-edit": { credits: 9 },
};

export function mainCloudName(): string {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME || process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!cloud) throw new Error("Cloudinary cloud name is not configured.");
  return cloud;
}
