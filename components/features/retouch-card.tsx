"use client";

/* eslint-disable @next/next/no-img-element -- Cloudinary delivery URLs, already sized (c_limit 1080x1350, f_auto/q_auto) */
import { Check, ChevronsLeftRight, CodeXml, ScanEye, WandSparkles } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { XraySheet } from "@/components/kit/xray-sheet";
import { Button } from "@/components/ui/button";
import type { RetouchPendingResponse, RetouchResponse } from "@/lib/api-contract";
import { featureMessage, featuresClient, fixMeta, isBusy, rawViewPath, retouchUntilDone, withBusyRetry, type FeaturesClient } from "@/lib/client/features";
import { publicUrl } from "@/lib/client/img";
import { KIND_META } from "@/lib/client/kit-view";
import { cn, isAborted } from "@/lib/client/util";
import type { KitAsset, RetouchFix, Sku } from "@/lib/types";
import { Narration, Notice, useCountdown } from "./shared";

const EXPO = [0.16, 1, 0.3, 1] as const;

export interface RetouchCardProps {
  sku: Sku;
  /** Start as soon as it mounts (the studio's flow). false shows a "Check my photo" button. */
  autoStart?: boolean;
  /** Fires once: the fixes applied ([] when the photo needed none) and the full answer. */
  onDone?: (fixes: RetouchFix[], result: RetouchResponse) => void;
  /** The touch-up gave up (busy after retries, or failed). The cutout can go ahead with the raw photo. */
  onError?: (message: string) => void;
  client?: FeaturesClient;
  className?: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; busyUntil?: number }
  | { kind: "fixing"; plan: RetouchPendingResponse }
  | { kind: "done"; res: RetouchResponse }
  | { kind: "error"; message: string; busy: boolean };

/**
 * Q4 auto-retouch, narrated: AI Vision reads the photo, the planned fixes are
 * named while Cloudinary derives them, then a drag compare shows before and
 * after, what was fixed, and the exact transformation that did it.
 */
export function RetouchCard({ sku, autoStart = true, onDone, onError, client = featuresClient, className }: RetouchCardProps) {
  const [phase, setPhase] = React.useState<Phase>(autoStart ? { kind: "reading" } : { kind: "idle" });
  const [xrayOpen, setXrayOpen] = React.useState(false);
  const ac = React.useRef<AbortController | null>(null);
  const done = React.useRef(onDone);
  const failed = React.useRef(onError);
  React.useEffect(() => {
    done.current = onDone;
    failed.current = onError;
  });

  const start = React.useCallback(async () => {
    ac.current?.abort();
    const ctl = new AbortController();
    ac.current = ctl;
    setPhase({ kind: "reading" });
    try {
      const res = await withBusyRetry(
        () => retouchUntilDone(client, sku, { signal: ctl.signal, onPending: (plan) => setPhase({ kind: "fixing", plan }) }),
        { signal: ctl.signal, onBusy: (ms) => setPhase({ kind: "reading", busyUntil: Date.now() + ms }) },
      );
      if (ctl.signal.aborted) return;
      setPhase({ kind: "done", res });
      done.current?.(res.fixes.applied, res);
    } catch (e) {
      if (isAborted(e) || ctl.signal.aborted) return;
      setPhase({ kind: "error", message: featureMessage(e), busy: isBusy(e) });
      failed.current?.(featureMessage(e));
    }
  }, [client, sku]);

  // Deferred a tick so a remount (StrictMode, fast refresh) never sends the paid first call twice.
  React.useEffect(() => {
    if (!autoStart) return;
    const t = setTimeout(() => void start(), 0);
    return () => {
      clearTimeout(t);
      ac.current?.abort();
    };
  }, [autoStart, start]);

  const rawView = publicUrl(rawViewPath(sku), { w: 1080, h: 1350 });
  const res = phase.kind === "done" ? phase.res : null;
  const fixed = res?.status === "done" && !!res.url && res.fixes.applied.length > 0;
  const busyIn = useCountdown(phase.kind === "reading" ? (phase.busyUntil ?? null) : null);

  const title =
    phase.kind === "idle"
      ? "Touch up the photo"
      : phase.kind === "reading"
        ? "Checking your photo"
        : phase.kind === "fixing"
          ? "Touching up your photo"
          : phase.kind === "error"
            ? phase.busy
              ? "Waiting for Cloudinary"
              : "The touch-up didn't finish"
            : fixed
              ? "Your photo, touched up"
              : "Your photo needs no touch-up";

  const xrayAsset: KitAsset | null = res?.xray
    ? { id: "retouch", format: "hero", label: "Auto-retouch", url: res.xray.url, width: 1080, height: 1350, frame: "none", alt: "Retouched product photo", xray: res.xray }
    : null;

  return (
    <section aria-labelledby={`retouch-${sku}`} className={cn("rounded-[22px] bg-stage p-4 shadow-[0_30px_60px_-30px_rgb(0_0_0/0.9)] ring-1 ring-line sm:p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`retouch-${sku}`} className="font-display text-lg leading-tight font-semibold text-paper">
            {title}
          </h3>
          <p role="status" aria-live="polite" className="mt-1 min-h-5 text-[0.88rem] text-dim">
            {phase.kind === "idle" ? (
              "Fix dim, blurry or small photos before the cutout."
            ) : phase.kind === "reading" ? (
              busyIn ? (
                <span className="tabular">Cloudinary is busy for a moment. Trying again in {busyIn} s</span>
              ) : (
                <>
                  <span className="sr-only">AI Vision is reading the photo</span>
                  <Narration lines={["Reading the light", "Checking sharpness", "Measuring the size", "Looking for clutter"]} every={1200} />
                </>
              )
            ) : phase.kind === "fixing" ? (
              phase.plan.planned.length ? (
                <>
                  <span className="sr-only">Applying: {phase.plan.planned.map((f) => fixMeta(f).label).join(", ")}</span>
                  <Narration lines={phase.plan.planned.map((f) => `${fixMeta(f).doing}…`)} every={1500} />
                </>
              ) : (
                "Cloudinary is applying the fixes"
              )
            ) : phase.kind === "error" ? (
              "Your photo is unchanged. The cutout can use it as it is."
            ) : fixed ? (
              "Drag across the photo to compare."
            ) : (
              "Good light, sharp and big enough. The cutout uses it as it is."
            )}
          </p>
        </div>
        {(phase.kind === "reading" && !busyIn) || phase.kind === "fixing" ? (
          <span aria-hidden className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-marigold/14 px-2.5 py-1 text-[0.72rem] font-semibold text-marigold-hi ring-1 ring-marigold/35 ring-inset">
            <ScanEye className="size-3.5" />
            {phase.kind === "reading" ? "AI Vision" : "Retouching"}
          </span>
        ) : null}
      </div>

      <div className="mt-4">
        {phase.kind === "idle" ? (
          <Button onClick={() => void start()} className="w-full">
            <WandSparkles />
            Check my photo
          </Button>
        ) : phase.kind === "error" ? (
          <div className="grid gap-3">
            <Frame src={rawView} scanning={false} />
            <Notice tone={phase.busy ? "busy" : "error"} title={phase.busy ? "Busy for a moment" : "Retouch failed"} onRetry={() => void start()}>
              {phase.busy ? "Cloudinary's limit refills shortly. Try again in a minute." : phase.message}
            </Notice>
          </div>
        ) : fixed && res ? (
          <Compare before={res.beforeUrl ?? rawView} after={res.url!} />
        ) : (
          <Frame src={res?.beforeUrl ?? rawView} scanning={phase.kind === "reading" || phase.kind === "fixing"} />
        )}
      </div>

      {phase.kind === "fixing" && phase.plan.planned.length ? (
        <ul aria-label="Planned fixes" className="mt-4 flex flex-wrap gap-1.5">
          {phase.plan.planned.map((f) => (
            <li key={f} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-stage-2 px-2.5 text-[0.8rem] font-medium text-paper ring-1 ring-line-strong ring-inset">
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-marigold" />
              {fixMeta(f).label}
            </li>
          ))}
        </ul>
      ) : null}

      {res ? (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: fixed ? 0.9 : 0.1, ease: EXPO }} className="mt-4 grid gap-4">
          {fixed ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="text-[0.88rem] font-medium text-dim">We fixed</span>
              <ul className="flex flex-wrap gap-1.5">
                {res.fixes.applied.map((f) => (
                  <li key={f} className="inline-flex h-7 items-center gap-1 rounded-full bg-leaf/12 pr-2.5 pl-2 text-[0.8rem] font-semibold text-leaf ring-1 ring-leaf/30 ring-inset">
                    <Check className="size-3.5" aria-hidden />
                    {fixMeta(f).label}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {res.notes.length ? (
            <ul className="grid gap-1 text-[0.86rem] text-dim">
              {res.notes.map((n) => (
                <li key={n} className="flex gap-2">
                  <span aria-hidden className="mt-[0.55em] size-1 shrink-0 rounded-full bg-faint" />
                  {n}
                </li>
              ))}
            </ul>
          ) : null}

          {res.xray ? (
            <div className="grid gap-2 rounded-2xl bg-studio p-3.5 ring-1 ring-line">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[0.82rem] font-medium text-dim">The transformation</p>
                <Button variant="ghost" size="sm" onClick={() => setXrayOpen(true)} className="-my-1 -mr-2">
                  <CodeXml />
                  X-ray
                </Button>
              </div>
              <p className="font-mono text-[0.74rem] leading-relaxed break-all">
                {res.xray.segments
                  .filter((s) => s.kind !== "asset")
                  .map((s, i) => (
                    <React.Fragment key={i}>
                      {i > 0 ? <span className="text-faint">/</span> : null}
                      <span style={{ color: KIND_META[s.kind]?.color }} title={s.label}>
                        {s.text}
                      </span>
                    </React.Fragment>
                  ))}
              </p>
            </div>
          ) : null}

          <p className="tabular text-[0.78rem] text-faint">
            {fixed ? `About ${res.tx.toLocaleString("en-IN")} ${res.tx === 1 ? "transformation" : "transformations"}, ` : ""}
            {res.tokens ? `${res.tokens.toLocaleString("en-IN")} AI Vision tokens` : fixed ? "plan reused, 0 AI tokens" : "Plan reused, 0 AI tokens"}
            {res.ms ? `, answered in ${(res.ms / 1000).toFixed(1)} s` : ""}
          </p>
        </motion.div>
      ) : null}

      <XraySheet asset={xrayOpen ? xrayAsset : null} onOpenChange={setXrayOpen} />
    </section>
  );
}

/** The photo under the scanner while AI Vision reads it and Cloudinary derives the fix. */
function Frame({ src, scanning }: { src: string; scanning: boolean }) {
  const [loaded, setLoaded] = React.useState(false);
  const reduce = useReducedMotion();
  return (
    <div className="relative isolate aspect-[4/5] w-full overflow-hidden rounded-2xl bg-studio ring-1 ring-line">
      {!loaded ? <div className="skeleton absolute inset-0" /> : null}
      <img
        src={src}
        alt="Your product photo"
        width={1080}
        height={1350}
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={cn("absolute inset-0 size-full object-contain transition-[opacity,filter] duration-700 ease-(--ease-out-expo)", loaded ? "opacity-100" : "opacity-0", scanning && "brightness-[0.82] saturate-[0.8]")}
      />
      {scanning && !reduce ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-x-0 h-1/3 animate-sweep bg-gradient-to-b from-transparent via-marigold/25 to-transparent">
            <div className="absolute inset-x-0 top-1/2 h-px bg-marigold/80 shadow-[0_0_16px_rgb(245_165_36/0.9)]" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Before / after. It opens on the photo as it was, then the divider sweeps in to
 * reveal the fix (and show that it moves). A full-frame range input drives it
 * (drag, tap, arrow keys; reads as a slider), and the position lives in a CSS
 * variable so dragging never re-renders React.
 */
function Compare({ before, after }: { before: string; after: string }) {
  const box = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const touched = React.useRef(false);
  const [ready, setReady] = React.useState({ before: false, after: false });
  const both = ready.before && ready.after;

  const set = React.useCallback((v: number) => {
    box.current?.style.setProperty("--pos", `${v}%`);
    if (input.current) {
      input.current.value = String(Math.round(v));
      input.current.setAttribute("aria-valuetext", `${Math.round(v)}% original photo`);
    }
  }, []);

  React.useEffect(() => {
    if (!both) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return set(50);
    let raf = 0;
    const t0 = performance.now() + 450;
    const e = (x: number) => 1 - Math.pow(1 - x, 3);
    // 100 (all before) → 22 → 50
    const path = (t: number) => (t < 0.55 ? 100 - 78 * e(t / 0.55) : 22 + 28 * e((t - 0.55) / 0.45));
    const tick = (now: number) => {
      if (touched.current) return;
      const t = (now - t0) / 1900;
      if (t >= 0) set(path(Math.min(1, t)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [both, set]);

  return (
    <div ref={box} className="group relative isolate aspect-[4/5] w-full overflow-hidden rounded-2xl bg-studio ring-1 ring-line [--pos:100%]">
      {!both ? <div className="skeleton absolute inset-0" /> : null}
      <img
        src={after}
        alt="Your photo after the touch-up"
        width={1080}
        height={1350}
        decoding="async"
        onLoad={() => setReady((r) => ({ ...r, after: true }))}
        className={cn("absolute inset-0 size-full object-contain", !both && "opacity-0")}
      />
      <img
        src={before}
        alt="Your photo before the touch-up"
        width={1080}
        height={1350}
        decoding="async"
        onLoad={() => setReady((r) => ({ ...r, before: true }))}
        className={cn("absolute inset-0 size-full object-contain [clip-path:inset(0_calc(100%_-_var(--pos))_0_0)]", !both && "opacity-0")}
      />

      <AnimatePresence>
        {both ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="pointer-events-none absolute inset-0">
            <span className="absolute top-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-[0.72rem] font-semibold text-white backdrop-blur-sm">Before</span>
            <span className="absolute top-3 right-3 rounded-full bg-marigold px-2.5 py-1 text-[0.72rem] font-semibold text-marigold-ink">After</span>
            <div aria-hidden className="absolute inset-y-0 left-(--pos) z-10 w-0.5 -translate-x-1/2 bg-white/90 shadow-[0_0_20px_rgb(0_0_0/0.6)]">
              <span className="absolute top-1/2 left-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-studio shadow-[0_8px_24px_rgb(0_0_0/0.45)] transition-transform duration-200 group-has-[input:focus-visible]:ring-4 group-has-[input:focus-visible]:ring-marigold group-active:scale-95">
                <ChevronsLeftRight className="size-5" />
              </span>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <input
        ref={input}
        type="range"
        min={0}
        max={100}
        defaultValue={100}
        disabled={!both}
        aria-label="Compare the photo before and after the touch-up"
        aria-valuetext="100% original photo"
        onPointerDown={() => (touched.current = true)}
        onKeyDown={() => (touched.current = true)}
        onInput={(e) => {
          touched.current = true;
          set(Number(e.currentTarget.value));
        }}
        className="absolute inset-0 z-20 size-full cursor-ew-resize touch-pan-y opacity-0"
      />
    </div>
  );
}
