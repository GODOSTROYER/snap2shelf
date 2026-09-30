/**
 * Kit Reel: a 9:16 vertical video built from 3–5 kit images with one delivery
 * URL. Each image becomes a Ken Burns clip (e_zoompan, a different move per
 * clip), clips are joined with fl_splice, each new clip fades up (e_fade), and
 * the offer card + text is laid over the whole spliced timeline. No generation
 * credits; video transformations bill per second of output. Recipe from
 * SPIKES.md §6, re-verified with ffprobe + frame grabs by scripts/dev/reel-check.mts.
 *
 * Verified live (30 Sep): on this image-based path (image/upload + e_zoompan +
 * .mp4) fl_splice:transition_(name_fade;du_…) is accepted but ignored — hard
 * cuts, no overlap, duration = clips × seconds. Cross-fades only work on the
 * video/upload path, where e_zoompan inside a layer breaks (1.96 s output for
 * two 2 s clips). A negative e_fade (fade-out) on a zoompan clip blacks it out
 * early, so only fade-ups are used.
 *
 * Every image must be a stored, non-transparent asset (layers can't reference
 * derived URLs), e.g. the saved hero and materialised pack formats.
 */
import type { BuiltUrl, XraySegment } from "../types";
import { cloudName, layerId } from "./composite";
import { encodeOverlayText } from "./channels";

export interface ReelInput {
  /** 3–5 public ids, in play order (extra ids are dropped; fewer than 3 is allowed but reads thin). */
  images: string[];
  offer?: { hindi?: string; english?: string };
  /** Seconds per clip. Default 3. */
  clipSeconds?: number;
  /** Fade-up from black at the start of clips 2..n, seconds. Default 0.4; 0 = hard cut. */
  fadeSeconds?: number;
  /** Frame size fed to e_zoompan. Default 720x1280. */
  width?: number;
  height?: number;
  cloud?: string;
}

export interface ReelUrl extends BuiltUrl {
  /** Expected duration of the delivered video. */
  seconds: number;
  /** Clip count actually used. */
  clips: number;
}

/**
 * One Ken Burns move per clip, cycling. Zooms stay gentle (≤1.2) so the real
 * product never leaves the frame; alternating in/out/pan keeps it from feeling
 * like one long zoom.
 */
export const REEL_MOVES = [
  { from: "zoom_1.0", to: "zoom_1.15", label: "slow push in" },
  { from: "zoom_1.2", to: "zoom_1.02", label: "pull back" },
  { from: "zoom_1.15;x_0.42", to: "zoom_1.15;x_0.58", label: "pan left to right" },
  { from: "zoom_1.05;y_0.46", to: "zoom_1.2;y_0.54", label: "tilt down into the product" },
  { from: "zoom_1.15;x_0.58", to: "zoom_1.15;x_0.42", label: "pan right to left" },
] as const;

const fixed = (n: number) => String(Math.round(n * 10) / 10);

export function reelUrl(i: ReelInput): ReelUrl {
  const imgs = i.images.filter(Boolean).slice(0, 5);
  if (!imgs.length) throw new Error("reelUrl needs at least one image");
  const du = Math.min(10, Math.max(1.5, i.clipSeconds ?? 3));
  const fade = Math.min(du / 2, Math.max(0, i.fadeSeconds ?? 0.4));
  const W = Math.round(i.width ?? 720);
  const H = Math.round(i.height ?? 1280);
  const segs: XraySegment[] = [];
  const push = (text: string, kind: XraySegment["kind"], label: string) => segs.push({ text, kind, label });

  const clip = (n: number) => {
    const m = REEL_MOVES[n % REEL_MOVES.length];
    // e_zoompan picks its own output size from the source (540x960 vs 640x1138 seen live),
    // and fl_splice refuses clips of different sizes: scale every clip back to W x H
    return { zp: `e_zoompan:du_${fixed(du)};fps_25;from_(${m.from});to_(${m.to})/c_scale,w_${W},h_${H}`, label: m.label };
  };

  // clip 1 is the base image itself
  const c0 = clip(0);
  push(`c_fill,w_${W},h_${H},g_center`, "crop", "First image filled to a 9:16 frame");
  push(c0.zp, "video", `Clip 1: ${c0.label} (${fixed(du)} s Ken Burns, turns the image into video)`);

  // clips 2..n spliced onto the end, each fading up from black
  const fadeUp = fade > 0 ? `/e_fade:${Math.round(fade * 1000)}` : "";
  for (let n = 1; n < imgs.length; n++) {
    const c = clip(n);
    push(
      `fl_splice,l_${layerId(imgs[n])}/c_fill,w_${W},h_${H},g_center/${c.zp}${fadeUp}/fl_layer_apply`,
      "video",
      `Clip ${n + 1}: ${c.label}, spliced onto the end${fade > 0 ? `, fading up over ${fixed(fade)} s` : ""}`,
    );
  }

  // offer held across the whole timeline: translucent card (first image, blacked out) + text
  if (i.offer?.hindi || i.offer?.english) {
    const hs = Math.round(W * 0.075);
    const es = Math.round(W * 0.042);
    const pad = Math.round(W * 0.035);
    const cardH = pad * 2 + (i.offer.hindi ? Math.round(hs * 1.3) : 0) + (i.offer.english ? Math.round(es * 1.35) : 0);
    const cardW = Math.round(W * 0.86);
    const top = Math.round(H * 0.06);
    push(
      `l_${layerId(imgs[0])}/c_scale,w_${cardW},h_${cardH}/co_rgb:1c130c,e_colorize:100/r_${Math.round(W * 0.03)}/o_72/fl_layer_apply,g_north,y_${top}`,
      "effect",
      "Offer card held for the whole reel",
    );
    let y = top + pad;
    if (i.offer.hindi) {
      push(
        `l_text:Noto%20Sans%20Devanagari@google_${hs}_700:${encodeOverlayText(i.offer.hindi)},co_white/c_limit,w_${cardW - pad * 2}/fl_layer_apply,g_north,y_${y}`,
        "text",
        "Hindi offer line, persistent across clips",
      );
      y += Math.round(hs * 1.3);
    }
    if (i.offer.english) {
      push(
        `l_text:Noto%20Sans@google_${es}_600:${encodeOverlayText(i.offer.english)},co_rgb:ffc56b/c_limit,w_${cardW - pad * 2}/fl_layer_apply,g_north,y_${y}`,
        "text",
        "English offer line, persistent across clips",
      );
    }
  }

  push("vc_h264,q_auto", "format", "H.264 MP4 that plays everywhere (WhatsApp, Instagram, browsers)");
  const transformation = segs.map((s) => s.text).join("/");
  const leaf = `${imgs[0]}.mp4`;
  segs.push({ text: leaf, kind: "asset", label: "First image; .mp4 turns the delivery into a video" });
  const seconds = Math.round(imgs.length * du * 10) / 10; // splices don't overlap on this path
  return {
    url: `https://res.cloudinary.com/${i.cloud ?? cloudName()}/image/upload/${transformation}/${leaf}`,
    transformation,
    segments: segs,
    seconds,
    clips: imgs.length,
  };
}
