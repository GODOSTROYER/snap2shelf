import type { Metadata } from "next";
import { SceneLibrary } from "@/components/admin/scene-library";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = { title: "Scene library", robots: { index: false } };

export default function ScenesAdminPage() {
  return (
    <>
      <SiteHeader current="admin" />
      <main id="main" className="mx-auto max-w-[90rem] px-4 pb-24 sm:px-8">
        <h1 className="mt-4 text-[clamp(2rem,5vw,3.25rem)] leading-none font-bold tracking-[-0.03em]">Scene library</h1>
        <p className="mt-3 max-w-[40rem] text-dim">
          Every stage the studio can use. Each was generated once, then read by AI Vision: the dot is where a product&apos;s base lands, the line is the clear surface, and the
          sun shows where the light comes from.
        </p>
        <SceneLibrary />
      </main>
    </>
  );
}
