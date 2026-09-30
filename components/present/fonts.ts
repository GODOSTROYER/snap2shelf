import { Bricolage_Grotesque, Fraunces, Hanken_Grotesk, JetBrains_Mono, Noto_Sans_Devanagari } from "next/font/google";

/**
 * Type for the director's cut and the video cards. Same families as the
 * product UI (Bricolage for display, Hanken for text) so the recorded video and
 * the live app read as one brand. Mono is only for real URLs and measurements;
 * Devanagari matches the font Cloudinary renders the offer overlays in.
 */
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--pz-font-display",
  axes: ["opsz", "wdth"],
  display: "swap",
});

const text = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--pz-font-text",
  display: "swap",
});

// only the URL X-ray, DNA readout and receipt use these two: don't preload them
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--pz-font-mono",
  display: "swap",
  preload: false,
});

const devanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  variable: "--pz-font-deva",
  display: "swap",
  preload: false,
});

// the live shelf's display serif, so the shelf chapter shows /shelf/demo-studio as it really looks
const shelf = Fraunces({
  subsets: ["latin"],
  variable: "--pz-font-shelf",
  axes: ["opsz", "SOFT"],
  display: "swap",
});

export const presentFontVars = [display.variable, text.variable, mono.variable, devanagari.variable, shelf.variable].join(" ");
