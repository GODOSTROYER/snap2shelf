import Link from "next/link";
import { SHOWCASE_KIT_SKU } from "@/lib/claims";
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

/** The source, for judges and developers: the repo, and its "How it's built" section. */
export const REPO_URL = "https://github.com/GODOSTROYER/snap2shelf";
export const HOW_BUILT_URL = `${REPO_URL}#how-its-built`;

/** GitHub's mark, for the "Read the code" link. */
export function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden fill="currentColor" className={cn("size-5", className)}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

type Section = "home" | "studio" | "kit" | "capture" | "admin";

const links: { href: string; label: string; section: Section }[] = [
  { href: "/studio", label: "Studio", section: "studio" },
  // the showcase kit (lib/claims.ts SHOWCASE_KIT_SKU): a finished kit with a ZIP
  { href: `/kit/${SHOWCASE_KIT_SKU}`, label: "Sample kit", section: "kit" },
];

export function SiteHeader({ current, children }: { current: Section; children?: React.ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 items-center rounded-full bg-marigold px-4 py-2.5 text-sm font-semibold text-marigold-ink focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:inline-flex focus-visible:min-h-11"
      >
        Skip to content
      </a>
      <header className="relative z-20 mx-auto flex h-16 w-full max-w-[90rem] items-center justify-between gap-3 px-4 sm:px-8">
        {/* on the home page this link is the page itself: prefetching it would re-download the whole landing payload during load */}
        <Link
          href="/"
          prefetch={current === "home" ? false : undefined}
          aria-label="Snap2Shelf home"
          aria-current={current === "home" ? "page" : undefined}
          className="inline-flex min-h-11 items-center rounded-lg"
        >
          <Wordmark />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-0.5 sm:gap-2">
          {children}
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              prefetch={current === l.section ? false : undefined}
              aria-current={current === l.section ? "page" : undefined}
              className={cn(
                "relative inline-flex min-h-11 items-center rounded-full px-2.5 text-sm font-medium whitespace-nowrap text-dim transition-colors hover:text-paper sm:px-3",
                "aria-[current=page]:text-paper aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-3 aria-[current=page]:after:bottom-1.5 aria-[current=page]:after:h-0.5 aria-[current=page]:after:rounded-full aria-[current=page]:after:bg-marigold",
              )}
            >
              {l.label}
            </Link>
          ))}
          <a
            href={HOW_BUILT_URL}
            className="hidden min-h-11 items-center rounded-full px-3 text-sm font-medium whitespace-nowrap text-dim transition-colors hover:text-paper md:inline-flex"
          >
            How it&apos;s built
          </a>
          <a
            href={REPO_URL}
            aria-label="Read the code on GitHub"
            className="inline-flex size-11 shrink-0 items-center justify-center gap-2 rounded-full text-sm font-medium whitespace-nowrap text-paper transition-colors hover:bg-stage-2 sm:ml-1 sm:h-10 sm:w-auto sm:px-3.5 sm:ring-1 sm:ring-line-strong sm:ring-inset"
          >
            <GitHubMark className="size-[1.15rem]" />
            <span className="hidden sm:inline">Read the code</span>
          </a>
        </nav>
      </header>
    </>
  );
}
