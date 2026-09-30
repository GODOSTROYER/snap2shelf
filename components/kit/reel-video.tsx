"use client";

import { Pause, Play } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/client/util";

/**
 * The Kit Reel. Plays muted and looped once it is on screen (and `ready`),
 * never downloads before that, and stays paused for reduced-motion users
 * until they press play.
 */
export function ReelVideo({ src, poster, label, ready = true, className }: { src: string; poster: string; label: string; ready?: boolean; className?: string }) {
  const ref = React.useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    const v = ref.current;
    if (!v || !ready) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) v.play().catch(() => {});
        else v.pause();
      },
      { threshold: 0.35 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, [ready]);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => setFailed(true));
    else v.pause();
  };

  return (
    <div className={cn("group relative size-full bg-stage-2", className)}>
      <video
        ref={ref}
        src={src}
        poster={poster}
        muted
        loop
        playsInline
        preload="none"
        aria-label={label}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setFailed(true)}
        className="size-full object-cover"
      />
      {failed ? (
        <p className="absolute inset-x-3 bottom-16 rounded-lg bg-black/70 p-2 text-center text-[0.72rem] text-white">
          The reel is still rendering. Try again in a moment.
        </p>
      ) : null}
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause the reel" : "Play the reel"}
        className={cn(
          "absolute top-1/2 left-1/2 z-10 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-opacity",
          playing ? "opacity-0 group-hover:opacity-100 focus-visible:opacity-100" : "opacity-100",
        )}
      >
        {playing ? <Pause className="size-5" /> : <Play className="size-5 translate-x-px" />}
      </button>
    </div>
  );
}
