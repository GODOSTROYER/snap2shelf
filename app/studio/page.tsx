import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { Studio } from "@/components/studio/studio";

export const metadata: Metadata = {
  title: "Studio",
  description: "Turn one product photo into a hero shot, a reel and every channel format.",
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function StudioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  return (
    <>
      <SiteHeader current="studio" />
      <main id="main" className="pb-10">
        <Studio initialSample={first(q.sample)} initialSku={first(q.sku)} />
      </main>
    </>
  );
}
