import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { LabBench } from "./lab-bench";

export const metadata: Metadata = {
  title: "Features lab",
  robots: { index: false, follow: false },
};

/**
 * A development bench: it calls live routes, so production answers 404 unless
 * S2S_LAB=1 is set on the deployment on purpose. Nothing on it runs until clicked.
 */
const labOpen = () => process.env.NODE_ENV !== "production" || process.env.S2S_LAB === "1";

/** Verification bench for the pipeline v2 studio components (not linked from the site). */
export default function LabPage() {
  if (!labOpen()) notFound();
  return (
    <>
      <SiteHeader current="admin" />
      <main id="main" className="mx-auto max-w-[90rem] px-4 pb-24 sm:px-8">
        <h1 className="mt-4 text-[clamp(2rem,5vw,3.25rem)] leading-none font-bold tracking-[-0.03em]">Features lab</h1>
        <p className="mt-3 max-w-[44rem] text-dim">
          The four new studio steps, wired together in studio order against real processed products. Library scenes are reused, so nothing on this page generates a new
          image; the one generation preview at the bottom is simulated in the browser. Nothing that spends AI runs until you press its button.
        </p>
        <LabBench />
      </main>
    </>
  );
}
