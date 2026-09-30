"use client";

/* eslint-disable @next/next/no-img-element -- Cloudinary delivery URL, already sized */
import { ArrowDown, ArrowUp, CodeXml, Eye, ShieldAlert, ShieldCheck, Wrench } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import * as React from "react";
import { QaBadge } from "@/components/kit/qa-badge";
import type { QaMarks } from "@/lib/client/qa-replay";
import { cn } from "@/lib/client/util";
import { PLATE, type KitAsset, type QaResult, type SceneDNA } from "@/lib/types";
import { CrossfadeImage, type Enter } from "./crossfade-image";
import type { PlateBox } from "./dna-labels";

// Only needed once someone opens the X-ray or Scene DNA shows: kept out of the first load.
const XraySheet = dynamic(() => import("@/components/kit/xray-sheet").then((m) => m.XraySheet), { ssr: false });
const loadOverlay = () => import("@/components/present/SceneDnaOverlay").then((m) => m.SceneDnaOverlay);
const SceneDnaOverlay = dynamic(loadOverlay, { ssr: false });
const loadLabels = () => import("./dna-labels").then((m) => m.DnaLabels);
const DnaLabels = dynamic(loadLabels, { ssr: false });

/**
 * The QA gate's automatic fix, told on the stage: caught (where the product sat,
 * and the correction the fix makes) → fixing (the new frame settles by exactly
 * that much) → approved. A sample tells every check its live run recorded.
 */
export interface QaStory {
  phase: "caught" | "fixing" | "fixed";
  check: number; // which QA check this is, from 1
  checks?: number; // how many the run took (known on a replay)
  caught: string; // the first sentence of the rejection, as the server wrote it
  fix: string; // what the fix changes ("set it 10 px lower, onto the surface")
  marks?: QaMarks | null; // where on the plate, for the ring and the bracket
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
    /** First frame only: responsive sources, and fetched first (it is the page's LCP image). */
    srcSet?: string;
    sizes?: string;
    priority?: boolean;
    originalSrc?: string | null;
    originalLabel?: string;
    qaStory?: QaStory | null;
    scanning?: string | null; // label while a step works on the photo
    qa?: QaResult | null;
    onBusy?: (busy: boolean) => void;
    busyLabel?: string | null;
    xray?: KitAsset | null; // what the X-ray button explains
    enter?: Enter; // how the next image arrives
    settle?: number | null; // enter "settle": how far (fraction of the height) the next frame travels
    light?: { azimuth: number; key: number } | null; // key light sweeping in from the scene's light direction
    /** Scene DNA drawn over the composite (surface, anchor, light, shadow, text zone). */
    dna?: { dna: SceneDNA; key: string; shadow?: boolean; product?: PlateBox | null } | null;
  }
>(function Stage(
  { src, alt, placeholder, srcSet, sizes, priority, originalSrc, originalLabel = "Hold to see your photo", qaStory, scanning, qa, onBusy, busyLabel, xray, enter, settle, light, dna },
  ref,
) {
  const [showOriginal, setShowOriginal] = React.useState(false);
  const [xrayOpen, setXrayOpen] = React.useState(false);
  const [xrayUsed, setXrayUsed] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);

  // warm the Scene DNA chunks while the photo is read, so the overlay draws on time
  React.useEffect(() => {
    const t = setTimeout(() => void Promise.all([loadOverlay(), loadLabels()]).catch(() => {}), 1500);
    return () => clearTimeout(t);
  }, []);

  const dnaShown = !!dna && !showOriginal;

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
          srcSet={srcSet}
          sizes={sizes}
          priority={priority}
          onBusy={onBusy}
          onError={() => setFailed(src)}
          className="absolute inset-0"
          imgClassName="object-cover"
          enter={enter}
          shift={settle ?? 0}
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
        {dna && dnaShown ? (
          <motion.div
            key={dna.key}
            className="pointer-events-none absolute inset-0 [--pz-font-text:var(--font-hanken)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.2 } }}
            exit={{ opacity: 0, transition: { duration: 0.35 } }}
          >
            {/* a light scrim so the marks read on bright plates */}
            <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,rgb(14_12_10/0.35))]" />
            <SceneDnaOverlay dna={dna.dna} animate step={0.32} weight={1.6} labels={false} show={{ shadow: dna.shadow ?? true, temperature: false, finish: false }} accent="var(--color-marigold)" />
            <DnaLabels dna={dna.dna} shadow={dna.shadow ?? true} step={0.32} avoid={dna.product} keepOut={[...(xray ? [{ corner: "tr" as const, w: 150, h: 56 }] : []), ...(qa ? [{ corner: "tl" as const, w: typeof qa.fidelity === "number" ? 220 : 130, h: 50 }] : [])]} />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {qaStory?.marks && !showOriginal && (qaStory.phase === "caught" || qaStory.marks.dy != null) ? <FixMarks key="marks" story={qaStory} marks={qaStory.marks} /> : null}
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
              className="inline-flex items-center gap-1.5"
            >
              <QaBadge qa={qa} className="bg-studio/85 backdrop-blur-sm" />
              {typeof qa.fidelity === "number" ? (
                <span className="tabular rounded-full bg-studio/85 px-2.5 py-1 text-[0.75rem] leading-none font-semibold text-paper backdrop-blur-sm">fidelity {qa.fidelity}</span>
              ) : null}
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
          onClick={() => {
            setXrayUsed(true);
            setXrayOpen(true);
          }}
          className={cn(
            "absolute top-3 right-3 inline-flex h-9 items-center gap-2 rounded-full bg-studio/85 px-3.5 text-[0.8rem] font-semibold text-paper backdrop-blur-sm transition-colors hover:bg-studio hover:text-marigold",
            qaStory && "max-sm:invisible",
          )}
        >
          <CodeXml className="size-4" aria-hidden />
          See the URL
        </button>
      ) : null}
      {xrayUsed ? <XraySheet asset={xrayOpen ? (xray ?? null) : null} onOpenChange={setXrayOpen} /> : null}

      {/* Scene DNA takes the lower frame for its labels; the compare button steps aside meanwhile */}
      {originalSrc && !dnaShown ? (
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
          // exactly where a "floating" fix happens, so the story never covers it. Phones get it on
          // the top edge (the chips step aside); wider stages keep the chips above it.
          <motion.div
            key="qa-story"
            role="status"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.25 } }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            className="absolute inset-x-2.5 top-2.5 rounded-xl bg-studio/90 px-3 py-2.5 text-[14px] leading-[1.35] text-paper shadow-[0_20px_40px_-16px_rgb(0_0_0/0.9)] ring-1 ring-line-strong backdrop-blur-md sm:inset-x-4 sm:top-15 sm:rounded-2xl sm:px-3.5 sm:py-3"
          >
            <StoryText story={qaStory} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
});

const STATE = {
  caught: { word: "QA caught it", Icon: ShieldAlert, tone: "text-sindoor" },
  fixing: { word: "Fixing", Icon: Wrench, tone: "text-marigold" },
  fixed: { word: "Approved", Icon: ShieldCheck, tone: "text-leaf" },
} as const;

/** One state word, coloured, then what happened in plain words. */
function StoryText({ story }: { story: QaStory }) {
  const s = STATE[story.phase];
  const count = story.checks ? (story.phase === "fixed" ? `after ${story.checks} checks` : `check ${story.check} of ${story.checks}`) : story.phase === "fixed" ? `on check ${story.check}` : null;
  return (
    <p>
      <span className={cn("inline-flex items-center gap-1.5 font-semibold", s.tone)}>
        <s.Icon className="size-4 shrink-0" aria-hidden />
        {s.word}
      </span>
      {count ? <span className="tabular text-faint"> · {count}</span> : null}
      <span className="block text-dim">
        {story.phase === "caught" ? story.caught : story.phase === "fixing" ? `We ${story.fix}. Checking again.` : `Auto-fixed: we ${story.fix}.`}
      </span>
    </p>
  );
}

const pct = (v: number, of: number) => `${(v / of) * 100}%`;

/**
 * On the frame QA rejected: a dashed ring where the product's base sits and a
 * bracket with the correction the fix makes, both from the composite's own
 * geometry. Fixing: the ring moves with the product. Approved: it turns green.
 */
function FixMarks({ story, marks }: { story: QaStory; marks: QaMarks }) {
  const reduce = useReducedMotion();
  const [fade, setFade] = React.useState(false);
  React.useEffect(() => {
    if (story.phase !== "fixed") return;
    const t = setTimeout(() => setFade(true), 2600); // the approved hero reads clean again
    return () => clearTimeout(t);
  }, [story.phase]);

  const moved = story.phase !== "caught" && marks.dy != null;
  const y = marks.baseY + (moved ? (marks.dy ?? 0) : 0);
  const ew = Math.max(marks.w * 1.6, 150);
  const eh = ew * 0.26;
  const tone = story.phase === "fixed" ? "leaf" : story.phase === "fixing" ? "marigold" : "sindoor";
  const travel = { duration: reduce ? 0 : 0.9, ease: [0.16, 1, 0.3, 1] as const };
  const dy = marks.dy ?? 0;
  const bx = marks.cx + ew / 2 + 18; // the bracket, just right of the ring

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: fade ? 0 : 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduce ? 0 : 0.35 }}
    >
      <motion.div
        className={cn(
          "absolute rounded-[50%] border-2 [filter:drop-shadow(0_0_2px_rgb(0_0_0/0.55))] transition-colors duration-300 motion-reduce:transition-none",
          tone === "leaf" ? "border-solid border-leaf" : tone === "marigold" ? "border-dashed border-marigold" : "border-dashed border-sindoor",
        )}
        style={{ left: pct(marks.cx - ew / 2, PLATE.width), width: pct(ew, PLATE.width), height: pct(eh, PLATE.height) }}
        initial={false}
        animate={{ top: pct(y - eh / 2, PLATE.height) }}
        transition={travel}
      />
      <AnimatePresence>
        {story.phase === "caught" && marks.dy ? (
          // the bracket spans the real correction: from where the base is to where the fix puts it
          <motion.div
            key="bracket"
            className="absolute min-h-1 [filter:drop-shadow(0_0_2px_rgb(0_0_0/0.6))]"
            style={{ left: pct(bx, PLATE.width), top: pct(Math.min(marks.baseY, marks.baseY + dy), PLATE.height), height: pct(Math.abs(dy), PLATE.height) }}
            initial={{ opacity: 0, x: reduce ? 0 : -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ delay: reduce ? 0 : 0.35, duration: reduce ? 0 : 0.3 }}
          >
            <BracketLines dy={dy} />
            <span className="absolute top-1/2 left-5 inline-flex -translate-y-1/2 items-center gap-0.5 rounded-full bg-sindoor px-2 py-0.5 text-[13px] leading-[1.35] font-semibold whitespace-nowrap text-studio shadow-[0_4px_12px_-4px_rgb(0_0_0/0.8)]">
              {dy > 0 ? <ArrowDown className="size-3.5" aria-hidden /> : <ArrowUp className="size-3.5" aria-hidden />}
              <span className="tabular">{Math.abs(dy)} px</span>
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {story.phase === "fixed" ? (
          <motion.span
            key="ok"
            className="absolute inline-flex -translate-y-1/2 items-center gap-1 rounded-full bg-leaf px-2 py-0.5 text-[13px] leading-[1.35] font-semibold text-studio shadow-[0_4px_12px_-4px_rgb(0_0_0/0.8)]"
            style={{ left: pct(bx, PLATE.width), top: pct(y, PLATE.height) }}
            initial={{ opacity: 0, scale: reduce ? 1 : 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 24 }}
          >
            <ShieldCheck className="size-3.5" aria-hidden />
            Approved
          </motion.span>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

/** Two ticks joined by a line: the base now (solid) and where the fix puts it (dashed). */
function BracketLines({ dy }: { dy: number }) {
  return (
    <span className="relative block h-full min-h-1 w-3">
      <span className={cn("absolute left-0 h-0.5 w-3 bg-sindoor", dy > 0 ? "top-0" : "bottom-0")} />
      <span className="absolute top-0 bottom-0 left-[5px] w-0.5 bg-sindoor" />
      <span className={cn("absolute left-0 h-0 w-3 border-t-2 border-dashed border-sindoor", dy > 0 ? "bottom-0" : "top-0")} />
    </span>
  );
}

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
