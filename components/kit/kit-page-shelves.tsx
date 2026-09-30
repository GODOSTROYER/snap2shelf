import { Suspense } from "react";
import { frameProduct, shelvesFor } from "@/lib/client/kit-view";
import type { Kit } from "@/lib/types";
import { KitCard } from "./kit-card";
import { Shelf } from "./shelf";
import { XrayHost } from "./xray-button";

/**
 * A saved kit's shelves for /kit/<sku>: rendered on the server (nothing to
 * hydrate but the X-ray buttons and the reel), one lazily loaded X-ray sheet.
 */
export function KitPageShelves({ kit }: { kit: Kit }) {
  const product = frameProduct(kit);
  return (
    <XrayHost>
      <div className="grid gap-4">
        {shelvesFor(kit).map((g) => (
          // each shelf is its own hydration unit: React hydrates Suspense boundaries in separate, interruptible tasks
          <Suspense key={g.id}>
            <Shelf title={g.title}>
              {g.items.map((item) => (
                <KitCard key={item.key} item={item} product={product} />
              ))}
            </Shelf>
          </Suspense>
        ))}
      </div>
    </XrayHost>
  );
}
