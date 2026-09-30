"use client";

import { Check, PackageCheck, Scissors, ShieldCheck, SunMedium, WandSparkles, X, Frame } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/client/util";
import { PIPELINE_STEPS, type PipelineStepId } from "@/lib/types";

export type StepStatus = "waiting" | "active" | "done" | "failed";

const ICONS: Record<PipelineStepId, typeof Check> = {
  fix: WandSparkles,
  cutout: Scissors,
  stage: Frame,
  light: SunMedium,
  qa: ShieldCheck,
  pack: PackageCheck,
};

/** Fix → Cut out → Stage → Light-match → QA → Pack, lighting up as the real calls finish. */
export function PipelineRail({ status, notes }: { status: Record<PipelineStepId, StepStatus>; notes: Partial<Record<PipelineStepId, string>> }) {
  const doneCount = PIPELINE_STEPS.filter((s) => status[s.id] === "done").length;
  const active = PIPELINE_STEPS.find((s) => status[s.id] === "active" || status[s.id] === "failed");
  const progress = Math.min(1, (doneCount + (active && status[active.id] === "active" ? 0.5 : 0)) / (PIPELINE_STEPS.length - 1));

  return (
    <div className="rounded-2xl bg-stage/70 px-3 py-3 ring-1 ring-line sm:px-5 sm:py-4">
      <ol className="relative grid grid-cols-6" aria-label="Progress">
        <div aria-hidden className="absolute top-[18px] right-[calc(100%/12)] left-[calc(100%/12)] h-0.5 rounded-full bg-stage-3">
          <motion.div
            className="h-full origin-left rounded-full bg-marigold"
            initial={false}
            animate={{ scaleX: progress }}
            transition={{ type: "spring", stiffness: 90, damping: 22 }}
          />
        </div>
        {PIPELINE_STEPS.map((s) => {
          const st = status[s.id];
          const Icon = st === "done" ? Check : st === "failed" ? X : ICONS[s.id];
          return (
            <li key={s.id} className="relative flex flex-col items-center gap-2 text-center" aria-current={st === "active" ? "step" : undefined}>
              <motion.span
                initial={false}
                animate={{ scale: st === "active" ? 1.08 : 1 }}
                transition={{ type: "spring", stiffness: 380, damping: 22 }}
                className={cn(
                  "relative z-10 grid size-9 place-items-center rounded-full ring-1 transition-colors duration-300 ring-inset",
                  st === "waiting" && "bg-stage-2 text-faint ring-line",
                  st === "active" && "animate-glow bg-marigold text-marigold-ink ring-marigold",
                  st === "done" && "bg-paper text-studio ring-paper",
                  st === "failed" && "bg-sindoor text-studio ring-sindoor",
                )}
              >
                <Icon className="size-[18px]" aria-hidden />
              </motion.span>
              <span className={cn("text-[0.7rem] leading-tight font-semibold sm:text-[0.78rem]", st === "waiting" ? "text-faint" : "text-paper")}>
                {s.label}
                <span className="sr-only">: {st === "waiting" ? "not started" : st === "active" ? "in progress" : st === "done" ? "done" : "failed"}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p role="status" aria-live="polite" className="mt-3 min-h-5 text-center text-sm text-dim sm:mt-2">
        {active ? (
          <span className={status[active.id] === "failed" ? "text-sindoor" : undefined}>{notes[active.id]}</span>
        ) : doneCount === PIPELINE_STEPS.length ? (
          <span>{notes.pack ?? "Kit ready"}</span>
        ) : (
          "Waiting for a photo"
        )}
      </p>
    </div>
  );
}
