import { z } from "zod";
import type { AccessResponse } from "@/lib/api-contract";
import { safeEqual } from "@/lib/server/crypto";
import { HttpError, readJson, route } from "@/lib/server/http";
import { generationsLeft, grantUnlock } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({ code: z.string().min(1).max(128) });

/**
 * POST /api/access { code } → unlock live generation for this session: its own httpOnly signed
 * cookie (s2s_unlock, bound to the session id), so no other route's response can undo it.
 * Re-entering the code never resets the generations already used (they are separate cookies).
 */
export const POST = route("access", async (req, session) => {
  const { code } = await readJson(req, schema);
  const expected = process.env.DEMO_ACCESS_CODE;
  if (!expected || !safeEqual(code.trim(), expected)) {
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing
    throw new HttpError(403, "locked", "That access code isn't right.");
  }
  return { body: { ok: true, generationsLeft: generationsLeft({ ...session, u: true }) } satisfies AccessResponse, cookies: grantUnlock(req, session) };
});
