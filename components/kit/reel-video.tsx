"use client";

import { Pause, Play } from "lucide-react";
import * as React from "react";
import { cn, sleep } from "@/lib/client/util";

type Phase = "idle" | "rendering" | "ready" | "failed";

/**
 * The Kit Reel. Until it plays, it is only its poster: a lazy image (a video's
 * poster attribute downloads eagerly, even far below the fold) and a video
 * element with no source (preload="none"). Once it is on screen (and `ready`)
 * it makes sure Cloudinary has finished rendering the reel (a fresh reel takes
 * a few seconds the first time), then plays it muted and looped. Reduced-motion
 * users get the poster and a play button.
 */
export function ReelVideo({ src, poster, label, ready = true, className }: { src: string; poster: string; label: string; ready?: boolean; className?: string }) {
  const ref = React.useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [framed, setFramed] = React.useState(false); // the video has a frame to show: the poster image can go
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [waited, setWaited] = React.useState(0);
  const wantPlay = React.useRef(false);

  // Is the video derived yet? HEAD it until Cloudinary answers 200 (423/5xx while it renders).
  const ensure = React.useCallback(
    async (signal: AbortSignal) => {
      setPhase((p) => (p === "ready" ? p : "rendering"));
      const t0 = Date.now();
      for (let i = 0; i < 40; i++) {
        try {
          const res = await fetch(src, { method: "HEAD", signal });
          if (res.ok) {
            setPhase("ready");
            return true;
          }
          if (res.status < 420 || res.status === 404) break;
        } catch (e) {
          if (signal.aborted) return false;
          void e;
        }
        await sleep(3000, signal).catch(() => undefined);
        if (signal.aborted) return false;
        setWaited(Math.round((Date.now() - t0) / 1000));
      }
      setPhase("failed");
      return false;
    },
    [src],
  );

  const [seen, setSeen] = React.useState(src);
  if (seen !== src) {
    setSeen(src);
    setPhase("idle");
    setWaited(0);
    setFramed(false);
  }

  React.useEffect(() => {
    const v = ref.current;
    if (!v || !ready) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ac = new AbortController();
    let started = false;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          if (!started) {
            started = true;
            void ensure(ac.signal).then((ok) => {
              if (ok && (!reduced || wantPlay.current)) {
                v.src = src;
                v.play().catch(() => {});
              }
            });
          } else if (v.src && !reduced) v.play().catch(() => {});
        } else v.pause();
      },
      { threshold: 0.35 },
    );
    io.observe(v);
    return () => {
      io.disconnect();
      ac.abort();
    };
  }, [ready, src, ensure]);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (phase !== "ready") {
      wantPlay.current = true;
      return;
    }
    if (!v.src) v.src = src;
    if (v.paused) v.play().catch(() => setPhase("failed"));
    else v.pause();
  };

  return (
    <div className={cn("group relative size-full bg-stage-2", className)}>
      <video
        ref={ref}
        muted
        loop
        playsInline
        preload="none"
        aria-label={label}
        onPlay={() => setPlaying(true)}
        onPlaying={() => setFramed(true)}
        onPause={() => setPlaying(false)}
        onError={() => ref.current?.getAttribute("src") && setPhase("failed")}
        className="size-full object-cover"
      />
      {framed ? null : (
        // eslint-disable-next-line @next/next/no-img-element -- a Cloudinary poster frame (fixed width), lazy like every other card image
        <img src={poster} alt="" aria-hidden loading="lazy" decoding="async" className="pointer-events-none absolute inset-0 size-full object-cover" />
      )}
      {phase === "rendering" ? (
        <p role="status" className="absolute inset-x-3 bottom-16 flex items-center justify-center gap-2 rounded-lg bg-black/70 px-2 py-1.5 text-center text-[0.75rem] font-semibold text-white backdrop-blur-sm">
          <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-marigold" />
          Cloudinary is rendering the reel{waited ? ` (${waited} s)` : "…"}
        </p>
      ) : phase === "failed" ? (
        <p role="status" className="absolute inset-x-3 bottom-16 rounded-lg bg-black/70 p-2 text-center text-[0.75rem] text-white">
          The reel is taking longer than usual. Tap play to try again.
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => {
          if (phase === "failed") {
            const ac = new AbortController();
            wantPlay.current = true;
            void ensure(ac.signal).then((ok) => ok && toggle());
            return;
          }
          toggle();
        }}
        aria-label={playing ? "Pause the reel" : "Play the reel"}
        className={cn(
          "absolute top-1/2 left-1/2 z-10 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-opacity",
          playing ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100" : "opacity-100",
        )}
      >
        {playing ? <Pause className="size-5" aria-hidden /> : <Play className="size-5 translate-x-px" aria-hidden />}
      </button>
    </div>
  );
}
