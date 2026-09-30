import type { MetadataRoute } from "next";
import { DEMO_SHELF } from "@/lib/claims";
import { siteUrl } from "@/lib/shelf/site";
import { LISTED_SAMPLES } from "@/lib/showcase";

/** The public pages: landing, studio, the sample kits and the demo storefront. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/studio`, changeFrequency: "weekly", priority: 0.8 },
    ...LISTED_SAMPLES.map((s) => ({ url: `${base}/kit/${s.sku}`, changeFrequency: "monthly" as const, priority: 0.6 })),
    { url: `${base}${DEMO_SHELF.path}`, changeFrequency: "weekly", priority: 0.6 },
  ];
}
