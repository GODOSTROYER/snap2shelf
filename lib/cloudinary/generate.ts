import "server-only";
import { z } from "zod";
import type { CloudinaryAccount } from "./accounts";
import { cldRequest, type AddonQuota } from "./rest";

/**
 * Cloudinary Image Generation API (v2, checked against the API reference 2026-09-29).
 *   POST /v2/generate/{cloud}/text_to_image | image_to_image
 *   GET  /v2/generate/{cloud}/tasks/{task_id}
 * One asset per request. `-edit` model ids work only on image_to_image.
 */

export type GenerateOperation = "text_to_image" | "image_to_image";

export type ModelPreference = "balanced" | "quality" | "economy" | "balanced_fast" | "quality_fast" | "economy_fast";

export type ModelSpec =
  | { mode: "auto"; preference?: ModelPreference }
  | { id: string }
  | { family: "flux" | "recraft" | "gpt-image" | "nano-banana" | "ideogram"; tier?: "standard" | "premium" };

/** Only these aspect ratios are accepted; anything else needs explicit width/height. */
export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

export type ImageSize =
  | { width: number; height: number }
  | { aspect_ratio: AspectRatio; resolution?: "0.5K" | "1K" | "2K" | "4K" };

export type ReferenceImage =
  | { source_type: "managed_asset"; asset_id: string }
  | { source_type: "url"; url: string };

export interface GenerateRequest {
  prompt: string;
  model?: ModelSpec;
  image_size?: ImageSize;
  format?: "jpeg" | "png" | "webp";
  seed?: number | null;
  async?: boolean;
  notification_url?: string;
  target?: { target_type: "managed_asset"; public_id?: string; upload_preset?: string } | { target_type: "temporary" };
  reference_images?: ReferenceImage[];
}

const assetSchema = z.object({
  storage: z.object({
    storage_type: z.string(),
    secure_url: z.string(),
    asset_id: z.string().optional(),
    public_id: z.string().optional(),
    version: z.union([z.number(), z.string()]).optional(),
    expires_at: z.string().optional(),
  }),
  format: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  bytes: z.number().optional(),
  seed: z.number().nullable().optional(),
  model: z.object({ id: z.string(), family: z.string().optional(), tier: z.string().optional() }).partial().optional(),
});
export type GeneratedAsset = z.infer<typeof assetSchema>;

const syncSchema = z.object({
  data: z.object({ assets: z.array(assetSchema) }),
  notices: z.array(z.object({ severity: z.string(), text: z.string() })).optional(),
  request_id: z.string().optional(),
});

const taskSchema = z.object({
  data: z.object({
    task_id: z.string(),
    status: z.enum(["pending", "processing", "completed", "failed"]),
    result: z
      .looseObject({ assets: z.array(assetSchema).optional() })
      .nullable()
      .optional(),
    error: z.unknown().optional(),
  }),
  request_id: z.string().optional(),
});

export type TaskStatus = z.infer<typeof taskSchema>["data"]["status"];

export interface GenerationOutcome {
  status: TaskStatus;
  taskId?: string;
  assets: GeneratedAsset[];
  quota: AddonQuota | null;
  notices: { severity: string; text: string }[];
  error?: string;
}

const genQuota = (quotas: AddonQuota[]) => quotas.find((q) => q.type === "image_generation") ?? null;

/** Start a generation. With `async: true` returns a task id to poll; otherwise the finished asset. */
export async function startGeneration(
  account: CloudinaryAccount,
  op: GenerateOperation,
  req: GenerateRequest,
): Promise<GenerationOutcome> {
  const { body, quotas } = await cldRequest<unknown>(account, `/generate/{cloud}/${op}`, { body: req });
  const quota = genQuota(quotas);

  const asTask = taskSchema.safeParse(body);
  if (asTask.success && asTask.data.data.task_id) {
    const d = asTask.data.data;
    return { status: d.status, taskId: d.task_id, assets: d.result?.assets ?? [], quota, notices: [] };
  }
  const sync = syncSchema.parse(body);
  return { status: "completed", assets: sync.data.assets, quota, notices: sync.notices ?? [] };
}

/** Poll a generation task once. */
export async function getGenerationTask(account: CloudinaryAccount, taskId: string): Promise<GenerationOutcome> {
  if (!/^[a-f0-9]{1,256}$/.test(taskId)) throw new Error("Invalid task id");
  const { body, quotas } = await cldRequest<unknown>(account, `/generate/{cloud}/tasks/${taskId}`, { method: "GET" });
  const d = taskSchema.parse(body).data;
  const error = d.status === "failed" ? JSON.stringify(d.error ?? d.result ?? "generation failed").slice(0, 300) : undefined;
  return { status: d.status, taskId: d.task_id, assets: d.result?.assets ?? [], quota: genQuota(quotas), notices: [], error };
}
