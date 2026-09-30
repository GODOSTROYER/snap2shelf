"use client";

import dynamic from "next/dynamic";
import * as React from "react";
import type { CostReceiptProps } from "@/components/features/cost-receipt";
import type { ReadinessGaugeProps } from "@/components/readiness/ReadinessGauge";
// clsx rather than util's cn: nothing here conflicts, and tailwind-merge would ride into /kit's first-load JS
import { clsx as cn } from "clsx";

// Below the fold on /kit/<sku>: their code (and motion) loads only as they come near.
const CostReceipt = dynamic(() => import("@/components/features/cost-receipt").then((m) => m.CostReceipt), { ssr: false });
const ReadinessGauge = dynamic(() => import("@/components/readiness/ReadinessGauge").then((m) => m.ReadinessGauge), { ssr: false });

/**
 * Renders its children once the placeholder is within `margin` of the
 * viewport. The placeholder keeps roughly the panel's height, and it mounts
 * well before it scrolls into view, so nothing below it jumps.
 */
function WhenNear({ children, reserve, margin = "900px", className }: { children: React.ReactNode; reserve: string; margin?: string; className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [near, setNear] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        setNear(true);
        io.disconnect();
      },
      { rootMargin: `${margin} 0px ${margin} 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return (
    <div ref={ref} className={cn(!near && reserve, className)}>
      {near ? children : null}
    </div>
  );
}

/** `className` places the panel's slot (e.g. a grid cell); the receipt keeps its own width. */
export function LazyReceipt({ reserve = "min-h-[54rem] sm:min-h-[50rem]", className, ...props }: CostReceiptProps & { reserve?: string }) {
  return (
    <WhenNear reserve={reserve} className={className}>
      <CostReceipt {...props} />
    </WhenNear>
  );
}

export function LazyReadiness({ reserve = "min-h-[61rem] md:min-h-[40rem]", className, ...props }: ReadinessGaugeProps & { reserve?: string }) {
  return (
    <WhenNear reserve={reserve} className={className}>
      <ReadinessGauge {...props} />
    </WhenNear>
  );
}
