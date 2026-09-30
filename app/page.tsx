/* eslint-disable @next/next/no-img-element -- Cloudinary delivery URLs, already sized and formatted (f_auto,q_auto) */
import { ArrowUpRight, Store, Timer } from "lucide-react";
import Link from "next/link";
import { StaticShelves } from "@/components/kit/static-shelves";
import { BeforeAfter } from "@/components/landing/before-after";
import { KitStrip } from "@/components/landing/hero/kit-strip";
import { HowItWorks } from "@/components/landing/how-it-works";
import { UrlAnatomy } from "@/components/landing/url-anatomy";
import { PhoneButton } from "@/components/phone/phone-button";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { buttonVariants } from "@/components/ui/button";
import { DEMO_SHELF, PHOTO_TO_KIT_COPY, PHOTO_TO_KIT_MEASURED_COPY, SAMPLE_PHOTO_DISCLOSURE, SAMPLE_PHOTO_LABEL } from "@/lib/claims";
import { isBuiltUrl, sizedUrl, srcSet } from "@/lib/client/img";
import { kitContents } from "@/lib/client/kit-view";
import { FEATURED, heroAt, landingBeforeAt, landingBeforeLqip, lqipOf } from "@/lib/showcase";

/** One product, end to end: the hero, how it works, its URL, its kit on the shelves, and every "Try a sample". */
const sample = FEATURED;
const kit = sample.kit;
const noun = (kit.product.understanding?.name ?? "product").toLowerCase();
const tryHref = `/studio?sample=${sample.sku}`;
const SIZES = "(min-width: 1440px) 620px, (min-width: 1024px) 40vw, (min-width: 640px) 34rem, calc(100vw - 2rem)";

/** Section titles: the condensed display cut of the headline (Bricolage Grotesque's wdth and opsz axes). */
const H2 = "text-[clamp(2rem,5vw,3.25rem)] leading-[0.95] font-extrabold tracking-[-0.03em] [font-variation-settings:'wdth'_84,'opsz'_96]";

/** What the app uses, and the real parameter or endpoint it calls (lib/transform, lib/server, lib/cloudinary). */
const CLOUDINARY_PARTS: readonly (readonly [name: string, params: readonly string[], what: string])[] = [
  ["Upload Widget and signed uploads", ["upload_preset", "signature"], "Photos go straight from the laptop or phone to Cloudinary."],
  ["Background removal", ["e_background_removal", "e_trim"], "Cuts the product out once; every shot reuses that cut-out."],
  ["AI Vision", ["ai_vision_general", "ai_vision_tagging"], "Reads the product, maps each scene's surface and light, and runs the QA check."],
  ["Image Generation", ["text_to_image", "image_to_image"], "Builds the scene library once, and powers Creative mode."],
  ["Layers and effects", ["l_", "e_distort", "e_multiply"], "The hero itself: cut-out, contact and cast shadows, light-match, placed by URL."],
  ["Generative fill and recolor", ["b_gen_fill", "e_gen_recolor"], "Stretches the hero to story and banner sizes, and makes colour variants."],
  ["Text overlays with Google fonts", ["l_text", "@google"], "Festive offers in Hindi and English, no font uploads."],
  ["Video from stills", ["e_zoompan", "fl_splice"], "The Kit Reel is spliced from the stored formats, straight from a URL."],
  ["Archives and automatic format", ["download_zip_url", "f_auto,q_auto"], "One zip for every image; each one in the lightest format the browser supports."],
];

/** A ~1 KB blurred copy, inlined so the hero never paints as an empty box. */
async function inlineLqip(url: string): Promise<string> {
  const jpg = url.replace("/f_auto/", "/f_jpg/");
  try {
    const res = await fetch(jpg, { signal: AbortSignal.timeout(2500), cache: "force-cache" });
    if (!res.ok) return jpg;
    return `data:image/jpeg;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  } catch {
    return jpg;
  }
}

export default async function Home() {
  const hero = kit.hero;
  const find = (id: string) => kit.assets.find((a) => a.id === id || a.id.startsWith(id));
  // front to back: the offer (text), a colour variant, the marketplace white
  const fan = [find("offer"), find("recolor-"), find("marketplace")].filter((a): a is NonNullable<typeof a> => !!a);
  const beforeLqip = landingBeforeLqip(sample);
  const [heroPh, beforePh] = await Promise.all([inlineLqip(lqipOf(sample.heroPublicId)), beforeLqip ? inlineLqip(beforeLqip) : Promise.resolve(undefined)]);
  // No preload(): the hero <img> is in the server HTML with fetchpriority=high, and a
  // preload hint here would ride along in every prefetch of "/" and warn on other pages.

  return (
    <>
      <SiteHeader current="home" />
      <main id="main">
        {/*
          Hero, acting out the headline: one photo (the compare), then a whole shelf (the kit,
          dealt out of the hero onto the strip below). On phones the picture sits between the
          promise and the buttons; on wide screens the hero leaves room for the strip on screen.
        */}
        <section className="mx-auto grid max-w-[90rem] gap-x-10 gap-y-3.5 overflow-x-clip px-4 pt-1 pb-16 lg:[--hero-chrome:calc(15.25rem+var(--sh))] lg:[--sh:clamp(4.5rem,10dvh,6.25rem)] [grid-template-areas:'title'_'figure'_'act'_'strip'] sm:gap-y-8 sm:px-8 sm:pt-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:grid-rows-[1fr_auto_auto_1fr_auto] lg:gap-x-16 lg:gap-y-0 lg:pt-4 lg:pb-16 lg:[grid-template-areas:'._figure'_'title_figure'_'act_figure'_'._figure'_'strip_strip']">
          <div className="max-w-[40rem] [grid-area:title]">
            <h1 className="text-[clamp(3.25rem,15vw,8rem)] leading-[0.86] font-extrabold tracking-[-0.03em] [font-variation-settings:'wdth'_84,'opsz'_96] lg:text-[clamp(5rem,min(9vw,14dvh),8rem)]">
              <span className="rise block">One photo.</span>
              <span className="rise block [animation-delay:110ms]">A whole shelf.</span>
            </h1>
            <p className="rise mt-2.5 font-display text-[clamp(0.98rem,4.1vw,1.6rem)] leading-snug font-medium text-paper [animation-delay:220ms] sm:mt-6 lg:mt-5">
              AI builds the stage — your product stays real.
            </p>
          </div>

          <figure className="relative mx-auto w-full max-w-[34rem] [grid-area:figure] lg:mr-0 lg:max-w-[min(100%,34rem,max(22rem,calc((100dvh-var(--hero-chrome))*0.8)))] lg:self-center">
            {/* the rest of the kit, fanned out from behind the hero (wide screens) */}
            <div aria-hidden className="pointer-events-none absolute inset-0 hidden xl:block">
              {fan.map((a, i) => {
                const pose = [
                  { left: "-34%", top: "33%", w: "33%", r: "-3deg", z: 3 },
                  { left: "-30%", top: "6%", w: "30%", r: "-8deg", z: 2 },
                  { left: "-28%", top: "67%", w: "27%", r: "-12deg", z: 1 },
                ][i];
                return (
                  <img
                    key={a.id}
                    src={sizedUrl(a, 360)}
                    alt=""
                    width={a.width}
                    height={a.height}
                    loading="lazy"
                    decoding="async"
                    className="fan-card absolute rounded-xl bg-stage-2 shadow-[0_30px_60px_-20px_rgb(0_0_0/0.95)] ring-1 ring-white/10"
                    style={{ left: pose.left, top: pose.top, width: pose.w, rotate: pose.r, zIndex: pose.z, "--i": i } as React.CSSProperties}
                  />
                );
              })}
            </div>
            <div aria-hidden className="pointer-events-none absolute -inset-[8%] -z-10 bg-[radial-gradient(closest-side,rgb(245_165_36/0.16),transparent)]" />
            <div className="relative z-10">
              <BeforeAfter
                width={1080}
                height={1350}
                sizes={SIZES}
                beforeLabel={SAMPLE_PHOTO_LABEL}
                before={{
                  src: landingBeforeAt(sample, 720),
                  srcSet: srcSet((w) => landingBeforeAt(sample, w)),
                  alt: `${SAMPLE_PHOTO_LABEL}, an AI-generated test image: ${sample.product.caption?.replace(/\.$/, "").replace(/^A /, "a ") ?? "the product"}`,
                  placeholder: beforePh,
                }}
                after={{ src: heroAt(kit, 720), srcSet: srcSet((w) => heroAt(kit, w)), alt: hero.alt, placeholder: heroPh }}
              />
            </div>
            {/* the hero stands on the same lit shelf as everything it produces */}
            <div aria-hidden className="shelf-ledge relative z-10 -mx-3 -mt-1 sm:-mx-6" />
            <figcaption className="mt-3 hidden gap-1.5 text-sm text-dim sm:mt-3.5 sm:grid">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="rounded-t-[2px] rounded-b-[5px] bg-paper px-2 py-1 text-[0.75rem] leading-none font-semibold text-studio shadow-[0_6px_14px_-6px_rgb(0_0_0/0.8)]">
                  Hero 4:5 <span className="tabular ml-1 font-medium text-studio/60">1080 × 1350</span>
                </span>
                <span>
                  <span className="lg:hidden">Drag to compare. </span>Same product pixels, new stage.
                </span>
              </span>
              <span className="hidden text-[0.8rem] leading-snug text-faint lg:block">{SAMPLE_PHOTO_DISCLOSURE}</span>
            </figcaption>
          </figure>

          <div className="flex max-w-[40rem] flex-col [grid-area:act]">
            <p className="mt-6 hidden max-w-[33rem] text-lg text-dim sm:block lg:mt-5">
              Snap one product photo. Snap2Shelf cuts it out, stages it on a festive or studio scene with matching shadows, checks that nothing about your product changed, then
              turns it into every format your shop and socials need, in {PHOTO_TO_KIT_COPY}.
            </p>
            <p className="order-last mt-3 flex items-center gap-2 text-[0.8rem] leading-snug text-faint sm:order-none sm:text-sm">
              <Timer aria-hidden className="size-4 shrink-0 text-marigold" />
              {PHOTO_TO_KIT_MEASURED_COPY}
            </p>
            <div className="mt-1 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap lg:mt-6">
              <Link href={tryHref} className={buttonVariants({ size: "lg" })}>
                Try a sample product (no signup)
              </Link>
              <PhoneButton size="lg" />
            </div>
            <p className="mt-2 text-sm text-dim sm:mt-3">
              Have a photo on this device?{" "}
              <Link href="/studio" className="inline-flex min-h-11 items-center font-medium text-paper underline decoration-marigold/60 hover:decoration-marigold">
                Upload it in the studio
              </Link>
            </p>
            <p className="order-last mt-1 text-[0.8rem] leading-snug text-faint lg:hidden">{SAMPLE_PHOTO_DISCLOSURE}</p>
          </div>

          <KitStrip kit={kit} href="#kit" className="mt-10 [grid-area:strip] lg:mt-6" />
        </section>

        {/* How it works: the same photo, step by step */}
        <section id="how" aria-labelledby="how-title" className="below-fold scroll-mt-4 border-t border-line [contain-intrinsic-size:auto_900px]">
          <div className="mx-auto max-w-[90rem] px-4 py-20 sm:px-8 lg:py-28">
            <h2 id="how-title" className={`max-w-[40rem] ${H2}`}>
              How it works
            </h2>
            <p className="mt-4 max-w-[40rem] text-lg text-dim">
              The same {noun}, from photo to finished kit. Every picture below is what the pipeline actually produced.
            </p>
            <div className="mt-10">
              <HowItWorks kit={kit} />
            </div>
          </div>
        </section>

        {/* The whole stage is one URL */}
        <section aria-labelledby="url-title" className="below-fold border-t border-line [contain-intrinsic-size:auto_1400px]">
          <div className="mx-auto max-w-[90rem] px-4 py-20 sm:px-8 lg:py-28">
            <div className="max-w-[44rem]">
              <h2 id="url-title" className={H2}>
                The whole stage is one URL
              </h2>
              <p className="mt-4 text-lg text-dim">
                No image editor and no render server. The picture here is one Cloudinary delivery URL: the hero from the top of the page, rebuilt in your browser every time
                you move a slider in the studio.
              </p>
            </div>
            <div className="mt-10">
              {isBuiltUrl(hero.xray) ? (
                <UrlAnatomy
                  built={hero.xray}
                  alt={hero.alt}
                  note={
                    <>
                      Each <code className="font-mono text-[0.9em] break-all text-paper/90">l_{kit.product.cutout?.publicId.replaceAll("/", ":")}</code> layer is this sample{" "}
                      {noun}&apos;s cut-out, stored once on the demo cloud. A kit from your own photo layers your own cut-out.
                    </>
                  }
                />
              ) : null}
            </div>

            <h3 className="mt-20 font-display text-2xl font-bold tracking-[-0.02em]">Built entirely on Cloudinary</h3>
            <dl className="mt-6 grid gap-x-12 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
              {CLOUDINARY_PARTS.map(([name, params, what]) => (
                <div key={name} className="border-t border-line pt-4">
                  <dt className="font-semibold text-paper">{name}</dt>
                  <dd className="mt-2 flex flex-wrap gap-1.5">
                    {params.map((p) => (
                      <code key={p} className="rounded-md bg-stage-2 px-1.5 py-0.5 font-mono text-[0.78rem] leading-5 text-marigold-hi ring-1 ring-line ring-inset">
                        {p}
                      </code>
                    ))}
                  </dd>
                  <dd className="mt-2 text-[0.95rem] text-dim">{what}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* The kit: every format, where it will live */}
        <section id="kit" aria-labelledby="shelf-title" className="below-fold scroll-mt-4 border-t border-line [contain-intrinsic-size:auto_1500px]">
          <div className="mx-auto max-w-[90rem] pt-20 pb-24 lg:pt-28">
            <div className="flex flex-col gap-4 px-4 sm:flex-row sm:items-end sm:justify-between sm:px-8">
              <div className="max-w-[40rem]">
                <h2 id="shelf-title" className={H2}>
                  {kitContents(kit)} from one photo
                </h2>
                <p className="mt-4 text-lg text-dim">
                  The finished kit from that photo, each asset shown where it will live. Every one is a Cloudinary transformation of the same approved hero.
                </p>
              </div>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <Link href={`/kit/${sample.sku}`} className={buttonVariants({ variant: "secondary" })}>
                  Open this kit
                  <ArrowUpRight />
                </Link>
                <Link href={DEMO_SHELF.path} prefetch={false} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-paper underline decoration-marigold/60 underline-offset-4 hover:decoration-marigold">
                  <Store aria-hidden className="size-4 text-marigold" />
                  See a shop built from the sample products
                </Link>
              </div>
            </div>
            {/* on wide screens each shelf's ledge is only as long as its row of cards */}
            <div className="mt-8 lg:[&_section]:w-fit">
              <StaticShelves kit={kit} />
            </div>
          </div>
        </section>

        <section className="border-t border-line">
          <div className="mx-auto flex max-w-[90rem] flex-col items-start gap-6 px-4 py-20 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
            <p className="max-w-[36rem] font-display text-[clamp(1.75rem,4vw,2.5rem)] leading-[1.05] font-extrabold tracking-[-0.025em] [font-variation-settings:'wdth'_84,'opsz'_96]">
              Your next listing is one photo away.
            </p>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Link href="/studio" className={buttonVariants({ size: "lg" })}>
                Upload your photo
              </Link>
              <Link href={tryHref} className={buttonVariants({ size: "lg", variant: "secondary" })}>
                Try a sample first
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
