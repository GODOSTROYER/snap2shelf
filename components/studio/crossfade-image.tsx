"use client";

/* eslint-disable @next/next/no-img-element -- Cloudinary delivery URLs, already sized and formatted */
import * as React from "react";
import { cn } from "@/lib/client/util";

export type Enter = "focus" | "wipe" | "soft" | "settle";

/** loading → decoded ("ready") → revealed ("shown"); a frame that failed is skipped. */
type Phase = "loading" | "ready" | "shown" | "failed";

interface Layer {
  id: number;
  src: string;
  phase: Phase;
  enter: Enter;
  shift: number; // settle: how far (fraction of the height) the new frame travels down into place
  born: number; // when it was asked for
  since: number; // when its reveal started
}

// How a new image arrives: a clean cross-fade, the scanner's wipe (the cut-out, on its own
// transparency checker), a quick soft swap for slider tweaks, or (QA's auto-fix) the new frame
// settling down by exactly the correction it made. Opacity, clip and translate only: never a
// blur, so a frame is always either the old picture or the new one, sharp.
const ENTER: Record<Enter, { base: string; before: string; after: string; ms: number }> = {
  settle: {
    base: "transition-[opacity,translate] duration-[900ms] ease-(--ease-out-expo)",
    before: "opacity-0 translate-y-(--settle-from) motion-reduce:translate-y-0",
    after: "opacity-100 translate-y-0",
    ms: 900,
  },
  focus: {
    base: "transition-opacity duration-[450ms] ease-(--ease-out-quart)",
    before: "opacity-0",
    after: "opacity-100",
    ms: 450,
  },
  wipe: {
    base: "checker transition-[clip-path] duration-[900ms] ease-(--ease-out-expo)",
    before: "opacity-0 [clip-path:inset(0_0_100%_0)]",
    after: "opacity-100 [clip-path:inset(0_0_0_0)]",
    ms: 900,
  },
  soft: {
    base: "transition-opacity duration-[260ms] ease-(--ease-out-quart)",
    before: "opacity-0",
    after: "opacity-100",
    ms: 260,
  },
};

/** The cut-out is a moment of its own: it stays on screen this long after its wipe before the next frame may cover it. */
const HOLD: Partial<Record<Enter, number>> = { wipe: 700 };
/** A held frame that still hasn't arrived this long after a newer one is ready is skipped. */
const HOLD_GIVE_UP_MS = 4000;

const now = () => performance.now();

/**
 * Keeps showing the previous image until the next one has downloaded AND
 * decoded, then cross-fades: the stage is never blank, white or half-painted.
 * A "wipe" frame (the cut-out) is never skipped for a newer one and holds for
 * a beat once revealed. `onBusy` reports whether a newer image is still on its way.
 */
export function CrossfadeImage({
  src,
  alt,
  className,
  imgClassName,
  placeholder,
  onBusy,
  onLoading,
  onError,
  width,
  height,
  enter = "focus",
  shift = 0,
  priority,
  srcSet,
  sizes,
}: {
  src: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  placeholder?: string;
  onBusy?: (busy: boolean) => void;
  /** Whether the newest image is still downloading (busy also covers a decoded frame waiting for its turn). */
  onLoading?: (loading: boolean) => void;
  onError?: () => void;
  width: number;
  height: number;
  enter?: Enter;
  /** settle: fraction of the height the new frame travels (the recorded correction). */
  shift?: number;
  /** The first frame is the page's largest image: fetch it first. */
  priority?: boolean;
  /** Responsive sources for the FIRST frame only (a stored asset at the site's fixed widths). */
  srcSet?: string;
  sizes?: string;
}) {
  // a priority first frame is server-rendered and simply paints as it arrives (it is the LCP image)
  const [layers, setLayers] = React.useState<Layer[]>(() => [{ id: 0, src, phase: priority ? "shown" : "loading", enter, shift, born: 0, since: 0 }]);
  const [first] = React.useState(src); // the frame the page opened with (its srcset and priority apply)
  const [seen, setSeen] = React.useState({ src, n: 0 }); // n: every frame asked for gets its own id
  if (src !== seen.src) {
    const id = seen.n + 1;
    setSeen({ src, n: id });
    setLayers((ls) => {
      const base = ls.filter((l) => l.phase === "shown").slice(-1);
      // a cut-out still on its way is shown before anything newer; any other unrevealed frame is simply replaced
      const held = ls.filter((l) => (l.phase === "loading" || l.phase === "ready") && HOLD[l.enter]);
      return [...base, ...held, { id, src, phase: "loading", enter, shift, born: now(), since: 0 }];
    });
  }

  const top = layers[layers.length - 1];
  const busy = top.phase === "loading" || top.phase === "ready";
  const loading = top.phase === "loading";
  React.useEffect(() => {
    onBusy?.(busy);
  }, [busy, onBusy]);
  React.useEffect(() => {
    onLoading?.(loading);
  }, [loading, onLoading]);

  const setPhase = React.useCallback((id: number, phase: Phase) => {
    setLayers((ls) => (ls.some((l) => l.id === id && l.phase !== phase) ? ls.map((l) => (l.id === id ? { ...l, phase, since: phase === "shown" ? now() : l.since } : l)) : ls));
  }, []);

  // downloaded is not enough: decode first, so the reveal never paints a half-drawn or empty frame
  const decoding = React.useRef(new Set<number>());
  const arrived = (id: number, el: HTMLImageElement) => {
    if (decoding.current.has(id)) return;
    decoding.current.add(id);
    el.decode()
      .catch(() => undefined) // decode() can reject for a frame that is fine to paint (e.g. detached): reveal anyway
      .then(() => setPhase(id, el.naturalWidth > 0 ? "ready" : "failed"));
  };
  const failed = (id: number) => {
    setPhase(id, "failed");
    onError?.();
  };

  // reveal in order: the first unrevealed frame, once decoded and once a held frame below it has had its beat
  React.useEffect(() => {
    const i = layers.findIndex((l) => l.phase === "loading" || l.phase === "ready");
    if (i < 0) return;
    const l = layers[i];
    const below = layers.slice(0, i).filter((x) => x.phase === "shown").pop();
    if (l.phase === "loading") {
      // a held frame that never arrives must not block a newer one forever
      if (!HOLD[l.enter] || !layers.slice(i + 1).some((x) => x.phase === "ready")) return;
      const t = setTimeout(() => setPhase(l.id, "failed"), Math.max(0, l.born + HOLD_GIVE_UP_MS - now()));
      return () => clearTimeout(t);
    }
    const hold = below && HOLD[below.enter] ? below.since + ENTER[below.enter].ms + HOLD[below.enter]! - now() : 0;
    let raf = 0;
    const t = setTimeout(() => {
      // two frames: the frame is painted in its "before" state first, so its entrance always plays
      raf = requestAnimationFrame(() => (raf = requestAnimationFrame(() => setPhase(l.id, "shown"))));
    }, Math.max(0, hold));
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
    };
  }, [layers, setPhase]);

  // once the newest revealed frame has finished arriving, the frames under it go (and failed ones at once)
  const lastShown = [...layers].reverse().find((l) => l.phase === "shown");
  React.useEffect(() => {
    if (!lastShown) return;
    const under = layers.some((l) => l.id !== lastShown.id && (l.phase === "failed" || layers.indexOf(l) < layers.indexOf(lastShown)));
    if (!under) return;
    const t = setTimeout(() => setLayers((ls) => ls.filter((l, j) => l.id === lastShown.id || (l.phase !== "failed" && j > ls.findIndex((x) => x.id === lastShown.id)))), Math.max(0, lastShown.since + ENTER[lastShown.enter].ms + 60 - now()));
    return () => clearTimeout(t);
  }, [layers, lastShown]);

  return (
    <div className={cn("relative overflow-hidden", className)} style={placeholder ? { backgroundImage: `url("${placeholder}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
      {layers.map((l) => {
        if (l.phase === "failed") return null;
        const lead = l.src === first;
        const current = l.id === top.id;
        return (
          <img
            key={l.id}
            src={l.src}
            srcSet={lead ? srcSet : undefined}
            sizes={lead && srcSet ? sizes : undefined}
            alt={current ? alt : ""}
            aria-hidden={current ? undefined : true}
            width={width}
            height={height}
            decoding="async"
            fetchPriority={lead && priority ? "high" : undefined}
            ref={(el) => {
              // loaded before hydration attached onLoad (cache, server-rendered): take it from here
              if (el && l.phase === "loading" && el.complete && el.naturalWidth > 0) arrived(l.id, el);
            }}
            onLoad={(e) => l.phase === "loading" && arrived(l.id, e.currentTarget)}
            onError={() => failed(l.id)}
            style={l.enter === "settle" ? ({ "--settle-from": `${-l.shift * 100}%` } as React.CSSProperties) : undefined}
            className={cn("absolute inset-0 size-full", ENTER[l.enter].base, l.phase === "shown" ? ENTER[l.enter].after : ENTER[l.enter].before, imgClassName)}
          />
        );
      })}
    </div>
  );
}
