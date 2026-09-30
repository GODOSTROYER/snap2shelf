import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/shelf/site";

/** Public pages are crawlable; the dev bench, admin, the API and the readiness demo route are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/lab", "/admin", "/api/", "/readiness"] },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
