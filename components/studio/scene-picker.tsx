"use client";

import { Check } from "lucide-react";
import { CldImage } from "next-cloudinary";
import { cn } from "@/lib/client/util";
import type { Scene } from "@/lib/types";

/** Scene library, filtered to the product's camera view. */
export function ScenePicker({ scenes, selected, onSelect, disabled }: { scenes: Scene[] | null; selected: string | null; onSelect: (s: Scene) => void; disabled?: boolean }) {
  if (!scenes) {
    return (
      <div className="grid grid-cols-3 gap-2.5" aria-busy="true" aria-label="Loading scenes">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton aspect-[4/5] rounded-xl" />
        ))}
      </div>
    );
  }
  if (!scenes.length) {
    return <p className="rounded-xl bg-stage-2 p-4 text-sm text-dim ring-1 ring-line">No scenes fit this product&apos;s angle yet. The current stage stays as it is.</p>;
  }
  return (
    <div role="radiogroup" aria-label="Scene" className="grid grid-cols-3 gap-2.5">
      {scenes.map((s) => {
        const on = s.publicId === selected;
        return (
          <button
            key={s.publicId}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onSelect(s)}
            className={cn(
              "group relative overflow-hidden rounded-xl text-left ring-2 transition-[box-shadow,transform] duration-200 ring-inset disabled:opacity-50",
              on ? "ring-marigold" : "ring-transparent hover:ring-line-strong",
            )}
          >
            <CldImage
              src={s.publicId}
              width={240}
              height={300}
              crop="fill"
              sizes="(min-width: 1024px) 120px, 30vw"
              alt=""
              className="aspect-[4/5] w-full object-cover transition-transform duration-500 ease-(--ease-out-expo) group-hover:scale-[1.04]"
            />
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pt-6 pb-1.5 text-[0.75rem] leading-tight font-semibold text-white">{s.title}</span>
            {on ? (
              <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-marigold text-marigold-ink">
                <Check className="size-3.5" aria-hidden />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
