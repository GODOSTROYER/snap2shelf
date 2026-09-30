import { AssetFrame } from "@/components/frames/asset-frame";
import { frameProduct, shelvesFor } from "@/lib/client/kit-view";
import type { Kit } from "@/lib/types";
import { ReelVideo } from "./reel-video";
import { Shelf, ShelfTag } from "./shelf";

/** Read-only shelves for the landing page: server-rendered, only the reel is a client island. */
export function StaticShelves({ kit }: { kit: Kit }) {
  const product = frameProduct(kit);
  return (
    <div className="grid gap-4">
      {shelvesFor(kit).map((g) => (
        <Shelf key={g.id} title={g.title}>
          {g.items.map((item) => (
            <li key={item.key} className="flex shrink-0 snap-start flex-col items-start">
              <div className="shadow-[0_18px_28px_-16px_rgb(0_0_0/0.9)]" style={{ borderRadius: 16 }}>
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
    </div>
  );
}
