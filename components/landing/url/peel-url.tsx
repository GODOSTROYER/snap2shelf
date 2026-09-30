"use client";

import { ArrowUpRight, RotateCcw } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/client/util";
import { XRAY_KINDS } from "@/lib/transform/xray";
import type { BuiltUrl } from "@/lib/types";
import { isOff, offKey, offNote, onNote, PEEL_HEIGHT, PEEL_WIDTH, peelModel, peelUrl, type Kind, type PeelModel } from "./peel";

/** The global X-ray colour of a group (app/globals.css), by name. */
const tok = (k: Kind) => `var(${XRAY_KINDS[k].token})`;
const kindStyle = (k: Kind) => ({ "--k": tok(k) }) as React.CSSProperties;

const NONE: ReadonlySet<Kind> = new Set();
/** Quick double taps settle before anything is requested: no derived image for a state nobody looked at. */
const SETTLE_MS = 180;

/** Load and decode an image off-screen, so it can replace the shown one without a blank frame. */
function decoded(src: string, ms = 45_000) {
  return new Promise<void>((resolve, reject) => {
    const img = new Image();
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    img.decoding = "async";
    img.crossOrigin = "anonymous"; // CORS mode (Cloudinary sends ACAO: *) exposes the delivered content type
    img.onload = () => {
      clearTimeout(t);
      img.decode().then(resolve, resolve);
    };
    img.onerror = () => {
      clearTimeout(t);
      reject(new Error("render failed"));
    };
    img.src = src;
  });
}

interface Delivered {
  format?: string;
  bytes?: number;
}

/**
 * What Cloudinary actually delivered, from the resource timing entry: the
 * response's content type (CORS-mode images only) and the byte count from
 * Cloudinary's Server-Timing content-info (readable: Timing-Allow-Origin is *).
 */
function delivered(e: PerformanceResourceTiming): Delivered | null {
  const info = e.serverTiming?.find((s) => s.name === "content-info")?.description ?? "";
  const type = (e as PerformanceResourceTiming & { contentType?: string }).contentType ?? "";
  const format = /^image\/([a-z0-9.-]+)/i.exec(type)?.[1] ?? /(?:^|,)format="?([a-z0-9]+)/i.exec(info)?.[1];
  const bytes = Number(/(?:^|,)bytes=(\d+)/.exec(info)?.[1]) || e.encodedBodySize || undefined;
  return format || bytes ? { format: format?.toUpperCase(), bytes } : null;
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const count = (n: number) => n.toLocaleString("en-US");

function listOf(names: string[]) {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

type Said = { kind: Kind; on: boolean } | { reset: true } | { error: true };

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeReduce(cb: () => void) {
  const mq = window.matchMedia(REDUCE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const readReduce = () => window.matchMedia(REDUCE_QUERY).matches;

/**
 * The landing's URL section: the hero's one delivery URL, colour-coded, with
 * the picture it renders beside it. Each colour is a toggle that peels its
 * group out of the URL; the picture re-renders from what is left, and only
 * once it has decoded does it cross-fade over the previous one.
 */
export function PeelUrl({ built, note, alt }: { built: BuiltUrl; note?: React.ReactNode; alt?: string }) {
  const model = React.useMemo(() => peelModel(built), [built]);
  const fullUrl = React.useMemo(() => peelUrl(model), [model]);
  // CSS transitions only: this section is on the landing, so it must not pull the motion library onto the critical path.
  const reduce = React.useSyncExternalStore(subscribeReduce, readReduce, () => false);
  const uid = React.useId();

  const [off, setOff] = React.useState<ReadonlySet<Kind>>(NONE); // what the code shows
  const [shown, setShown] = React.useState<ReadonlySet<Kind>>(NONE); // what the picture shows
  const shownRef = React.useRef(shown);
  const [frames, setFrames] = React.useState([{ id: 0, src: fullUrl }]);
  const [said, setSaid] = React.useState<Said | null>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [info, setInfo] = React.useState<ReadonlyMap<string, Delivered>>(() => new Map());
  const req = React.useRef(0);
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined);

  React.useEffect(() => () => clearTimeout(timer.current), []);

  // Format and size of each rendered variant, as Cloudinary reports them.
  React.useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    const mine = (name: string) => name.startsWith(model.prefix) && name.endsWith(`/${model.tail}`);
    const po = new PerformanceObserver((list) => {
      const found = list.getEntries().flatMap((e) => {
        const d = mine(e.name) ? delivered(e as PerformanceResourceTiming) : null;
        return d ? [[e.name, d] as const] : [];
      });
      if (found.length) setInfo((m) => new Map([...m, ...found]));
    });
    try {
      po.observe({ type: "resource", buffered: true });
    } catch {
      return;
    }
    return () => po.disconnect();
  }, [model]);

  const peelable = model.groups.filter((g) => g.peelable);
  const fixed = model.groups.filter((g) => !g.peelable);
  const pending = offKey(off) !== offKey(shown);
  const current = peelUrl(model, off);
  const top = frames[frames.length - 1];
  const topInfo = info.get(top.src);

  function apply(next: ReadonlySet<Kind>, say: Said) {
    setOff(next);
    const id = ++req.current;
    const src = peelUrl(model, next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      decoded(src).then(
        () => {
          if (id !== req.current) return; // a newer toggle owns the picture
          // Reduced motion: no cross-fade, so nothing will fire animationend to retire the old frame.
          setFrames((f) => (f[f.length - 1].src === src ? f : reduce ? [{ id, src }] : [...f.slice(-1), { id, src }]));
          shownRef.current = next;
          setShown(next);
          setSaid(say);
        },
        () => {
          if (id !== req.current) return;
          setOff(shownRef.current); // keep the code and the picture in step
          setSaid({ error: true });
        },
      );
    }, SETTLE_MS);
  }

  function toggle(kind: Kind) {
    const next = new Set(off);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    apply(next, { kind, on: !next.has(kind) });
  }

  // With format peeled: how much heavier is the source format than f_auto,q_auto's pick?
  const heavier = React.useMemo(() => {
    if (!shown.has("format")) return null;
    const a = info.get(top.src);
    const b = info.get(peelUrl(model, [...shown].filter((k) => k !== "format")));
    return a?.bytes && b?.bytes && a.bytes > b.bytes ? { times: Math.round(a.bytes / b.bytes), format: a.format, auto: b.format } : null;
  }, [info, model, shown, top.src]);

  let caption = `What this URL renders, ${PEEL_WIDTH} px wide.`;
  if (said && "error" in said) caption = "Cloudinary couldn't render that version, so the picture is unchanged. Try again.";
  else if (said && "reset" in said) caption = "Everything back on: the finished stage.";
  else if (said && said.on) caption = onNote(said.kind);
  else if (said && peelable.every((g) => shown.has(g.kind))) caption = `All peeled: only the source image is left, resized to ${PEEL_WIDTH} px.`;
  else if (said && said.kind === "format" && heavier)
    caption = `Format & quality off: the source ${heavier.format ? `${heavier.format} ` : ""}at full quality, ${heavier.times}× the bytes${heavier.auto ? ` of the ${heavier.auto}` : ""}.`;
  else if (said) caption = offNote(said.kind);

  const missing = peelable.filter((g) => shown.has(g.kind)).map((g) => g.legend.toLowerCase());
  const altText = `${alt ?? "The staged product this URL renders"}${missing.length ? `, with ${listOf(missing)} taken out of the URL` : ""}`;

  return (
    <div className="grid gap-x-12 gap-y-6 md:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:grid-cols-[minmax(0,min(26rem,calc((100svh-6rem)*0.8)))_minmax(0,1fr)] xl:gap-x-16">
      {/* The picture stays beside the long code and its walk-through on wide screens. */}
      <figure className="grid content-start gap-2.5 md:sticky md:top-6 md:self-start">
        <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-stage-2 ring-1 ring-line">
          {frames.map((f) => {
            const front = f.id === top.id;
            return (
              <img
                key={f.id}
                src={f.src}
                alt={front ? altText : ""}
                aria-hidden={front ? undefined : true}
                width={PEEL_WIDTH}
                height={PEEL_HEIGHT}
                loading={f.id === 0 ? "lazy" : "eager"}
                decoding={f.id === 0 ? "async" : "sync"}
                crossOrigin="anonymous"
                onAnimationEnd={() => {
                  if (front) setFrames((fs) => (fs.length > 1 && fs[fs.length - 1].id === f.id ? fs.slice(-1) : fs));
                }}
                style={f.id === 0 || reduce ? undefined : { animation: "fade-in 0.5s cubic-bezier(0.25, 1, 0.5, 1) both" }}
                className="absolute inset-0 size-full object-cover"
              />
            );
          })}
          {pending ? (
            <span
              aria-hidden
              style={reduce ? undefined : { animation: "fade-in 0.2s ease-out 0.15s both" }}
              className="absolute top-3 left-3 inline-flex items-center gap-2 rounded-full bg-studio/80 px-3 py-1.5 text-[0.75rem] leading-none font-semibold text-paper ring-1 ring-line-strong backdrop-blur-sm"
            >
              <span className="size-3 animate-spin rounded-full border-[1.5px] border-marigold border-t-transparent" />
              Rendering on Cloudinary
            </span>
          ) : null}
        </div>
        <figcaption className="flex items-start justify-between gap-4 text-[0.8rem] leading-snug">
          <span role="status" aria-live="polite" className={cn("min-h-[2lh] text-dim", said && "error" in said && "text-sindoor")}>
            {caption}
          </span>
          {topInfo ? (
            <span className="shrink-0 pt-px font-mono text-[0.72rem] text-faint tabular" title="As Cloudinary delivered it">
              {[topInfo.format, topInfo.bytes ? kb(topInfo.bytes) : null].filter(Boolean).join(" · ")}
            </span>
          ) : null}
        </figcaption>
      </figure>

      <div className="grid min-w-0 content-start gap-4">
        <div className="mb-2 grid gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <h3 id={`${uid}-peel`} className="font-display text-xl font-bold tracking-[-0.02em]">
              Peel the URL
            </h3>
            {off.size ? (
              <button
                type="button"
                onClick={() => apply(NONE, { reset: true })}
                className="inline-flex items-center gap-1.5 rounded-full py-1 text-[0.85rem] font-semibold text-dim transition-colors hover:text-paper"
              >
                <RotateCcw aria-hidden className="size-3.5" />
                Put it all back
              </button>
            ) : null}
          </div>
          <p id={`${uid}-how`} className="-mt-1.5 text-[0.9rem] leading-snug text-dim">
            Tap a colour to take that part out of the URL. Cloudinary renders what&apos;s left.
          </p>
          <div role="group" aria-labelledby={`${uid}-peel`} aria-describedby={`${uid}-how`} className="flex flex-wrap gap-2">
            {peelable.map((g) => {
              const on = !off.has(g.kind);
              return (
                <button
                  key={g.kind}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(g.kind)}
                  style={kindStyle(g.kind)}
                  className={cn(
                    "inline-flex h-10 items-center gap-2 rounded-full pr-3.5 pl-3 text-[0.85rem] font-semibold ring-1 transition-[background-color,color,box-shadow,scale] duration-200 ring-inset active:scale-[0.97]",
                    on
                      ? "bg-[color-mix(in_oklab,var(--k)_14%,transparent)] text-paper ring-[color-mix(in_oklab,var(--k)_50%,transparent)] hover:bg-[color-mix(in_oklab,var(--k)_22%,transparent)]"
                      : "text-faint ring-line-strong hover:text-dim",
                  )}
                >
                  <span aria-hidden className={cn("size-3 rounded-full border-2 border-[var(--k)] transition-colors duration-200", on ? "bg-[var(--k)]" : "bg-transparent")} />
                  <span className={cn(!on && "line-through decoration-[var(--k)] decoration-2")}>{g.legend}</span>
                </button>
              );
            })}
          </div>
          {fixed.length ? (
            <p className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[0.8rem] text-faint">
              <span>Always in the URL:</span>
              {fixed.map((g) => (
                <span key={g.kind} className="inline-flex items-center gap-1.5">
                  <span aria-hidden className="size-2.5 rounded-full" style={{ background: tok(g.kind) }} />
                  {g.legend}
                </span>
              ))}
            </p>
          ) : null}
        </div>

        <CodeWall model={model} off={off} expanded={expanded} id={`${uid}-code`} />
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={`${uid}-code`}
            onClick={() => {
              setExpanded(!expanded);
              // folding a long wall back up: bring its top back into view
              if (expanded) requestAnimationFrame(() => document.getElementById(`${uid}-code`)?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" }));
            }}
            className="-mx-1 rounded-md px-1 py-2 text-[0.85rem] font-semibold text-paper underline decoration-line-strong underline-offset-4 sm:hidden"
          >
            {expanded ? "Show less" : `Show all ${count(fullUrl.length)} characters`}
          </button>
          <p className="hidden text-[0.8rem] text-faint tabular sm:block">{count(fullUrl.length)} characters, one request, no render server.</p>
          <a
            href={current}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 rounded-md py-2 text-[0.9rem] font-semibold text-marigold transition-colors hover:text-marigold-hi"
          >
            {off.size ? "Open the peeled URL" : "Open this URL"}
            <ArrowUpRight aria-hidden className="size-4" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
        {note ? <p className="max-w-[40rem] text-[0.85rem] leading-relaxed text-dim">{note}</p> : null}
        <PeelSteps model={model} off={off} />
      </div>
    </div>
  );
}

/** The URL itself, every piece coloured by its group; peeled pieces stay in place, struck through. */
function CodeWall({ model, off, expanded, id }: { model: PeelModel; off: ReadonlySet<Kind>; expanded: boolean; id: string }) {
  return (
    <div className="rounded-2xl bg-studio p-5 ring-1 ring-line sm:p-7">
      <p
        id={id}
        className={cn(
          "font-mono text-[0.75rem] leading-[1.8] break-all sm:text-[0.85rem]",
          // phones: six lines, the last one fading out; the button below shows the rest
          !expanded && "max-sm:max-h-[10.8em] max-sm:overflow-hidden max-sm:[mask-image:linear-gradient(to_bottom,black_calc(100%-2.6em),transparent)]",
        )}
      >
        <span className="text-faint">{model.prefix}/</span>
        {model.segments.map((s, i) => {
          const gone = off.has(s.kind);
          return (
            <React.Fragment key={i}>
              {i > 0 ? <span className={cn("text-faint transition-opacity duration-300", gone && "opacity-40")}>/</span> : null}
              <span title={s.label}>
                {s.pieces.map((p, j) => (
                  <span key={j} style={{ color: tok(p.group) }} className={cn("transition-opacity duration-300", isOff(s, p, off) && "line-through decoration-1 opacity-35")}>
                    {p.text}
                  </span>
                ))}
              </span>
            </React.Fragment>
          );
        })}
      </p>
    </div>
  );
}

const same = (a: string, b: string) => a.trim().replace(/\.$/, "").toLowerCase() === b.trim().replace(/\.$/, "").toLowerCase();

/** The plain-language walk-through, left to right; peeled steps dim with their code. */
function PeelSteps({ model, off }: { model: PeelModel; off: ReadonlySet<Kind> }) {
  return (
    <ol className="mt-4 grid content-start gap-4" aria-label="The URL, step by step">
      {model.segments.map((s, i) => {
        const legend = XRAY_KINDS[s.kind].legend;
        const label = same(s.label, legend) ? null : s.label;
        const gone = off.has(s.kind);
        return (
          <li key={i} className={cn("grid grid-cols-[auto_1fr] gap-x-3 transition-opacity duration-300", gone && "opacity-40")}>
            <span
              aria-hidden
              className="mt-[0.45em] size-2.5 rounded-full border-2 transition-colors duration-300"
              style={{ borderColor: tok(s.kind), background: gone ? "transparent" : tok(s.kind) }}
            />
            <p className="min-w-0 text-[0.95rem] text-dim">
              <span className={cn("font-semibold", gone && "line-through")} style={{ color: tok(s.kind) }}>
                {legend}
                {label ? "." : null}
              </span>
              {label ? <span className="text-paper/90"> {label}</span> : null}
              {gone ? <span className="sr-only"> (taken out)</span> : null}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
