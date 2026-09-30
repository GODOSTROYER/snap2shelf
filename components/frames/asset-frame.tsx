/**
 * Generic real-world placements for a kit asset: a social feed post, a story,
 * a marketplace listing, a chat catalog tile and a web banner. Deliberately
 * brand-free. Height comes from the parent's --h (px); width follows the format.
 * Server-safe (no hooks); the chrome is decorative, the image carries the alt text.
 */
import { Bookmark, ChevronUp, Ellipsis, Heart, MessageCircle, Send, Star, VolumeX } from "lucide-react";
import * as React from "react";
import { CloudImg } from "@/components/cloud-img";
import { sizedUrl } from "@/lib/client/img";
import { cn } from "@/lib/client/util";
import type { KitAsset, PreviewFrame } from "@/lib/types";

export interface FrameProduct {
  name: string;
  price: string;
  mrp?: string;
}

type Props = {
  asset: KitAsset;
  product: FrameProduct;
  className?: string;
  /** Replace the image with something else (the reel video). */
  media?: React.ReactNode;
  /** "reel": a vertical video post, chrome kept at the bottom so the reel's own offer card stays clear. */
  frame?: PreviewFrame | "reel";
};

const shop = "yourshop";

function Avatar({ size = 22 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-marigold to-sindoor text-[0.6rem] font-bold text-marigold-ink"
    >
      Y
    </span>
  );
}

function Img({ asset, w, className }: { asset: KitAsset; w: number; className?: string }) {
  return <CloudImg src={sizedUrl(asset, w)} alt={asset.alt} width={asset.width} height={asset.height} className={cn("block size-full object-cover", className)} />;
}

export function frameWidth(frame: PreviewFrame | "reel", asset: Pick<KitAsset, "width" | "height">): string {
  switch (frame) {
    case "feed-post":
      return "calc((var(--h) - 112px) * 0.8)";
    case "story":
    case "reel":
      return "calc(var(--h) * 0.5625)";
    case "listing-card":
      return "calc(var(--h) - 118px)";
    case "catalog-tile":
      return "calc(var(--h) - 84px)";
    case "web-banner":
      return "calc((var(--h) - 30px) * 1.7778)";
    default:
      return `calc(var(--h) * ${(asset.width / asset.height).toFixed(4)})`;
  }
}

export function AssetFrame({ asset, product, className, media, frame = asset.frame }: Props) {
  const width = frameWidth(frame, asset);
  const base = cn("relative h-(--h) shrink-0 overflow-hidden", className);

  switch (frame) {
    case "feed-post":
      return (
        <div className={cn(base, "flex flex-col rounded-[14px] bg-frame-dark ring-1 ring-white/10")} style={{ width }}>
          <div aria-hidden className="flex h-[40px] items-center gap-2 px-2.5 text-[0.7rem] font-semibold text-white">
            <Avatar />
            <span className="truncate">{shop}</span>
            <Ellipsis className="ml-auto size-4 text-white/70" />
          </div>
          <div className="min-h-0 flex-1">{media ?? <Img asset={asset} w={640} />}</div>
          <div aria-hidden className="h-[72px] px-2.5 pt-2 text-[0.66rem] text-white">
            <div className="flex items-center gap-2.5">
              <Heart className="size-[15px]" />
              <MessageCircle className="size-[15px]" />
              <Send className="size-[15px]" />
              <Bookmark className="ml-auto size-[15px]" />
            </div>
            <p className="mt-1.5 font-semibold">1,204 likes</p>
            <p className="truncate text-white/75">
              <span className="font-semibold text-white">{shop}</span> {product.name}. Tap to shop.
            </p>
          </div>
        </div>
      );

    case "reel":
      return (
        <div className={cn(base, "rounded-[18px] bg-frame-dark ring-1 ring-white/10")} style={{ width }}>
          {media ?? <Img asset={asset} w={640} />}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end gap-2 bg-gradient-to-t from-black/60 to-transparent px-2.5 pt-10 pb-3 text-white">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[0.66rem] font-semibold">
                <Avatar size={20} />
                {shop}
                <span className="rounded border border-white/50 px-1 text-[0.58rem] leading-[1.4]">Follow</span>
              </div>
              <p className="mt-1 truncate text-[0.62rem] text-white/80">{product.name}. Shop the reel</p>
            </div>
            <div className="flex flex-col items-center gap-2.5">
              <Heart className="size-[15px]" />
              <MessageCircle className="size-[15px]" />
              <VolumeX className="size-[15px]" />
            </div>
          </div>
        </div>
      );

    case "story":
      return (
        <div className={cn(base, "rounded-[18px] bg-frame-dark ring-1 ring-white/10")} style={{ width }}>
          {media ?? <Img asset={asset} w={640} />}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/55 to-transparent p-2.5 pb-8">
            <div className="flex gap-1">
              <span className="h-0.5 flex-1 rounded-full bg-white" />
              <span className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/35">
                <span className="block h-full w-1/2 bg-white" />
              </span>
              <span className="h-0.5 flex-1 rounded-full bg-white/35" />
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[0.66rem] font-semibold text-white">
              <Avatar size={20} />
              {shop}
              <span className="font-normal text-white/70">2h</span>
            </div>
          </div>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center bg-gradient-to-t from-black/55 to-transparent pt-8 pb-3 text-white">
            <ChevronUp className="size-4" />
            <span className="rounded-full bg-white px-3 py-1 text-[0.66rem] font-bold text-frame-ink">Shop now</span>
          </div>
        </div>
      );

    case "listing-card":
      return (
        <div className={cn(base, "flex flex-col rounded-[14px] bg-frame-light text-frame-ink")} style={{ width }}>
          <div className="aspect-square w-full shrink-0 border-b border-frame-line">{media ?? <Img asset={asset} w={640} className="bg-frame-line object-contain" />}</div>
          <div aria-hidden className="flex min-h-0 flex-1 flex-col gap-1 px-3 py-2.5 text-[0.7rem] leading-tight">
            <p className="line-clamp-1 font-medium">{product.name}</p>
            <div className="flex items-center gap-1 text-frame-soft">
              <span className="flex text-marigold">
                {[0, 1, 2, 3, 4].map((i) => (
                  <Star key={i} className={cn("size-2.5", i < 4 ? "fill-current" : "opacity-40")} />
                ))}
              </span>
              <span>4.6 (218)</span>
            </div>
            <p className="flex items-baseline gap-1.5">
              <span className="text-[0.85rem] font-bold">{product.price}</span>
              {product.mrp ? <span className="text-frame-soft line-through">{product.mrp}</span> : null}
            </p>
            <p className="text-frame-soft">Free delivery by Friday</p>
          </div>
        </div>
      );

    case "catalog-tile":
      return (
        <div className={cn(base, "flex flex-col rounded-[16px] rounded-bl-[4px] bg-frame-bubble p-1.5 text-white ring-1 ring-white/10")} style={{ width }}>
          <div className="aspect-square w-full shrink-0 overflow-hidden rounded-[11px]">{media ?? <Img asset={asset} w={640} />}</div>
          <div aria-hidden className="flex min-h-0 flex-1 flex-col justify-center px-1.5 text-[0.7rem] leading-tight">
            <p className="truncate font-semibold">{product.name}</p>
            <p className="mt-0.5 text-white/70">{product.price}</p>
            <p className="mt-1.5 border-t border-white/10 pt-1.5 text-center font-semibold text-sky-300">View item</p>
          </div>
        </div>
      );

    case "web-banner":
      return (
        <div className={cn(base, "flex flex-col rounded-[12px] bg-frame-light ring-1 ring-white/10")} style={{ width }}>
          <div aria-hidden className="flex h-[30px] shrink-0 items-center gap-1.5 bg-frame-line px-2.5">
            <span className="size-2 rounded-full bg-frame-soft/40" />
            <span className="size-2 rounded-full bg-frame-soft/40" />
            <span className="size-2 rounded-full bg-frame-soft/40" />
            <span className="ml-2 h-[18px] flex-1 truncate rounded-md bg-frame-light px-2 text-[0.62rem] leading-[18px] text-frame-soft">{shop}.in</span>
          </div>
          <div className="min-h-0 flex-1">{media ?? <Img asset={asset} w={1280} />}</div>
        </div>
      );

    default:
      return (
        <div className={cn(base, "rounded-[14px]")} style={{ width }}>
          {media ?? <Img asset={asset} w={640} />}
        </div>
      );
  }
}
