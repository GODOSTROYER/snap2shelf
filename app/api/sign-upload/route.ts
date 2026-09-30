import { z } from "zod";
import type { SignUploadResponse } from "@/lib/api-contract";
import { assetInfo } from "@/lib/server/cld";
import { badRequest, readJson, route } from "@/lib/server/http";
import { grantProof, provenSkus } from "@/lib/server/proofs";
import { rawId } from "@/lib/server/products";
import { ownsProduct } from "@/lib/server/protect";
import { checkParamsToSign, signParams } from "@/lib/server/upload-sign";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({ paramsToSign: z.record(z.string(), z.union([z.string(), z.number()])) });

/**
 * POST /api/sign-upload  (CldUploadWidget signatureEndpoint contract: {paramsToSign} → {signature}).
 * Signs only snap2shelf/products/<sku>/raw uploads through the s2s_ingest preset, never for a
 * sample / showcase sku (lib/server/protect.ts).
 *
 * When the raw doesn't exist yet (one Upload-API explicit, no Admin API), this browser gets a
 * product proof for the sku (httpOnly cookie s2s_p_<sku>, lib/server/proofs.ts): that is what
 * lets it run the pipeline on the product, apply one-click fixes and publish shelves. A raw that
 * already exists is signed as before (the preset never overwrites) but grants nothing. The proof
 * is its own cookie, so concurrent requests re-issuing the session cookie can't drop it.
 */
export const POST = route("sign-upload", async (req, session) => {
  const { paramsToSign } = await readJson(req, schema, 4096);
  const check = checkParamsToSign(paramsToSign);
  if (!check.ok) throw badRequest("These upload parameters can't be signed.");
  const body = { signature: signParams(check.params) } satisfies SignUploadResponse;
  if (ownsProduct(session, check.sku, provenSkus(req))) return { body };
  let fresh = false;
  try {
    fresh = (await assetInfo(rawId(check.sku))) === null;
  } catch (err) {
    console.warn(`[sign-upload] raw lookup failed, not recording the sku: ${String((err as Error)?.message ?? err).slice(0, 120)}`);
  }
  return { body, cookies: fresh ? grantProof(req, "product", check.sku, session.sid) : undefined };
});
