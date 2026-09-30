"use client";

import * as React from "react";

/**
 * Stocks the shelves as they scroll into view: each framed asset slides onto
 * its shelf (CSS `deal-in`, staggered by --i). Arms only when JS runs, motion
 * is allowed and the shelves start below the fold, so nothing is ever hidden
 * by default.
 */
export function DealOnView({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.85) return;
    el.dataset.deal = "armed";
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
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
