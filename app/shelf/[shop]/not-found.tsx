import type { Metadata } from "next";
import { Backdrop } from "@/components/shelf/Backdrop";
import { EmptyShelf } from "@/components/shelf/EmptyShelf";
import { shelfFontVars } from "@/components/shelf/fonts";

export const metadata: Metadata = { title: "Shelf not found · Snap2Shelf", robots: { index: false } };

export default function ShelfNotFound() {
  return (
    <div className={`${shelfFontVars} relative min-h-dvh font-[family-name:var(--font-shelf-sans)] text-[#f4efe7]`}>
      <Backdrop />
      <EmptyShelf
        eyebrow="Nothing on this shelf yet"
        title="This shelf is still being stocked"
        body="There's no shop at this address yet, or its products haven't been published. Snap one product photo and Snap2Shelf builds the whole shelf around it."
        cta={{ href: "/", label: "Build your shelf" }}
      />
    </div>
  );
}
