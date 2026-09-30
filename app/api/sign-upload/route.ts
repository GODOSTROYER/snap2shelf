import { z } from "zod";
import type { SignUploadResponse } from "@/lib/api-contract";
import { assetInfo } from "@/lib/server/cld";
import { badRequest, readJson, route } from "@/lib/server/http";
import { rawId } from "@/lib/server/products";
import { ownsSku, withOwnedSku } from "@/lib/server/session";
import { checkParamsToSign, signParams } from "@/lib/server/upload-sign";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({ paramsToSign: z.record(z.string(), z.union([z.string(), z.number()])) });

/**
 * POST /api/sign-upload  (CldUploadWidget signatureEndpoint contract: {paramsToSign} → {signature}).
 * Signs only snap2shelf/products/<sku>/raw uploads through the s2s_ingest preset, never for a
 * sample / showcase sku (lib/server/protect.ts).
 *
 * When the raw doesn't exist yet (one Upload-API explicit, no Admin API), the sku is recorded in
 * this browser's signed session as one it created: that is what lets it apply one-click readiness
 * fixes and publish shelves without the access code. A raw that already exists is signed as
 * before (the preset never overwrites) but grants nothing.
 */
export const POST = route("sign-upload", async (req, session) => {
  const { paramsToSign } = await readJson(req, schema, 4096);
  const check = checkParamsToSign(paramsToSign);
  if (!check.ok) throw badRequest("These upload parameters can't be signed.");
  const body = { signature: signParams(check.params) } satisfies SignUploadResponse;
  if (ownsSku(session, check.sku)) return { body };
  let fresh = false;
  try {
    fresh = (await assetInfo(rawId(check.sku))) === null;
  } catch (err) {
    console.warn(`[sign-upload] raw lookup failed, not recording the sku: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
  }
  return { body, session: fresh ? withOwnedSku(session, check.sku) : undefined };
});
