"use client";

import { ArrowUp, Check, WandSparkles } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import type { BriefResponse, BriefSource } from "@/lib/api-contract";
import {
  ApiFailure,
  channelMeta,
  featureMessage,
  featuresClient,
  isBusy,
  themeLabel,
  withBusyRetry,
  type FeaturesClient,
} from "@/lib/client/features";
import { cn, isAborted } from "@/lib/client/util";
import { FESTIVALS, festivalBySlug, type FestivalSlug } from "@/lib/festivals";
import type { BriefKit, ChannelFormat, Sku } from "@/lib/types";
import { devanagari } from "./fonts";
import { AiBadge, Narration, Notice, useCountdown } from "./shared";

const MAX = 300;
const EXPO = [0.16, 1, 0.3, 1] as const;
const EXAMPLE = "Diwali sale, 20% off, Hindi, for WhatsApp + Instagram";

export interface BriefBarProps {
  sku: Sku;
  /** "Use these settings": theme → scene selection, offer → PackRequest.offer, swatches → PackRequest.recolor. */
  onApply: (kit: BriefKit, response: BriefResponse) => void;
  /** Every parsed brief, before the seller applies it (e.g. to prefill the scene generator). */
  onResult?: (response: BriefResponse) => void;
  defaultBrief?: string;
  defaultFestival?: FestivalSlug;
  /** e.g. until the product has been analysed. */
  disabled?: boolean;
  client?: FeaturesClient;
  className?: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "reading"; brief: string; busyUntil?: number }
  | { kind: "done"; brief: string; res: BriefResponse; ms: number }
  | { kind: "error"; brief: string; message: string; busy: boolean };

/**
 * Brief bar: one line of seller intent → the kit's stage, offer lines, channels,
 * palette and tone. Words the seller typed light up as they're read, then each
 * setting focus-pulls into place with where it came from (their words, a festival
 * preset, or AI Vision looking at the product photo).
 */
export function BriefBar({ sku, onApply, onResult, defaultBrief = "", defaultFestival, disabled, client = featuresClient, className }: BriefBarProps) {
  const [text, setText] = React.useState(defaultBrief);
  const [festival, setFestival] = React.useState<FestivalSlug | null>(defaultFestival ?? null);
  const [phase, setPhase] = React.useState<Phase>({ kind: "idle" });
  const [applied, setApplied] = React.useState<BriefResponse | null>(null);
  const [hint, setHint] = React.useState<string | null>(null);
  const ac = React.useRef<AbortController | null>(null);
  const inputId = React.useId();
  const hintId = React.useId();

  // A different product starts a fresh brief.
  const [seenSku, setSeenSku] = React.useState(sku);
  if (seenSku !== sku) {
    setSeenSku(sku);
    setPhase({ kind: "idle" });
    setApplied(null);
  }
  React.useEffect(() => () => ac.current?.abort(), []);

  const reading = phase.kind === "reading";
  const preset = festivalBySlug(festival);

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const typed = text.trim();
    const brief = typed || (preset ? `${preset.label} sale` : "");
    if (!brief) {
      setHint("Describe the ad in a few words, or pick a festival below.");
      return;
    }
    setHint(null);
    ac.current?.abort();
    const ctl = new AbortController();
    ac.current = ctl;
    const t0 = performance.now();
    setPhase({ kind: "reading", brief });
    try {
      const res = await withBusyRetry(() => client.brief({ sku, brief, festival: festival ?? undefined }, ctl.signal), {
        signal: ctl.signal,
        onBusy: (ms) => setPhase({ kind: "reading", brief, busyUntil: Date.now() + ms }),
      });
      // Let the read-through land even when the answer comes from cache.
      const elapsed = performance.now() - t0;
      if (elapsed < 900) await new Promise((r) => setTimeout(r, 900 - elapsed));
      if (ctl.signal.aborted) return;
      setPhase({ kind: "done", brief, res, ms: performance.now() - t0 });
      onResult?.(res);
    } catch (err) {
      if (isAborted(err) || ctl.signal.aborted) return;
      setPhase({ kind: "error", brief, message: err instanceof ApiFailure && err.status === 404 ? "We couldn't find this product's photo. Add the photo again, then describe the ad." : featureMessage(err), busy: isBusy(err) });
    }
  };

  const pickFestival = (slug: FestivalSlug) => {
    setFestival((f) => (f === slug ? null : slug));
    setHint(null);
  };

  const done = phase.kind === "done" ? phase : null;
  const isApplied = !!done && applied === done.res;

  return (
    <section aria-labelledby={`${inputId}-title`} className={cn("grid gap-4", devanagari.variable, className)}>
      <div>
        <h3 id={`${inputId}-title`} className="font-display text-base font-semibold text-paper">
          Describe the ad
        </h3>
        <p className="mt-1 text-[0.9rem] text-dim">One line is enough. It sets the stage, the offer text, the channels and the colours.</p>
      </div>

      <form onSubmit={run} className="grid gap-3" aria-busy={reading}>
        <div
          className={cn(
            "group relative flex items-center gap-2 overflow-hidden rounded-2xl bg-stage-2 py-1.5 pr-1.5 pl-4 ring-1 ring-line transition-[box-shadow] duration-300 ring-inset focus-within:ring-marigold",
            reading && "ring-marigold/60",
            disabled && "opacity-50",
          )}
        >
          <WandSparkles aria-hidden className={cn("size-5 shrink-0 transition-colors", reading ? "text-marigold" : "text-faint group-focus-within:text-marigold")} />
          <label htmlFor={inputId} className="sr-only">
            Describe your ad
          </label>
          <input
            id={inputId}
            value={text}
            maxLength={MAX}
            disabled={disabled}
            onChange={(e) => {
              setText(e.target.value);
              setHint(null);
            }}
            placeholder={preset ? `Describe your ad… e.g. ${preset.label} sale, 20% off, for Instagram` : `Describe your ad… e.g. ${EXAMPLE}`}
            aria-describedby={hint ? hintId : undefined}
            aria-invalid={!!hint}
            autoComplete="off"
            enterKeyHint="go"
            className="h-12 min-w-0 flex-1 bg-transparent text-base text-ellipsis text-paper focus:outline-none disabled:cursor-not-allowed"
          />
          <Button type="submit" disabled={disabled || reading} className="h-11 shrink-0 max-sm:w-11 max-sm:px-0">
            {reading ? <span aria-hidden className="size-[18px] animate-spin rounded-full border-2 border-marigold-ink/30 border-t-marigold-ink" /> : <ArrowUp className="sm:hidden" />}
            <span className="max-sm:sr-only">{reading ? "Reading…" : "Build kit"}</span>
          </Button>
          {/* the key light passing over the field while it reads */}
          {reading ? (
            <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
              <motion.span
                className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-marigold/15 to-transparent"
                initial={{ x: "-100%" }}
                animate={{ x: "300%" }}
                transition={{ duration: 1.6, ease: [0.25, 1, 0.5, 1], repeat: Infinity, repeatDelay: 0.2 }}
              />
            </span>
          ) : null}
        </div>
        {hint ? (
          <p id={hintId} className="text-sm text-sindoor">
            {hint}
          </p>
        ) : null}
        {text.length > MAX - 60 ? <p className="tabular -mt-1 text-right text-[0.78rem] text-faint">{MAX - text.length} characters left</p> : null}

        <div className="grid gap-2">
          <p id={`${inputId}-fest`} className="text-[0.82rem] font-medium text-dim">
            Festival preset
          </p>
          <div
            role="group"
            aria-labelledby={`${inputId}-fest`}
            className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [mask-image:linear-gradient(to_right,transparent,#000_1rem,#000_calc(100%-2rem),transparent)] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:[mask-image:none]"
          >
            {FESTIVALS.map((f) => {
              const on = festival === f.slug;
              return (
                <button
                  key={f.slug}
                  type="button"
                  aria-pressed={on}
                  disabled={disabled || reading}
                  onClick={() => pickFestival(f.slug)}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-2 rounded-full pr-3.5 pl-2 text-sm font-medium ring-1 transition-[background-color,box-shadow,color] duration-200 ring-inset disabled:opacity-50",
                    on ? "bg-stage-3 text-paper ring-marigold" : "bg-stage-2/60 text-dim ring-line hover:text-paper hover:ring-line-strong",
                  )}
                >
                  <span aria-hidden className="flex -space-x-1">
                    {f.palette.slice(0, 3).map((hex) => (
                      <span key={hex} className="size-3.5 rounded-full ring-2 ring-stage-2" style={{ background: `#${hex}` }} />
                    ))}
                  </span>
                  {f.label}
                  {on ? <Check aria-hidden className="-mr-1 size-3.5 text-marigold" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </form>

      <AnimatePresence mode="wait" initial={false}>
        {phase.kind === "idle" ? null : phase.kind === "error" ? (
          <motion.div key="error" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: EXPO }}>
            <Notice
              tone={phase.busy ? "busy" : "error"}
              title={phase.busy ? "Still busy" : "That brief didn't go through"}
              onRetry={() => void run()}
            >
              {phase.busy ? "Cloudinary is busy for a moment. Try again in a minute." : phase.message}
            </Notice>
          </motion.div>
        ) : (
          <motion.div key="sheet" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease: EXPO }}>
            <KitSheet
              phase={phase}
              applied={isApplied}
              onApply={() => {
                if (!done) return;
                setApplied(done.res);
                onApply(done.res.kit, done.res);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

// ─── the parsed kit ───────────────────────────────────────────────────────────

const ROWS: { key: keyof BriefKit; label: string }[] = [
  { key: "offer", label: "Offer" },
  { key: "theme", label: "Stage" },
  { key: "channels", label: "Channels" },
  { key: "swatches", label: "Colours" },
  { key: "tone", label: "Tone" },
];

function KitSheet({ phase, applied, onApply }: { phase: Extract<Phase, { kind: "reading" } | { kind: "done" }>; applied: boolean; onApply: () => void }) {
  const reduce = useReducedMotion();
  const res = phase.kind === "done" ? phase.res : null;
  const busyIn = useCountdown(phase.kind === "reading" ? (phase.busyUntil ?? null) : null);
  const marks = React.useMemo(() => briefHighlights(phase.brief), [phase.brief]);
  const festivalName = res?.festival ? festivalBySlug(res.festival)?.label : undefined;
  const aiCount = res ? ROWS.filter((r) => res.sources[r.key] === "ai").length : 0;

  return (
    <div className="rounded-[22px] bg-stage p-4 shadow-[0_30px_60px_-30px_rgb(0_0_0/0.9)] ring-1 ring-line sm:p-6">
      <p className="font-display text-[1.05rem] leading-snug font-medium text-pretty text-paper sm:text-lg">
        <span aria-hidden className="text-faint">“</span>
        {res ? <Marked text={phase.brief} marks={marks} animate={!reduce} /> : <span className="animate-shimmer bg-[linear-gradient(100deg,var(--color-dim)_35%,var(--color-marigold-hi)_50%,var(--color-dim)_65%)] bg-[length:250%_100%] bg-clip-text text-transparent">{phase.brief}</span>}
        <span aria-hidden className="text-faint">”</span>
      </p>

      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-[0.82rem] text-dim">
        {phase.kind === "reading" ? (
          busyIn ? (
            <span className="tabular">Cloudinary is busy for a moment. Trying again in {busyIn} s</span>
          ) : (
            <>
              <span className="sr-only">Reading your brief</span>
              <Narration lines={["Reading your words", "Looking at your product photo", "Choosing a stage and colours", "Writing the offer lines"]} every={1300} />
            </>
          )
        ) : res ? (
          <span>
            {res.cached ? "Answered from cache, 0 AI tokens" : `Built in ${(phase.ms / 1000).toFixed(1)} s with ${res.tokens.toLocaleString("en-IN")} AI Vision tokens`}
            {aiCount ? `. AI Vision chose ${aiCount === 1 ? "one setting" : `${aiCount} settings`}.` : "."}
          </span>
        ) : null}
      </p>

      <dl className="mt-4 grid gap-x-5 border-t border-line sm:grid-cols-[6.5rem_minmax(0,1fr)]">
        {ROWS.map((row, i) => (
          <div key={row.key} className="grid gap-1.5 border-b border-line py-3.5 last:border-b-0 sm:col-span-2 sm:grid-cols-subgrid sm:items-start sm:gap-0">
            <dt className="flex items-center justify-between gap-2 text-[0.82rem] font-medium text-dim sm:pt-1">
              {row.label}
              {res ? <SourceTag source={res.sources[row.key]} festival={festivalName} className="sm:hidden" /> : null}
            </dt>
            <dd className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2">
              {res ? (
                <motion.div
                  className="min-w-0 flex-1"
                  initial={reduce ? false : { opacity: 0, filter: "blur(10px)", y: 6 }}
                  animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                  transition={{ duration: 0.7, delay: 0.25 + i * 0.11, ease: EXPO }}
                >
                  <FieldValue field={row.key} kit={res.kit} delay={0.25 + i * 0.11} reduce={!!reduce} />
                </motion.div>
              ) : (
                <span aria-hidden className={cn("skeleton block h-5 rounded-md", ["w-3/4", "w-1/3", "w-2/3", "w-28", "w-20"][i])} />
              )}
              {res ? <SourceTag source={res.sources[row.key]} festival={festivalName} className="max-sm:hidden sm:mt-1" /> : null}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button onClick={onApply} disabled={!res || applied} className="max-sm:w-full">
          <Check />
          {applied ? "Settings applied" : "Use these settings"}
        </Button>
        {res?.scenePrompt ? <p className="text-[0.8rem] text-faint">Also suggests a backdrop you can generate in the scene step.</p> : null}
      </div>
    </div>
  );
}

function FieldValue({ field, kit, delay, reduce }: { field: keyof BriefKit; kit: BriefKit; delay: number; reduce: boolean }) {
  switch (field) {
    case "offer":
      return kit.offer.hindi || kit.offer.english ? (
        <div className="grid gap-0.5">
          {kit.offer.hindi ? (
            <p lang="hi" className="text-[1.4rem] leading-tight font-bold text-paper sm:text-[1.6rem]" style={{ fontFamily: "var(--font-bricolage), var(--font-deva), sans-serif" }}>
              {kit.offer.hindi}
            </p>
          ) : null}
          {kit.offer.english ? <p className={cn("font-display leading-tight font-semibold text-paper", kit.offer.hindi ? "text-base text-dim" : "text-[1.4rem] sm:text-[1.6rem]")}>{kit.offer.english}</p> : null}
        </div>
      ) : (
        <p className="text-[0.95rem] text-dim">No offer line. The kit goes out without price text.</p>
      );
    case "theme":
      return <p className="text-[0.95rem] font-semibold text-paper">{kit.theme ? themeLabel(kit.theme) : "Best fit for the product"}</p>;
    case "channels":
      return kit.channels.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {kit.channels.map((c, i) => (
            <motion.li
              key={c}
              initial={reduce ? false : { opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 420, damping: 24, delay: delay + 0.1 + i * 0.07 }}
            >
              <ChannelChip channel={c} />
            </motion.li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.95rem] text-dim">Every format</p>
      );
    case "swatches":
      return kit.swatches.length ? (
        <ul className="flex flex-wrap gap-2" aria-label="Colours">
          {kit.swatches.map((hex, i) => (
            <motion.li
              key={hex}
              title={`#${hex}`}
              initial={reduce ? false : { scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 20, delay: delay + 0.12 + i * 0.06 }}
              className="size-7 rounded-full shadow-[0_4px_10px_-2px_rgb(0_0_0/0.6)] ring-2 ring-paper/15 ring-inset"
              style={{ background: `#${hex}` }}
            >
              <span className="sr-only">Colour #{hex}</span>
            </motion.li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.95rem] text-dim">The product&apos;s own colours</p>
      );
    case "tone":
      return <p className="text-[0.95rem] font-semibold text-paper capitalize">{kit.tone}</p>;
  }
}

/** A channel with a tiny frame drawn at its real aspect ratio. */
function ChannelChip({ channel }: { channel: ChannelFormat }) {
  const m = channelMeta(channel);
  const [w, h] = m.ratio;
  const scale = 14 / Math.max(w, h);
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-full bg-stage-2 pr-3 pl-2.5 text-[0.85rem] font-medium text-paper ring-1 ring-line-strong ring-inset">
      <span aria-hidden className="grid size-4 place-items-center">
        <span className="rounded-[2px] border-[1.5px] border-marigold" style={{ width: Math.max(6, w * scale), height: Math.max(6, h * scale) }} />
      </span>
      {m.label}
      <span className="tabular text-[0.75rem] text-faint">
        {w}:{h}
      </span>
    </span>
  );
}

function SourceTag({ source, festival, className }: { source: BriefSource; festival?: string; className?: string }) {
  if (source === "ai") return <AiBadge className={className} />;
  const label = source === "brief" ? "Your words" : source === "festival" ? `${festival ?? "Festival"} preset` : source === "product" ? "From the product" : "Default";
  return <span className={cn("shrink-0 text-[0.75rem] leading-5 whitespace-nowrap text-faint", className)}>{label}</span>;
}

// ─── the words that were read ─────────────────────────────────────────────────

const HIGHLIGHTS: RegExp[] = [
  new RegExp(FESTIVALS.flatMap((f) => f.keywords).sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi"),
  /\d{1,2}\s*(?:%|percent\b|per\s*cent\b)(?:\s*off\b)?|(?:₹|\brs\.?\s?|\binr\s?)\d{1,6}(?:\s*off\b)?|\bbuy\s*(?:1|one)\s*get\s*(?:1|one)\b|\bbogo\b|\bfree\s+(?:delivery|shipping)\b/gi,
  /\bhindi\b|हिंदी|हिन्दी|\benglish\b/gi,
  /\bwhats\s?app\b|\binsta(?:gram)?\b|\breels?\b|\bstor(?:y|ies)\b|\bfacebook\b|\bamazon\b|\bflipkart\b|\bmeesho\b|\bmyntra\b|\bmarketplaces?\b|\bwebsite\b|\bbanners?\b|\bshopify\b|\ball channels\b|\beverywhere\b/gi,
  /\b(?:premium|luxury|luxurious|elegant|minimal|minimalist|clean|simple|warm|cozy|cosy|bold|festive|playful|fun|rustic|marble|pastel|kitchen|outdoor)\b/gi,
];

/** Character ranges in the brief that the rules read (festival, discount, language, channels, tone). */
export function briefHighlights(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const re of HIGHLIGHTS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      const prev = text[at - 1];
      if (prev && /[a-z0-9]/i.test(prev) && /^[a-z]/i.test(m[0])) continue; // inside a word
      ranges.push([at, at + m[0].length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** The brief with the words that were read marked by a highlighter stroke, left to right. */
function Marked({ text, marks, animate }: { text: string; marks: [number, number][]; animate: boolean }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  marks.forEach(([s, e], i) => {
    if (s > at) parts.push(text.slice(at, s));
    parts.push(
      <motion.mark
        key={s}
        initial={animate ? { backgroundSize: "0% 100%" } : false}
        animate={{ backgroundSize: "100% 100%" }}
        transition={{ duration: 0.5, delay: 0.05 + i * 0.12, ease: EXPO }}
        className="rounded-[3px] bg-transparent bg-[linear-gradient(transparent_58%,rgb(245_165_36/0.42)_58%,rgb(245_165_36/0.42)_92%,transparent_92%)] bg-no-repeat text-paper [box-decoration-break:clone]"
      >
        {text.slice(s, e)}
      </motion.mark>,
    );
    at = e;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}
