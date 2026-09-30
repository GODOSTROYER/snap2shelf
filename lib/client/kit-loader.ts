/**
 * Rebuild a finished kit from Cloudinary's public tag lists alone (no API, no
 * secrets), so /kit/<sku> works for any saved kit:
 *   s2s-pack-<sku>  materialised channel assets  snap2shelf/products/<sku>/pack/<format>
 *   s2s-sku-<sku>   raw, cut-out and saved hero  snap2shelf/products/<sku>/{raw,cutout,hero-…}
 */
import { getShowcaseKit } from "../showcase";
import { deliveryBase } from "../transform/composite";
import { SKU_RE, type Kit, type KitAsset, type PreviewFrame } from "../types";
import { reelUrl } from "./reel";
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

function asset(r: ListResource, id: string, alt: string): KitAsset | null {
  const meta = id.startsWith("recolor-") ? { label: recolorLabel(id), frame: "feed-post" as const, format: "recolor" as const } : FORMATS[id];
  if (!meta) return null;
  const t = "f_auto,q_auto";
  const url = `${deliveryBase()}/${t}/v${r.version}/${r.public_id}`;
  return {
    id,
    format: meta.format,
    label: meta.label,
    url,
    width: r.width,
    height: r.height,
    frame: meta.frame,
    alt,
    publicId: r.public_id,
    xray: {
      url,
      transformation: t,
      segments: [
        { text: t, kind: "format", label: "Best format and quality for the viewer's browser" },
        { text: `v${r.version}/${r.public_id}`, kind: "asset", label: "Saved channel asset, materialised once" },
      ],
    },
  };
}

export async function loadKit(sku: string): Promise<Kit | null> {
  const show = getShowcaseKit(sku);
  if (show) return show;
  if (!SKU_RE.test(sku)) return null;

  const [pack, product] = await Promise.all([list(`s2s-pack-${sku}`), list(`s2s-sku-${sku}`)]);
  const heroRes = product.find((r) => /\/hero-[^/]+$/.test(r.public_id));
  if (!heroRes || !pack.length) return null;
  const raw = product.find((r) => r.public_id.endsWith("/raw"));
  const cutout = product.find((r) => r.public_id.endsWith("/cutout"));
  const ctx = { ...raw?.context?.custom, ...heroRes.context?.custom };
  const name = ctx.name ?? ctx.product_name ?? "Product";
  const alt = ctx.alt ?? ctx.caption ?? `${name}, staged`;

  const assets = pack
    .map((r) => asset(r, r.public_id.split("/").pop() ?? "", alt))
    .filter((a): a is KitAsset => !!a);

  const heroUrl = `${deliveryBase()}/f_auto,q_auto/v${heroRes.version}/${heroRes.public_id}`;
  return {
    sku,
    product: {
      sku,
      rawPublicId: raw?.public_id ?? heroRes.public_id,
      rawWidth: raw?.width ?? 0,
      rawHeight: raw?.height ?? 0,
      rawBytes: 0,
      caption: ctx.caption,
      understanding: ctx.name
        ? { name, category: ctx.category ?? "", primary_color: "", material: "", recolorable_part: "", placement: (ctx.placement as "standing") ?? "standing", suggested_themes: [] }
        : undefined,
      cutout: cutout ? { publicId: cutout.public_id, width: cutout.width, height: cutout.height } : undefined,
    },
    mode: "exact",
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
      xray: { url: heroUrl, transformation: "f_auto,q_auto", segments: [{ text: "f_auto,q_auto", kind: "format", label: "Best format and quality" }, { text: heroRes.public_id, kind: "asset", label: "Saved hero" }] },
    },
    assets,
    reel: reelUrl({ heroPublicId: heroRes.public_id }),
    cost: { generationCredits: 0, creditsSavedByReuse: 0, aiVisionTokens: 0, transformationsEstimate: 0, bytesOriginal: 0, bytesDelivered: 0, seconds: 0 },
    createdAt: heroRes.created_at,
  };
}
