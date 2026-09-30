import "server-only";
import { z } from "zod";
import { deriveKey, seal, unseal } from "./crypto";

/**
 * Opaque job handle returned by POST /api/generate and polled at GET /api/jobs/:job.
 * Encrypted + authenticated (AES-256-GCM, key derived from the API secret), so the
 * client can neither read which pool account runs the task nor forge/alter a job.
 */
const jobSchema = z.object({
  v: z.literal(1),
  a: z.string().min(1).max(32), // internal account label (never sent in clear)
  t: z.string().regex(/^[a-f0-9]{1,256}$/), // Cloudinary task id
  s: z.string().regex(/^[a-z0-9]{8}$/), // sku
  m: z.string().min(1).max(64), // model id
  seed: z.number().int().min(0),
  cv: z.number().int().min(0), // cutout version used as the reference (rebuilds the request JSON)
  p: z.string().max(400), // user prompt (to rebuild the request JSON for X-ray)
  sid: z.string().max(32), // session that started it
  iat: z.number().int(), // ms
});
export type JobClaims = z.infer<typeof jobSchema>;

const JOB_TTL_MS = 2 * 3600_000;
export const jobKey = () => deriveKey("s2s-job");

export function encodeJob(claims: Omit<JobClaims, "v">, key = jobKey()): string {
  return seal(key, { v: 1, ...claims });
}

export function decodeJob(token: string | undefined | null, key = jobKey(), now = Date.now()): JobClaims | null {
  const parsed = jobSchema.safeParse(unseal(key, token));
  if (!parsed.success) return null;
  if (now - parsed.data.iat > JOB_TTL_MS || parsed.data.iat - now > 60_000) return null;
  return parsed.data;
}
