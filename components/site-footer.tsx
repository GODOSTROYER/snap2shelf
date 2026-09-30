import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { SHOWCASE_KIT_SKU } from "@/lib/claims";
import { GitHubMark, HOW_BUILT_URL, REPO_URL, Wordmark } from "./site-header";

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
          <a href={HOW_BUILT_URL} className="inline-flex min-h-11 items-center gap-1 hover:text-paper">
            How it&apos;s built
            <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
          <a href={REPO_URL} className="inline-flex min-h-11 items-center gap-2 font-medium text-paper hover:text-marigold">
            <GitHubMark className="size-4" />
            Read the code
          </a>
        </nav>
      </div>
    </footer>
  );
}
