import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import { FEATURED_KIT, ogImageUrl } from "@/lib/showcase";
import "./globals.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  axes: ["opsz", "wdth"],
  display: "swap",
});

const sans = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
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
    images: [{ url: ogImageUrl(FEATURED_KIT), width: 1200, height: 630, alt: FEATURED_KIT.hero.alt }],
  },
  twitter: { card: "summary_large_image", title: "Snap2Shelf", description },
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
