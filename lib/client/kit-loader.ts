/**
 * Rebuild a finished kit from Cloudinary's public tag lists alone (no API, no
 * secrets), so /kit/<sku> works for any saved kit:
 *   s2s-pack-<sku>  materialised channel assets  snap2shelf/products/<sku>/pack/<format>
 *   s2s-sku-<sku>   raw, cut-out and saved hero  snap2shelf/products/<sku>/{raw,cutout,hero-…}
 *   s2s-scene       the scene library (for the scene's name)
 */
import { sceneFromListResource } from "../scenes";
import { getShowcaseKit, heroAlt, reelClips } from "../showcase";
import { deliveryBase } from "../transform/composite";
import { describeTransformation } from "../transform/xray";
import { reelUrl } from "../transform/reel";
import { SKU_RE, type Kit, type KitAsset, type Placement, type PreviewFrame } from "../types";
import { recolorLabel } from "./swatches";

interface ListResource {
  public_id: string;
  version: number;
  width: number;
  height: number;
  format: string;
  created_at: string;
  context?: { custom?: Record<string, string> };
}

const FORMATS: Record<string, { label: string; frame: PreviewFrame; format: KitAsset["format"] }> = {
  feed: { label: "Feed post 4:5", frame: "feed-post", format: "feed" },
  story: { label: "Story 9:16", frame: "story", format: "story" },
  banner: { label: "Web banner 16:9", frame: "web-banner", format: "banner" },
  marketplace: { label: "Marketplace main 2000px", frame: "listing-card", format: "marketplace" },
  whatsapp: { label: "WhatsApp catalog tile", frame: "catalog-tile", format: "whatsapp" },
  offer: { label: "Festive offer", frame: "feed-post", format: "offer" },
};

async function list(tag: string): Promise<ListResource[]> {
  const res = await fetch(`https://res.cloudinary.com/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/list/${tag}.json`, { next: { revalidate: 60 } });
  if (!res.ok) return [];
  return ((await res.json()) as { resources?: ListResource[] }).resources ?? [];
}

export async function loadKit(sku: string): Promise<Kit | null> {
  const show = getShowcaseKit(sku);
  if (show) return show;
  if (!SKU_RE.test(sku)) return null;

  const [pack, product] = await Promise.all([list(`s2s-pack-${sku}`), list(`s2s-sku-${sku}`)]);
  const raw = product.find((r) => r.public_id.endsWith("/raw"));
  const ctx = raw?.context?.custom ?? {};
  // the current pack's hero is named on the raw (hero-<scene>-<hash>); older heroes may still carry the tag
  const heroRes = product.find((r) => r.public_id === ctx.hero) ?? product.filter((r) => /\/hero-[^/]+$/.test(r.public_id)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!heroRes) return null;
  const current = pack.filter((r) => !r.context?.custom?.hero || r.context.custom.hero === heroRes.public_id);
  if (!current.length) return null;
  const cutout = product.find((r) => r.public_id.endsWith("/cutout"));

  const sceneSlug = heroRes.context?.custom?.scene ?? "";
  const scenes = sceneSlug ? await list("s2s-scene") : [];
  const scene = scenes.map((r) => sceneFromListResource(r)).find((s) => s && s.publicId.split("/").slice(-2).join("-") === sceneSlug) ?? null;

  const understanding = ctx.u_name
    ? {
        name: ctx.u_name,
        category: ctx.u_cat ?? "",
        primary_color: ctx.u_color ?? "",
        material: ctx.u_mat ?? "",
        recolorable_part: ctx.u_part ?? "",
        placement: (["standing", "flatlay", "hanging"].includes(ctx.u_place) ? ctx.u_place : "standing") as Placement,
        suggested_themes: (ctx.u_themes ?? "").split(",").filter(Boolean),
      }
    : undefined;
  const alt = scene ? heroAlt({ understanding }, scene) : `${understanding?.name ?? "Product"}, staged on a new scene`;

  const assets = current
    .map((r): KitAsset | null => {
      const id = r.public_id.split("/").pop() ?? "";
      const meta = id.startsWith("recolor-") ? { label: recolorLabel(id, understanding), frame: "feed-post" as const, format: "recolor" as const } : FORMATS[id];
      if (!meta) return null;
      const url = `${deliveryBase()}/f_auto,q_auto/v${r.version}/${r.public_id}`;
      return { id, format: meta.format, label: meta.label, url, width: r.width, height: r.height, frame: meta.frame, alt, publicId: r.public_id, xray: describeTransformation(url) };
    })
    .filter((a): a is KitAsset => !!a);

  const heroUrl = `${deliveryBase()}/f_auto,q_auto/v${heroRes.version}/${heroRes.public_id}`;
  const clips = reelClips(heroRes.public_id, assets);
  const reel = clips.length ? reelUrl({ images: clips, offer: ctx.pack_hi || ctx.pack_en ? { hindi: ctx.pack_hi || undefined, english: ctx.pack_en || undefined } : undefined }) : null;

  return {
    sku,
    product: {
      sku,
      rawPublicId: raw?.public_id ?? heroRes.public_id,
      rawWidth: raw?.width ?? 0,
      rawHeight: raw?.height ?? 0,
      rawBytes: 0,
      caption: ctx.caption,
      understanding,
      cutout: cutout ? { publicId: cutout.public_id, width: cutout.width, height: cutout.height } : undefined,
    },
    mode: "exact",
    scene: scene ?? undefined,
    hero: {
      id: "hero",
      format: "hero",
      label: "Hero 4:5",
      url: heroUrl,
      width: heroRes.width,
      height: heroRes.height,
      frame: "feed-post",
      alt,
      publicId: heroRes.public_id,
      xray: describeTransformation(heroUrl),
    },
    assets,
    reel: reel ? { url: reel.url, xray: reel, seconds: reel.seconds } : undefined,
    cost: { generationCredits: 0, creditsSavedByReuse: 0, aiVisionTokens: 0, transformationsEstimate: 0, bytesOriginal: 0, bytesDelivered: 0, seconds: 0 },
    createdAt: heroRes.created_at,
  };
}
