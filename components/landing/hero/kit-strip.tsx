/* eslint-disable @next/next/no-img-element -- Cloudinary delivery URLs, already sized and formatted (f_auto,q_auto) */
/**
 * The hero's kit, one row on a lit shelf: every format the photo became, at its
 * real aspect ratio. The cards are dealt out of the hero onto it (KitDeal). A
 * preview only: the full shelves further down carry each asset's frame, name and
 * alt text, so this row is hidden from assistive tech and says what it holds instead.
 */
import { ArrowDown, Play } from "lucide-react";
import { sizedUrl } from "@/lib/client/img";
import { kitContents, shelvesFor } from "@/lib/client/kit-view";
import { cn } from "@/lib/client/util";
import type { Kit } from "@/lib/types";
import { KitDeal } from "./kit-deal";

export function KitStrip({ kit, href, className }: { kit: Kit; href: string; className?: string }) {
  const items = shelvesFor(kit).flatMap((g) => g.items);
  return (
    <KitDeal
      className={cn(
        "grid grid-cols-[minmax(0,1fr)] [grid-template-areas:'cap'_'row'_'ledge'] lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-x-8 lg:[grid-template-areas:'row_cap'_'ledge_ledge']",
        // before hydration (scripting on, motion allowed) the cards wait for the deal; shown anyway after 12 s
        "motion-safe:[@media(scripting:enabled)]:[&[data-deal=auto]_[data-card]]:[animation:rise_1ms_12s_both]",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 [grid-area:cap] lg:max-w-[16rem] lg:flex-col lg:items-start lg:justify-end lg:pb-2">
        <p className="text-sm text-dim">
          <span className="font-semibold text-paper">{kitContents(kit)}</span>, all from that one photo.
        </p>
        <a
          href={href}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-paper underline decoration-marigold/60 underline-offset-4 hover:decoration-marigold"
        >
          See the whole kit
          <ArrowDown aria-hidden className="size-4 text-marigold" />
        </a>
      </div>
      <ul
        aria-hidden
        className="no-scrollbar -mx-4 flex items-end gap-2.5 overflow-x-auto px-4 pt-3 pb-[3px] [grid-area:row] [--sh:5.25rem] sm:mx-0 sm:gap-3 sm:px-3 sm:max-lg:[--sh:6rem] lg:[--sh:inherit]"
      >
        {items.map((item) => {
          const a = item.asset;
          const src = item.kind === "reel" ? item.poster : sizedUrl(a, 360);
          return (
            <li
              key={item.key}
              data-card
              className="relative h-(--sh) shrink-0 overflow-hidden rounded-[7px] bg-stage-2 shadow-[0_14px_22px_-12px_rgb(0_0_0/0.9)] ring-1 ring-white/10"
              style={{ aspectRatio: `${a.width} / ${a.height}` }}
            >
              <img src={src} alt="" width={a.width} height={a.height} loading="lazy" decoding="async" fetchPriority="low" className="size-full object-cover" />
              {item.kind === "reel" ? (
                <span className="absolute inset-0 grid place-items-center bg-black/15">
                  <span className="grid size-7 place-items-center rounded-full bg-white/90 text-studio shadow-[0_4px_12px_rgb(0_0_0/0.4)]">
                    <Play className="size-3.5 translate-x-px fill-current" />
                  </span>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div aria-hidden className="shelf-ledge relative -mx-2 [grid-area:ledge] sm:-mx-1" />
    </KitDeal>
  );
}
