import type { ProductUnderstanding } from "../types";

/** Colour-variant presets (hex without '#', as PackRequest.recolor expects). */
export const SWATCHES = [
  { hex: "0f766e", name: "Teal" },
  { hex: "1e3a8a", name: "Indigo" },
  { hex: "b91c1c", name: "Crimson" },
  { hex: "1f2937", name: "Charcoal" },
  { hex: "a16207", name: "Mustard" },
  { hex: "7c3aed", name: "Violet" },
] as const;

export const MAX_SWATCHES = 4;

export const swatchName = (hex: string) =>
  SWATCHES.find((s) => s.hex === hex.replace(/^#/, "").toLowerCase())?.name ?? "Custom colour";

type Understanding = Pick<ProductUnderstanding, "category" | "recolorable_part"> | undefined | null;

/**
 * Generative recolor on footwear repaints the whole shoe (verified live), so a
 * shoe gets "colourways"; bottles and pouches keep the part-level wording
 * because only the named part changes.
 */
export const isWholeRecolor = (u: Understanding) => /foot|shoe|sneaker|sandal|boot/i.test(`${u?.category ?? ""} ${u?.recolorable_part ?? ""}`);

/** Human label for a pack asset id like "recolor-0f766e". */
export function recolorLabel(id: string, u?: Understanding) {
  const name = swatchName(id.replace(/^recolor-/, ""));
  if (isWholeRecolor(u)) return `${name} colourway`;
  const part = u?.recolorable_part?.trim();
  return part ? `${name} ${part.toLowerCase()}` : `${name} variant`;
}

/** Plain-language explanation for the recolor X-ray segment. */
export function recolorExplain(u?: Understanding) {
  if (isWholeRecolor(u)) return "Generative recolor: a new colourway for the whole shoe, shading and texture kept";
  const part = u?.recolorable_part?.trim() || "product";
  return `Generative recolor of the ${part} only (shading kept)`;
}
