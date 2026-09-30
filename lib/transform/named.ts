/**
 * Named transformations for the fixed-size Channel Pack outputs. The setup
 * script creates each one (Admin API create_transformation) under its name;
 * URLs then use `t_<name>` and append delivery options OUTSIDE the name,
 * because f_auto / q_auto / dpr_auto are not applied inside a named
 * transformation:
 *
 *   .../t_s2s_story/f_auto,q_auto/<hero public id>
 *   .../t_s2s_marketplace/f_jpg,q_auto:best/<cutout public id>
 *
 * The chains are the same strings channels.ts uses inline (verified live by
 * scripts/dev/channel-check.mts), so named and inline URLs render identically.
 */
import { CHANNEL_CHAINS } from "./channels";

export const NAMED_TRANSFORMATIONS = {
  /** transparent cutout → 2000x2000 pure white, product 1700px on its long side (85%) */
  s2s_marketplace: CHANNEL_CHAINS.marketplace,
  /** hero → 1080x1920, scene outpainted with generative fill (50 tx on first render) */
  s2s_story: CHANNEL_CHAINS.story,
  /** hero → 1920x1080, scene outpainted with generative fill (50 tx on first render) */
  s2s_banner: CHANNEL_CHAINS.banner,
  /** hero → 600x600 content-aware square catalog tile */
  s2s_whatsapp: CHANNEL_CHAINS.whatsapp,
  /** hero → 1080x1350 feed post (plate size, no-op for our heroes, normalises anything else) */
  s2s_feed: "c_fill,w_1080,h_1350,g_auto",
} as const;

export type NamedTransformation = keyof typeof NAMED_TRANSFORMATIONS;

/** Delivery options to append after `t_<name>` (never inside it). */
export const NAMED_DELIVERY: Record<NamedTransformation, string> = {
  s2s_marketplace: "f_jpg,q_auto:best",
  s2s_story: "f_auto,q_auto",
  s2s_banner: "f_auto,q_auto",
  s2s_whatsapp: "f_auto,q_auto:eco",
  s2s_feed: "f_auto,q_auto",
};

/** `t_<name>/<delivery>` for a URL, e.g. namedUrlPart("s2s_story") → "t_s2s_story/f_auto,q_auto". */
export const namedUrlPart = (name: NamedTransformation) => `t_${name}/${NAMED_DELIVERY[name]}`;
