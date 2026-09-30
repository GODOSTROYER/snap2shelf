/**
 * Scene library recipes. Every plate follows one of two fixed camera recipes so
 * composites stay consistent: eye-level tabletop for standing products,
 * top-down flat-lay for garments. Client-safe data.
 */
import type { SceneView } from "./types";

const NEGATIVE = "No products, no bottles, no packaging, no people, no hands, no text, no letters, no logos, no brand names.";

const eyeLevel = (surface: string, background: string, light: string) =>
  `Photorealistic empty product-photography backdrop, professional commercial photo. Camera at eye level, about 15 degrees above the surface. ` +
  `${surface} fills the lower 40% of the frame. The centre foreground of the surface is completely empty and clear for placing a product. ` +
  `${background}, softly out of focus with shallow depth of field. ${light}. ${NEGATIVE}`;

const topDown = (surface: string, edges: string, light: string) =>
  `Photorealistic top-down flat-lay product-photography background, camera directly overhead looking straight down. ${surface} covers the whole frame. ` +
  `${edges} only along the outer edges; the central 60% of the frame is completely empty for laying a folded garment. ${light}. ${NEGATIVE}`;

export interface SceneRecipe {
  theme: string;
  title: string;
  view: SceneView;
  prompt: string;
}

export const SCENE_RECIPES: SceneRecipe[] = [
  {
    theme: "diwali",
    title: "Diwali glow",
    view: "eye-level",
    prompt: eyeLevel("A warm teak wooden tabletop", "In the background brass diyas with small flames, marigold garlands and warm fairy-light bokeh", "Soft warm light from the upper left"),
  },
  {
    theme: "marble",
    title: "Marble studio",
    view: "eye-level",
    prompt: eyeLevel("A polished white Carrara marble tabletop with subtle grey veins", "In the background a pale warm-grey plaster wall with a soft window shadow of leaves", "Bright soft daylight from the left"),
  },
  {
    theme: "pastel",
    title: "Pastel minimal",
    view: "eye-level",
    prompt: eyeLevel("A matte pastel peach tabletop", "In the background a seamless pastel lilac wall with one soft arch shape", "Even soft studio light from the front left"),
  },
  {
    theme: "jute",
    title: "Rustic jute",
    view: "eye-level",
    prompt: eyeLevel("A woven jute mat on a weathered wooden table", "In the background terracotta pots, dried palm leaves and a whitewashed wall", "Warm afternoon sunlight from the right"),
  },
  {
    theme: "kitchen",
    title: "Kitchen counter",
    view: "eye-level",
    prompt: eyeLevel("A light oak kitchen countertop", "In the background a bright modern kitchen with white tiles and fresh green herbs", "Morning daylight from a window on the left"),
  },
  {
    theme: "cafe",
    title: "Outdoor café",
    view: "eye-level",
    prompt: eyeLevel("A round white marble café table outdoors", "In the background a leafy Indian street café with warm string lights at early evening", "Golden-hour light from the right"),
  },
  {
    theme: "flatlay-festive",
    title: "Festive flat-lay",
    view: "top-down",
    prompt: topDown("A deep maroon raw-silk cloth", "Marigold petals, one small brass diya and a few grains of rangoli colour", "Soft even light with a gentle shadow toward the lower right"),
  },
  {
    theme: "flatlay-linen",
    title: "Linen flat-lay",
    view: "top-down",
    prompt: topDown("Natural ivory linen fabric with gentle creases", "A few dried flowers and a sprig of eucalyptus", "Soft diffused daylight from the upper left"),
  },
];

/** Scene DNA prompt. Field names match lib/types.ts SceneDNA. */
export function sceneDnaPrompt(view: SceneView) {
  const anchor =
    view === "top-down"
      ? `"anchor_x": 0-1 and "anchor_y": 0-1 (centre of the largest empty area, fractions of width and height from the top-left)`
      : `"anchor_x": 0-1 (horizontal centre of the clear surface where a product should stand), "anchor_y": 0-1 from the top (where a product's base should touch the surface: a point on the surface a little in front of its back edge)`;
  return `You are preparing a product-photography backdrop for compositing a real product photo onto it. Return ONLY a JSON object, no prose, with exactly these keys:
{${anchor},
 "surface_width": 0-1 (width of the clear area as a fraction of image width),
 "light_azimuth": 0-360 (direction the main light comes FROM, degrees clockwise from the top of the image: 0=top, 90=right, 180=bottom, 270=left),
 "light_elevation": 0-90 (0 = at the horizon, 90 = directly overhead),
 "temperature": "warm" | "neutral" | "cool",
 "glossy": boolean (true only if the surface is reflective like polished marble, glass or lacquer),
 "text_zone": "top" | "bottom" | "left" | "right" | "top_left" | "top_right" | "none" (largest calm area for overlay text that will not cover the product)}`;
}
