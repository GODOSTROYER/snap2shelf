import { z } from "zod";
import type { BriefResponse } from "@/lib/api-contract";
import { FESTIVAL_SLUGS } from "@/lib/festivals";
import { runBrief } from "@/lib/server/brief";
import { chargeOpenOp, readJson, route, skuSchema } from "@/lib/server/http";
import type { Session } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({
  sku: skuSchema,
  brief: z.string().trim().min(1).max(300),
  festival: z.enum(FESTIVAL_SLUGS).optional(),
});

/**
 * POST /api/brief { sku, brief, festival? } → kit settings for the studio's brief bar
 * (theme, offer lines, channels, swatches, tone). One AI Vision call on the product
 * photo (one open paid operation); the same brief again is answered from cache.
 */
export const POST = route("brief", async (req, session) => {
  const body = await readJson(req, schema, 4096);
  let charged: Session | undefined;
  const { response } = await runBrief(body.sku, body.brief, body.festival, { beforeSpend: () => void (charged = chargeOpenOp(session)) });
  return { body: response satisfies BriefResponse, session: charged };
});
