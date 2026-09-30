import { z } from "zod";
import type { QaResponse } from "@/lib/api-contract";
import { mainCloud } from "@/lib/server/cld";
import { checkMainImageUrl } from "@/lib/server/guard";
import { badRequest, chargeOpenOp, readJson, route, skuSchema } from "@/lib/server/http";
import { exactQa, fidelityQa } from "@/lib/server/qa";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({ sku: skuSchema, url: z.string().min(1).max(2048), kind: z.enum(["exact", "creative"]) });

/** POST /api/qa → AI Vision QA gate: exact = "does the composite look pasted?", creative = fidelity sheet. */
export const POST = route("qa", async (req, session) => {
  const body = await readJson(req, schema);
  const check = checkMainImageUrl(body.url, mainCloud());
  if (!check.ok) throw badRequest("Only images made in this app can be checked.");
  const charged = chargeOpenOp(session);

  if (body.kind === "exact") {
    const out = await exactQa(body.url);
    return { body: { qa: out.qa, tokens: out.tokens } satisfies QaResponse, session: charged };
  }
  const m = new RegExp(`/(snap2shelf/products/${body.sku}/creative-[a-z0-9-]+)(?:\\.[a-z]{3,4})?$`).exec(check.url.pathname);
  if (!m) throw badRequest("Creative QA needs a creative image of this product.");
  const out = await fidelityQa(body.sku, m[1]);
  return { body: { qa: out.qa, tokens: out.tokens } satisfies QaResponse, session: charged };
});
