import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <>
      <SiteHeader current="home" />
      <main id="main" className="mx-auto flex min-h-[70dvh] max-w-[40rem] flex-col items-start justify-center px-4 sm:px-8">
        <h1 className="text-[clamp(2.4rem,7vw,4rem)] leading-[0.95] font-extrabold tracking-[-0.035em]">This shelf is empty</h1>
        <p className="mt-4 text-lg text-dim">The kit or page you followed doesn&apos;t exist, or it hasn&apos;t finished saving yet. Kits appear here a minute after they&apos;re made.</p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link href="/studio" className={buttonVariants({ size: "lg" })}>
            Make a kit
          </Link>
          <Link href="/kit/sneaker1" className={buttonVariants({ size: "lg", variant: "secondary" })}>
            See a sample kit
          </Link>
        </div>
      </main>
    </>
  );
}
