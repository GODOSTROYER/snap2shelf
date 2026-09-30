import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CloudImg } from "@/components/cloud-img";
import { CostReceipt } from "@/components/features/cost-receipt";
import { KitShelves } from "@/components/kit/kit-shelves";
import { QaBadge } from "@/components/kit/qa-badge";
import { ReadinessGauge } from "@/components/readiness/ReadinessGauge";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { buttonVariants } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/controls";
import { srcSet } from "@/lib/client/img";
import { countAssets } from "@/lib/client/kit-view";
import { loadKit } from "@/lib/client/kit-loader";
import { sampleCost, sampleReadiness } from "@/lib/client/sample-data";
import type { ReadinessReport } from "@/lib/readiness";
import { measureReadiness } from "@/lib/shelf/measure";
import { getSample, heroAt, heroLqip } from "@/lib/showcase";
import { ogImageUrl } from "@/lib/transform/og";

type Props = { params: Promise<{ sku: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sku } = await params;
  const kit = await loadKit(sku);
  if (!kit) return { title: "Kit not found" };
  const name = kit.product.understanding?.name ?? "Product";
  const description = `${countAssets(kit)} ready-to-post assets made from one phone photo with Snap2Shelf.`;
  const og = kit.hero.publicId ? ogImageUrl({ heroes: [kit.hero.publicId], shopName: name, tagline: `${countAssets(kit)} assets from one photo` }).url : undefined;
  return {
    title: `${name} kit`,
    description,
    openGraph: { title: `${name}: a whole shelf from one photo`, description, images: og ? [{ url: og, width: 1200, height: 630, alt: kit.hero.alt }] : undefined },
    twitter: { card: "summary_large_image", title: `${name} kit`, description, images: og ? [og] : undefined },
  };
}

export default async function KitPage({ params }: Props) {
  const { sku } = await params;
  const kit = await loadKit(sku);
  if (!kit) notFound();
  const name = kit.product.understanding?.name ?? "Your product";
  const sample = getSample(sku);
  const heroSrc = (w: number) => heroAt(kit, w);

  return (
    <>
      <SiteHeader current="kit" />
      <main id="main">
        <section className="mx-auto grid max-w-[90rem] items-center gap-10 px-4 pt-4 pb-16 sm:px-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] lg:gap-16 lg:pt-8">
          <div className="mx-auto w-full max-w-[34rem] lg:mx-0 lg:max-w-[min(100%,calc((100dvh-8rem)*0.8))]">
            <CloudImg
              priority
              src={heroSrc(720)}
              srcSet={srcSet(heroSrc, [480, 720, 1080])}
              sizes="(min-width: 1024px) 40vw, calc(100vw - 2rem)"
              alt={kit.hero.alt}
              width={1080}
              height={1350}
              placeholder={heroLqip(kit)}
              className="aspect-[4/5] w-full rounded-[22px] object-cover shadow-[0_50px_90px_-40px_rgb(0_0_0/0.95)] ring-1 ring-line"
            />
          </div>
          <div className="max-w-[36rem]">
            {kit.hero.qa ? <QaBadge qa={kit.hero.qa} /> : null}
            <h1 className="mt-4 text-[clamp(2.4rem,6vw,4.25rem)] leading-[0.95] font-extrabold tracking-[-0.035em] [font-variation-settings:'wdth'_86,'opsz'_96]">{name}</h1>
            <p className="mt-4 text-lg text-dim">
              {countAssets(kit)} ready-to-post assets, made from one phone photo. The product is the real photo, cut out and staged{kit.scene ? ` in the ${kit.scene.title} scene` : ""}.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/studio" className={buttonVariants({ size: "lg" })}>
                Make a kit for your product
              </Link>
              {kit.zipUrl ? (
                <a href={kit.zipUrl} className={buttonVariants({ size: "lg", variant: "secondary" })}>
                  <Download />
                  Download all (.zip)
                </a>
              ) : sample ? (
                <Link href={`/studio?sample=${kit.sku}`} className={buttonVariants({ size: "lg", variant: "secondary" })}>
                  Watch it being made
                </Link>
              ) : null}
            </div>
            {kit.zipUrl && sample ? (
              <p className="mt-4 text-sm text-dim">
                <Link href={`/studio?sample=${kit.sku}`} className="font-medium text-paper underline decoration-marigold/60 hover:decoration-marigold">
                  Watch this kit being made
                </Link>{" "}
                in the studio, step by step.
              </p>
            ) : null}
            {/* a sample's ledger ships with the page; a live kit's is read from Cloudinary once */}
            <CostReceipt sku={kit.sku} scene={kit.scene?.publicId} initial={sample ? sampleCost(sample) : undefined} className="mt-10 lg:mx-0" />
          </div>
        </section>

        <section aria-labelledby="shelf-title" className="mx-auto max-w-[90rem] pb-20">
          <div className="px-4 sm:px-8">
            <h2 id="shelf-title" className="text-[clamp(1.9rem,4.5vw,3rem)] leading-none font-bold tracking-[-0.03em]">
              Every format
            </h2>
            <p className="mt-3 text-dim">Tap the code button under any asset to see the Cloudinary URL that makes it.</p>
          </div>
          <div className="mt-6">
            <TooltipProvider>
              <KitShelves kit={kit} />
            </TooltipProvider>
          </div>
        </section>

        <Suspense fallback={null}>
          <Readiness sku={kit.sku} isSample={!!sample} />
        </Suspense>
      </main>
      <SiteFooter />
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
  return (
    <section aria-label="Marketplace readiness" className="mx-auto max-w-[90rem] px-4 pb-24 sm:px-8">
      <ReadinessGauge report={report} className="max-w-[60rem]" />
    </section>
  );
}
