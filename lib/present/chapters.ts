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

export const CHAPTERS: ChapterMeta[] = [
  {
    id: "cold-open",
    title: "One photo",
    seconds: () => 6,
    light: { x: 0.7, y: 0.42 },
    cue: () => "This is how most small sellers photograph a product: on a phone, on the floor.",
  },
  {
    id: "pipeline",
    title: "The pipeline",
    seconds: () => 8,
    light: { x: 0.5, y: 0.5 },
    cue: (d) => `Snap2Shelf turns that one photo into a finished kit in six steps, about ${Math.round(d.pipeline.totalSeconds)} seconds on a live run.`,
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
    cue: (d) => `The product is never regenerated. The same real cutout goes onto any scene, and reusing library scenes saved ${d.cost.creditsSavedByReuse} credits here.`,
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
    cue: (d) => `From one approved hero, ${d.pack.length} channel formats come from transformations alone: feed, story, marketplace, banner, WhatsApp, colour, and a Hindi offer.`,
  },
  {
    id: "reel",
    title: "Kit reel",
    seconds: (d) => Math.min(13, Math.max(8, Math.ceil(d.reel?.seconds ?? 9) + 1)),
    light: { x: 0.64, y: 0.5 },
    cue: () => "Even the video is one URL: Ken Burns clips spliced together, with the offer held on top.",
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
    cue: (d) => `Zero generation credits for this kit, scenes reused, and the ${mb(d.cost.bytesOriginal)} phone photo ships at around ${kb(d.cost.bytesDeliveredFallback)}.`,
  },
  {
    id: "shelf",
    title: "The shelf",
    seconds: () => 9,
    light: { x: 0.5, y: 0.5 },
    cue: () => "It all lands on a live storefront the seller can share on WhatsApp in one tap.",
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
