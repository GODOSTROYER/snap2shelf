"use client";

/* eslint-disable @next/next/no-img-element -- Cloudinary URLs are already sized and formatted (f_auto,q_auto). */
import { ChevronsLeftRight } from "lucide-react";
import * as React from "react";

interface Img {
  src: string;
  srcSet: string;
  alt: string;
  placeholder?: string; // tiny blurred copy, painted until the real image arrives
}

/**
 * Drag to compare: the input photo (left) against the finished hero, aligned
 * so the product stays put while the world around it changes.
 *
 * Once both images are decoded, one intro plays (CSS, on the registered --pos
 * property): the input photo slides over, then the stage sweeps in behind the
 * product and the handle settles in the middle. Touching the slider stops it.
 * The range input covers the whole frame, so it works with drag, tap and arrow
 * keys, and reads as a slider to screen readers. Dragging never re-renders React.
 */
export function BeforeAfter({
  before,
  after,
  sizes,
  width,
  height,
  beforeLabel = "Your photo",
}: {
  before: Img;
  after: Img;
  sizes: string;
  width: number;
  height: number;
  /** What the input photo is: "Your photo", or the sample label (the samples are AI-generated test images). */
  beforeLabel?: string;
}) {
  const what = beforeLabel.toLowerCase();
  const box = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const loaded = React.useRef(0);

  const set = React.useCallback(
    (v: number) => {
      const el = box.current;
      if (!el) return;
      el.dataset.intro = "done";
      el.style.setProperty("--pos", `${v}%`);
      if (input.current) {
        input.current.value = String(Math.round(v));
        input.current.setAttribute("aria-valuetext", `${Math.round(v)}% ${what}`);
      }
    },
    [what],
  );

  const arm = React.useCallback(() => {
    const el = box.current;
    if (!el || el.dataset.intro) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.dataset.intro = "play";
  }, []);

  const onImg = () => {
    loaded.current += 1;
    if (loaded.current >= 2) arm();
  };

  React.useEffect(() => {
    // images already cached before hydration fire no load event; and never wait forever
    const imgs = box.current?.querySelectorAll("img");
    if (imgs && [...imgs].every((i) => i.complete && i.naturalWidth > 0)) arm();
    const t = setTimeout(arm, 2600);
    return () => clearTimeout(t);
  }, [arm]);

  return (
    <div
      ref={box}
      onAnimationEnd={(e) => {
        if (e.animationName === "ba-intro" && box.current) box.current.dataset.intro = "done";
      }}
      className="ba group relative isolate aspect-[4/5] w-full overflow-hidden rounded-[22px] bg-stage-2 shadow-[0_50px_90px_-40px_rgb(0_0_0/0.95)] ring-1 ring-line"
    >
      <img
        src={after.src}
        srcSet={after.srcSet}
        sizes={sizes}
        alt={after.alt}
        width={width}
        height={height}
        fetchPriority="high"
        decoding="async"
        onLoad={onImg}
        style={after.placeholder ? { backgroundImage: `url("${after.placeholder}")` } : undefined}
        className="absolute inset-0 size-full bg-cover bg-center object-cover"
      />
      <img
        src={before.src}
        srcSet={before.srcSet}
        sizes={sizes}
        alt={before.alt}
        width={width}
        height={height}
        fetchPriority="auto"
        decoding="async"
        onLoad={onImg}
        style={before.placeholder ? { backgroundImage: `url("${before.placeholder}")` } : undefined}
        className="absolute inset-0 size-full bg-cover bg-center object-cover [clip-path:inset(0_calc(100%_-_var(--pos))_0_0)]"
      />

      <span className="pointer-events-none absolute top-3.5 left-3.5 rounded-full bg-black/55 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm sm:top-4 sm:left-4">{beforeLabel}</span>
      <span className="pointer-events-none absolute top-3.5 right-3.5 rounded-full bg-marigold px-3 py-1.5 text-xs font-semibold text-marigold-ink sm:top-4 sm:right-4">Shelf-ready hero</span>

      {/* a full-width layer moved by transform (never layout), so the handle can follow --pos without shifting anything */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-10 translate-x-(--pos) will-change-transform">
        <div className="absolute inset-y-0 left-0 w-0.5 -translate-x-1/2 bg-white/90 shadow-[0_0_20px_rgb(0_0_0/0.6)]">
          <span className="absolute top-1/2 left-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-studio shadow-[0_8px_24px_rgb(0_0_0/0.45)] transition-transform duration-200 group-has-[input:focus-visible]:ring-4 group-has-[input:focus-visible]:ring-marigold group-active:scale-95">
            <ChevronsLeftRight className="size-5" />
          </span>
        </div>
      </div>

      <input
        ref={input}
        type="range"
        min={0}
        max={100}
        defaultValue={50}
        aria-label={`Compare the ${what} with the finished hero`}
        aria-valuetext={`50% ${what}`}
        onPointerDown={() => {
          if (box.current) box.current.dataset.intro = "done";
        }}
        onInput={(e) => set(Number(e.currentTarget.value))}
        onKeyDown={() => {
          if (box.current?.dataset.intro !== "done") set(Number(input.current?.value ?? 50));
        }}
        className="absolute inset-0 z-20 size-full cursor-ew-resize touch-pan-y opacity-0"
      />
    </div>
  );
}
