import { AssetFrame } from "@/components/frames/asset-frame";
import { DealOnView } from "@/components/landing/deal-on-view";
import { frameProduct, shelvesFor } from "@/lib/client/kit-view";
import type { Kit } from "@/lib/types";
import { ReelVideo } from "./reel-video";
import { Shelf, ShelfTag } from "./shelf";

/**
 * Each row renders (and fetches its pictures) only once it nears the viewport: on a
 * phone the rows start below the fold, so their ~200 KB of images no longer compete
 * with the hero. The reserved height is the row's real one (h3 + ledge + card at
 * --h 292/330/372 + tag), so skipping it moves nothing.
 */
const ROW_WHEN_NEAR = "[content-visibility:auto] [contain-intrinsic-height:auto_410px] sm:[contain-intrinsic-height:auto_448px] lg:[contain-intrinsic-height:auto_490px]";

/** Read-only shelves for the landing page: server-rendered; the reel and the stocking motion are small client islands. */
export function StaticShelves({ kit }: { kit: Kit }) {
  const product = frameProduct(kit);
  return (
    <DealOnView className="grid gap-4">
      {shelvesFor(kit).map((g, row) => (
        <Shelf key={g.id} title={g.title} className={ROW_WHEN_NEAR}>
          {g.items.map((item, i) => (
            <li key={item.key} className="flex shrink-0 snap-start flex-col items-start">
              <div data-card className="lift rounded-2xl shadow-[0_18px_28px_-16px_rgb(0_0_0/0.9)]" style={{ "--i": row * 2 + i, "--dx": "55vw", "--dy": "-28px", "--tilt": `${8 + ((i * 5) % 7)}deg` } as React.CSSProperties}>
                <AssetFrame
                  asset={item.asset}
                  product={product}
          frame={item.kind === "reel" ? "reel" : undefined}
                  media={item.kind === "reel" ? <ReelVideo src={item.src} poster={item.poster} cover={item.cover} label={item.asset.alt} /> : undefined}
                />
              </div>
              <ShelfTag asset={item.asset} />
            </li>
          ))}
        </Shelf>
      ))}
    </DealOnView>
  );
}
