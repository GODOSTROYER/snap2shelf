"use client";

/* eslint-disable @next/next/no-img-element -- Cloudinary delivery URLs, already sized and formatted */
import * as React from "react";
import { cn } from "@/lib/client/util";

export type Enter = "focus" | "wipe" | "soft" | "settle";

interface Layer {
  src: string;
  loaded: boolean;
  failed: boolean;
  enter: Enter;
  shift: number; // settle: how far (fraction of the height) the new frame travels down into place
}

// How a new image arrives: a focus pull, the scanner's wipe, a quick soft swap for slider tweaks,
// or (QA's auto-fix) the new frame settling down by exactly the correction it made.
const ENTER: Record<Enter, { base: string; before: string; after: string }> = {
  settle: {
    base: "transition-[opacity,translate] duration-[900ms] ease-(--ease-out-expo) motion-reduce:transition-none",
    before: "opacity-0 translate-y-(--settle-from) motion-reduce:translate-y-0",
    after: "opacity-100 translate-y-0",
  },
  focus: {
    base: "transition-[opacity,filter,scale] duration-[1000ms] ease-(--ease-out-expo)",
    before: "opacity-0 blur-[18px] scale-[1.05]",
    after: "opacity-100 blur-0 scale-100",
  },
  wipe: {
    base: "transition-[clip-path] duration-[1100ms] ease-(--ease-out-expo)",
    before: "opacity-0 [clip-path:inset(0_0_100%_0)]",
    after: "opacity-100 [clip-path:inset(0_0_0_0)]",
  },
  soft: {
    base: "transition-[opacity,filter] duration-300 ease-(--ease-out-quart)",
    before: "opacity-0 blur-[6px]",
    after: "opacity-100 blur-0",
  },
};

/**
 * Keeps showing the previous image until the next one has rendered on the
 * CDN, then cross-fades. `onBusy` reports whether a newer image is still loading.
 */
export function CrossfadeImage({
  src,
  alt,
  className,
  imgClassName,
  placeholder,
  onBusy,
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
  const [layers, setLayers] = React.useState<Layer[]>([{ src, loaded: !!priority, failed: false, enter, shift }]);
  const [first] = React.useState(src); // the frame the page opened with (its srcset and priority apply)
  const [seen, setSeen] = React.useState(src);
  if (src !== seen) {
    setSeen(src);
    setLayers((ls) => [...ls.filter((l) => l.loaded).slice(-1), { src, loaded: false, failed: false, enter, shift }]);
  }

  const top = layers[layers.length - 1];
  const busy = !top.loaded && !top.failed;
  React.useEffect(() => {
    onBusy?.(busy);
  }, [busy, onBusy]);

  const settle = (s: string, ok: boolean) => {
    setLayers((ls) => {
      const i = ls.findIndex((l) => l.src === s);
      if (i < 0) return ls;
      return ls.map((l, j) => (j === i ? { ...l, loaded: ok, failed: !ok } : l));
    });
    if (!ok) onError?.();
  };

  // drop stale layers after the fade has finished
  React.useEffect(() => {
    if (!top.loaded || layers.length < 2) return;
    const t = setTimeout(() => setLayers((ls) => ls.slice(-1)), 1200);
    return () => clearTimeout(t);
  }, [top.loaded, layers.length]);

  return (
    <div className={cn("relative overflow-hidden", className)} style={placeholder ? { backgroundImage: `url("${placeholder}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
      {layers.map((l, i) => {
        const lead = l.src === first;
        return (
          <img
            key={l.src}
            src={l.src}
            srcSet={lead ? srcSet : undefined}
            sizes={lead && srcSet ? sizes : undefined}
            alt={i === layers.length - 1 ? alt : ""}
            aria-hidden={i === layers.length - 1 ? undefined : true}
            width={width}
            height={height}
            decoding="async"
            fetchPriority={lead && priority ? "high" : undefined}
            ref={(el) => {
              // loaded before hydration attached onLoad (cache, server-rendered): settle it now
              if (el && !l.loaded && !l.failed && el.complete && el.naturalWidth > 0) settle(l.src, true);
            }}
            onLoad={() => settle(l.src, true)}
            onError={() => settle(l.src, false)}
            style={l.enter === "settle" ? ({ "--settle-from": `${-l.shift * 100}%` } as React.CSSProperties) : undefined}
            className={cn("absolute inset-0 size-full", ENTER[l.enter].base, l.loaded ? ENTER[l.enter].after : ENTER[l.enter].before, imgClassName)}
          />
        );
      })}
    </div>
  );
}
