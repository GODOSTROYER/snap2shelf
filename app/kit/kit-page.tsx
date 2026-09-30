import { ArrowUpRight, Download, Store } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Suspense } from "react";
import { CloudImg } from "@/components/cloud-img";
import { KitPageShelves } from "@/components/kit/kit-page-shelves";
import { LazyReadiness, LazyReceipt } from "@/components/kit/lazy-panels";
import { QaBadge } from "@/components/kit/qa-badge";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { buttonVariants } from "@/components/ui/button";
import { DEMO_SHELF, FIDELITY_CLAIM, KIT_REDIRECTS, SAMPLE_PHOTO_DISCLOSURE, SAMPLE_PHOTO_LABEL, sampleTimeNote } from "@/lib/claims";
import { srcSet } from "@/lib/client/img";
import { kitContents, zipLabel } from "@/lib/client/kit-view";
import { loadKit } from "@/lib/client/kit-loader";
import { sampleCost, sampleReadiness } from "@/lib/client/sample-data";
import type { ReadinessReport } from "@/lib/readiness";
import { zipUrl } from "@/lib/server/pack";
import { measureReadiness } from "@/lib/shelf/measure";
import { getSample, heroAt, heroLqip, productName } from "@/lib/showcase";
import { ogImageUrl } from "@/lib/transform/og";

const textLink = "inline-block py-1 font-medium text-paper underline decoration-marigold/60 underline-offset-4 hover:decoration-marigold";

/**
 * /kit/<sku>, shared by two kinds of route:
 *  - app/kit/<sample>/page.tsx: one static folder per sample kit (they ship with the site,
 *    data/showcase.json), prerendered at build and served as static HTML, no render per visit;
 *  - app/kit/[sku]/page.tsx: every other (live) kit, rendered on request from Cloudinary's lists.
 * A static segment wins over [sku], so a sample never reaches the dynamic route.
 * A new sample works without a folder too (dynamically); give it one to make it static.
 */

/** A kit link that moved for good (lib/claims.ts KIT_REDIRECTS): 308 to its new home. */
function redirectMoved(sku: string) {
  const to = KIT_REDIRECTS[sku];
  if (to) permanentRedirect(`/kit/${to}`);
}

export async function kitMetadata(sku: string): Promise<Metadata> {
  redirectMoved(sku);
  const kit = await loadKit(sku);
  if (!kit) return { title: "Kit not found" };
  const name = productName(sku, kit.product.understanding?.name ?? "Product");
  const sample = getSample(sku);
  const description = `${kitContents(kit)}, ready to post, made from one ${sample ? `sample photo (${sample.blurb.toLowerCase()})` : "photo"} with Snap2Shelf.`;
  const og = kit.hero.publicId ? ogImageUrl({ heroes: [kit.hero.publicId], shopName: name, tagline: `${kitContents(kit)} from one photo` }).url : undefined;
  return {
    title: `${name} kit`,
    description,
    openGraph: { title: `${name}: a whole shelf from one photo`, description, images: og ? [{ url: og, width: 1200, height: 630, alt: kit.hero.alt }] : undefined },
    twitter: { card: "summary_large_image", title: `${name} kit`, description, images: og ? [og] : undefined },
  };
}

export async function KitPage({ sku }: { sku: string }) {
  redirectMoved(sku);
  const kit = await loadKit(sku);
  if (!kit) notFound();
  const sample = getSample(sku);
  const name = sample ? sample.title : productName(sku, kit.product.understanding?.name ?? "Your product");
  const heroSrc = (w: number) => heroAt(kit, w);
  // a saved kit's pack downloads as one zip: signed here (no API call), valid for an hour
  let zip = kit.zipUrl;
  if (!zip && !sample && kit.assets.length) {
    try {
      zip = zipUrl(kit.sku);
    } catch {
      zip = undefined;
    }
  }
  const staged = kit.scene ? `, staged on the ${kit.scene.title} scene` : "";
  // a sample's ledger ships with the page; a live kit's is read from Cloudinary once
  const sampleLedger = sample ? sampleCost(sample) : undefined;
  const timeNote = sample && sampleLedger ? sampleTimeNote({ seconds: sampleLedger.cost.seconds, qaChecks: sample.qaStory?.attempts ?? 1 }) : undefined;

  return (
    <>
      <Suspense>
        <SiteHeader current="kit" />
      </Suspense>
      <main id="main">
        {/* hero → what to do with it → every format → how it measures → what it cost, on every width.
            Each part is its own Suspense boundary, so React hydrates them in separate, short tasks. */}
        <Suspense>
          <section className="mx-auto grid max-w-[90rem] items-start gap-8 px-4 pt-4 pb-14 sm:px-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] lg:gap-16 lg:pt-8 lg:pb-16">
            <div className="mx-auto w-full max-w-[34rem] lg:sticky lg:top-6 lg:mx-0 lg:max-w-[min(100%,calc((100dvh-8rem)*0.8))]">
              <CloudImg
                priority
                src={heroSrc(720)}
                srcSet={srcSet(heroSrc)}
                sizes="(min-width: 1440px) 39rem, (min-width: 1024px) 43vw, (min-width: 640px) 34rem, calc(100vw - 2rem)"
                alt={kit.hero.alt}
                width={1080}
                height={1350}
                placeholder={heroLqip(kit)}
                className="aspect-[4/5] w-full rounded-[22px] object-cover shadow-[0_50px_90px_-40px_rgb(0_0_0/0.95)] ring-1 ring-line"
              />
            </div>
            <div className="max-w-[36rem] lg:pt-4">
              {kit.hero.qa ? <QaBadge qa={kit.hero.qa} /> : null}
              <h1 className="mt-4 text-[clamp(2.4rem,6vw,4.25rem)] leading-[0.95] font-extrabold tracking-[-0.035em] [font-variation-settings:'wdth'_86,'opsz'_96]">
                {name}
              </h1>
              <p className="mt-4 text-lg text-dim">
                {kitContents(kit)}, ready to post, from one {sample ? `sample photo (${sample.blurb.toLowerCase()})` : "photo"}
                {staged}. {FIDELITY_CLAIM}
              </p>
              {sample ? (
                <p className="mt-4 flex gap-2.5 rounded-xl bg-stage-2 px-3.5 py-2.5 text-[0.85rem] leading-snug text-dim ring-1 ring-line ring-inset">
                  <span aria-hidden className="mt-[0.45em] size-1.5 shrink-0 rounded-full bg-marigold" />
                  {SAMPLE_PHOTO_DISCLOSURE}
                </p>
              ) : null}
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                {zip ? (
                  <a href={zip} className={buttonVariants({ size: "lg" })}>
                    <Download />
                    {zipLabel(kit)}
                  </a>
                ) : sample ? (
                  <Link href={`/studio?sample=${kit.sku}`} className={buttonVariants({ size: "lg" })}>
                    Watch it being made
                  </Link>
                ) : null}
                <Link href="/studio" className={buttonVariants({ size: "lg", variant: zip || sample ? "secondary" : undefined })}>
                  Make a kit for your product
                </Link>
              </div>
              <ul className="mt-4 grid gap-1 text-sm text-dim">
                {zip && kit.reel ? <li>The zip holds every image; the reel plays from its Cloudinary URL.</li> : null}
                {zip && sample ? (
                  <li>
                    <Link href={`/studio?sample=${kit.sku}`} className={textLink}>
                      Watch this kit being made
                    </Link>{" "}
                    in the studio, step by step.
                  </li>
                ) : null}
                <li>
                  <Link href={DEMO_SHELF.path} prefetch={false} className={`${textLink} inline-flex items-center gap-1.5`}>
                    <Store aria-hidden className="size-4 text-marigold" />
                    See a shop built from the sample products
                    <ArrowUpRight aria-hidden className="size-4" />
                  </Link>
                </li>
              </ul>
            </div>
          </section>
        </Suspense>

        <section aria-labelledby="shelf-title" className="mx-auto max-w-[90rem] pb-16">
          <div className="px-4 sm:px-8">
            <h2 id="shelf-title" className="text-[clamp(1.9rem,4.5vw,3rem)] leading-none font-bold tracking-[-0.03em]">
              Every format
            </h2>
            <p className="mt-3 text-dim">Tap the code button under any asset to see the Cloudinary URL that makes it.</p>
          </div>
          <div className="mt-6">
            <KitPageShelves kit={kit} />
          </div>
        </section>

        <section aria-label="How this kit measures, and what it cost" className="mx-auto grid max-w-[90rem] items-start gap-10 px-4 pb-24 sm:px-8 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-12">
          <Suspense fallback={null}>
            <Readiness sku={kit.sku} isSample={!!sample} />
          </Suspense>
          <LazyReceipt sku={kit.sku} scene={kit.scene?.publicId} initial={sampleLedger} replay={timeNote} date={kit.createdAt} className="lg:col-start-2 lg:row-start-1 lg:mx-0" />
        </section>
      </main>
      <Suspense>
        <SiteFooter />
      </Suspense>
    </>
  );
}

/** The marketplace image, measured: a sample's stored reading, or a live kit's (cached AI Vision verdict only). */
async function Readiness({ sku, isSample }: { sku: string; isSample: boolean }) {
  let report: ReadinessReport | null = null;
  try {
    report = isSample ? await sampleReadiness(sku) : (await measureReadiness(sku, { vision: false })).report;
  } catch {
    report = null; // not measurable right now: the kit page stands without it
  }
  if (!report || !report.checks.length) return null;
  return <LazyReadiness report={report} photoLabel={isSample ? SAMPLE_PHOTO_LABEL : undefined} className="lg:col-start-1 lg:row-start-1" />;
}
