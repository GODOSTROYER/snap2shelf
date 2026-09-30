import { z } from "zod";
import type { SignUploadResponse } from "@/lib/api-contract";
import { badRequest, readJson, route } from "@/lib/server/http";
import { checkParamsToSign, signParams } from "@/lib/server/upload-sign";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({ paramsToSign: z.record(z.string(), z.union([z.string(), z.number()])) });

/**
 * POST /api/sign-upload  (CldUploadWidget signatureEndpoint contract: {paramsToSign} → {signature}).
 * Signs only snap2shelf/products/<sku>/raw uploads through the s2s_ingest preset.
 */
export const POST = route("sign-upload", async (req) => {
  const { paramsToSign } = await readJson(req, schema, 4096);
  const check = checkParamsToSign(paramsToSign);
  if (!check.ok) throw badRequest("These upload parameters can't be signed.");
  return { body: { signature: signParams(check.params) } satisfies SignUploadResponse };
});
