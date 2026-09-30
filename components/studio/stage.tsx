"use client";

/* eslint-disable @next/next/no-img-element -- Cloudinary delivery URL, already sized */
import { ArrowRight, CodeXml, Eye, ShieldCheck, Wrench } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { QaBadge } from "@/components/kit/qa-badge";
import { XraySheet } from "@/components/kit/xray-sheet";
import { SceneDnaOverlay } from "@/components/present/SceneDnaOverlay";
import { cn } from "@/lib/client/util";
import type { KitAsset, QaResult, SceneDNA } from "@/lib/types";
import { CrossfadeImage, type Enter } from "./crossfade-image";

/** The QA gate's automatic retry, told on the stage: caught → fixed → approved. */
export interface QaStory {
  phase: "fixing" | "fixed";
  caught: string; // the first rejection reason, as the server wrote it
  fix: string; // what was changed
}

/**
 * The big 4:5 viewer. Shows whatever the pipeline has so far (raw photo →
 * cut-out on a transparency checker → staged hero) and cross-fades between them.
 */
export const Stage = React.forwardRef<
  HTMLDivElement,
  {
    src: string | null;
    alt: string;
    placeholder?: string;
    originalSrc?: string | null;
    originalLabel?: string;
    qaStory?: QaStory | null;
    scanning?: string | null; // label while a step works on the photo
    qa?: QaResult | null;
    onBusy?: (busy: boolean) => void;
    busyLabel?: string | null;
    xray?: KitAsset | null; // what the X-ray button explains
    enter?: Enter; // how the next image arrives
    light?: { azimuth: number; key: number } | null; // key light sweeping in from the scene's light direction
    /** Scene DNA drawn over the composite (surface, anchor, light, shadow, text zone). */
    dna?: { dna: SceneDNA; key: string; shadow?: boolean } | null;
  }
>(function Stage({ src, alt, placeholder, originalSrc, originalLabel = "Hold to see your photo", qaStory, scanning, qa, onBusy, busyLabel, xray, enter, light, dna }, ref) {
  const [showOriginal, setShowOriginal] = React.useState(false);
  const [xrayOpen, setXrayOpen] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);

  return (
    <div
      ref={ref}
      className="checker relative isolate aspect-[4/5] w-full overflow-hidden rounded-[22px] shadow-[0_50px_90px_-40px_rgb(0_0_0/0.95)] ring-1 ring-line"
    >
      {src ? (
        <CrossfadeImage
          src={src}
          alt={alt}
          width={1080}
          height={1350}
          placeholder={placeholder}
          onBusy={onBusy}
          onError={() => setFailed(src)}
          className="absolute inset-0"
          imgClassName="object-cover"
          enter={enter}
        />
      ) : (
        <div className="skeleton absolute inset-0" />
      )}

      {originalSrc ? (
        <img
          src={originalSrc}
          alt=""
          aria-hidden
          className={cn("pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-300", showOriginal ? "opacity-100" : "opacity-0")}
        />
      ) : null}

      <AnimatePresence>
        {light ? <KeyLight key={light.key} azimuth={light.azimuth} /> : null}
      </AnimatePresence>

      <AnimatePresence>
        {dna && !showOriginal ? (
          <motion.div
            key={dna.key}
            className="pointer-events-none absolute inset-0 [--pz-font-text:var(--font-hanken)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.2 } }}
            exit={{ opacity: 0, transition: { duration: 0.35 } }}
          >
            {/* a light scrim so the marks read on bright plates */}
            <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgb(14_12_10/0.35))]" />
            <SceneDnaOverlay dna={dna.dna} animate step={0.32} weight={1.6} show={{ shadow: dna.shadow ?? true, temperature: false, finish: false }} accent="var(--color-marigold)" />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {scanning ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-x-0 h-1/3 animate-sweep bg-gradient-to-b from-transparent via-marigold/25 to-transparent">
            <div className="absolute inset-x-0 top-1/2 h-px bg-marigold/80 shadow-[0_0_16px_rgb(245_165_36/0.9)]" />
          </div>
        </div>
      ) : null}

      {/* phones: the QA story card takes the top edge while it tells its story, so these step aside */}
      <div className={cn("absolute top-3 left-3 flex flex-wrap gap-2", qaStory && "max-sm:invisible")}>
        <AnimatePresence>
          {qa ? (
            <motion.span
              key={qa.status}
              initial={{ scale: 1.6, opacity: 0, rotate: -6 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={{ type: "spring", stiffness: 420, damping: 18 }}
              className="inline-flex"
            >
              <QaBadge qa={qa} className="bg-studio/85 backdrop-blur-sm" />
            </motion.span>
          ) : null}
        </AnimatePresence>
        {busyLabel ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-studio/85 px-2.5 py-1 text-[0.75rem] leading-none font-semibold text-paper backdrop-blur-sm">
            <span className="size-1.5 animate-pulse rounded-full bg-marigold" />
            {busyLabel}
          </span>
        ) : null}
      </div>

      {failed && failed === src ? (
        <p role="alert" className="absolute inset-x-3 bottom-16 rounded-xl bg-studio/90 p-3 text-center text-sm text-paper">
          Cloudinary couldn&apos;t render this version. Move a slider to try a slightly different one.
        </p>
      ) : null}

      {xray ? (
        <button
          type="button"
          onClick={() => setXrayOpen(true)}
          className={cn(
            "absolute top-3 right-3 inline-flex h-9 items-center gap-2 rounded-full bg-studio/85 px-3.5 text-[0.8rem] font-semibold text-paper backdrop-blur-sm transition-colors hover:bg-studio hover:text-marigold",
            qaStory && "max-sm:invisible",
          )}
        >
          <CodeXml className="size-4" aria-hidden />
          See the URL
        </button>
      ) : null}
      <XraySheet asset={xrayOpen ? (xray ?? null) : null} onOpenChange={setXrayOpen} />

      {originalSrc ? (
        <button
          type="button"
          aria-pressed={showOriginal}
          onPointerDown={() => setShowOriginal(true)}
          onPointerUp={() => setShowOriginal(false)}
          onPointerLeave={() => setShowOriginal(false)}
          onKeyDown={(e) => (e.key === " " || e.key === "Enter") && setShowOriginal(true)}
          onKeyUp={() => setShowOriginal(false)}
          className="absolute right-3 bottom-3 inline-flex h-9 items-center gap-2 rounded-full bg-studio/85 px-3.5 text-[0.8rem] font-semibold text-paper backdrop-blur-sm transition-colors select-none hover:bg-studio"
        >
          <Eye className="size-4" aria-hidden />
          {originalLabel}
        </button>
      ) : null}

      <AnimatePresence>
        {qaStory ? (
          // Top of the frame: a standing product rests on the surface in the lower half, which is
          // exactly where a "floating" fix happens, so the story never covers it. Phones get a
          // compact card on the top edge (the chips step aside); wider stages keep the chips.
          <motion.div
            key="qa-story"
            role="status"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.25 } }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            className="absolute inset-x-2.5 top-2.5 rounded-xl bg-studio/90 px-3 py-2.5 text-[0.75rem] leading-snug text-paper shadow-[0_20px_40px_-16px_rgb(0_0_0/0.9)] ring-1 ring-line-strong backdrop-blur-md sm:inset-x-4 sm:top-15 sm:rounded-2xl sm:p-3.5 sm:text-[0.8rem]"
          >
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
              <li className="text-sindoor">QA caught it</li>
              <li aria-hidden><ArrowRight className="size-3.5 text-faint" /></li>
              <li className={cn("inline-flex items-center gap-1", qaStory.phase === "fixing" ? "text-marigold" : "text-paper")}>
                <Wrench className="size-3.5" aria-hidden />
                {qaStory.phase === "fixing" ? "Fixing" : "Auto-fixed"}
              </li>
              <li aria-hidden><ArrowRight className="size-3.5 text-faint" /></li>
              <li className={cn("inline-flex items-center gap-1", qaStory.phase === "fixed" ? "text-leaf" : "text-faint")}>
                <ShieldCheck className="size-3.5" aria-hidden />
                {qaStory.phase === "fixed" ? "Approved" : "Re-checking"}
              </li>
            </ol>
            <p className="mt-1 text-dim sm:mt-1.5">
              {qaStory.caught} We {qaStory.fix}.
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
});

/** A warm key light swinging in from where the scene's light comes from, then settling. */
function KeyLight({ azimuth }: { azimuth: number }) {
  const rad = (azimuth * Math.PI) / 180;
  const dx = Math.sin(rad) * 55;
  const dy = -Math.cos(rad) * 55;
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-[-40%] mix-blend-soft-light"
      style={{ background: "radial-gradient(closest-side, rgb(255 214 150 / 0.95), rgb(255 190 110 / 0.35) 45%, transparent 75%)" }}
      initial={{ x: `${dx}%`, y: `${dy}%`, opacity: 0 }}
      animate={{ x: `${dx * 0.35}%`, y: `${dy * 0.35}%`, opacity: [0, 1, 0.55] }}
      exit={{ opacity: 0, transition: { duration: 0.6 } }}
      transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
    />
  );
}
