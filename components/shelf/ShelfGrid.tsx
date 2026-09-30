"use client";

import { ArrowUpRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { ShelfImage } from "./ShelfImage";
import { WhatsAppIcon } from "./icons";

export interface ShelfCard {
  sku: string;
  name: string;
  facts?: string;
  alt: string;
  src: string;
  srcSet: string;
  width: number;
  height: number;
  lqip?: string;
  /** wa.me link that asks the shop about this product. */
  askHref: string;
}

/** Column widths: 2-up phone, 3-up tablet, 4-up desktop (max 1152 px container). */
export const SHELF_SIZES = "(min-width: 1280px) 272px, (min-width: 768px) calc((100vw - 96px) / 3), calc((100vw - 44px) / 2)";

export function ShelfGrid({ items }: { items: ShelfCard[] }) {
  const reduce = useReducedMotion();

  // Entrance: CSS stagger (paints before hydration, see Reveal.tsx). Hover: motion spring.
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 md:gap-x-6 md:gap-y-10 xl:grid-cols-4 xl:gap-x-7">
      {items.map((it, i) => (
        <li key={it.sku} className="s2s-rise min-w-0" style={{ animationDelay: `${220 + i * 90}ms` }}>
          <article id={`p-${it.sku}`} className="group">
            <div className="relative">
              {/* shelf-edge glow under each product */}
              <div
                aria-hidden
                className="pointer-events-none absolute -bottom-3 left-[8%] right-[8%] h-6 rounded-[50%] bg-[#f5a524]/25 blur-xl transition-opacity duration-500 group-hover:opacity-100 motion-safe:opacity-60"
              />
              <motion.div
                whileHover={reduce ? undefined : { y: -6 }}
                transition={{ type: "spring", stiffness: 260, damping: 22 }}
                className="relative overflow-hidden rounded-[20px] shadow-[0_24px_48px_-24px_rgba(0,0,0,0.9)] ring-1 ring-[#f4efe7]/10"
              >
                <ShelfImage
                  src={it.src}
                  srcSet={it.srcSet}
                  sizes={SHELF_SIZES}
                  alt={it.alt}
                  width={it.width}
                  height={it.height}
                  lqip={it.lqip}
                  priority={i < 2}
                />
                <span className="absolute left-2.5 top-2.5 rounded-full bg-[#0e0c0a]/55 px-2.5 py-1 font-[family-name:var(--font-shelf-sans)] text-[10px] font-semibold uppercase tracking-[0.14em] text-[#f4efe7]/90 backdrop-blur-md sm:left-3 sm:top-3 sm:text-[11px]">
                  No. {String(i + 1).padStart(2, "0")}
                </span>
              </motion.div>
            </div>

            <h2 className="mt-4 font-[family-name:var(--font-shelf-display)] text-[17px] font-semibold leading-snug text-[#f4efe7] sm:text-xl">{it.name}</h2>
            {it.facts && <p className="mt-1 truncate text-[13px] text-[#a89f92] sm:text-sm">{it.facts}</p>}
            <a
              href={it.askHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2.5 inline-flex min-h-11 items-center gap-1.5 rounded-full text-[13px] font-medium text-[#f5a524] underline-offset-4 transition-colors hover:text-[#ffc15a] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f5a524] sm:text-sm"
            >
              <WhatsAppIcon className="h-4 w-4" />
              Ask about this
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">: {it.name} (opens WhatsApp)</span>
            </a>
          </article>
        </li>
      ))}
    </ul>
  );
}
