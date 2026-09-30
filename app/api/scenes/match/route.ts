import { NextResponse, type NextRequest } from "next/server";
import type { SceneMatchResponse } from "@/lib/api-contract";
import { apiError } from "@/lib/server/http";
import { libraryScenes, rankScenes } from "@/lib/server/scenes";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/scenes/match?theme=diwali&q=brass+diyas&view=eye-level&limit=6
 * Ranks the existing library (client-side list, cached) by theme, keywords, festival
 * and warmth. Visual Search isn't available on the Free plan (SPIKES.md §8), so this
 * is the "find a scene like this" path. Public and cacheable: no session.
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const theme = sp.get("theme") ?? undefined;
    const q = (sp.get("q") ?? "").slice(0, 300);
    const view = sp.get("view");
    const limit = Math.min(20, Math.max(1, Number(sp.get("limit")) || 6));
    const scenes = await libraryScenes();
    const matches = rankScenes(
      scenes,
      {
        theme: theme && /^[a-z0-9-]{1,40}$/.test(theme) ? theme : undefined,
        text: q,
        view: view === "eye-level" || view === "top-down" ? view : undefined,
      },
      limit,
    );
    return NextResponse.json({ matches } satisfies SceneMatchResponse, {
      headers: { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (err) {
    const res = apiError(err, "scenes-match");
    res.headers.set("Cache-Control", "no-store");
    return res;
  }
}
