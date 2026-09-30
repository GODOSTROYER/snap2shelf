import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { buttonVariants } from "@/components/ui/button";
import { FEATURED } from "@/lib/showcase";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <>
      <SiteHeader current="home" />
      <main id="main" className="mx-auto flex min-h-[70dvh] max-w-[40rem] flex-col items-start justify-center px-4 sm:px-8">
        {/* an empty spot on a lit shelf: where the product should be */}
        <div aria-hidden className="mb-10 w-full max-w-[18rem]">
          <div className="mx-auto flex h-36 w-24 items-end justify-center rounded-xl border-2 border-dashed border-line-strong">
            <span className="mb-2 h-1.5 w-14 rounded-full bg-black/40 blur-[2px]" />
          </div>
          <div className="shelf-ledge relative mt-1" />
        </div>
        <h1 className="text-[clamp(2.4rem,7vw,4rem)] leading-[0.95] font-extrabold tracking-[-0.035em]">This shelf is empty</h1>
        <p className="mt-4 text-lg text-dim">The kit or page you followed doesn&apos;t exist, or it hasn&apos;t finished saving yet. Kits appear here a minute after they&apos;re made.</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/studio" className={buttonVariants({ size: "lg" })}>
            Make a kit
          </Link>
          <Link href={`/kit/${FEATURED.sku}`} className={buttonVariants({ size: "lg", variant: "secondary" })}>
            See a sample kit
          </Link>
        </div>
      </main>
    </>
  );
}
