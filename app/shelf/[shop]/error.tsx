"use client";

import { RotateCcw } from "lucide-react";
import { Backdrop } from "@/components/shelf/Backdrop";
import { EmptyShelf } from "@/components/shelf/EmptyShelf";
import { shelfFontVars } from "@/components/shelf/fonts";

/** Cloudinary hiccup while loading the shelf: say so plainly and offer a retry. */
export default function ShelfError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className={`${shelfFontVars} relative min-h-dvh font-[family-name:var(--font-shelf-sans)] text-[#f4efe7]`}>
      <Backdrop />
      <EmptyShelf
        eyebrow="Couldn't open the shelf"
        title="The lights flickered"
        body="We couldn't load this shelf just now. Your products are safe; try again in a moment."
        cta={{ href: "/", label: "Go to Snap2Shelf" }}
        secondary={
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-12 items-center gap-2 rounded-full border border-[#f4efe7]/20 px-5 text-[15px] font-medium text-[#f4efe7] transition-colors hover:border-[#f4efe7]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f5a524]"
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
            Try again
          </button>
        }
      />
    </div>
  );
}
