/**
 * Absolute origin for share links and OG metadata. NEXT_PUBLIC_SITE_URL wins
 * (set per deployment); Vercel's production host is the fallback; local dev last.
 * The share bar re-reads window.location on the client, so dev ports are right too.
 */
export function siteUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env && /^https?:\/\//.test(env)) return env.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}

export const absoluteUrl = (path: string) => `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
