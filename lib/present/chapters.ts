/**
 * The director's cut, chapter by chapter: title, running time, where the key
 * light sits, the presenter's one-line voice-over cue, and which images must be
 * warm in the cache before the chapter starts. Pure; edit copy and timing here.
 */
import type { PresentData } from "./data";

export type ChapterId =
  | "cold-open"
  | "pipeline"
  | "cutout"
  | "dna"
  | "stages"
  | "qa"
  | "pack"
  | "reel"
  | "xray"
  | "cost"
  | "shelf"
  | "closing";

export interface ChapterMeta {
  id: ChapterId;
  title: string;
  /** Auto-advance after this many seconds. */
  seconds: (d: PresentData) => number;
  /** Key-light position on the 1920×1080 stage, as fractions. */
  light: { x: number; y: number };
  /** One line the presenter says over this chapter. */
  cue: (d: PresentData) => string;
}

const kb = (n: number) => `${Math.round(n / 1024)} KB`;
const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

/** "feed, story, marketplace, banner, WhatsApp, 3 colour variants and a Hindi offer", from the pack itself. */
function packList(d: PresentData): string {
  const names: Record<string, string> = { feed: "feed", story: "story", marketplace: "marketplace", banner: "banner", whatsapp: "WhatsApp", offer: "a Hindi offer" };
  const recolors = d.pack.filter((a) => a.format === "recolor").length;
  const parts = d.pack.filter((a) => a.format !== "recolor" && a.format !== "offer").map((a) => names[a.format] ?? a.label);
  if (recolors) parts.push(plural(recolors, "colour variant"));
  if (d.pack.some((a) => a.format === "offer")) parts.push(names.offer);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "");
}

export const CHAPTERS: ChapterMeta[] = [
  {
    id: "cold-open",
    title: "One photo",
    seconds: () => 6,
    light: { x: 0.7, y: 0.42 },
    cue: (d) =>
      d.product.raw.disclosure
        ? "Here's the kind of photo a small seller takes: a steel bottle on a cluttered kitchen counter. This one is a sample, an AI-generated test image."
        : "Here's the photo the seller took: one product, on a real counter.",
  },
  {
    id: "pipeline",
    title: "The pipeline",
    seconds: () => 8,
    light: { x: 0.5, y: 0.5 },
    cue: (d) => `Snap2Shelf turns that one photo into a finished kit in six steps. On the live site, photo to ZIP took ${d.pipeline.totalSeconds} seconds.`,
  },
  {
    id: "cutout",
    title: "Cut out once",
    seconds: () => 9,
    light: { x: 0.66, y: 0.45 },
    cue: () => "Cloudinary removes the background once. That one cutout is reused by everything that follows.",
  },
  {
    id: "dna",
    title: "Scene DNA",
    seconds: () => 12,
    light: { x: 0.7, y: 0.48 },
    cue: () => "AI Vision reads each scene once: where the surface is, where the light comes from, where text fits. The product lands on that anchor and its shadow falls away from the light.",
  },
  {
    id: "stages",
    title: "Every stage",
    seconds: () => 9,
    light: { x: 0.55, y: 0.5 },
    cue: (d) =>
      `The product is never regenerated. The same cutout goes onto ${plural(d.stages.length, "library scene")}. Each scene was generated once; reusing it costs 0 credits.`,
  },
  {
    id: "qa",
    title: "QA gate",
    seconds: () => 11,
    light: { x: 0.5, y: 0.52 },
    cue: () => "Creative mode lets an image model restage the product, but a QA gate compares every take with the photo. The cheap model invented a logo badge and a second shoe, so it was rejected.",
  },
  {
    id: "pack",
    title: "Channel pack",
    seconds: () => 10,
    light: { x: 0.52, y: 0.58 },
    cue: (d) => `From one approved hero, ${d.pack.length} channel formats come from transformations alone: ${packList(d)}.`,
  },
  {
    id: "reel",
    title: "Kit reel",
    seconds: (d) => Math.min(13, Math.max(8, Math.ceil(d.reel?.seconds ?? 9) + 1)),
    light: { x: 0.64, y: 0.5 },
    cue: (d) => {
      const r = d.reel!;
      const per = r.clips[0]?.seconds;
      return `Even the video is one URL: ${plural(r.clips.length, "stored image")} become ${per ? `${per}-second ` : ""}Ken Burns clips, spliced into ${Math.round(r.seconds)} seconds with the offer held on top.`;
    },
  },
  {
    id: "xray",
    title: "It's a URL",
    seconds: () => 12,
    light: { x: 0.5, y: 0.45 },
    cue: () => "Every image you've seen is just a Cloudinary URL. Here is the hero, piece by piece: scene, shadows, your product, light-match, format.",
  },
  {
    id: "cost",
    title: "What it cost",
    seconds: () => 9,
    light: { x: 0.45, y: 0.5 },
    cue: (d) =>
      `This kit spent ${d.cost.generationCredits} new generation credits: it reused the ${d.cost.sceneTitle} scene, which cost ${plural(d.cost.sceneCredits, "credit")} once. The ${mb(d.cost.bytesOriginal)} photo is delivered at about ${kb(d.cost.bytesDeliveredFallback)}, and a basic studio shoot is about ${inr(d.cost.photoshootInr)}, as an estimate.`,
  },
  {
    id: "shelf",
    title: "The shelf",
    seconds: () => 9,
    light: { x: 0.5, y: 0.5 },
    cue: (d) => `It all lands on a live storefront. ${d.shelf.title} has ${plural(d.shelf.products.length, "product")} on one festive scene, and the seller shares it on WhatsApp in one tap.`,
  },
  {
    id: "closing",
    title: "Snap2Shelf",
    seconds: () => 8,
    light: { x: 0.5, y: 0.44 },
    cue: (d) => `One photo, a whole shelf. Try it at ${d.site.host}, no signup.`,
  },
];

export function chapterAvailable(id: ChapterId, d: PresentData): boolean {
  if (id === "qa") return !!d.qa;
  if (id === "reel") return !!d.reel;
  if (id === "stages") return d.stages.length >= 2;
  if (id === "pack") return d.pack.length > 0;
  return true;
}

/** Images a chapter shows, so the deck can have them decoded before it starts. */
export function chapterAssets(id: ChapterId, d: PresentData): string[] {
  switch (id) {
    case "cold-open":
      return [d.product.raw.url];
    case "pipeline":
      return [];
    case "cutout":
      return [d.product.raw.url, d.product.cutout.url];
    case "dna":
      return [d.scene.image.url, d.product.cutout.url, d.hero.url];
    case "stages":
      return d.stages.map((s) => s.image.url);
    case "qa":
      return d.qa ? [d.qa.approved.sheet.url, d.qa.rejected.sheet.url] : [];
    case "pack":
      return d.pack.map((a) => a.url);
    case "reel":
      return d.reel ? [d.reel.poster, ...d.reel.clips.map((c) => c.url)] : [];
    case "xray":
      return [d.hero.url];
    case "cost":
      return [d.cost.deliveredUrl];
    case "shelf":
      return [...d.shelf.products.map((p) => p.image.url), d.shelf.share.image.url];
    case "closing":
      return [];
  }
}
