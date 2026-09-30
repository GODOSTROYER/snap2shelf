"use client";

// clsx rather than util's cn: nothing here conflicts, and tailwind-merge would ride into the landing's JS
import { clsx as cn } from "clsx";
import { Pause, Play } from "lucide-react";
import * as React from "react";
import { HANDOFF, LEAD, stillAt, type ReelCover } from "@/lib/client/reel-cover";
import { sleep } from "@/lib/client/sleep";

type Phase = "idle" | "rendering" | "ready" | "failed";

/**
 * The Kit Reel. Until it plays, it is only its poster: a lazy image (a video's
 * poster attribute downloads eagerly, even far below the fold) and a video
 * element with no source (preload="none"). Once it is on screen (and `ready`)
 * it makes sure Cloudinary has finished rendering the reel (a fresh reel takes
 * a few seconds the first time), then plays it muted and looped. Reduced-motion
 * users get the poster and a play button.
 *
 * The poster is the first still of a cover (lib/client/reel-cover.ts) that
 * keeps the card lit: it holds until the first real frame plays, and while
 * each later clip fades up from black that clip's own still covers the video,
 * then hands over. The offer card baked into the video shows through a hole.
 */
export function ReelVideo({ src, poster, label, ready = true, cover, className }: { src: string; poster: string; label: string; ready?: boolean; cover?: ReelCover; className?: string }) {
  const ref = React.useRef<HTMLVideoElement>(null);
  const coverRef = React.useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [live, setLive] = React.useState(false); // the video has its source: the other clips' stills can load
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
    setLive(false);
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
                setLive(true);
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

  // Keep the card lit (lib/client/reel-cover.ts). The frame loop runs only while the video plays.
  const fade = cover?.fade ?? 0;
  const mask = cover?.mask ?? null;
  const startsKey = cover?.starts.join(",") ?? "0";
  React.useEffect(() => {
    const v = ref.current;
    const c = coverRef.current;
    if (!v || !c) return;
    const starts = startsKey.split(",").map(Number);
    const firstCut = starts.length > 1 ? starts[1] - LEAD : Infinity;
    const stills = Array.from(c.children) as HTMLElement[];
    let raf = 0;
    let shown = 0;
    let playingAt = 0;
    const setMask = (m: string | null) => {
      for (const k of ["mask-image", "-webkit-mask-image"]) {
        if (m) c.style.setProperty(k, m);
        else c.style.removeProperty(k);
      }
      for (const k of ["mask-size", "-webkit-mask-size"]) {
        if (m) c.style.setProperty(k, "100% 100%");
        else c.style.removeProperty(k);
      }
    };
    const show = (i: number, o: number) => {
      if (i !== shown) {
        stills.forEach((el, k) => (el.style.opacity = k === i ? "1" : "0"));
        shown = i;
      }
      c.style.opacity = Math.max(0, Math.min(1, o)).toFixed(3);
    };
    const tick = (now: number) => {
      raf = v.paused ? 0 : requestAnimationFrame(tick);
      const time = v.currentTime;
      if (!playingAt) {
        if (v.paused || v.readyState < 3 || time <= 0.04) return show(0, 1); // the poster until a real frame plays
        playingAt = now;
        setMask(mask); // from here on the video's own offer card shows through
      }
      const intro = 1 - (now - playingAt) / (HANDOFF * 1000);
      const still = stillAt(time, starts, fade);
      if (v.seeking && time < firstCut) show(0, 1); // the loop jumping back to the start: clip 1's still is that frame
      else if (intro > 0 && time < firstCut) show(0, intro);
      else if (still) show(still.clip, still.opacity);
      else show(shown, 0);
    };
    const run = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    show(0, 1);
    setMask(null);
    const events = ["play", "playing", "seeking", "pause"] as const;
    events.forEach((e) => v.addEventListener(e, run));
    run();
    return () => {
      cancelAnimationFrame(raf);
      events.forEach((e) => v.removeEventListener(e, run));
    };
  }, [src, startsKey, fade, mask]);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (phase !== "ready") {
      wantPlay.current = true;
      return;
    }
    if (!v.src) {
      setLive(true);
      v.src = src;
    }
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
        onPause={() => setPlaying(false)}
        onError={() => ref.current?.getAttribute("src") && setPhase("failed")}
        className="size-full object-cover"
      />
      <div ref={coverRef} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {(cover?.stills ?? [{ url: poster, transform: undefined }]).map((still, i) => (
          <div key={i} className="absolute inset-0 overflow-hidden" style={{ opacity: i === 0 ? 1 : 0 }}>
            {i === 0 || live ? (
              // eslint-disable-next-line @next/next/no-img-element -- Cloudinary stills at fixed widths, lazy like every other card image
              <img
                src={i === 0 ? poster : still.url}
                alt=""
                loading="lazy"
                decoding="async"
                className="absolute inset-0 size-full object-cover"
                style={still.transform ? { transformOrigin: "0 0", transform: still.transform } : undefined}
              />
            ) : null}
          </div>
        ))}
      </div>
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
