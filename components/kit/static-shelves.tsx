import { AssetFrame } from "@/components/frames/asset-frame";
import { DealOnView } from "@/components/landing/deal-on-view";
import { frameProduct, shelvesFor } from "@/lib/client/kit-view";
import type { Kit } from "@/lib/types";
import { ReelVideo } from "./reel-video";
import { Shelf, ShelfTag } from "./shelf";

/** Read-only shelves for the landing page: server-rendered; the reel and the stocking motion are small client islands. */
export function StaticShelves({ kit }: { kit: Kit }) {
  const product = frameProduct(kit);
  return (
    <DealOnView className="grid gap-4">
      {shelvesFor(kit).map((g, row) => (
        <Shelf key={g.id} title={g.title}>
          {g.items.map((item, i) => (
            <li key={item.key} className="flex shrink-0 snap-start flex-col items-start">
              <div data-card className="lift rounded-2xl shadow-[0_18px_28px_-16px_rgb(0_0_0/0.9)]" style={{ "--i": row * 2 + i, "--dx": "55vw", "--dy": "-28px", "--tilt": `${8 + ((i * 5) % 7)}deg` } as React.CSSProperties}>
                <AssetFrame
                  asset={item.asset}
                  product={product}
                  media={item.kind === "reel" ? <ReelVideo src={item.src} poster={item.poster} label={item.asset.alt} /> : undefined}
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
