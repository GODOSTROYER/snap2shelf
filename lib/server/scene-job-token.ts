import "server-only";
import { z } from "zod";
import { deriveKey, seal, unseal } from "./crypto";

/**
 * Opaque handle for an on-demand scene job (POST /api/scenes/generate →
 * GET /api/scene-jobs/:job). AES-256-GCM sealed with its own derived key, so it
 * can't be read (which pool account runs the task), forged, or swapped with a
 * creative-job token.
 */
const sceneJobSchema = z.object({
  v: z.literal(1),
  k: z.literal("scene"),
  a: z.string().min(1).max(32), // internal account label (never sent in clear)
  t: z.string().regex(/^[a-f0-9]{1,256}$/), // Cloudinary task id
  th: z.string().regex(/^[a-z0-9-]{1,40}$/), // theme folder
  vw: z.enum(["eye-level", "top-down"]),
  ti: z.enum(["draft", "final"]),
  x: z.string().max(300), // cleaned user backdrop text ("" = theme recipe)
  seed: z.number().int().min(0),
  id: z.string().regex(/^snap2shelf\/scenes\/[a-z0-9-]{1,40}\/(?:draft|final)-[a-f0-9]{8}$/), // plate public id
  sku: z.string().regex(/^[a-z0-9]{8}$/).optional(),
  sid: z.string().max(32),
  iat: z.number().int(), // ms
});
export type SceneJobClaims = z.infer<typeof sceneJobSchema>;

const TTL_MS = 2 * 3600_000;
export const sceneJobKey = () => deriveKey("s2s-scene-job");

export function encodeSceneJob(claims: Omit<SceneJobClaims, "v" | "k">, key = sceneJobKey()): string {
  return seal(key, { v: 1, k: "scene", ...claims });
}

export function decodeSceneJob(token: string | undefined | null, key = sceneJobKey(), now = Date.now()): SceneJobClaims | null {
  const parsed = sceneJobSchema.safeParse(unseal(key, token));
  if (!parsed.success) return null;
  if (now - parsed.data.iat > TTL_MS || parsed.data.iat - now > 60_000) return null;
  return parsed.data;
}
