/** Colour-variant presets (hex without '#', as PackRequest.recolor expects). */
export const SWATCHES = [
  { hex: "0f766e", name: "Teal" },
  { hex: "2563eb", name: "Royal blue" },
  { hex: "b91c1c", name: "Crimson" },
  { hex: "1f2937", name: "Charcoal" },
  { hex: "a16207", name: "Mustard" },
  { hex: "7c3aed", name: "Violet" },
] as const;

export const MAX_SWATCHES = 4;

export const swatchName = (hex: string) =>
  SWATCHES.find((s) => s.hex === hex.replace(/^#/, "").toLowerCase())?.name ?? "Custom colour";

/** Human label for a pack asset id like "recolor-0f766e". */
export const recolorLabel = (id: string) => `${swatchName(id.replace(/^recolor-/, ""))} variant`;
