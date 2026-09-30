import { Noto_Sans_Devanagari } from "next/font/google";

/**
 * Devanagari for the Hindi offer line: the same family the pack's l_text overlay
 * renders with, so what the seller reads here is what ends up on the image.
 * Latin glyphs stay in the display face (it comes first in the stack).
 */
export const devanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  weight: ["500", "700"],
  display: "swap",
  preload: false,
  variable: "--font-deva",
});
