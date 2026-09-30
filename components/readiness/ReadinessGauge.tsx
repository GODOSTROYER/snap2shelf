"use client";

import { ArrowRight, Check, CircleHelp, ExternalLink, LoaderCircle, Minus, Wand2, X } from "lucide-react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform, type Variants } from "motion/react";
import { useEffect, useId, useState } from "react";
import { GRADE_LABEL, type CheckStatus, type Grade, type ReadinessCheck, type ReadinessReport } from "@/lib/readiness";

/**
 * Readiness Score (U5): animated radial gauge + checklist with pass/fix states.
 * Self-contained (own palette, fonts fall back when the shelf font variables are absent).
 * The kit view (feat/ui) can drop it in as-is:
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
  /** Show the "phone photo → kit" comparison when the report has a baseline. Default true. */
  showBaseline?: boolean;
  title?: string;
  className?: string;
}

const STATUS: Record<CheckStatus, { label: string; ring: string; text: string; bg: string; Icon: typeof Check }> = {
  pass: { label: "Pass", ring: "ring-[#7fc28a]/35", text: "text-[#9bd3a4]", bg: "bg-[#7fc28a]/12", Icon: Check },
  warn: { label: "Needs a touch", ring: "ring-[#f5a524]/40", text: "text-[#f5b94a]", bg: "bg-[#f5a524]/12", Icon: Minus },
  fail: { label: "Fail", ring: "ring-[#ef6f5e]/40", text: "text-[#f28a7c]", bg: "bg-[#ef6f5e]/12", Icon: X },
  unknown: { label: "Not measured", ring: "ring-[#f4efe7]/15", text: "text-[#a89f92]", bg: "bg-[#f4efe7]/[0.05]", Icon: CircleHelp },
};

const GRADE_COLOR: Record<Grade, string> = { ready: "#9bd3a4", almost: "#f5b94a", "not-ready": "#f28a7c" };

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
    <div className="relative mx-auto h-[184px] w-[184px] shrink-0">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full rotate-[135deg]" aria-hidden>
        <defs>
          <linearGradient id={`g-${gid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#e2711d" />
            <stop offset="100%" stopColor="#f5a524" />
          </linearGradient>
        </defs>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="#f4efe7" strokeOpacity={0.08} strokeWidth={STROKE} strokeLinecap="round" strokeDasharray={`${C * ARC} ${C}`} />
        <motion.circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={`url(#g-${gid})`}
          strokeWidth={STROKE}
          strokeLinecap="round"
          style={{ strokeDasharray: dash }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
        <span className="font-[family-name:var(--font-shelf-display,ui-serif,Georgia,serif)] text-[56px] font-semibold leading-none tracking-tight tabular-nums text-[#f4efe7]">
          {shown}
        </span>
        <span className="mt-1 text-xs font-medium tracking-wide text-[#a89f92]">out of 100</span>
      </div>
    </div>
  );
}

function FixButton({ check, onFix, busy }: { check: ReadinessCheck; onFix: NonNullable<ReadinessGaugeProps["onFix"]>; busy: boolean }) {
  const fix = check.fix!;
  if (fix.kind === "retake") return <p className="mt-2 text-[13px] leading-relaxed text-[#a89f92]">Tip: {fix.tip}</p>;
  const label = fix.kind === "transformation" && fix.paid ? `${fix.label} (uses AI credits)` : fix.label;
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => onFix(check)}
        disabled={busy}
        aria-label={`Fix ${check.label}: ${label}`}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[#f5a524] px-3.5 text-[13px] font-semibold text-[#1a1208] transition-colors hover:bg-[#ffb73d] disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f4efe7] focus-visible:ring-offset-2 focus-visible:ring-offset-[#15120f]"
      >
        {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Wand2 className="h-3.5 w-3.5" aria-hidden />}
        {busy ? "Fixing…" : label}
      </button>
      {fix.kind === "transformation" && fix.previewUrl && (
        <a
          href={fix.previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-9 items-center gap-1 rounded-full px-2 text-[13px] text-[#a89f92] underline-offset-4 hover:text-[#f4efe7] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f5a524]"
        >
          Preview <ExternalLink className="h-3 w-3" aria-hidden />
          <span className="sr-only"> the fixed image (opens a new tab)</span>
        </a>
      )}
    </div>
  );
}

export function ReadinessGauge({ report, onFix, fixing = null, showBaseline = true, title = "Marketplace readiness", className = "" }: ReadinessGaugeProps) {
  const reduce = useReducedMotion();
  const list: Variants = { hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.06, delayChildren: reduce ? 0 : 0.25 } } };
  const row: Variants = reduce
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : { hidden: { opacity: 0, x: -10 }, show: { opacity: 1, x: 0, transition: { type: "spring", stiffness: 200, damping: 24 } } };
  const passed = report.checks.filter((c) => c.status === "pass").length;
  const measured = report.checks.filter((c) => c.status !== "unknown").length;
  const baseline = showBaseline ? report.baseline : undefined;

  return (
    <section
      aria-label={title}
      className={`rounded-[28px] border border-[#f4efe7]/10 bg-[#15120f]/90 p-5 text-[#f4efe7] shadow-[0_30px_80px_-40px_rgba(0,0,0,0.9)] sm:p-7 ${className}`}
    >
      <div className="grid gap-7 md:grid-cols-[auto_minmax(0,1fr)] md:gap-10">
        <div className="flex flex-col items-center">
          <div
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={report.score}
            aria-valuetext={`${report.score} out of 100, ${GRADE_LABEL[report.grade]}`}
            aria-label={title}
          >
            <Dial score={report.score} reduce={reduce} />
          </div>
          <span
            className="-mt-4 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]"
            style={{ color: GRADE_COLOR[report.grade], backgroundColor: `${GRADE_COLOR[report.grade]}1f` }}
          >
            {GRADE_LABEL[report.grade]}
          </span>
          <p className="mt-3 text-center text-[13px] text-[#a89f92]">
            {passed} of {measured} checks pass
          </p>
          {baseline && (
            <div className="mt-4 flex w-full max-w-[260px] items-center justify-between gap-2 rounded-2xl border border-[#f4efe7]/10 bg-[#f4efe7]/[0.03] px-4 py-3">
              <div className="text-center">
                <p className="whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.1em] text-[#a89f92]">Phone photo</p>
                <p className="font-[family-name:var(--font-shelf-display,ui-serif,Georgia,serif)] text-2xl font-semibold tabular-nums text-[#f28a7c]">{baseline.score}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-[#a89f92]" aria-hidden />
              <div className="text-center">
                <p className="whitespace-nowrap text-[10px] font-medium uppercase tracking-[0.1em] text-[#a89f92]">Snap2Shelf</p>
                <p className="font-[family-name:var(--font-shelf-display,ui-serif,Georgia,serif)] text-2xl font-semibold tabular-nums" style={{ color: GRADE_COLOR[report.grade] }}>
                  {report.score}
                </p>
              </div>
              <span className="sr-only">
                The original phone photo scores {baseline.score}; the Snap2Shelf marketplace image scores {report.score}.
              </span>
            </div>
          )}
        </div>

        <div className="min-w-0">
          <h3 className="font-[family-name:var(--font-shelf-display,ui-serif,Georgia,serif)] text-2xl font-semibold tracking-tight">{title}</h3>
          <p className="mt-1 text-sm text-[#a89f92]">Main image on white, plus social formats. Measured on the real pixels.</p>
          <motion.ul variants={list} initial="hidden" animate="show" className="mt-5 divide-y divide-[#f4efe7]/[0.07]">
            {report.checks.map((c) => {
              const s = STATUS[c.status];
              return (
                <motion.li key={c.id} variants={row} className="flex gap-3.5 py-3.5 first:pt-0 last:pb-0">
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1 ${s.ring} ${s.bg} ${s.text}`} aria-hidden>
                    <s.Icon className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-medium leading-snug">
                        {c.label}
                        <span className="sr-only">: {s.label}.</span>
                      </p>
                      <span className={`shrink-0 text-xs font-semibold tabular-nums ${s.text}`}>
                        {c.status === "unknown" ? "—" : `${c.points}/${c.weight}`}
                        <span className="sr-only"> points</span>
                      </span>
                    </div>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-[#a89f92]">{c.detail}</p>
                    {onFix && c.fix && c.status !== "pass" && <FixButton check={c} onFix={onFix} busy={fixing === c.id} />}
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
