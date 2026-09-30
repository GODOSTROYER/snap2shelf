"use client";

/* eslint-disable @next/next/no-img-element -- Cloudinary delivery URLs, already sized and formatted */
import * as React from "react";
import { cn } from "@/lib/client/util";

interface Layer {
  src: string;
  loaded: boolean;
  failed: boolean;
}

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
}) {
  const [layers, setLayers] = React.useState<Layer[]>([{ src, loaded: false, failed: false }]);
  const [seen, setSeen] = React.useState(src);
  if (src !== seen) {
    setSeen(src);
    setLayers((ls) => [...ls.filter((l) => l.loaded).slice(-1), { src, loaded: false, failed: false }]);
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
    const t = setTimeout(() => setLayers((ls) => ls.slice(-1)), 450);
    return () => clearTimeout(t);
  }, [top.loaded, layers.length]);

  return (
    <div className={cn("relative overflow-hidden", className)} style={placeholder ? { backgroundImage: `url("${placeholder}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
      {layers.map((l, i) => (
        <img
          key={l.src}
          src={l.src}
          alt={i === layers.length - 1 ? alt : ""}
          aria-hidden={i === layers.length - 1 ? undefined : true}
          width={width}
          height={height}
          decoding="async"
          onLoad={() => settle(l.src, true)}
          onError={() => settle(l.src, false)}
          className={cn("absolute inset-0 size-full transition-opacity duration-[400ms] ease-(--ease-out-quart)", l.loaded ? "opacity-100" : "opacity-0", imgClassName)}
        />
      ))}
    </div>
  );
}
