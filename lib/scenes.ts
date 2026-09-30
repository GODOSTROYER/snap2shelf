/**
 * Scene library encoding. Scenes live in Cloudinary (tag `s2s-scene`) with Scene
 * DNA flattened into context, so the client-side list JSON is the whole API:
 *   https://res.cloudinary.com/<cloud>/image/list/s2s-scene.json
 */
import type { Scene, SceneDNA, SceneView } from "./types";

export const SCENE_TAG = "s2s-scene";

/** Context keys written on each scene asset (all values are strings). */
export function sceneToContext(s: Omit<Scene, "publicId">): Record<string, string> {
  return {
    theme: s.theme,
    view: s.view,
    title: s.title,
    prompt: s.prompt.slice(0, 900),
    model: s.modelId,
    credits: String(s.credits),
    dna_ax: s.dna.anchor_x.toFixed(3),
    dna_ay: s.dna.anchor_y.toFixed(3),
    dna_sw: s.dna.surface_width.toFixed(3),
    dna_az: String(Math.round(s.dna.light_azimuth)),
    dna_el: String(Math.round(s.dna.light_elevation)),
    dna_temp: s.dna.temperature,
    dna_gloss: s.dna.glossy ? "1" : "0",
    dna_text: s.dna.text_zone,
  };
}

interface ListResource {
  public_id: string;
  context?: { custom?: Record<string, string> };
}

export function sceneFromListResource(r: ListResource): Scene | null {
  const c = r.context?.custom;
  if (!c || !c.dna_ax || !c.dna_ay) return null;
  const num = (v: string | undefined, d: number) => (v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d);
  const dna: SceneDNA = {
    anchor_x: num(c.dna_ax, 0.5),
    anchor_y: num(c.dna_ay, 0.65),
    surface_width: num(c.dna_sw, 0.8),
    light_azimuth: num(c.dna_az, 315),
    light_elevation: num(c.dna_el, 45),
    temperature: (["warm", "neutral", "cool"].includes(c.dna_temp) ? c.dna_temp : "neutral") as SceneDNA["temperature"],
    glossy: c.dna_gloss === "1",
    text_zone: (c.dna_text as SceneDNA["text_zone"]) ?? "top",
  };
  return {
    publicId: r.public_id,
    theme: c.theme ?? "misc",
    view: (c.view === "top-down" ? "top-down" : "eye-level") as SceneView,
    title: c.title ?? c.theme ?? "Scene",
    prompt: c.prompt ?? "",
    modelId: c.model ?? "",
    credits: num(c.credits, 0),
    dna,
  };
}

export function sceneListUrl(cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? "", tag = SCENE_TAG) {
  return `https://res.cloudinary.com/${cloud}/image/list/${tag}.json`;
}
