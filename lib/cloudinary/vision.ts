import "server-only";
import { z } from "zod";
import type { CloudinaryAccount } from "./accounts";
import { cldRequest, type AddonQuota } from "./rest";

/**
 * Cloudinary AI Vision (Analyze API, beta), checked against the API reference 2026-09-29.
 *   POST /v2/analysis/{cloud}/analyze/ai_vision_general  { source, prompts[1..10] }
 *   POST /v2/analysis/{cloud}/analyze/ai_vision_tagging  { source, tag_definitions[1..10] }
 * `source` is either { asset_id } (asset in that same account) or { uri } (any
 * public URL), so a pool account can analyse an asset delivered from main.
 */

export type VisionSource = { asset_id: string } | { uri: string };

const generalSchema = z.object({
  data: z.object({
    analysis: z.object({
      responses: z.array(z.object({ value: z.string() }).loose()),
      model_version: z.union([z.string(), z.number()]).optional(),
    }),
  }),
});

const taggingSchema = z.object({
  data: z.object({
    analysis: z.object({
      tags: z.array(z.object({ name: z.string() }).loose()).default([]),
      model_version: z.union([z.string(), z.number()]).optional(),
    }),
  }),
});

const visionQuota = (quotas: AddonQuota[]) => quotas.find((q) => q.type === "ai_vision") ?? null;

export async function visionGeneral(
  account: CloudinaryAccount,
  source: VisionSource,
  prompts: string[],
): Promise<{ answers: string[]; quota: AddonQuota | null }> {
  if (prompts.length < 1 || prompts.length > 10) throw new Error("ai_vision_general takes 1-10 prompts");
  const { body, quotas } = await cldRequest<unknown>(account, "/analysis/{cloud}/analyze/ai_vision_general", {
    body: { source, prompts },
  });
  const parsed = generalSchema.parse(body);
  return { answers: parsed.data.analysis.responses.map((r) => r.value), quota: visionQuota(quotas) };
}

export interface TagDefinition {
  /** lower-case letters, digits and hyphens only (API rejects underscores) */
  name: string;
  description: string;
}

/** Returns the names of the tags that matched (AI Vision tagging reports no confidence). */
export async function visionTagging(
  account: CloudinaryAccount,
  source: VisionSource,
  tagDefinitions: TagDefinition[],
): Promise<{ matched: string[]; quota: AddonQuota | null }> {
  if (tagDefinitions.length < 1 || tagDefinitions.length > 10) throw new Error("ai_vision_tagging takes 1-10 tag definitions");
  const bad = tagDefinitions.find((t) => !/^[a-z0-9-]+$/.test(t.name));
  if (bad) throw new Error(`Invalid AI Vision tag name "${bad.name}": use lower-case letters, digits and hyphens`);
  const { body, quotas } = await cldRequest<unknown>(account, "/analysis/{cloud}/analyze/ai_vision_tagging", {
    body: { source, tag_definitions: tagDefinitions },
  });
  const parsed = taggingSchema.parse(body);
  return { matched: parsed.data.analysis.tags.map((t) => t.name), quota: visionQuota(quotas) };
}

/**
 * AI Vision answers are free text. Pull the first JSON object/array out of an
 * answer (models sometimes wrap it in prose or ``` fences) and validate it.
 */
export function parseJsonAnswer<T>(answer: string, schema: z.ZodType<T>): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(answer)?.[1];
  const candidates = [fenced, answer, /[[{][\s\S]*[\]}]/.exec(answer)?.[0]].filter((s): s is string => Boolean(s));
  for (const c of candidates) {
    try {
      const r = schema.safeParse(JSON.parse(c.trim()));
      if (r.success) return r.data;
    } catch {
      // try the next candidate
    }
  }
  return null;
}
