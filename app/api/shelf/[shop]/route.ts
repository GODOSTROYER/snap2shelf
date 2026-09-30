import { NextResponse } from "next/server";
import type { ApiError, ShelfGetResponse } from "@/lib/api-contract";
import { apiError } from "@/lib/server/http";
import { getShelf } from "@/lib/shelf/server";
import { checkShop } from "@/lib/shelf/slug";

export const runtime = "nodejs";
export const maxDuration = 30;

/** GET /api/shelf/:shop → the shelf as the storefront renders it. Public and CDN-cacheable, no session. */
export async function GET(_req: Request, ctx: { params: Promise<{ shop: string }> }) {
  try {
    const { shop } = await ctx.params;
    if (!checkShop(shop).ok) return NextResponse.json({ error: "Invalid shop name.", code: "bad_request" } satisfies ApiError, { status: 400 });
    const shelf = await getShelf(shop);
    if (!shelf) return NextResponse.json({ error: "No shelf with that name yet.", code: "not_found" } satisfies ApiError, { status: 404 });
    return NextResponse.json(shelf satisfies ShelfGetResponse, {
      headers: { "Cache-Control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (err) {
    const res = apiError(err, "shelf-get");
    res.headers.set("Cache-Control", "no-store");
    return res;
  }
}
