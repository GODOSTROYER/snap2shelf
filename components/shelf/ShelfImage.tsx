"use client";

import { useCallback, useState } from "react";

export interface ShelfImageProps {
  src: string;
  srcSet: string;
  sizes: string;
  alt: string;
  width: number;
  height: number;
  /** Inline data URI of a tiny blurred copy (server-fetched). */
  lqip?: string;
  priority?: boolean;
  className?: string;
}

/**
 * Responsive Cloudinary image with a blur-up: the tiny blurred copy paints
 * instantly as the background, the real image fades in once decoded.
 * Handles images that finished loading before hydration (cache hits).
 */
export function ShelfImage({ src, srcSet, sizes, alt, width, height, lqip, priority, className = "" }: ShelfImageProps) {
  const [loaded, setLoaded] = useState(false);
  const ref = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, []);

  return (
    <div
      className={`relative overflow-hidden bg-[#1a1612] bg-cover bg-center ${className}`}
      style={{ aspectRatio: `${width} / ${height}`, backgroundImage: lqip ? `url("${lqip}")` : undefined }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary does the resizing (srcset of f_auto,q_auto widths) */}
      <img
        ref={ref}
        src={src}
        srcSet={srcSet}
        sizes={sizes}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={`absolute inset-0 h-full w-full object-cover transition-[opacity,filter,transform] duration-700 ease-out motion-reduce:transition-none ${
          loaded ? "opacity-100 blur-0" : "opacity-0 blur-md"
        }`}
      />
    </div>
  );
}
