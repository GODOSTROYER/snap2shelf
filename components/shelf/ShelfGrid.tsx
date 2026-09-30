"use client";

import { ArrowUpRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import * as React from "react";
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

/** Gap between products; each product's piece of ledge reaches half of it on both sides, so a row reads as one shelf. */
const GAP = "[--gx:12px] sm:[--gx:20px] md:[--gx:24px] xl:[--gx:28px]";
/** When the first products drop, and how far apart. */
const FIRST_MS = 250;
const STEP_MS = 140;

/**
 * The storefront: every product stands on the site's lit wooden ledge (the
 * same one the kit shelves use) and is dropped onto it one by one, landing
 * with a squash of its contact shadow. Its price-tag chip hangs from the
 * ledge's edge. The drop is CSS (it paints before hydration, see Reveal.tsx);
 * products below the fold wait and drop as they scroll into view. Off under
 * reduced motion.
 */
export function ShelfGrid({ items }: { items: ShelfCard[] }) {
  const reduce = useReducedMotion();
  const list = React.useRef<HTMLUListElement>(null);

  React.useEffect(() => {
    const ul = list.current;
    if (!ul || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // products still below the fold: hold them (they are off screen, nothing visibly vanishes) …
    const waiting = Array.from(ul.querySelectorAll<HTMLElement>("[data-drop]")).filter((li) => li.getBoundingClientRect().top > window.innerHeight);
    if (!waiting.length) return;
    waiting.forEach((li) => (li.dataset.wait = ""));
    // … and drop each row as it comes into view, left to right
    const io = new IntersectionObserver(
      (entries) => {
        const arriving = entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement);
        arriving
          .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left)
          .forEach((li, k) => {
            li.style.setProperty("--d", `${80 + k * STEP_MS}ms`);
            delete li.dataset.wait;
            io.unobserve(li);
          });
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    waiting.forEach((li) => io.observe(li));
    return () => {
      io.disconnect();
      waiting.forEach((li) => delete li.dataset.wait);
    };
  }, []);

  return (
    <ul ref={list} className={`grid grid-cols-2 gap-x-(--gx) gap-y-10 md:grid-cols-3 md:gap-y-12 xl:grid-cols-4 ${GAP}`}>
      {items.map((it, i) => (
        <li key={it.sku} data-drop className="min-w-0" style={{ "--d": `${FIRST_MS + i * STEP_MS}ms` } as React.CSSProperties}>
          <article id={`p-${it.sku}`} className="group">
            <div className="relative">
              {/* the ledge: this product's piece, reaching into the gaps so a row reads as one shelf */}
              <div aria-hidden className="shelf-ledge absolute top-full right-[calc(var(--gx)*-0.5_-_1px)] left-[calc(var(--gx)*-0.5_-_1px)] rounded-none" />
              {/* contact shadow on the ledge's top: squashes wide as the product lands */}
              <div
                aria-hidden
                className="s2s-contact pointer-events-none absolute inset-x-[7%] -bottom-1.5 h-3 rounded-[50%] bg-black/75 blur-[5px] transition-[transform,opacity] duration-500 group-hover:scale-x-90 group-hover:opacity-60 motion-reduce:transition-none"
              />
              <div className="s2s-drop relative">
                <motion.div
                  whileHover={reduce ? undefined : { y: -6 }}
                  transition={{ type: "spring", stiffness: 260, damping: 22 }}
                  className="relative overflow-hidden rounded-[18px] rounded-b-[6px] shadow-[0_24px_40px_-26px_rgba(0,0,0,0.95)] ring-1 ring-[#f4efe7]/10"
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
                </motion.div>
              </div>
            </div>

            {/* price-tag chip hanging from the ledge's edge, as under the kit cards */}
            <div className="s2s-tag mt-[14px] flex">
              <h2 className="max-w-full rounded-t-[2px] rounded-b-[6px] bg-[#f5ede1] px-2.5 py-1.5 font-[family-name:var(--font-shelf-sans)] text-[13px] leading-tight font-semibold text-[#15110d] shadow-[0_8px_16px_-8px_rgba(0,0,0,0.85)] sm:text-sm">
                {it.name}
                {it.facts ? <span className="mt-0.5 block text-[11px] font-medium text-[#15110d]/60 sm:text-xs">{it.facts}</span> : null}
              </h2>
            </div>
            <a
              href={it.askHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full text-[13px] font-medium text-[#f5a524] underline-offset-4 transition-colors hover:text-[#ffc15a] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f5a524] sm:text-sm"
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
