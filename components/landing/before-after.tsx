"use client";

/* eslint-disable @next/next/no-img-element -- Cloudinary URLs are already sized and formatted (f_auto,q_auto). */
import { ChevronsLeftRight } from "lucide-react";
import * as React from "react";

interface Img {
  src: string;
  srcSet: string;
  alt: string;
}

/**
 * Drag to compare: the raw phone photo (left) against the finished hero.
 * The range input covers the whole frame, so it works with drag, tap and
 * arrow keys, and reads as a slider to screen readers. The position lives in a
 * CSS variable, so dragging never re-renders React.
 */
export function BeforeAfter({ before, after, sizes, width, height }: { before: Img; after: Img; sizes: string; width: number; height: number }) {
  const box = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const touched = React.useRef(false);

  const set = React.useCallback((v: number) => {
    box.current?.style.setProperty("--pos", `${v}%`);
    if (input.current) {
      input.current.value = String(Math.round(v));
      input.current.setAttribute("aria-valuetext", `${Math.round(v)}% original photo`);
    }
  }, []);

  // One intro sweep so people see it moves; skipped for reduced motion or once touched.
  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const start = performance.now() + 700;
    const path = (t: number) => {
      // 50 → 16 → 50, eased
      const e = (x: number) => 1 - Math.pow(1 - x, 3);
      if (t < 0.5) return 50 - 34 * e(t / 0.5);
      return 16 + 34 * e((t - 0.5) / 0.5);
    };
    const tick = (now: number) => {
      if (touched.current) return;
      const t = (now - start) / 2200;
      if (t >= 0) set(path(Math.min(1, t)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [set]);

  return (
    <div
      ref={box}
      className="group relative isolate aspect-[4/5] w-full overflow-hidden rounded-[22px] bg-stage-2 shadow-[0_50px_90px_-40px_rgb(0_0_0/0.95)] ring-1 ring-line [--pos:50%]"
    >
      <img src={after.src} srcSet={after.srcSet} sizes={sizes} alt={after.alt} width={width} height={height} fetchPriority="high" decoding="async" className="absolute inset-0 size-full object-cover" />
      <img
        src={before.src}
        srcSet={before.srcSet}
        sizes={sizes}
        alt={before.alt}
        width={width}
        height={height}
        decoding="async"
        className="absolute inset-0 size-full object-cover [clip-path:inset(0_calc(100%_-_var(--pos))_0_0)]"
      />

      <span className="pointer-events-none absolute top-4 left-4 rounded-full bg-black/55 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm">Your phone photo</span>
      <span className="pointer-events-none absolute top-4 right-4 rounded-full bg-marigold px-3 py-1.5 text-xs font-semibold text-marigold-ink">Shelf-ready hero</span>

      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-(--pos) z-10 w-0.5 -translate-x-1/2 bg-white/90 shadow-[0_0_20px_rgb(0_0_0/0.6)]">
        <span className="absolute top-1/2 left-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-studio shadow-[0_8px_24px_rgb(0_0_0/0.45)] transition-transform duration-200 group-has-[input:focus-visible]:ring-4 group-has-[input:focus-visible]:ring-marigold group-active:scale-95">
          <ChevronsLeftRight className="size-5" />
        </span>
      </div>

      <input
        ref={input}
        type="range"
        min={0}
        max={100}
        defaultValue={50}
        aria-label="Compare your phone photo with the finished hero"
        aria-valuetext="50% original photo"
        onPointerDown={() => (touched.current = true)}
        onKeyDown={() => (touched.current = true)}
        onInput={(e) => {
          touched.current = true;
          set(Number(e.currentTarget.value));
        }}
        className="absolute inset-0 z-20 size-full cursor-ew-resize touch-pan-y opacity-0"
      />
    </div>
  );
}
