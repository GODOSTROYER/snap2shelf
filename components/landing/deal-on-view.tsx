"use client";

import * as React from "react";

/**
 * Stocks the shelves as they scroll into view: each framed asset slides onto
 * its shelf (CSS `deal-in`, staggered by --i). Arms only when JS runs, motion
 * is allowed and the shelves start below the fold, so nothing is ever hidden
 * by default. Where the shelves are comes from the observer's first report, not
 * a layout read on mount: hydration never forces a synchronous page layout.
 */
export function DealOnView({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let first = true;
    const io = new IntersectionObserver(
      ([e]) => {
        if (first) {
          first = false;
          const vh = e.rootBounds?.height ?? window.innerHeight;
          if (e.boundingClientRect.top < vh * 0.85) return io.disconnect(); // already in view: leave it be
          el.dataset.deal = "armed";
        }
        if (e.intersectionRatio < 0.18) return;
        el.dataset.deal = "go";
        io.disconnect();
      },
      { threshold: 0.18 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
