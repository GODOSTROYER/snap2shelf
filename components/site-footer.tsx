import Link from "next/link";
import { SHOWCASE_KIT_SKU } from "@/lib/claims";
import { Wordmark } from "./site-header";

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[90rem] flex-col gap-6 px-4 py-10 text-sm text-dim sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex flex-col gap-2">
          <Wordmark className="text-base text-paper" />
          <p>Built for Pixels to Products, the Cloudinary AI Hackathon 2026. Every image and video here is delivered by Cloudinary.</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5">
          <Link href="/studio" className="inline-flex min-h-11 items-center hover:text-paper">
            Studio
          </Link>
          <Link href={`/kit/${SHOWCASE_KIT_SKU}`} className="inline-flex min-h-11 items-center hover:text-paper">
            Sample kit
          </Link>
          <Link href="/#how" className="inline-flex min-h-11 items-center hover:text-paper">
            How it works
          </Link>
        </nav>
      </div>
    </footer>
  );
}
