import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReadinessDemo } from "@/components/readiness/ReadinessDemo";
import { Backdrop } from "@/components/shelf/Backdrop";
import { EmptyShelf } from "@/components/shelf/EmptyShelf";
import { shelfFontVars } from "@/components/shelf/fonts";
import { HttpError } from "@/lib/server/http";
import { measureReadiness } from "@/lib/shelf/measure";
import { SKU_RE } from "@/lib/types";

/** Demo/verification route for the Readiness Score; the kit view embeds <ReadinessGauge> directly. */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Readiness", robots: { index: false } }; // the root layout adds " · Snap2Shelf"

export default async function ReadinessPage({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  if (!SKU_RE.test(sku)) notFound();
  let out: Awaited<ReturnType<typeof measureReadiness>>;
  try {
    out = await measureReadiness(sku, { vision: true });
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    // errors from lib/shelf are already stripped of credentials; show a calm retry state
    console.error(`[readiness-page] ${sku}: ${String((err as Error)?.message ?? err).slice(0, 160)}`);
    return (
      <div className={`${shelfFontVars} relative min-h-dvh font-[family-name:var(--font-shelf-sans)] text-[#f4efe7]`}>
        <Backdrop />
        <EmptyShelf
          eyebrow="Readiness check"
          title="Cloudinary is catching its breath"
          body={err instanceof HttpError ? err.publicMessage : "We couldn't measure this product just now. Try again in a minute."}
          cta={{ href: `/readiness/${sku}`, label: "Try again" }}
        />
      </div>
    );
  }
  const { report, product } = out;

  return (
    <div className={`${shelfFontVars} relative min-h-dvh font-[family-name:var(--font-shelf-sans)] text-[#f4efe7] antialiased`}>
      <Backdrop />
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-5 sm:px-8 sm:pt-8">
        <nav className="flex items-center justify-between" aria-label="Snap2Shelf">
          <Link href="/" className="rounded-md font-[family-name:var(--font-shelf-display)] text-lg font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f5a524]">
            Snap<span className="text-[#f5a524]">2</span>Shelf
          </Link>
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-[#a89f92]">Readiness check</span>
        </nav>

        <header className="mt-10 sm:mt-14">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#f5a524]">Is it marketplace-ready?</p>
          <h1 className="mt-3 font-[family-name:var(--font-shelf-display)] text-[clamp(2.2rem,8vw,4rem)] font-semibold leading-[0.95] tracking-[-0.03em]">{product.name}</h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-[#a89f92] sm:text-base">
            Measured on the real pixels against what marketplaces ask for (pure white, ~85% fill, zoomable, sharp, no text or props) and
            the story and offer-text safe zones for social.
          </p>
        </header>

        <div className="mt-8 lg:mt-10">
          <ReadinessDemo initial={report} name={product.name} rawUrl={product.rawUrl} />
        </div>
      </div>
    </div>
  );
}
