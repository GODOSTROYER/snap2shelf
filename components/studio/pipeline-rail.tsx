"use client";

import { Check, Frame, PackageCheck, Pause, Scissors, ShieldCheck, SunMedium, WandSparkles, Wrench, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/client/util";
import { PIPELINE_STEPS, type PipelineStepId } from "@/lib/types";

export type StepStatus = "waiting" | "active" | "done" | "failed" | "paused";

const ICONS: Record<PipelineStepId, typeof Check> = {
  fix: WandSparkles,
  cutout: Scissors,
  stage: Frame,
  light: SunMedium,
  qa: ShieldCheck,
  pack: PackageCheck,
};

/**
 * Fix → Cut out → Stage → Light-match → QA → Pack, lighting up as the real
 * calls finish. A lit fuse runs along the rail; each finished step flashes once.
 * `fixed` marks a QA pass that needed the automatic fix.
 */
export const PipelineRail = React.memo(function PipelineRail({
  status,
  notes,
  fixed,
}: {
  status: Record<PipelineStepId, StepStatus>;
  notes: Partial<Record<PipelineStepId, string>>;
  fixed?: boolean;
}) {
  const reduce = useReducedMotion();
  const doneCount = PIPELINE_STEPS.filter((s) => status[s.id] === "done").length;
  const active = PIPELINE_STEPS.find((s) => status[s.id] === "active" || status[s.id] === "failed" || status[s.id] === "paused");
  const progress = Math.min(1, (doneCount + (active && status[active.id] === "active" ? 0.5 : 0)) / (PIPELINE_STEPS.length - 1));
  const allDone = doneCount === PIPELINE_STEPS.length;
  // between steps (a finished step holding its moment before the next starts) the last one keeps the line
  const lastDone = [...PIPELINE_STEPS].reverse().find((s) => status[s.id] === "done");
  const note = active ? notes[active.id] : allDone ? (notes.pack ?? "Kit ready") : lastDone ? notes[lastDone.id] : "Waiting for a photo";
  const stepKey = active ? active.id : allDone ? "done" : (lastDone?.id ?? "idle");
  // the note the page was served with paints as it is (no entrance on the first paint)
  const [bootKey] = React.useState(stepKey);
  const noteTone = active && status[active.id] === "failed" ? "text-sindoor" : active && status[active.id] === "paused" ? "text-marigold" : allDone ? "text-paper" : "text-dim";

  return (
    <div className={cn("relative overflow-hidden rounded-2xl bg-stage/70 px-3 py-3 ring-1 transition-[box-shadow] duration-700 sm:px-5 sm:py-4", allDone ? "ring-marigold/35 shadow-[0_0_40px_-12px_rgb(245_165_36/0.45)]" : "ring-line")}>
      <ol className="relative grid grid-cols-6" aria-label="Progress">
        <div aria-hidden className="absolute top-[18px] right-[calc(100%/12)] left-[calc(100%/12)] h-0.5 rounded-full bg-stage-3">
          <motion.div
            className="h-full origin-left rounded-full bg-gradient-to-r from-marigold/50 to-marigold"
            initial={false}
            animate={{ scaleX: progress }}
            transition={{ type: "spring", stiffness: 90, damping: 22 }}
          />
          {/* the lit fuse head */}
          <motion.div
            className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-marigold-hi shadow-[0_0_14px_4px_rgb(245_165_36/0.75)]"
            initial={false}
            animate={{ left: `${progress * 100}%`, opacity: progress > 0 && progress < 1 ? 1 : 0 }}
            transition={{ type: "spring", stiffness: 90, damping: 22 }}
          />
        </div>
        {PIPELINE_STEPS.map((s) => {
          const st = status[s.id];
          const Icon = st === "done" ? (s.id === "qa" && fixed ? Wrench : Check) : st === "failed" ? X : st === "paused" ? Pause : ICONS[s.id];
          return (
            <li key={s.id} className="relative flex flex-col items-center gap-2 text-center" aria-current={st === "active" ? "step" : undefined}>
              <motion.span
                initial={false}
                animate={{ scale: st === "active" ? 1.1 : 1 }}
                transition={{ type: "spring", stiffness: 380, damping: 22 }}
                className={cn(
                  "relative z-10 grid size-9 place-items-center rounded-full ring-1 transition-colors duration-300 ring-inset",
                  st === "waiting" && "bg-stage-2 text-faint ring-line",
                  st === "active" && "animate-glow bg-marigold text-marigold-ink ring-marigold",
                  st === "done" && "bg-paper text-studio ring-paper",
                  st === "failed" && "bg-sindoor text-studio ring-sindoor",
                  st === "paused" && "bg-stage-2 text-marigold ring-marigold/60",
                )}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={`${st}${s.id === "qa" && fixed ? "-fixed" : ""}`}
                    initial={{ scale: 0.4, opacity: 0, rotate: -30 }}
                    animate={{ scale: 1, opacity: 1, rotate: 0 }}
                    exit={{ scale: 0.4, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 520, damping: 26 }}
                    className="grid place-items-center"
                  >
                    <Icon className="size-[18px]" aria-hidden />
                  </motion.span>
                </AnimatePresence>
                {/* the finish flash is a growing ring: with reduced motion it would just jump to its full size, so it is left out */}
                {st === "done" && !reduce ? (
                  <motion.span
                    aria-hidden
                    className="absolute inset-0 rounded-full ring-2 ring-marigold"
                    initial={{ scale: 1, opacity: 0.8 }}
                    animate={{ scale: 2.2, opacity: 0 }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                  />
                ) : null}
              </motion.span>
              <span className={cn("text-[0.75rem] leading-tight font-semibold transition-colors duration-300 sm:text-[0.78rem]", st === "waiting" ? "text-faint" : "text-paper")}>
                {s.label}
                <span className="sr-only">: {st === "waiting" ? "not started" : st === "active" ? "in progress" : st === "done" ? "done" : st === "paused" ? "paused" : "failed"}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p role="status" className="sr-only">
        {note}
      </p>
      <p aria-hidden className="relative mt-3 grid min-h-10 place-items-center text-center text-sm sm:mt-2 sm:min-h-5">
        {/* One note at a time: a new step's note replaces the last one in the same frame and brightens
            in (opacity and a 4 px rise, never a blur), so no two notes ever overlap and none lingers.
            Keyed on the step, not the text: the pack counter changes every few hundred ms and must
            not restart the entrance. */}
        <motion.span
          key={stepKey}
          initial={stepKey === bootKey ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className={cn("[grid-area:1/1] text-balance", noteTone)}
        >
          <NoteText note={note} />
        </motion.span>
      </p>
    </div>
  );
});

const COUNT = /^(\d+) of (\d+) (.+)$/;

/**
 * A running count ("4 of 9 formats ready") swaps its digits in place; any other change of
 * wording within a step brightens in quickly (opacity only, so the text is always crisp).
 */
function NoteText({ note = "" }: { note?: string }) {
  const m = COUNT.exec(note);
  if (m) {
    return (
      <span>
        <span className="tabular-nums">{m[1]}</span> of {m[2]} {m[3]}
      </span>
    );
  }
  return (
    <motion.span key={note} initial={{ opacity: 0.35 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      {note}
    </motion.span>
  );
}
