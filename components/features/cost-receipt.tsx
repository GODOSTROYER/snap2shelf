"use client";

import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";
import type { CostResponse } from "@/lib/api-contract";
import { PHOTOSHOOT_INR_ESTIMATE, PHOTOSHOOT_NOTE } from "@/lib/claims";
import { BUSY_RETRIES, featureMessage, featuresClient, formatBytes, formatLabel, isBusy, type FeaturesClient } from "@/lib/client/features";
import { cn, isAborted, sleep } from "@/lib/client/util";
import type { Sku } from "@/lib/types";
import { CountUp, Notice, useCountdown } from "./shared";

export interface CostReceiptProps {
  sku: Sku;
  /** Library scene the kit is staged on (publicId). Its credits count as saved by reuse. */
  scene?: string | null;
  /** Change it (e.g. after a pack finishes) to print a fresh receipt. */
  refreshKey?: string | number;
  /** What a basic one-product studio shoot costs, for scale. Shown as an estimate. */
  photoshootInr?: number;
  client?: FeaturesClient;
  /** A ledger already in hand (a sample's saved run, a server render): printed without a request. */
  initial?: CostResponse;
  /**
   * A saved sample's receipt: the note under its processing time (what that run
   * did). No end-to-end line: the seed script's own upload isn't a seller's.
   */
  replay?: string;
  className?: string;
}

type State =
  | { kind: "loading"; busyUntil?: number }
  | { kind: "ready"; data: CostResponse }
  | { kind: "error"; message: string; busy: boolean };

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const int = (n: number) => Math.round(n).toLocaleString("en-IN");
const PRINT_MS = 1500;

/**
 * What this kit cost, printed like a till receipt: it feeds out of the slot,
 * each line counts up as it prints, and the photo's weight counts down from the
 * original upload to what a browser actually downloads.
 */
export function CostReceipt({ sku, scene, refreshKey, photoshootInr = PHOTOSHOOT_INR_ESTIMATE, client = featuresClient, initial, replay, className }: CostReceiptProps) {
  const [state, setState] = React.useState<State>(initial ? { kind: "ready", data: initial } : { kind: "loading" });
  const hasInitial = !!initial;
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    if (hasInitial) return;
    const ctl = new AbortController();
    // Deferred a tick: a remount (StrictMode, fast refresh) must not spend a second Admin API call.
    const t = setTimeout(async () => {
      // Busy (Admin API rate limit etc.): wait 4 / 8 / 16 s, then stop and offer a button.
      for (let i = 0; ; i++) {
        try {
          const data = await client.cost(sku, scene ?? null, ctl.signal);
          if (!ctl.signal.aborted) setState({ kind: "ready", data });
          return;
        } catch (e) {
          if (isAborted(e) || ctl.signal.aborted) return;
          if (isBusy(e) && i < BUSY_RETRIES.length) {
            setState({ kind: "loading", busyUntil: Date.now() + BUSY_RETRIES[i] });
            await sleep(BUSY_RETRIES[i], ctl.signal).catch(() => undefined);
            if (ctl.signal.aborted) return;
            continue;
          }
          setState({ kind: "error", message: featureMessage(e), busy: isBusy(e) });
          return;
        }
      }
    }, 0);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [client, sku, scene, refreshKey, attempt, hasInitial]);

  const retry = () => {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  };

  return (
    <section aria-label="What this kit cost" className={cn("mx-auto w-full max-w-[26rem]", className)}>
      {/* the printer's slot */}
      <div aria-hidden className="relative z-10 mx-0 h-3.5 rounded-full bg-[color-mix(in_srgb,var(--color-studio)_40%,black)] shadow-[inset_0_2px_4px_rgb(0_0_0/0.9),0_1px_0_rgb(245_237_225/0.08)]" />
      <div className="-mt-2 overflow-hidden px-2.5 pt-1.5 pb-8">
        <AnimatePresence mode="wait" initial={false}>
          {state.kind === "ready" ? (
            <Printed key={`ready-${attempt}-${String(refreshKey ?? "")}`} data={state.data} photoshootInr={photoshootInr} replay={replay} />
          ) : state.kind === "error" ? (
            <motion.div key="error" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="pt-3">
              <Notice
                tone={state.busy ? "busy" : "error"}
                title={state.busy ? "The cost ledger is busy" : "Couldn't print the receipt"}
                onRetry={retry}
              >
                {state.busy ? "Cloudinary's reporting limit refills shortly. Try again in a minute." : state.message}
              </Notice>
            </motion.div>
          ) : (
            <Printing key="loading" busyUntil={state.busyUntil} />
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

/** Paper still feeding: a short stub with the header and a few blank lines. */
function Printing({ busyUntil }: { busyUntil?: number }) {
  const busyIn = useCountdown(busyUntil ?? null);
  const reduce = useReducedMotion();
  return (
    <motion.div initial={reduce ? false : { y: "-100%" }} animate={{ y: 0 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
      <Paper>
        <div className="grid gap-3 px-5 pt-5 pb-7" aria-busy="true">
          <p role="status" className="font-mono text-[0.78rem] text-studio/70">
            {busyIn ? `Cloudinary is busy. Trying again in ${busyIn} s` : "Adding up your kit…"}
          </p>
          {[0.9, 0.7, 0.8, 0.55].map((w, i) => (
            <span key={i} className="block h-3 animate-pulse rounded-sm bg-studio/10" style={{ width: `${w * 100}%`, animationDelay: `${i * 120}ms` }} />
          ))}
        </div>
      </Paper>
    </motion.div>
  );
}

function Printed({ data, photoshootInr, replay }: { data: CostResponse; photoshootInr: number; replay?: string }) {
  const reduce = useReducedMotion();
  const [open, setOpen] = React.useState(false);
  const itemsId = React.useId();
  const c = data.cost;
  const at = (i: number) => (reduce ? 0 : PRINT_MS * 0.35 + i * 140);
  const orig = c.bytesOriginal;
  const deliv = data.delivered.bytes || c.bytesDelivered;
  const lighter = orig > 0 && deliv > 0 ? Math.max(0, 1 - deliv / orig) : 0;
  const fmt = data.delivered.format ? formatLabel(data.delivered.format) : "";
  const wall = data.wallClockSeconds;
  const date = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  const lines: { label: string; value: number; unit: (n: number) => string; note?: string; tone?: "saved" }[] = [
    { label: "Image generation", value: c.generationCredits, unit: (n) => `${int(n)} ${Math.round(n) === 1 ? "credit" : "credits"}`, note: c.generationCredits === 0 ? "Nothing generated: the product photo itself is used" : undefined },
    { label: "Saved by reusing a scene", value: c.creditsSavedByReuse, unit: (n) => `${int(n)} ${Math.round(n) === 1 ? "credit" : "credits"}`, tone: "saved" },
    { label: "AI Vision", value: c.aiVisionTokens, unit: (n) => `${int(n)} tokens` },
    { label: "Transformations", value: c.transformationsEstimate, unit: (n) => int(n), note: "Estimate" },
  ];
  // the pipeline's own steps (read, cut out, stage, check, pack), not the upload or the seller's time in the studio
  if (c.seconds > 0) lines.push({ label: "Cloudinary processing", value: c.seconds, unit: (n) => `${n.toFixed(1)} s`, note: replay ?? "Every step after the upload" });
  // end to end, live kits only: this kit's own upload → its last format saved
  const photoToKit = replay ? null : wall !== null && wall > 0 && wall < 3600 ? `${wall < 90 ? `${wall} s` : `${Math.round(wall / 60)} min`} from upload to the last format saved` : null;

  return (
    <motion.div
      initial={reduce ? false : { y: "-100%" }}
      animate={{ y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: PRINT_MS / 1000, ease: [0.22, 1, 0.36, 1] }}
    >
      <Paper>
        <div className="px-5 pt-5 pb-8 font-mono text-[0.8rem] leading-relaxed text-studio">
          <div className="text-center">
            <h2 className="font-display text-[1.35rem] leading-none font-bold tracking-[-0.02em]">What this kit cost</h2>
            <p className="mt-2 text-[0.72rem] text-studio/65">
              Kit {data.sku} · {date}
            </p>
          </div>

          <Rule />
          <dl className="grid gap-2.5">
            {lines.map((l, i) => (
              // one dt/dd group per line (valid <dl>): the dotted leader is the label's own ::after
              <div key={l.label} className="flex flex-wrap items-baseline gap-x-2">
                <dt className="flex min-w-0 flex-1 items-baseline gap-2 after:min-w-3 after:flex-1 after:translate-y-[-3px] after:border-b after:border-dotted after:border-studio/35 after:content-['']">
                  <span className="shrink-0">{l.label}</span>
                </dt>
                <dd className={cn("shrink-0 font-semibold", l.tone === "saved" && l.value > 0 && "text-[color-mix(in_srgb,var(--color-leaf)_45%,var(--color-studio))]")}>
                  <CountUp value={l.value} format={l.unit} delay={at(i)} duration={900} />
                </dd>
                {l.note ? <dd className="basis-full text-[0.7rem] text-studio/60">{l.note}</dd> : null}
              </div>
            ))}
          </dl>

          {orig > 0 && deliv > 0 ? (
            <>
              <Rule />
              <div>
                <div className="flex items-baseline justify-between gap-3">
                  <p>{data.delivered.from === "hero" ? "Hero weight" : "Photo weight"}</p>
                  <p className="text-[0.72rem] text-studio/65">{Math.round(lighter * 100)}% lighter</p>
                </div>
                <p className="mt-1 flex flex-wrap items-baseline gap-x-2 font-display text-[1.25rem] leading-tight font-bold tracking-[-0.01em]">
                  <span className="tabular">{formatBytes(orig)}</span>
                  <span className="text-studio/40">to</span>
                  <CountUp value={deliv} from={orig} format={formatBytes} delay={at(lines.length) + 150} duration={1600} />
                  {fmt ? <span className="rounded bg-studio px-1.5 py-0.5 font-mono text-[0.68rem] font-semibold text-paper">{fmt}</span> : null}
                </p>
                <div aria-hidden className="mt-2.5 h-2 overflow-hidden rounded-full bg-studio/10">
                  <motion.div
                    className="h-full rounded-full bg-studio"
                    initial={reduce ? false : { width: "100%" }}
                    animate={{ width: `${Math.max(1.5, (1 - lighter) * 100)}%` }}
                    transition={{ duration: 1.6, delay: (at(lines.length) + 150) / 1000, ease: [0.16, 1, 0.3, 1] }}
                  />
                </div>
                <p className="mt-1.5 text-[0.7rem] text-studio/60">Original upload vs what a browser downloads (f_auto, q_auto).</p>
              </div>
            </>
          ) : null}

          <Rule />
          <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
            <div>
              <p className="font-semibold">Photoshoot you skipped</p>
              <p className="text-[0.7rem] text-studio/60">{PHOTOSHOOT_NOTE}</p>
            </div>
            <p className="font-display text-[1.9rem] leading-none font-bold tracking-[-0.02em] whitespace-nowrap">
              ≈ <CountUp value={photoshootInr} format={inr} delay={at(lines.length + 2)} duration={1300} />
            </p>
          </div>
          {photoToKit ? (
            <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-[0.72rem] text-studio/65">
              <span className="font-semibold text-studio">Photo to kit</span>
              {photoToKit}
            </p>
          ) : null}

          <button
            type="button"
            aria-expanded={open}
            aria-controls={itemsId}
            onClick={() => setOpen((o) => !o)}
            className="mt-3 inline-flex min-h-8 items-center gap-1.5 rounded-md py-1 font-semibold text-studio underline decoration-studio/30 underline-offset-4 hover:decoration-studio focus-visible:outline-studio"
          >
            {open ? "Hide itemised lines" : "Show itemised lines"}
            <ChevronDown aria-hidden className={cn("size-4 transition-transform duration-300", open && "rotate-180")} />
          </button>
          <AnimatePresence initial={false}>
            {open ? (
              <motion.div
                id={itemsId}
                key="items"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <Itemised data={data} />
              </motion.div>
            ) : null}
          </AnimatePresence>

          <Rule />
          <p className="text-[0.68rem] leading-snug text-studio/60">
            Transformation counts are estimates from Cloudinary&apos;s documented per-effect counts; credits, tokens and times are what the pipeline recorded
            {replay ? " on this sample's live run" : ""}.
          </p>
        </div>
      </Paper>
    </motion.div>
  );
}

function Itemised({ data }: { data: CostResponse }) {
  const b = data.breakdown;
  const groups: { title: string; rows: { label: string; value: string }[] }[] = [
    { title: "Transformations", rows: b.transformations.map((t) => ({ label: tidy(t.label), value: int(t.tx) })) },
    { title: "AI Vision tokens", rows: b.tokens.map((t) => ({ label: tidy(t.label), value: int(t.tokens) })) },
    { title: "Generation credits", rows: b.generation.map((g) => ({ label: tidy(g.label), value: int(g.credits) })) },
    { title: "Time per step", rows: b.steps.map((s) => ({ label: tidy(s.label), value: `${(s.ms / 1000).toFixed(1)} s` })) },
  ].filter((g) => g.rows.length);
  if (!groups.length) return <p className="pt-3 text-[0.75rem] text-studio/65">No itemised lines recorded for this product yet.</p>;
  return (
    <div className="grid gap-3 pt-3">
      {groups.map((g) => (
        <div key={g.title}>
          <p className="text-[0.72rem] font-semibold text-studio/70">{g.title}</p>
          <ul className="mt-1 grid gap-0.5 text-[0.74rem]">
            {g.rows.map((r, i) => (
              <li key={`${r.label}-${i}`} className="flex items-baseline gap-2">
                <span className="min-w-0 truncate" title={r.label}>
                  {r.label}
                </span>
                <span aria-hidden className="min-w-3 flex-1 translate-y-[-3px] border-b border-dotted border-studio/25" />
                <span className="tabular shrink-0">{r.value}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const tidy = (s: string) => s.replace(/,(?=\S)/g, ", ");

function Rule() {
  return <div aria-hidden className="my-4 border-t border-dashed border-studio/30" />;
}

/** Receipt paper: warm white, a torn zig-zag foot, a soft shadow that follows the tear. */
function Paper({ children }: { children: React.ReactNode }) {
  return (
    <div className="drop-shadow-[0_18px_22px_rgb(0_0_0/0.55)]">
      <div
        className="bg-paper bg-[linear-gradient(to_bottom,rgb(0_0_0/0.07),transparent_1.5rem)]"
        style={{
          WebkitMaskImage: "conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg)",
          maskImage: "conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg)",
          WebkitMaskSize: "14px 100%",
          maskSize: "14px 100%",
          WebkitMaskPosition: "50%",
          maskPosition: "50%",
        }}
      >
        {children}
      </div>
    </div>
  );
}
