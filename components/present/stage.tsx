"use client";

/**
 * Stage primitives shared by the deck and the video cards: the scaled
 * 1920×1080 artboard, the key light / vignette / film grain, a plain <img>
 * for Cloudinary URLs, the brand mark, and small timing hooks.
 */
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ImgHTMLAttributes, type ReactNode } from "react";

export const STAGE = { width: 1920, height: 1080 } as const;

// useLayoutEffect warns during SSR; this component only measures on the client
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Fixed 1920×1080 composition, scaled uniformly to fit the window (letterboxed). */
export function Artboard({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const s = Math.min(window.innerWidth / STAGE.width, window.innerHeight / STAGE.height);
      el.style.setProperty("--pz-scale", String(s));
    };
    fit();
    el.dataset.ready = "true";
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <div ref={ref} className={["pz-artboard", className].filter(Boolean).join(" ")} data-ready="false" role={label ? "region" : undefined} aria-label={label}>
      {children}
    </div>
  );
}

/** Film grain: one noise tile drawn once on a canvas, jittered by transform only. */
function Grain() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const c = document.createElement("canvas");
    c.width = c.height = 220;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    el.style.backgroundImage = `url(${c.toDataURL("image/png")})`;
  }, []);
  return <div ref={ref} className="pz-grain" aria-hidden />;
}

/** Key light that drifts to where the action is, plus vignette and grain. */
export function Backdrop({ light, grain = true }: { light: { x: number; y: number }; grain?: boolean }) {
  return (
    <>
      <motion.div
        className="pz-spot"
        aria-hidden
        initial={false}
        animate={{ x: `${(light.x - 0.5) * 100}vw`, y: `${(light.y - 0.5) * 100}vh` }}
        transition={{ type: "spring", stiffness: 28, damping: 18, mass: 1.2 }}
      />
      <div className="pz-vignette" aria-hidden />
      {grain && <Grain />}
    </>
  );
}

/**
 * Plain <img> on purpose: every src is a Cloudinary delivery URL that is
 * already sized and format-negotiated (f_auto), so next/image would only
 * re-encode it. Images fade in once decoded so nothing pops.
 */
export function Img({ src, alt, className, style, fade = true, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string; alt: string; fade?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth) setLoaded(true);
  }, [src]);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- see component comment
    <img
      ref={ref}
      src={src}
      alt={alt}
      decoding="async"
      draggable={false}
      onLoad={() => setLoaded(true)}
      className={className}
      style={{ ...style, opacity: fade && !loaded ? 0 : (style?.opacity ?? undefined), transition: fade ? "opacity 400ms cubic-bezier(0.16,1,0.3,1)" : undefined }}
      {...rest}
    />
  );
}

/** The brand mark: a product resting on a shelf, casting its shadow (same drawing as the app header). */
export function Mark({ size = 28, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} aria-hidden style={style}>
      <rect x="8" y="5" width="12" height="14" rx="2.5" fill="var(--pz-marigold)" />
      <ellipse cx="14.5" cy="20.6" rx="7.5" ry="1.3" fill="#000" opacity="0.45" />
      <rect x="2" y="21.5" width="24" height="2.5" rx="1.25" fill="var(--pz-paper)" />
    </svg>
  );
}

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: size * 0.3 }}>
      <Mark size={size * 1.15} />
      <span className="pz-display" style={{ fontSize: size, fontWeight: 720, letterSpacing: "-0.03em", lineHeight: 1 }}>
        Snap2Shelf
      </span>
    </span>
  );
}

/** Number of beats (timestamps in seconds since mount) that have passed. */
export function useBeat(times: readonly number[]): number {
  const [beat, setBeat] = useState(0);
  const key = times.join(",");
  useEffect(() => {
    const at = key.split(",").map(Number);
    const ids = at.map((t, i) => window.setTimeout(() => setBeat((b) => Math.max(b, i + 1)), t * 1000));
    return () => ids.forEach((id) => window.clearTimeout(id));
  }, [key]);
  return beat;
}

/** Counts to `to` over `duration` s after `delay` s; reduced motion shows the value at once. */
export function CountUp({ to, from = 0, duration = 1.4, delay = 0, format = (n: number) => String(Math.round(n)), className, style }: {
  to: number;
  from?: number;
  duration?: number;
  delay?: number;
  format?: (n: number) => string;
  className?: string;
  style?: CSSProperties;
}) {
  const reduced = useReducedMotion();
  const [v, setV] = useState(from);
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const t0 = performance.now(); // wall-clock start, so a throttled tab catches up instead of lagging
    const tick = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - t0 - delay * 1000) / (duration * 1000)));
      const e = 1 - Math.pow(1 - p, 4);
      setV(from + (to - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, from, duration, delay, reduced]);
  return (
    <span className={["pz-num", className].filter(Boolean).join(" ")} style={style}>
      {format(reduced ? to : v)}
    </span>
  );
}

export const EASE = [0.16, 1, 0.3, 1] as const;
