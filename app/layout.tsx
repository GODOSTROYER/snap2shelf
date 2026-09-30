import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import { siteOgImage } from "@/lib/showcase";
import "./globals.css";

/*
 * Bricolage Grotesque and Hanken Grotesk (OFL), split for a faster first paint.
 * The preloaded "core" files are Google's own latin files cut down, with fontTools,
 * to the characters this site prints (ASCII plus a few marks) — same outlines,
 * metrics, axes and kerning, but 84 KB + 22 KB instead of 131 KB + 35 KB.
 * Every other character falls through to the "Rest" families in globals.css:
 * Google's untouched files under the remaining unicode-ranges, loaded only if a
 * page ever prints one. The fallbacks are next/font's metric-matched Arial.
 * (next/font needs literal options, hence the repeated core range.)
 */
const display = localFont({
  src: "./fonts/bricolage-core.woff2",
  variable: "--font-bricolage",
  weight: "200 800",
  display: "swap",
  declarations: [
    { prop: "font-stretch", value: "75% 100%" },
    { prop: "unicode-range", value: "U+0020-007E, U+00A0, U+00A7, U+00B0, U+00B7, U+00D7, U+00E9, U+2013-2014, U+2018-2019, U+201C-201D, U+2022, U+2026" },
  ],
  adjustFontFallback: false,
  fallback: ["'Bricolage Rest'", "'Bricolage Grotesque Fallback'"],
});

const sans = localFont({
  src: "./fonts/hanken-core.woff2",
  variable: "--font-hanken",
  weight: "100 900",
  display: "swap",
  declarations: [{ prop: "unicode-range", value: "U+0020-007E, U+00A0, U+00A7, U+00B0, U+00B7, U+00D7, U+00E9, U+2013-2014, U+2018-2019, U+201C-201D, U+2022, U+2026" }],
  adjustFontFallback: false,
  fallback: ["'Hanken Rest'", "'Hanken Grotesk Fallback'"],
});

// Only the X-ray panel (actual transformation URLs) uses mono, so don't preload it.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
  preload: false,
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const description = "One photo. A whole shelf. AI builds the stage — your product stays real.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Snap2Shelf — one photo, a whole shelf",
    template: "%s · Snap2Shelf",
  },
  description,
  openGraph: {
    title: "Snap2Shelf",
    description,
    type: "website",
    images: [{ url: siteOgImage(), width: 1200, height: 630, alt: "Snap2Shelf: product photos staged on festive and studio scenes" }],
  },
  twitter: { card: "summary_large_image", title: "Snap2Shelf", description, images: [siteOgImage()] },
};

export const viewport: Viewport = {
  themeColor: "#15110d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <head>
        <link rel="preconnect" href="https://res.cloudinary.com" crossOrigin="" />
      </head>
      <body>{children}</body>
    </html>
  );
}
