/**
 * A shelf: a horizontally scrolling row of framed assets standing on a lit
 * ledge, each with a shelf-edge tag. Server-safe; interactive cards are passed
 * in as children.
 */
import * as React from "react";
import { dims } from "@/lib/client/kit-view";
import { cn } from "@/lib/client/util";
import type { KitAsset } from "@/lib/types";

export const SHELF_HEIGHTS = "[--h:292px] sm:[--h:330px] lg:[--h:372px]";

export function Shelf({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className={cn("min-w-0", SHELF_HEIGHTS, className)}>
      <h3 id={id} className="px-4 font-display text-lg font-semibold tracking-[-0.01em] text-paper sm:px-8">
        {title}
      </h3>
      <div className="relative mt-1">
        <div aria-hidden className="shelf-ledge absolute inset-x-2 top-[calc(var(--h)+1.75rem)] sm:inset-x-4" />
        <ul className="shelf-scroller relative flex snap-x snap-mandatory scroll-px-4 gap-5 overflow-x-auto px-4 pt-7 pb-6 sm:scroll-px-8 sm:gap-7 sm:px-8">
          {children}
        </ul>
      </div>
    </section>
  );
}

/** Shelf-edge label: what the asset is and its size. */
export function ShelfTag({ asset, children }: { asset: Pick<KitAsset, "label" | "width" | "height">; children?: React.ReactNode }) {
  return (
    <div data-tag className="mt-[14px] flex items-center gap-2">
      <p className="rounded-b-[5px] rounded-t-[2px] bg-paper px-2 py-1 text-[0.75rem] leading-none font-semibold text-studio shadow-[0_6px_14px_-6px_rgb(0_0_0/0.8)]">
        {asset.label}
        <span className="tabular ml-1.5 font-medium text-studio/60">{dims(asset)}</span>
      </p>
      {children}
    </div>
  );
}
