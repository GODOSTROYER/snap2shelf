import { NextResponse, type NextRequest } from "next/server";
import type { ScenesResponse } from "@/lib/api-contract";
import { sceneFromListResource, sceneListUrl } from "@/lib/scenes";
import { apiError } from "@/lib/server/http";
import { mainCloud } from "@/lib/server/cld";
import type { Scene } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

type ListResource = Parameters<typeof sceneFromListResource>[0];

/**
 * GET /api/scenes?view=eye-level&theme=diwali → the scene library, read from the
 * client-side list JSON (tag s2s-scene) and cached for 60 s. No session: this
 * response is public and CDN-cacheable.
 */
export async function GET(req: NextRequest) {
  try {
    const view = req.nextUrl.searchParams.get("view");
    const theme = req.nextUrl.searchParams.get("theme");
    const res = await fetch(sceneListUrl(mainCloud()), { next: { revalidate: 60 } });
    let scenes: Scene[] = [];
    if (res.ok) {
      const json = (await res.json()) as { resources?: ListResource[] };
      scenes = (json.resources ?? []).map(sceneFromListResource).filter((s): s is Scene => s !== null);
    } else if (res.status !== 404) {
      // 404 = no asset carries the tag yet → empty library
      throw new Error(`scene list HTTP ${res.status}`);
    }
    if (view === "eye-level" || view === "top-down") scenes = scenes.filter((s) => s.view === view);
    if (theme && /^[a-z0-9-]{1,40}$/.test(theme)) scenes = scenes.filter((s) => s.theme === theme);
    return NextResponse.json({ scenes } satisfies ScenesResponse, {
      headers: { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (err) {
    const res = apiError(err, "scenes");
    res.headers.set("Cache-Control", "no-store");
    return res;
  }
}
