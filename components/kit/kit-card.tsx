import { AssetFrame, frameWidth } from "@/components/frames/asset-frame";
import type { frameProduct, ShelfItem } from "@/lib/client/kit-view";
import { QaBadge } from "./qa-badge";
import { ReelVideo } from "./reel-video";
import { ShelfTag } from "./shelf";
import { XrayButton } from "./xray-button";

/**
 * One asset on a shelf: its frame, the shelf-edge tag and the X-ray button.
 * Behind the card sits its outline (data-slot), shown while the card is being
 * dealt so the shelf is never empty. Server-safe.
 */
export function KitCard({ item, product, reelReady = true }: { item: ShelfItem; product: ReturnType<typeof frameProduct>; reelReady?: boolean }) {
  const a = item.asset;
  const frame = item.kind === "reel" ? "reel" : a.frame;
  return (
    <li className="relative flex shrink-0 snap-start flex-col items-start">
      <div
        aria-hidden
        data-slot
        className="pointer-events-none absolute top-0 left-0 h-(--h) rounded-2xl border border-dashed border-line-strong bg-stage/60 opacity-0 transition-opacity duration-300"
        style={{ width: frameWidth(frame, a) }}
      />
      <div data-card className="lift rounded-2xl shadow-[0_18px_28px_-16px_rgb(0_0_0/0.9)]">
        <AssetFrame
          asset={a}
          product={product}
          frame={item.kind === "reel" ? "reel" : undefined}
          media={item.kind === "reel" ? <ReelVideo src={item.src} poster={item.poster} label={a.alt} ready={reelReady} /> : undefined}
        />
      </div>
      <ShelfTag asset={a}>
        <XrayButton asset={a} />
        {a.qa && a.id.startsWith("creative") ? <QaBadge qa={a.qa} /> : null}
      </ShelfTag>
    </li>
  );
}
