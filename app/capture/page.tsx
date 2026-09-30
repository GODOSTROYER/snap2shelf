import type { Metadata } from "next";
import Link from "next/link";
import { Capture } from "@/components/capture/capture";
import { Wordmark } from "@/components/site-header";

export const metadata: Metadata = {
  title: "Snap your product",
  description: "Take one photo of your product and send it to the Snap2Shelf studio.",
  robots: { index: false },
};

export default async function CapturePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const sku = Array.isArray(q.sku) ? q.sku[0] : q.sku;
  return (
    <>
      <header className="flex h-16 items-center px-4">
        <Link href="/" aria-label="Snap2Shelf home" className="rounded-lg">
          <Wordmark />
        </Link>
      </header>
      <main id="main">
        <Capture sku={sku} />
      </main>
    </>
  );
}
