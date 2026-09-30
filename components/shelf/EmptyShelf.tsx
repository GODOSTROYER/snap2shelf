import { ArrowRight } from "lucide-react";
import Link from "next/link";

export interface EmptyShelfProps {
  eyebrow?: string;
  title: string;
  body: string;
  cta?: { href: string; label: string };
  secondary?: React.ReactNode;
}

/** Designed empty/404 state: an unlit shelf with three ghost product outlines. */
export function EmptyShelf({ eyebrow = "Snap2Shelf", title, body, cta = { href: "/", label: "Build a shelf" }, secondary }: EmptyShelfProps) {
  return (
    <section className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      <div aria-hidden className="relative mb-12 h-40 w-full max-w-sm">
        <div className="absolute inset-x-6 bottom-6 flex items-end justify-center gap-5">
          <div className="h-20 w-14 rounded-t-[18px] rounded-b-md border border-dashed border-[#f4efe7]/20 motion-safe:animate-[pulse_4s_ease-in-out_infinite]" />
          <div className="h-28 w-10 rounded-t-full rounded-b-md border border-dashed border-[#f4efe7]/25 motion-safe:animate-[pulse_4s_ease-in-out_0.6s_infinite]" />
          <div className="h-16 w-20 rounded-t-[26px] rounded-b-md border border-dashed border-[#f4efe7]/20 motion-safe:animate-[pulse_4s_ease-in-out_1.2s_infinite]" />
        </div>
        <div className="absolute inset-x-0 bottom-3 h-3 rounded-full bg-gradient-to-b from-[#3a2a1a] to-[#1c140d] shadow-[0_18px_40px_-8px_rgba(245,165,36,0.18)]" />
        <div className="absolute inset-x-10 bottom-0 h-3 rounded-[50%] bg-black/60 blur-md" />
      </div>
      <p className="font-[family-name:var(--font-shelf-sans)] text-xs font-semibold uppercase tracking-[0.22em] text-[#f5a524]">{eyebrow}</p>
      <h1 className="mt-3 font-[family-name:var(--font-shelf-display)] text-4xl font-semibold leading-[1.05] tracking-tight text-[#f4efe7] sm:text-5xl">{title}</h1>
      <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[#a89f92] sm:text-base">{body}</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href={cta.href}
          className="inline-flex h-12 items-center gap-2 rounded-full bg-[#f5a524] px-5 text-[15px] font-semibold text-[#1a1208] transition-colors hover:bg-[#ffb73d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f4efe7] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e0c0a]"
        >
          {cta.label}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
        {secondary}
      </div>
    </section>
  );
}
