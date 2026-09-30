import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { CloudImg } from "@/components/cloud-img";
import { StaticShelves } from "@/components/kit/static-shelves";
import { QaBadge } from "@/components/kit/qa-badge";
import { BeforeAfter } from "@/components/landing/before-after";
import { UrlAnatomy } from "@/components/landing/url-anatomy";
import { PhoneButton } from "@/components/phone/phone-button";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { buttonVariants } from "@/components/ui/button";
import { isBuiltUrl, publicUrl, srcSet } from "@/lib/client/img";
import { countAssets } from "@/lib/client/kit-view";
import { cn } from "@/lib/client/util";
import { CREATIVE_APPROVED, CREATIVE_REJECTED, FEATURED_KIT, heroAt, rawAt, SAMPLES } from "@/lib/showcase";

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
              One photo.
              <br />
              A whole shelf.
            </h1>
            <p className="mt-6 font-display text-[clamp(1.25rem,3.4vw,1.6rem)] leading-snug font-medium text-paper">
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
            <figcaption className="mt-4 text-sm text-dim">Drag to compare. The sneaker is the same pixels; only the stage is new.</figcaption>
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
            <ol className="mt-12 grid gap-x-12 gap-y-14 md:grid-cols-2">
              <Step n={1} title="Snap">
                Upload a photo, or scan a QR code and take one with your phone. Any background, any light.
              </Step>
              <Step n={2} title="Stage">
                Your product is cut out once and placed on a ready-made scene. AI Vision has already measured where each scene&apos;s surface is and where its light comes
                from, so the shadow falls the right way.
              </Step>
              <Step n={3} title="Check">
                <>
                  AI Vision compares every result with your photo. Anything that changed the product is rejected, even when it looks good.
                  <QaProof />
                </>
              </Step>
              <Step n={4} title="Ship">
                A feed post, story, web banner, marketplace image, chat catalog tile, colour variants, a Hindi and English offer and a short reel. Download them all at once.
              </Step>
            </ol>
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

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[2.5rem_1fr] gap-x-4">
      <span aria-hidden className="font-display text-4xl leading-none font-extrabold text-marigold">
        {n}
      </span>
      <div>
        <h3 className="font-display text-2xl font-bold tracking-[-0.02em]">{title}</h3>
        <div className="mt-2 max-w-[34rem] text-[1.05rem] text-dim">{children}</div>
      </div>
    </li>
  );
}

function QaProof() {
  const pair = [CREATIVE_APPROVED, CREATIVE_REJECTED];
  return (
    <span className="mt-5 grid grid-cols-2 gap-3">
      {pair.map((a) => (
        <span key={a.id} className="block">
          <span className="relative block overflow-hidden rounded-xl ring-1 ring-line">
            <CloudImg src={publicUrl(a.publicId!, { w: 480, h: 600, crop: "c_fill,g_auto" })} alt={a.alt} width={1080} height={1350} className="aspect-[4/5] w-full object-cover" />
            <QaBadge qa={a.qa!} className="absolute top-2 left-2 bg-studio/85 backdrop-blur-sm" />
          </span>
          <span className="mt-2 block text-[0.85rem] leading-snug text-dim">
            {a.qa!.status === "approved" ? "Kept: " : "Caught: "}
            {a.qa!.reasons.join(", ").toLowerCase()}.
          </span>
        </span>
      ))}
    </span>
  );
}
