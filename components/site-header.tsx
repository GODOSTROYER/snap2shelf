import Link from "next/link";
import { cn } from "@/lib/client/util";

export function Mark({ className }: { className?: string }) {
  // a product resting on a shelf, casting its shadow
  return (
    <svg viewBox="0 0 28 28" aria-hidden className={cn("size-7", className)}>
      <rect x="8" y="5" width="12" height="14" rx="2.5" fill="var(--color-marigold)" />
      <ellipse cx="14.5" cy="20.6" rx="7.5" ry="1.3" fill="#000" opacity="0.45" />
      <rect x="2" y="21.5" width="24" height="2.5" rx="1.25" fill="var(--color-paper)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-display text-[1.2rem] font-bold tracking-[-0.03em]", className)}>
      <Mark />
      Snap2Shelf
    </span>
  );
}

type Section = "home" | "studio" | "kit" | "capture" | "admin";

const links: { href: string; label: string; section: Section }[] = [
  { href: "/studio", label: "Studio", section: "studio" },
  { href: "/kit/sneaker1", label: "Sample kit", section: "kit" },
];

export function SiteHeader({ current, children }: { current: Section; children?: React.ReactNode }) {
  return (
    <header className="relative z-20 mx-auto flex h-16 w-full max-w-[90rem] items-center justify-between gap-4 px-4 sm:px-8">
      <Link href="/" aria-label="Snap2Shelf home" aria-current={current === "home" ? "page" : undefined} className="rounded-lg">
        <Wordmark />
      </Link>
      <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
        {children}
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={current === l.section ? "page" : undefined}
            className={cn(
              "relative rounded-full px-3 py-2 text-sm font-medium text-dim transition-colors hover:text-paper",
              "aria-[current=page]:text-paper aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-3 aria-[current=page]:after:-bottom-0.5 aria-[current=page]:after:h-0.5 aria-[current=page]:after:rounded-full aria-[current=page]:after:bg-marigold",
              l.section === "kit" && "hidden sm:inline-flex",
            )}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
