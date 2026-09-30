import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Backdrop } from "@/components/shelf/Backdrop";
import { shelfFontVars } from "@/components/shelf/fonts";
import { Reveal } from "@/components/shelf/Reveal";
import { ShareBar } from "@/components/shelf/ShareBar";
import { ShelfGrid, type ShelfCard } from "@/components/shelf/ShelfGrid";
import { XrayNote } from "@/components/shelf/XrayNote";
import { mainCloud } from "@/lib/server/cld";
import { HERO_XRAY, heroSrcSet, heroUrl } from "@/lib/shelf/images";
import { getShelf, lqipDataUri, shelfOg } from "@/lib/shelf/server";
import { absoluteUrl, siteUrl } from "@/lib/shelf/site";
import { checkShop, shelfPath, whatsappShareUrl } from "@/lib/shelf/slug";
import type { Shelf, ShelfItem } from "@/lib/shelf/types";
import { DEMO_SHELF, FIDELITY_CLAIM, TAGLINE } from "@/lib/claims";
import { productName } from "@/lib/showcase";
import { SCENE_THEMES } from "@/lib/types";

/** ISR: the shelf re-renders at most once a minute; POST /api/shelf revalidates it immediately. */
export const revalidate = 60;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

type Params = { params: Promise<{ shop: string }> };

/** One Admin API lookup per render, shared by generateMetadata and the page. */
const loadShelf = cache(async (shop: string): Promise<Shelf | null> => {
  const shelf = checkShop(shop).ok ? await getShelf(shop) : null;
  // sample kits go by their canonical names (lib/claims.ts), not AI Vision's generic reading
  return shelf ? { ...shelf, items: shelf.items.map((i) => ({ ...i, name: productName(i.sku, i.name) })) } : null;
});

const sceneLabel = (slug?: string) => SCENE_THEMES.find((t) => slug?.startsWith(t.slug))?.label.toLowerCase();

function altFor(item: ShelfItem): string {
  const scene = sceneLabel(item.scene);
  return [item.name, item.facts?.toLowerCase(), scene ? `staged in a ${scene} scene` : ""].filter(Boolean).join(", ");
}

function shareMessage(shelf: Shelf): string {
  const names = shelf.items.slice(0, 3).map((i) => i.name.toLowerCase());
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  return `${shelf.title}: ${shelf.tagline ?? `${list} and more`}. Take a look at the shelf 👇`;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { shop } = await params;
  const shelf = await loadShelf(shop);
  if (!shelf) return { title: "Shelf not found", robots: { index: false } };
  const og = shelfOg(shelf).url;
  const url = absoluteUrl(shelfPath(shop));
  const n = shelf.items.length;
  const description = shelf.tagline ?? `${n} ${n === 1 ? "product" : "products"} on one shelf, staged with Snap2Shelf.`;
  const alt = `${shelf.title}: ${shelf.items.map((i) => i.name).join(", ")}`;
  return {
    metadataBase: new URL(siteUrl()),
    title: shelf.title, // the root layout adds " · Snap2Shelf"
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", url, siteName: "Snap2Shelf", title: shelf.title, description, images: [{ url: og, width: 1200, height: 630, alt, type: "image/jpeg" }] },
    twitter: { card: "summary_large_image", title: shelf.title, description, images: [{ url: og, alt }] },
  };
}

export default async function ShelfPage({ params }: Params) {
  const { shop } = await params;
  const shelf = await loadShelf(shop);
  if (!shelf) notFound();

  const cloud = mainCloud();
  const url = absoluteUrl(shelfPath(shop));
  const og = shelfOg(shelf);
  const lqips = await Promise.all(shelf.items.map((i) => lqipDataUri(i.heroPublicId, i.version, i.geo)));
  const cards: ShelfCard[] = shelf.items.map((i, n) => ({
    sku: i.sku,
    name: i.name,
    facts: i.facts,
    alt: altFor(i),
    src: heroUrl(i.heroPublicId, 720, { version: i.version, cloud, geo: i.geo }),
    srcSet: heroSrcSet(i.heroPublicId, { version: i.version, cloud, geo: i.geo }),
    width: 800,
    height: 1000,
    lqip: lqips[n],
    askHref: whatsappShareUrl(`Hi! I'd like to know more about the ${i.name} on ${shelf.title}.`, `${url}#p-${i.sku}`),
  }));
  const count = shelf.items.length;

  return (
    <div className={`${shelfFontVars} relative min-h-dvh font-[family-name:var(--font-shelf-sans)] text-[#f4efe7] antialiased`}>
      <Backdrop />
      <a
        href="#shelf"
        className="sr-only z-50 rounded-full bg-[#f5a524] px-4 py-2 font-semibold text-[#1a1208] focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to products
      </a>

      <header className="mx-auto max-w-6xl px-4 pt-5 sm:px-8 sm:pt-8">
        {/* the shop's own page: no Snap2Shelf wordmark up here, the footer credits it */}
        <div className="flex items-center justify-end">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#f4efe7]/12 bg-[#f4efe7]/[0.04] px-3 py-1.5 text-xs font-medium text-[#a89f92]">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#f5a524] opacity-70 motion-safe:animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#f5a524]" />
            </span>
            Live shelf
          </span>
        </div>

        <div className="mt-12 grid gap-8 sm:mt-20 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-12">
          <Reveal>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#f5a524]">
              Shop · {count} {count === 1 ? "product" : "products"}
            </p>
            <h1 className="mt-4 break-words font-[family-name:var(--font-shelf-display)] text-[clamp(2.75rem,12vw,6.75rem)] font-semibold leading-[0.9] tracking-[-0.035em] [font-variation-settings:'SOFT'_50,'opsz'_144]">
              {shelf.title}
            </h1>
            {shelf.tagline && <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-[#a89f92] sm:text-lg">{shelf.tagline}</p>}
          </Reveal>
          <Reveal delay={0.12}>
            <ShareBar shareUrl={url} title={shelf.title} message={shareMessage(shelf)} />
          </Reveal>
        </div>
      </header>

      <div aria-hidden className="mx-auto mt-10 max-w-6xl px-4 sm:mt-14 sm:px-8">
        <div className="h-px bg-gradient-to-r from-transparent via-[#f5a524]/45 to-transparent" />
      </div>

      <main id="shelf" className="mx-auto mt-10 max-w-6xl scroll-mt-6 px-4 sm:mt-14 sm:px-8">
        <h2 className="sr-only">Products</h2>
        <ShelfGrid items={cards} />
      </main>

      <footer className="mx-auto mt-20 max-w-6xl space-y-6 px-4 pb-12 sm:mt-28 sm:px-8">
        <XrayNote
          count={count}
          ogUrl={og.url}
          ogLayers={og.segments.filter((s) => s.kind === "layer" || s.kind === "text").length}
          heroTransformation={HERO_XRAY}
        />
        <p className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-[#a89f92]">
          <span>
            Made with{" "}
            <Link href="/" className="font-medium text-[#f4efe7] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f5a524]">
              Snap2Shelf
            </Link>{" "}
            · {TAGLINE}
          </span>
          <span className="text-[#a89f92]/70">
            {shop === DEMO_SHELF.slug
              ? `Sample products from AI-generated test photos. ${FIDELITY_CLAIM}`
              : FIDELITY_CLAIM}
          </span>
        </p>
      </footer>
    </div>
  );
}
