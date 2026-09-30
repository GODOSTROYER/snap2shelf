// Signed upload of a local file through the s2s_ingest preset, using exactly the
// allowlist + signature logic behind POST /api/sign-upload. Used by e2e and spikes.
import { readFileSync } from "node:fs";
import { basename } from "node:path";

export async function signedRawUpload(file: string, sku: string, extra: { tags?: string; context?: string } = {}) {
  const { checkParamsToSign, signParams } = await import("../../lib/server/upload-sign.ts");
  const paramsToSign: Record<string, string | number> = {
    timestamp: Math.floor(Date.now() / 1000),
    upload_preset: "s2s_ingest",
    public_id: `snap2shelf/products/${sku}/raw`,
    tags: extra.tags ?? `s2s,s2s-raw,s2s-sku-${sku}`,
    ...(extra.context ? { context: extra.context } : {}),
  };
  const check = checkParamsToSign(paramsToSign);
  if (!check.ok) throw new Error(`sign-upload allowlist refused: ${check.reason}`);
  const signature = signParams(check.params);

  const form = new FormData();
  form.set("file", new Blob([readFileSync(file)]), basename(file));
  for (const [k, v] of Object.entries(check.params)) form.set(k, String(v));
  form.set("api_key", process.env.CLOUDINARY_API_KEY!);
  form.set("signature", signature);
  const t0 = Date.now();
  const res = await fetch(`https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`, { method: "POST", body: form });
  const body = (await res.json()) as { public_id?: string; width?: number; height?: number; bytes?: number; version?: number; error?: { message: string } };
  if (!res.ok) throw new Error(`upload failed: HTTP ${res.status} ${body.error?.message ?? ""}`);
  return { ...body, ms: Date.now() - t0 };
}
