"use client";

import { RefreshCw, Sparkles } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/client/util";

/** Marks a field that AI Vision filled in (as opposed to the seller's words or a preset). */
export function AiBadge({ className, label = "AI Vision" }: { className?: string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-marigold/14 px-2 py-0.5 text-[0.7rem] leading-4 font-semibold whitespace-nowrap text-marigold-hi ring-1 ring-marigold/35 ring-inset",
        className,
      )}
    >
      <Sparkles className="size-3" aria-hidden />
      {label}
    </span>
  );
}

const useIsoLayoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

/** Rewrite the span's own text node, so React keeps a live reference to it. */
function write(el: HTMLElement, text: string) {
  if (el.firstChild) el.firstChild.nodeValue = text;
  else el.textContent = text;
}

/**
 * A number that counts to `value` once `start` is true (ease-out-expo). One text
 * node: the server HTML (and anything reading the page without script) carries the
 * final value; before the first paint the layout effect rewinds it to `from` and
 * counts up, writing to the DOM directly so React never re-renders. Screen
 * readers and text extraction read the number once.
 */
export function CountUp({
  value,
  from = 0,
  format = (n) => Math.round(n).toLocaleString("en-IN"),
  duration = 1400,
  delay = 0,
  start = true,
  className,
}: {
  value: number;
  from?: number;
  format?: (n: number) => string;
  duration?: number;
  delay?: number;
  start?: boolean;
  className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const fmt = React.useRef(format);
  React.useEffect(() => {
    fmt.current = format;
  });

  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!start) {
      write(el, fmt.current(from));
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || from === value) {
      write(el, fmt.current(value));
      return;
    }
    let raf = 0;
    const t0 = performance.now() + delay;
    const ease = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
    const tick = (now: number) => {
      const t = Math.max(0, (now - t0) / duration);
      write(el, fmt.current(from + (value - from) * ease(t)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    write(el, fmt.current(from));
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, from, duration, delay, start]);

  return (
    <span ref={ref} className={cn("tabular", className)} suppressHydrationWarning>
      {format(value)}
    </span>
  );
}

/**
 * Plain-language narration of long work ("Brightening…", "Upscaling…"): one line
 * at a time, each arriving with the studio's focus pull. Decorative; pair it with
 * a status line for screen readers.
 */
export function Narration({ lines, every = 1600, className }: { lines: string[]; every?: number; className?: string }) {
  const [i, setI] = React.useState(0);
  const key = lines.join("|");
  const [seen, setSeen] = React.useState(key);
  if (seen !== key) {
    setSeen(key);
    setI(0);
  }
  React.useEffect(() => {
    if (lines.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % lines.length), every);
    return () => clearInterval(t);
  }, [lines.length, every, key]);
  const line = lines[i % Math.max(1, lines.length)] ?? "";
  return (
    <span aria-hidden className={cn("relative inline-grid", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={line}
          initial={{ opacity: 0, filter: "blur(6px)", y: 6 }}
          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          exit={{ opacity: 0, filter: "blur(6px)", y: -6 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="col-start-1 row-start-1 whitespace-nowrap"
        >
          {line}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Seconds left until `until` (ms timestamp), ticking once a second. */
export function useCountdown(until: number | null): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

/**
 * Busy / error / info note. Busy is calm (Cloudinary needs a moment, nothing is
 * wrong); error names the problem and offers the recovery.
 */
export function Notice({
  tone,
  title,
  children,
  onRetry,
  retryLabel = "Try again",
  retryIcon,
  retryIn,
  className,
}: {
  tone: "busy" | "error" | "info";
  title: string;
  children?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  retryIcon?: React.ReactNode;
  retryIn?: number; // seconds until an automatic retry
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex flex-col gap-3 rounded-2xl p-4 text-sm ring-1 sm:flex-row sm:items-center sm:justify-between",
        tone === "error" ? "bg-sindoor/10 ring-sindoor/35" : "bg-stage-2 ring-line",
        className,
      )}
    >
      <div className="flex min-w-0 gap-3">
        {tone === "busy" ? (
          <span aria-hidden className="relative mt-1.5 grid size-2.5 shrink-0 place-items-center">
            <span className="size-2.5 rounded-full bg-marigold" />
            {!reduce ? <span className="absolute inset-0 animate-ping rounded-full bg-marigold/60 [animation-duration:1.8s]" /> : null}
          </span>
        ) : null}
        <div className="min-w-0">
          <p className={cn("font-semibold", tone === "error" ? "text-sindoor" : "text-paper")}>{title}</p>
          {children ? <div className="mt-0.5 text-dim">{children}</div> : null}
          {retryIn ? <p className="tabular mt-0.5 text-faint">Trying again in {retryIn} s</p> : null}
        </div>
      </div>
      {onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry} className="self-start sm:self-center">
          {retryIcon ?? <RefreshCw />}
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
