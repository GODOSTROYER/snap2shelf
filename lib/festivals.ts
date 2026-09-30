/**
 * Festival presets for the brief bar: backdrop theme, palette, offer wording and
 * which offer languages to render. Client-safe data (no secrets, no server imports),
 * so the UI can show preset chips and the server can map a brief onto a kit.
 *
 * Offer lines are templates, not AI output: the Devanagari strings below are
 * fixed and render with the Noto Sans Devanagari overlay used by the pack.
 * Regional scripts (Malayalam, Tamil, Bengali) are not offered because the
 * pack's text overlay only carries Hindi and English lines.
 */
import type { BriefTone, Placement } from "./types";

export const FESTIVAL_SLUGS = ["diwali", "christmas", "eid", "onam", "durga-puja", "pongal", "new-year", "black-friday"] as const;
export type FestivalSlug = (typeof FESTIVAL_SLUGS)[number];

export type OfferLanguage = "hindi" | "english";

export interface FestivalPreset {
  slug: FestivalSlug;
  label: string;
  /** SCENE_THEMES slug for standing / hanging products (eye-level scenes). */
  theme: string;
  /** SCENE_THEMES slug for flat-lay products (top-down scenes). */
  flatlayTheme: string;
  /** Up to 4 hex colours without '#'. */
  palette: string[];
  /** Sale line without a discount; the discount is appended as " · 20% छूट" / " · 20% off". */
  hindi: string;
  english: string;
  /** Offer lines rendered by default for this festival (English is always available on request). */
  languages: OfferLanguage[];
  tone: BriefTone;
  /** Empty-backdrop description for "Generate a new scene" (wrapped with the no-product/no-text rules server-side). */
  scenePrompt: string;
  /** Words that name the festival in a brief (lower-case, matched on word boundaries). */
  keywords: string[];
}

export const FESTIVALS: readonly FestivalPreset[] = [
  {
    slug: "diwali",
    label: "Diwali",
    theme: "diwali",
    flatlayTheme: "flatlay-festive",
    palette: ["f59e0b", "b91c1c", "7c2d12", "fde68a"],
    hindi: "दिवाली सेल",
    english: "Diwali Sale",
    languages: ["hindi", "english"],
    tone: "festive",
    scenePrompt: "a carved teak tabletop, brass diyas with small flames, marigold garlands and warm fairy-light bokeh in the background, soft warm light from the upper left",
    keywords: ["diwali", "deepavali", "divali", "दिवाली", "दीपावली"],
  },
  {
    slug: "christmas",
    label: "Christmas",
    theme: "cafe",
    flatlayTheme: "flatlay-linen",
    palette: ["b91c1c", "166534", "d4af37", "f8fafc"],
    hindi: "क्रिसमस सेल",
    english: "Christmas Sale",
    languages: ["english"],
    tone: "festive",
    scenePrompt: "a rustic pine-wood tabletop, pine branches, red and gold baubles and warm fairy-light bokeh in the background, soft warm light from the left",
    keywords: ["christmas", "xmas", "x-mas", "क्रिसमस"],
  },
  {
    slug: "eid",
    label: "Eid",
    theme: "marble",
    flatlayTheme: "flatlay-festive",
    palette: ["065f46", "d4af37", "fffbeb", "1e3a8a"],
    hindi: "ईद सेल",
    english: "Eid Sale",
    languages: ["english"],
    tone: "festive",
    scenePrompt: "a polished white marble tabletop, brass lanterns with soft glowing light, a bowl of dates and a deep emerald wall in the background, soft evening light from the right",
    keywords: ["eid", "ramzan", "ramadan", "eid-ul-fitr", "bakrid", "ईद"],
  },
  {
    slug: "onam",
    label: "Onam",
    theme: "jute",
    flatlayTheme: "flatlay-festive",
    palette: ["facc15", "f97316", "15803d", "fefce8"],
    hindi: "ओणम सेल",
    english: "Onam Sale",
    languages: ["english"],
    tone: "festive",
    scenePrompt: "a woven mat on a wooden table, fresh banana leaves, yellow and orange pookalam flower petals and a brass lamp in the background, bright soft daylight from the left",
    keywords: ["onam", "ओणम"],
  },
  {
    slug: "durga-puja",
    label: "Durga Puja",
    theme: "diwali",
    flatlayTheme: "flatlay-festive",
    palette: ["dc2626", "fafafa", "f59e0b", "7f1d1d"],
    hindi: "दुर्गा पूजा सेल",
    english: "Durga Puja Sale",
    languages: ["hindi", "english"],
    tone: "festive",
    scenePrompt: "a dark wooden tabletop draped with red-bordered white cloth, a brass dhunuchi with gentle smoke and white shiuli flowers in the background, warm light from the upper right",
    keywords: ["durga puja", "durga", "pujo", "puja", "navratri", "dussehra", "पूजा"],
  },
  {
    slug: "pongal",
    label: "Pongal",
    theme: "jute",
    flatlayTheme: "flatlay-festive",
    palette: ["eab308", "65a30d", "c2410c", "fef3c7"],
    hindi: "पोंगल सेल",
    english: "Pongal Sale",
    languages: ["english"],
    tone: "festive",
    scenePrompt: "a terracotta-toned earthen tabletop, sugarcane stalks, a clay pot and turmeric leaves in the background, warm morning sunlight from the right",
    keywords: ["pongal", "sankranti", "sankranthi", "makar sankranti", "lohri", "पोंगल"],
  },
  {
    slug: "new-year",
    label: "New Year",
    theme: "cafe",
    flatlayTheme: "flatlay-linen",
    palette: ["d4af37", "c0c0c0", "111827", "7c3aed"],
    hindi: "नए साल की सेल",
    english: "New Year Sale",
    languages: ["english"],
    tone: "bold",
    scenePrompt: "a glossy black tabletop, gold and silver bokeh lights and soft metallic confetti far in the background, cool evening light from the left",
    keywords: ["new year", "new-year", "nye", "नया साल", "नए साल"],
  },
  {
    slug: "black-friday",
    label: "Black Friday",
    theme: "marble",
    flatlayTheme: "flatlay-linen",
    palette: ["111111", "facc15", "dc2626", "ffffff"],
    hindi: "ब्लैक फ्राइडे सेल",
    english: "Black Friday Sale",
    languages: ["english"],
    tone: "bold",
    scenePrompt: "a matte black tabletop against a deep charcoal wall with a single bold yellow light streak, dramatic studio light from the upper left",
    keywords: ["black friday", "cyber monday", "blackfriday"],
  },
];

export function festivalBySlug(slug: string | undefined | null): FestivalPreset | null {
  return FESTIVALS.find((f) => f.slug === slug) ?? null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * First festival named in free text. Longer keywords win over shorter ones
 * ("durga puja" before "puja"), and Latin keywords match on word boundaries.
 */
export function detectFestival(text: string): FestivalPreset | null {
  const t = text.toLowerCase();
  let best: { f: FestivalPreset; at: number; len: number } | null = null;
  for (const f of FESTIVALS) {
    for (const k of f.keywords) {
      const re = /^[a-z0-9 -]+$/.test(k) ? new RegExp(`(?:^|[^a-z0-9])${escapeRe(k)}(?![a-z0-9])`) : new RegExp(escapeRe(k));
      const m = re.exec(t);
      if (!m) continue;
      const at = m.index;
      if (!best || at < best.at || (at === best.at && k.length > best.len)) best = { f, at, len: k.length };
    }
  }
  return best?.f ?? null;
}

/** Theme for a festival, fitted to how the product is staged. */
export const festivalTheme = (f: FestivalPreset, placement: Placement = "standing") => (placement === "flatlay" ? f.flatlayTheme : f.theme);

export type Discount =
  | { kind: "percent"; value: number } // "20% off"
  | { kind: "flat"; value: number } // "₹200 off"
  | { kind: "bogo" } // "buy 1 get 1"
  | { kind: "free-delivery" };

/** Offer suffix in each language. */
export function discountText(d: Discount): { hindi: string; english: string } {
  switch (d.kind) {
    case "percent":
      return { hindi: `${d.value}% छूट`, english: `${d.value}% off` };
    case "flat":
      return { hindi: `₹${d.value} की छूट`, english: `₹${d.value} off` };
    case "bogo":
      return { hindi: "एक के साथ एक मुफ़्त", english: "Buy 1 Get 1" };
    case "free-delivery":
      return { hindi: "मुफ़्त डिलीवरी", english: "Free delivery" };
  }
}

/** Max characters per offer line (PackRequest.offer validation). */
export const OFFER_MAX = 40;

/**
 * Template offer lines, e.g. Diwali + 20% → "दिवाली सेल · 20% छूट" / "Diwali Sale · 20% off".
 * Without a festival the sale word stands alone ("सेल · 20% छूट" / "Sale · 20% off").
 */
export function offerLines(f: FestivalPreset | null, d: Discount | null, languages: OfferLanguage[]): { hindi?: string; english?: string } {
  if (!f && !d) return {};
  const sale = { hindi: f?.hindi ?? "सेल", english: f?.english ?? "Sale" };
  const off = d ? discountText(d) : null;
  const line = (lang: OfferLanguage) => {
    const s = off ? `${sale[lang]} · ${off[lang]}` : sale[lang];
    return s.length <= OFFER_MAX ? s : (off?.[lang] ?? sale[lang]).slice(0, OFFER_MAX);
  };
  const out: { hindi?: string; english?: string } = {};
  if (languages.includes("hindi")) out.hindi = line("hindi");
  if (languages.includes("english")) out.english = line("english");
  return out;
}
