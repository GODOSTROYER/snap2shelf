/**
 * The QA gate's automatic fix, told on the stage: where the product sat when QA
 * caught it, and by how much the fix moved it. A sample replays EVERY check its
 * live run recorded (data/showcase.json → attempts), in order, so "this run
 * needed 3 QA checks" on its receipt is what the viewer just watched. Client-safe.
 */
import { SCENE_LIBRARY, type SampleProduct } from "../showcase";
import { SHOWCASE } from "../showcase-data";
import { geometry } from "../transform/composite";
import type { CompositeControls, CutoutRecord, Placement, QaResult, SceneDNA } from "../types";

/** The product's base on the 1080x1350 plate when QA caught it, and the recorded correction. */
export interface QaMarks {
  cx: number; // centre of the product's base (plate px)
  baseY: number; // where the base sat (plate px)
  w: number; // product width (plate px)
  /** How far the fix moved the base (plate px, + = lower). null: the fix changed the scene instead. */
  dy: number | null;
}

/** One recorded staging attempt and its verdict. */
export interface ReplayAttempt {
  scenePublicId: string;
  controls: CompositeControls;
  url: string; // that attempt's composite (rendered during the live run)
  qa: QaResult;
}

/** First sentence of a QA reason, as the server wrote it. */
export const firstSentence = (reason: string | undefined) => (reason ?? "Something looked off.").split(/(?<=\.)\s/)[0];

/**
 * Every check a sample's live run needed, when it tells a story: the first was
 * rejected and the last approved. null for a sample that passed first time.
 */
export function replayAttempts(sample: Pick<SampleProduct, "sku"> | undefined | null): ReplayAttempt[] | null {
  const kit = sample ? SHOWCASE.kits.find((k) => k.sku === sample.sku) : undefined;
  const list = kit?.attempts ?? [];
  if (list.length < 2 || list[0].qa.status !== "rejected" || list[list.length - 1].qa.status !== "approved") return null;
  return list.map((a) => ({ scenePublicId: a.scenePublicId, controls: a.controls, url: a.url, qa: a.qa }));
}

type Stageable = { cutout: Pick<CutoutRecord, "width" | "height">; dna: SceneDNA; placement: Placement };

/**
 * Where the fix moved the product, from the same geometry the composite URL is
 * built with (lib/transform/composite.ts). Flat-lays have no base to point at.
 */
export function qaMarks(from: Stageable & { controls: CompositeControls }, to: { controls: CompositeControls; sameScene: boolean }): QaMarks | null {
  if (from.placement === "flatlay") return null;
  const a = geometry(from.cutout, from.dna, from.controls, from.placement);
  const b = to.sameScene ? geometry(from.cutout, from.dna, to.controls, from.placement) : null;
  return { cx: a.px + a.pw / 2, baseY: a.baseY, w: a.pw, dy: b ? b.baseY - a.baseY : null };
}

/** The scene DNA of a recorded attempt's plate (the sample's own scene, or the library snapshot). */
export function dnaOf(scenePublicId: string, fallback: { publicId: string; dna: SceneDNA }): SceneDNA | null {
  if (scenePublicId === fallback.publicId) return fallback.dna;
  return SCENE_LIBRARY.find((s) => s.publicId === scenePublicId)?.dna ?? null;
}

/** What changed between two attempts, in the story's words ("We …"). */
export function fixWords(a: { controls: CompositeControls; scene: string }, b: { controls: CompositeControls; scene: string; sceneTitle?: string }): string {
  if (a.scene !== b.scene) return `moved it to the ${b.sceneTitle ?? "next"} scene`;
  const x = a.controls;
  const y = b.controls;
  const parts: string[] = [];
  const dy = y.offsetY - x.offsetY;
  if (dy > 0) parts.push(`set it ${dy} px lower, onto the surface`);
  if (dy < 0) parts.push(`lifted it ${-dy} px`);
  if (x.contact !== y.contact) parts.push(y.contact ? "turned on the contact shadow" : "turned the contact shadow off");
  if (x.shadow !== y.shadow) parts.push(y.shadow ? "turned on the cast shadow" : "turned the cast shadow off");
  if (Math.abs(y.scale - x.scale) >= 0.01) parts.push(y.scale < x.scale ? "made it a little smaller" : "made it a little larger");
  if (y.offsetX !== x.offsetX) parts.push("re-centred it");
  if (!parts.length) return "re-staged it";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}
