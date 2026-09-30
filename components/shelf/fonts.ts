import { Fraunces, Inter } from "next/font/google";

/**
 * Shelf + readiness type pairing (self-contained until feat/ui's design system lands):
 * Fraunces for display (warm, editorial serif; also what the OG card uses via l_text),
 * Inter for UI text. Exposed as CSS variables so components fall back gracefully.
 */
export const shelfDisplay = Fraunces({
  subsets: ["latin"],
  variable: "--font-shelf-display",
  display: "swap",
  axes: ["opsz", "SOFT"],
});

export const shelfSans = Inter({
  subsets: ["latin"],
  variable: "--font-shelf-sans",
  display: "swap",
});

export const shelfFontVars = `${shelfDisplay.variable} ${shelfSans.variable}`;
