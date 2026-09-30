import { z } from "zod";
import type { QaResponse } from "@/lib/api-contract";
import { mainCloud } from "@/lib/server/cld";
import { recordTokens, TOKEN_KEYS } from "@/lib/server/facts";
import { checkMainImageUrl } from "@/lib/server/guard";
import { badRequest, chargeOpenOp, readJson, route, skuSchema } from "@/lib/server/http";
import { prebuiltCreativeQa, prebuiltQa } from "@/lib/server/prebuilt";
import { provenSkus } from "@/lib/server/proofs";
import { canWrite, readOnly, readOnlyMessageFor } from "@/lib/server/protect";
import { exactQa, fidelityQa, imageOfProduct } from "@/lib/server/qa";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({ sku: skuSchema, url: z.string().min(1).max(2048), kind: z.enum(["exact", "creative"]) });

/**
 * POST /api/qa → AI Vision QA gate: exact = "does the composite look pasted?", creative = fidelity sheet.
 * The tokens a check spends are added to the product's cost ledger (facts t_qa → GET /api/cost/:sku).
 * Sample / showcase products without the access code: only the verdicts recorded when the showcase
 * was built (no AI Vision call), else 403 read_only. Another browser's product: 403 read_only
 * (a check spends AI Vision and writes to that product's cost ledger).
 */
export const POST = route("qa", async (req, session) => {
  const body = await readJson(req, schema);
  const check = checkMainImageUrl(body.url, mainCloud());
  if (!check.ok) throw badRequest("Only images made in this app can be checked.");
  const creative =
    body.kind === "creative" ? new RegExp(`/(snap2shelf/products/${body.sku}/creative-[a-z0-9-]+)(?:\\.[a-z]{3,4})?$`).exec(check.url.pathname)?.[1] : undefined;
  if (body.kind === "creative" && !creative) throw badRequest("Creative QA needs a creative image of this product.");

  if (!canWrite(session, body.sku, provenSkus(req))) {
    const recorded = creative ? prebuiltCreativeQa(creative) : prebuiltQa(body.url);
    if (!recorded) throw readOnly(readOnlyMessageFor(body.sku));
    return { body: { qa: recorded, tokens: 0 } satisfies QaResponse };
  }

  const charged = chargeOpenOp(session);
  const out = creative ? await fidelityQa(body.sku, creative) : await exactQa(body.url);
  if (out.tokens > 0 && (creative || imageOfProduct(body.sku, check.url.pathname))) await recordTokens(body.sku, TOKEN_KEYS.qa, out.tokens);
  return { body: { qa: out.qa, tokens: out.tokens } satisfies QaResponse, session: charged };
});
