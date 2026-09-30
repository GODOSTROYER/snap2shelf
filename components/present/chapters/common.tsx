"use client";

import { motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";
import type { PresentData } from "@/lib/present/data";
import { EASE } from "../stage";

export interface ChapterProps {
  d: PresentData;
}

/** Headline / copy block that settles in: opacity plus a short rise (reduced motion: fade only). */
export function Rise({
  children,
  delay = 0,
  y = 18,
  duration = 0.7,
  style,
  className,
  as = "div",
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  duration?: number;
  style?: CSSProperties;
  className?: string;
  as?: "div" | "h1" | "h2" | "p" | "span";
}) {
  const M = motion[as];
  return (
    <M className={className} style={style} initial={{ opacity: 0, y }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration, ease: EASE }}>
      {children}
    </M>
  );
}

export const abs = (left: number, top: number, extra?: CSSProperties): CSSProperties => ({ position: "absolute", left, top, ...extra });

/** Same convention as the studio's receipt (lib/client/features formatBytes): 2,249,535 B → "2.15 MB", 157,588 B → "154 KB". */
export const fmtBytes = (n: number) => {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  return `${mb >= 10 ? mb.toFixed(1) : mb.toFixed(2)} MB`;
};
/** Image format as people write it: "webp" / "WEBP" → "WebP". */
export const fmtFormat = (f: string) => ({ webp: "WebP", avif: "AVIF", jpeg: "JPEG", jpg: "JPEG", png: "PNG", gif: "GIF", jxl: "JPEG XL" })[f.toLowerCase()] ?? f.toUpperCase();
export const fmtSeconds = (n: number) => `${n.toFixed(1)} s`;
export const fmtInt = (n: number) => Math.round(n).toLocaleString("en-IN");
