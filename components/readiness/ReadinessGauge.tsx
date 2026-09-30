"use client";

import { ArrowRight, Check, CircleHelp, ExternalLink, LoaderCircle, Minus, Wand2, X } from "lucide-react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type Variants } from "motion/react";
import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/client/util";
import { GRADE_LABEL, type CheckStatus, type Grade, type ReadinessCheck, type ReadinessReport } from "@/lib/readiness";

/**
 * Readiness Score (U5): animated radial gauge + checklist with pass/fix states,
 * on the studio's tokens (works on any page that loads app/globals.css).
 *
 *   <ReadinessGauge report={report} onFix={(check) => …} fixing={checkId} />
 *
 * `onFix` receives the failing check; `check.fix` says what to do:
 *   transformation + apply → POST /api/readiness/:sku { fixes: [apply] }
 *   restage               → nudge the composite controls (check.fix.controls)
 *   repack                → re-run the pack with check.fix.textZone
 *   retake                → show check.fix.tip
 */
export interface ReadinessGaugeProps {
  report: ReadinessReport;
  /** Called with the check whose fix the user clicked. Omit to hide fix buttons (read-only view). */
  onFix?: (check: ReadinessCheck) => void | Promise<void>;
  /** Id of the check being fixed right now (shows a spinner, disables the button). */
  fixing?: ReadinessCheck["id"] | null;
  /** Disable every fix button (e.g. while the studio re-packs). */
  fixesDisabled?: boolean;
  /** Fix buttons explain rather than act (a saved sample): drawn as secondary buttons. */
  quietFixes?: boolean;
  /** Show the "phone photo → kit" comparison when the report has a baseline. Default true. */
  showBaseline?: boolean;
  title?: string;
  subtitle?: string;
  className?: string;
}

const STATUS: Record<CheckStatus, { label: string; tone: string; Icon: typeof Check }> = {
  pass: { label: "Pass", tone: "bg-leaf/12 text-leaf ring-leaf/35", Icon: Check },
  warn: { label: "Needs a touch", tone: "bg-marigold/12 text-marigold-hi ring-marigold/40", Icon: Minus },
  fail: { label: "Fail", tone: "bg-sindoor/12 text-sindoor ring-sindoor/40", Icon: X },
  unknown: { label: "Not measured", tone: "bg-paper/5 text-dim ring-line-strong", Icon: CircleHelp },
};

const GRADE_TONE: Record<Grade, string> = { ready: "text-leaf bg-leaf/12", almost: "text-marigold-hi bg-marigold/12", "not-ready": "text-sindoor bg-sindoor/12" };
const GRADE_TEXT: Record<Grade, string> = { ready: "text-leaf", almost: "text-marigold-hi", "not-ready": "text-sindoor" };

const SIZE = 184;
const STROKE = 14;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;
/** The ring is a 270° arc (open at the bottom), like a dial. */
const ARC = 0.75;

function useCountUp(target: number, reduce: boolean | null): number {
  const [n, setN] = useState(reduce ? target : 0);
  useEffect(() => {
    if (reduce) return;
    const controls = animate(0, target, { type: "spring", stiffness: 60, damping: 18, onUpdate: (v) => setN(Math.round(v)) });
    return () => controls.stop();
  }, [target, reduce]);
  return reduce ? target : n;
}

function Dial({ score, reduce }: { score: number; reduce: boolean | null }) {
  const gid = useId().replace(/:/g, "");
  const progress = useMotionValue(reduce ? score : 0);
  useEffect(() => {
    if (reduce) {
      progress.set(score);
      return;
    }
    const c = animate(progress, score, { type: "spring", stiffness: 55, damping: 16 });
    return () => c.stop();
  }, [score, reduce, progress]);
  const dash = useTransform(progress, (v) => `${(C * ARC * Math.max(0, Math.min(100, v))) / 100} ${C}`);
  const shown = useCountUp(score, reduce);

  return (
    <div className="relative mx-auto size-[184px] shrink-0">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="size-full rotate-[135deg]" aria-hidden>
        <defs>
          <linearGradient id={`g-${gid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#e2711d" />
            <stop offset="100%" stopColor="#f5a524" />
          </linearGradient>
        </defs>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="currentColor" className="text-paper/8" strokeWidth={STROKE} strokeLinecap="round" strokeDasharray={`${C * ARC} ${C}`} />
        <motion.circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke={`url(#g-${gid})`} strokeWidth={STROKE} strokeLinecap="round" style={{ strokeDasharray: dash }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
        <span className="tabular font-display text-[56px] leading-none font-bold tracking-[-0.03em] text-paper">{shown}</span>
        <span className="mt-1 text-xs font-medium text-dim">out of 100</span>
      </div>
    </div>
  );
}

function FixButton({ check, onFix, busy, disabled, quiet }: { check: ReadinessCheck; onFix: NonNullable<ReadinessGaugeProps["onFix"]>; busy: boolean; disabled?: boolean; quiet?: boolean }) {
  const fix = check.fix!;
  if (fix.kind === "retake") return <p className="mt-2 text-[0.82rem] leading-relaxed text-dim">Tip: {fix.tip}</p>;
  // a paid AI fix is never one click: say what would fix it, and where
  if (fix.kind === "transformation" && fix.paid) {
    return (
      <p className="mt-2 text-[0.82rem] leading-relaxed text-dim">
        Fix: {fix.label.charAt(0).toLowerCase() + fix.label.slice(1)}. It spends AI credits, so it isn&apos;t a one-click fix.
        {fix.previewUrl ? (
          <>
            {" "}
            <a href={fix.previewUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-paper underline decoration-marigold/60 underline-offset-4 hover:decoration-marigold">
              Preview it
              <span className="sr-only"> (opens a new tab)</span>
            </a>
          </>
        ) : null}
      </p>
    );
  }
  const label = fix.label;
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => onFix(check)}
        disabled={busy || disabled}
        aria-label={`Fix ${check.label}: ${label}`}
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[0.82rem] font-semibold transition-[background-color,opacity,transform] duration-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50",
          quiet
            ? "bg-stage-2 text-paper ring-1 ring-line-strong ring-inset hover:bg-stage-3"
            : "bg-marigold text-marigold-ink shadow-[0_8px_22px_-10px_rgb(245_165_36/0.6)] hover:bg-marigold-hi",
        )}
      >
        {busy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <Wand2 className="size-3.5" aria-hidden />}
        {busy ? "Fixing…" : label}
      </button>
      {fix.kind === "transformation" && fix.previewUrl && (
        <a
          href={fix.previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center gap-1 rounded-full px-2 text-[0.82rem] text-dim underline-offset-4 hover:text-paper hover:underline"
        >
          Preview <ExternalLink className="size-3" aria-hidden />
          <span className="sr-only"> the fixed image (opens a new tab)</span>
        </a>
      )}
    </div>
  );
}

export function ReadinessGauge({
  report,
  onFix,
  fixing = null,
  fixesDisabled,
  quietFixes,
  showBaseline = true,
  title = "Marketplace readiness",
  subtitle = "The main image on white, plus the social formats. Measured on the real pixels.",
  className = "",
}: ReadinessGaugeProps) {
  const reduce = useReducedMotion();
  const list: Variants = { hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.06, delayChildren: reduce ? 0 : 0.25 } } };
  const row: Variants = reduce
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : { hidden: { opacity: 0, x: -10 }, show: { opacity: 1, x: 0, transition: { type: "spring", stiffness: 200, damping: 24 } } };
  const passed = report.checks.filter((c) => c.status === "pass").length;
  const measured = report.checks.filter((c) => c.status !== "unknown").length;
  const baseline = showBaseline ? report.baseline : undefined;

  return (
    <section aria-label={title} className={cn("rounded-[22px] bg-stage p-5 text-paper shadow-[0_30px_60px_-30px_rgb(0_0_0/0.9)] ring-1 ring-line sm:p-7", className)}>
      <div className="grid gap-7 md:grid-cols-[auto_minmax(0,1fr)] md:gap-10">
        <div className="flex flex-col items-center">
          <div role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={report.score} aria-valuetext={`${report.score} out of 100, ${GRADE_LABEL[report.grade]}`} aria-label={title}>
            <Dial score={report.score} reduce={reduce} />
          </div>
          <span className={cn("-mt-4 rounded-full px-3 py-1 text-[0.75rem] font-semibold", GRADE_TONE[report.grade])}>{GRADE_LABEL[report.grade]}</span>
          <p className="mt-3 text-center text-[0.82rem] text-dim">
            {passed} of {measured} checks pass
          </p>
          {baseline && (
            <div className="mt-4 flex w-full max-w-[260px] items-center justify-between gap-2 rounded-2xl bg-stage-2 px-4 py-3 ring-1 ring-line">
              <div className="text-center">
                <p className="text-[0.72rem] font-medium whitespace-nowrap text-dim">Phone photo</p>
                <p className="tabular font-display text-2xl font-bold text-sindoor">{baseline.score}</p>
              </div>
              <ArrowRight className="size-4 text-faint" aria-hidden />
              <div className="text-center">
                <p className="text-[0.72rem] font-medium whitespace-nowrap text-dim">Snap2Shelf</p>
                <p className={cn("tabular font-display text-2xl font-bold", GRADE_TEXT[report.grade])}>{report.score}</p>
              </div>
              <span className="sr-only">
                The original phone photo scores {baseline.score}; the Snap2Shelf marketplace image scores {report.score}.
              </span>
            </div>
          )}
        </div>

        <div className="min-w-0">
          <h3 className="font-display text-xl font-bold tracking-[-0.02em] sm:text-2xl">{title}</h3>
          <p className="mt-1 text-sm text-dim">{subtitle}</p>
          <motion.ul variants={list} initial="hidden" animate="show" className="mt-5 divide-y divide-line">
            {report.checks.map((c) => {
              const s = STATUS[c.status];
              return (
                <motion.li key={c.id} variants={row} className="flex gap-3.5 py-3.5 first:pt-0 last:pb-0">
                  <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full ring-1 ring-inset", s.tone)} aria-hidden>
                    <s.Icon className="size-3.5" strokeWidth={3} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="leading-snug font-medium">
                        {c.label}
                        <span className="sr-only">: {s.label}.</span>
                      </p>
                      <span className={cn("tabular shrink-0 text-xs font-semibold", s.tone.split(" ").find((t) => t.startsWith("text-")))}>
                        {c.status === "unknown" ? "—" : `${c.points}/${c.weight}`}
                        <span className="sr-only"> points</span>
                      </span>
                    </div>
                    <p className="mt-0.5 text-[0.82rem] leading-relaxed text-dim">{c.detail}</p>
                    {onFix && c.fix && c.status !== "pass" && <FixButton check={c} onFix={onFix} busy={fixing === c.id} quiet={quietFixes} disabled={fixesDisabled || (fixing !== null && fixing !== c.id)} />}
                  </div>
                </motion.li>
              );
            })}
          </motion.ul>
        </div>
      </div>
    </section>
  );
}
