import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CloudImg } from "@/components/cloud-img";
import { KitShelves } from "@/components/kit/kit-shelves";
import { QaBadge } from "@/components/kit/qa-badge";
import { Receipt } from "@/components/kit/receipt";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { buttonVariants } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/controls";
import { srcSet } from "@/lib/client/img";
import { countAssets } from "@/lib/client/kit-view";
import { loadKit } from "@/lib/client/kit-loader";
import { heroAt, heroLqip, getSample } from "@/lib/showcase";

type Props = { params: Promise<{ sku: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sku } = await params;
  const kit = await loadKit(sku);
  if (!kit) return { title: "Kit not found" };
  const name = kit.product.understanding?.name ?? "Product";
  return {
    title: `${name} kit`,
    description: `${countAssets(kit)} ready-to-post assets made from one photo with Snap2Shelf.`,
    openGraph: { images: [{ url: kit.hero.url, alt: kit.hero.alt }] },
  };
}

export default async function KitPage({ params }: Props) {
  const { sku } = await params;
  const kit = await loadKit(sku);
  if (!kit) notFound();
  const name = kit.product.understanding?.name ?? "Your product";
  const isSample = !!getSample(sku);
  const heroSrc = (w: number) => (isSample ? heroAt(kit, w) : kit.hero.url);

  return (
    <>
      <SiteHeader current="kit" />
      <main id="main">
        <section className="mx-auto grid max-w-[90rem] items-center gap-10 px-4 pt-4 pb-16 sm:px-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)] lg:gap-16 lg:pt-8">
          <div className="mx-auto w-full max-w-[34rem] lg:mx-0 lg:max-w-[min(100%,calc((100dvh-8rem)*0.8))]">
            <CloudImg
              priority
              src={heroSrc(720)}
              srcSet={isSample ? srcSet(heroSrc, [480, 720, 1080]) : undefined}
              sizes="(min-width: 1024px) 40vw, 92vw"
              alt={kit.hero.alt}
              width={1080}
              height={1350}
              placeholder={isSample ? heroLqip(kit) : undefined}
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
              ) : isSample ? (
                <Link href={`/studio?sample=${kit.sku}`} className={buttonVariants({ size: "lg", variant: "secondary" })}>
                  Watch it being made
                </Link>
              ) : null}
            </div>
            {kit.cost.bytesOriginal > 0 ? <Receipt cost={kit.cost} mode={kit.mode} assetCount={countAssets(kit)} className="mt-10" /> : null}
          </div>
        </section>

        <section aria-labelledby="shelf-title" className="mx-auto max-w-[90rem] pb-24">
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
      </main>
      <SiteFooter />
    </>
  );
}
