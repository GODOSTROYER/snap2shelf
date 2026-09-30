"use client";

import { ScanLine } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/client/util";
import type { SceneDNA } from "@/lib/types";

const DIRS = ["behind", "the back right", "the right", "the front right", "the front", "the front left", "the left", "the back left"];
const from = (az: number) => DIRS[Math.round((((az % 360) + 360) % 360) / 45) % 8];

/** One line of what AI Vision read from the plate, in plain words. */
export function dnaSummary(d: SceneDNA): string {
  const zone = d.text_zone === "none" ? "" : ` · room for text at the ${d.text_zone.replace("_", " ")}`;
  return `Surface at ${Math.round(d.anchor_y * 100)}% height · light from ${from(d.light_azimuth)}, ${Math.round(d.light_elevation)}° up · ${d.temperature}, ${d.glossy ? "glossy" : "matte"}${zone}`;
}

/**
 * "Scene DNA" switch under the stage: draws what AI Vision measured on the
 * backdrop (surface line, anchor, light, shadow direction, text zone) over the
 * composite, and says it in one line. The same numbers place the product.
 */
export function DnaToggle({ dna, on, onChange, disabled }: { dna: SceneDNA | null; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:mt-4">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled || !dna}
        onClick={() => onChange(!on)}
        className={cn(
          "group inline-flex h-9 shrink-0 items-center gap-2.5 rounded-full pr-3.5 pl-1.5 text-[0.82rem] font-semibold ring-1 transition-[background-color,box-shadow,color] duration-200 ring-inset disabled:opacity-45",
          on ? "bg-marigold/14 text-marigold-hi ring-marigold/45" : "bg-stage-2 text-paper ring-line-strong hover:bg-stage-3",
        )}
      >
        <span aria-hidden className={cn("relative h-6 w-10 rounded-full transition-colors duration-200", on ? "bg-marigold" : "bg-stage-3")}>
          <span className={cn("absolute top-1 left-1 grid size-4 place-items-center rounded-full bg-paper shadow transition-transform duration-200 ease-(--ease-out-expo)", on && "translate-x-4")}>
            <ScanLine className={cn("size-2.5", on ? "text-marigold-ink" : "text-studio/70")} />
          </span>
        </span>
        Scene DNA
      </button>
      <p className="min-w-0 flex-1 basis-56 text-[0.8rem] leading-snug text-dim" aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={on && dna ? "on" : "off"}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="block"
          >
            {on && dna ? dnaSummary(dna) : "See what AI Vision read from this backdrop, and where it put your product."}
          </motion.span>
        </AnimatePresence>
      </p>
    </div>
  );
}
