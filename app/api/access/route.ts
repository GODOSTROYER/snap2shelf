import { z } from "zod";
import type { AccessResponse } from "@/lib/api-contract";
import { safeEqual } from "@/lib/server/crypto";
import { HttpError, readJson, route } from "@/lib/server/http";
import { generationsLeft } from "@/lib/server/session";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({ code: z.string().min(1).max(128) });

/** POST /api/access { code } → unlock live generation for this session (httpOnly signed cookie). */
export const POST = route("access", async (req, session) => {
  const { code } = await readJson(req, schema);
  const expected = process.env.DEMO_ACCESS_CODE;
  if (!expected || !safeEqual(code.trim(), expected)) {
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing
    throw new HttpError(403, "locked", "That access code isn't right.");
  }
  // Re-entering the code keeps the generations already used in this session.
  const next = { ...session, u: true };
  return { body: { ok: true, generationsLeft: generationsLeft(next) } satisfies AccessResponse, session: next };
});
