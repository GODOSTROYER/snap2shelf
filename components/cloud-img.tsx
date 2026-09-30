/* eslint-disable @next/next/no-img-element -- Cloudinary already resizes and picks the format (f_auto,q_auto); next/image would double-optimise. */
import * as React from "react";
import { cn } from "@/lib/client/util";

/**
 * Plain <img> for Cloudinary delivery URLs, with a blurred low-quality
 * placeholder painted underneath so there is never a blank box.
 * Server-safe (no hooks).
 */
export function CloudImg({
  src,
  alt,
  width,
  height,
  placeholder,
  className,
  style,
  priority,
  ...rest
}: Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "alt" | "placeholder"> & {
  src: string;
  alt: string;
  width: number;
  height: number;
  placeholder?: string; // LQIP url
  priority?: boolean;
}) {
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding={priority ? "sync" : "async"}
      className={cn("bg-stage-2 bg-cover bg-center", className)}
      style={placeholder ? { backgroundImage: `url("${placeholder}")`, ...style } : style}
      {...rest}
    />
  );
}
