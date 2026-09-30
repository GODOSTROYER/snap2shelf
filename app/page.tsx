import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { StaticShelves } from "@/components/kit/static-shelves";
import { BeforeAfter } from "@/components/landing/before-after";
import { HowItWorks } from "@/components/landing/how-it-works";
import { UrlAnatomy } from "@/components/landing/url-anatomy";
import { PhoneButton } from "@/components/phone/phone-button";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { buttonVariants } from "@/components/ui/button";
import { isBuiltUrl, srcSet } from "@/lib/client/img";
import { countAssets } from "@/lib/client/kit-view";
import { cn } from "@/lib/client/util";
import { FEATURED_KIT, heroAt, rawAt, SAMPLES } from "@/lib/showcase";

const kit = FEATURED_KIT;
const sample = SAMPLES[0];
const WIDTHS = [480, 720, 1080];

const CLOUDINARY_PARTS = [
  ["Upload Widget and signed uploads", "Photos go straight from the laptop or phone to Cloudinary."],
  ["Background removal", "Cuts the product out once; every shot reuses that cut-out."],
  ["AI Vision", "Reads the product, maps each scene's surface and light, and runs the QA check."],
  ["Image Generation", "Builds the scene library once, and powers Creative mode."],
  ["Layers and effects", "The hero itself: cut-out, contact shadow and cast shadow, placed by URL."],
  ["Generative fill and recolor", "Stretches the hero to story and banner sizes, and makes colour variants."],
  ["Text overlays with Google fonts", "Festive offers in Hindi and English, no font uploads."],
  ["Video from stills", "The Kit Reel is spliced from photos, straight from a URL."],
  ["Archives and automatic format", "One zip for everything; every image in the lightest format each browser supports."],
] as const;

export default function Home() {
  const hero = kit.hero;
  return (
    <>
      <SiteHeader current="home" />
      <main id="main">
        {/* Hero */}
        <section className="mx-auto grid max-w-[90rem] items-center gap-10 px-4 pt-4 pb-20 sm:px-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16 lg:pt-8 lg:pb-28">
          <div className="max-w-[40rem]">
            <h1 className="text-[clamp(3.1rem,10.5vw,6rem)] leading-[0.9] font-extrabold tracking-[-0.035em] [font-variation-settings:'wdth'_84,'opsz'_96]">
              <span className="rise block">One photo.</span>
              <span className="rise block [animation-delay:110ms]">A whole shelf.</span>
            </h1>
            <p className="rise mt-6 font-display text-[clamp(1.25rem,3.4vw,1.6rem)] leading-snug font-medium text-paper [animation-delay:220ms]">
              AI builds the stage — your product stays real.
            </p>
            <p className="mt-4 hidden max-w-[33rem] text-lg text-dim sm:block">
              Snap one product photo. Snap2Shelf cuts it out, stages it on a festive or studio scene with matching shadows, checks that nothing about your product changed, then
              turns it into every format your shop and socials need.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link href={`/studio?sample=${sample.sku}`} className={buttonVariants({ size: "lg" })}>
                Try a sample product (no signup)
              </Link>
              <PhoneButton size="lg" />
            </div>
            <p className="mt-5 text-sm text-dim">
              Have a photo on this device?{" "}
              <Link href="/studio" className="font-medium text-paper underline decoration-marigold/60 hover:decoration-marigold">
                Upload it in the studio
              </Link>
            </p>
          </div>

          <figure className="mx-auto w-full max-w-[34rem] lg:mr-0 lg:max-w-[min(100%,calc((100dvh-9rem)*0.8))]">
            <BeforeAfter
              width={1080}
              height={1350}
              sizes="(min-width: 1440px) 620px, (min-width: 1024px) 44vw, (min-width: 640px) 34rem, 92vw"
              before={{
                src: rawAt(kit.product, 720),
                srcSet: srcSet((w) => rawAt(kit.product, w), WIDTHS),
                alt: "The original phone photo: the sneaker floating on a flat pink background",
              }}
              after={{ src: heroAt(kit, 720), srcSet: srcSet((w) => heroAt(kit, w), WIDTHS), alt: hero.alt }}
            />
            {/* the hero stands on the same lit shelf as everything it produces */}
            <div aria-hidden className="shelf-ledge relative -mx-3 -mt-1 sm:-mx-6" />
            <figcaption className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-dim">
              <span className="rounded-b-[5px] rounded-t-[2px] bg-paper px-2 py-1 text-[0.74rem] leading-none font-semibold text-studio shadow-[0_6px_14px_-6px_rgb(0_0_0/0.8)]">
                Hero 4:5 <span className="tabular ml-1 font-medium text-studio/60">1080 × 1350</span>
              </span>
              Drag to compare. Same sneaker pixels, new stage, zero generation credits.
            </figcaption>
          </figure>
        </section>

        {/* The shelf */}
        <section aria-labelledby="shelf-title" className="mx-auto max-w-[90rem] pb-24">
          <div className="flex flex-col gap-4 px-4 sm:flex-row sm:items-end sm:justify-between sm:px-8">
            <div className="max-w-[40rem]">
              <h2 id="shelf-title" className="text-[clamp(2rem,5vw,3.25rem)] leading-[1] font-bold tracking-[-0.03em]">
                {countAssets(kit)} assets from that one photo
              </h2>
              <p className="mt-4 text-lg text-dim">Each one shown where it will live. All of them are transformations of the same approved hero, so nothing about the product is redrawn.</p>
            </div>
            <Link href={`/kit/${kit.sku}`} className={cn(buttonVariants({ variant: "secondary" }), "self-start sm:self-auto")}>
              Open this kit
              <ArrowUpRight />
            </Link>
          </div>
          <div className="mt-8">
            <StaticShelves kit={kit} />
          </div>
        </section>

        {/* How it works */}
        <section id="how" aria-labelledby="how-title" className="border-t border-line">
          <div className="mx-auto max-w-[90rem] px-4 py-20 sm:px-8 lg:py-28">
            <h2 id="how-title" className="max-w-[40rem] text-[clamp(2rem,5vw,3.25rem)] leading-[1] font-bold tracking-[-0.03em]">
              How it works
            </h2>
            <p className="mt-4 max-w-[40rem] text-lg text-dim">The real sneaker, step by step. Every picture below is what the pipeline actually produced.</p>
            <div className="mt-10">
              <HowItWorks kit={kit} />
            </div>
          </div>
        </section>

        {/* All Cloudinary */}
        <section aria-labelledby="url-title" className="border-t border-line">
          <div className="mx-auto max-w-[90rem] px-4 py-20 sm:px-8 lg:py-28">
            <div className="max-w-[44rem]">
              <h2 id="url-title" className="text-[clamp(2rem,5vw,3.25rem)] leading-[1] font-bold tracking-[-0.03em]">
                The whole stage is one URL
              </h2>
              <p className="mt-4 text-lg text-dim">
                No image editor and no render server. The hero above is this Cloudinary delivery URL, rebuilt in your browser every time you move a slider in the studio.
              </p>
            </div>
            <div className="mt-10">{isBuiltUrl(hero.xray) ? <UrlAnatomy built={hero.xray} /> : null}</div>

            <h3 className="mt-20 font-display text-2xl font-bold tracking-[-0.02em]">Built entirely on Cloudinary</h3>
            <dl className="mt-6 grid gap-x-12 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
              {CLOUDINARY_PARTS.map(([name, what]) => (
                <div key={name} className="border-t border-line pt-4">
                  <dt className="font-semibold text-paper">{name}</dt>
                  <dd className="mt-1 text-[0.95rem] text-dim">{what}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="border-t border-line">
          <div className="mx-auto flex max-w-[90rem] flex-col items-start gap-6 px-4 py-20 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
            <p className="max-w-[36rem] font-display text-[clamp(1.75rem,4vw,2.5rem)] leading-[1.05] font-bold tracking-[-0.025em]">Your next listing is one photo away.</p>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Link href={`/studio?sample=${sample.sku}`} className={buttonVariants({ size: "lg" })}>
                Try a sample product (no signup)
              </Link>
              <Link href="/studio" className={buttonVariants({ size: "lg", variant: "secondary" })}>
                Upload your photo
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
