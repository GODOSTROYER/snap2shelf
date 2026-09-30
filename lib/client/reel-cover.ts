/**
 * Keeps a Kit Reel lit. The reel's clips 2..n fade up from black (e_fade), so
 * at every cut the video shows a black frame. While a clip rises, that clip's
 * own stored image sits over the video, framed like the clip's move where it
 * hands over, then fades out to the moving picture. The offer card baked into
 * the video shows through a hole in the cover. Shared by the deck's reel
 * chapter and the shelf's reel card. Pure and server-safe.
 */
import { REEL_MOVES, reelClipsFromUrl } from "../transform/reel";
import type { BuiltUrl } from "../types";

/** Seconds a still covers the reel before a cut (currentTime trails the frame on screen), and its hand-over. */
export const LEAD = 0.07;
export const HANDOFF = 0.3;

/** Fade-up baked into the reel URL (e_fade:400 → 0.4 s): each clip after the first rises from black. */
export const reelFade = (b: Pick<BuiltUrl, "transformation">) => Number(/\be_fade:(\d+)/.exec(b.transformation)?.[1] ?? 0) / 1000;

export interface ReelCard {
  frame: { w: number; h: number };
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

/** The offer card laid over the reel (…/l_<id>/c_scale,w_W,h_H/…/r_R/…/fl_layer_apply,g_north,y_Y), in frame px. */
export function reelCard(b: Pick<BuiltUrl, "transformation">): ReelCard | null {
  const frame = /c_fill,w_(\d+),h_(\d+)/.exec(b.transformation);
  const card = /\/l_[^/]+\/c_scale,w_(\d+),h_(\d+)\/(?:[^/]+\/)*?fl_layer_apply,g_north,y_(\d+)/.exec(b.transformation);
  if (!frame || !card) return null;
  const fw = Number(frame[1]);
  const [w, h, y] = [Number(card[1]), Number(card[2]), Number(card[3])];
  const r = Number(/\/r_(\d+)\//.exec(card[0])?.[1] ?? 0);
  return { frame: { w: fw, h: Number(frame[2]) }, x: (fw - w) / 2, y, w, h, r };
}

/** An SVG mask: the whole frame minus the offer card, so a still laid over the reel never hides the card. */
export function cardHoleMask({ frame: F, x, y, w, h, r }: ReelCard): string {
  const hole = `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${F.w} ${F.h}' preserveAspectRatio='none'><path fill-rule='evenodd' d='M0 0H${F.w}V${F.h}H0Z${hole}'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** CSS transform (origin 0 0) that frames a still like the clip's Ken Burns move at progress p (0..1). */
export function kenBurnsAt(move: string, p: number): string | undefined {
  const m = REEL_MOVES.find((r) => r.label === move);
  if (!m) return undefined;
  const parse = (s: string) => {
    const o: Record<string, number> = { zoom: 1, x: 0.5, y: 0.5 };
    for (const kv of s.split(";")) {
      const [k, v] = kv.split("_");
      if (k in o && Number.isFinite(Number(v))) o[k] = Number(v);
    }
    return o;
  };
  const a = parse(m.from);
  const b = parse(m.to);
  const z = a.zoom + (b.zoom - a.zoom) * p;
  const edge = 0.5 / z; // e_zoompan keeps its window inside the frame
  const cx = Math.min(1 - edge, Math.max(edge, a.x + (b.x - a.x) * p));
  const cy = Math.min(1 - edge, Math.max(edge, a.y + (b.y - a.y) * p));
  return `translate(${((0.5 - z * cx) * 100).toFixed(2)}%, ${((0.5 - z * cy) * 100).toFixed(2)}%) scale(${z.toFixed(4)})`;
}

/** Start time (s) of each clip, from the clips' lengths. */
export const clipStarts = (lengths: readonly number[]) => lengths.map((_, i) => lengths.slice(0, i).reduce((n, s) => n + s, 0));

/**
 * Which clip's still covers a faded reel at media time `time`, and how opaque it is: fully
 * from just before each cut until its fade-up ends, then handing over. null: the video shows.
 */
export function stillAt(time: number, starts: readonly number[], fade: number): { clip: number; opacity: number } | null {
  if (fade <= 0) return null;
  for (let i = 1; i < starts.length; i++) {
    const b = starts[i];
    if (time >= b - LEAD && time < b + fade) return { clip: i, opacity: 1 };
    if (time >= b + fade && time < b + fade + HANDOFF) return { clip: i, opacity: 1 - (time - b - fade) / HANDOFF };
  }
  return null;
}

/** Everything a player needs to keep a reel lit: one framed still per clip, the cut times, the fade and the card's hole. */
export interface ReelCover {
  stills: { url: string; transform?: string }[];
  starts: number[];
  fade: number;
  mask: string | null;
}

/**
 * The cover for a reel, read back from its URL. `stillUrl` gives each clip's stored image
 * (by public id) at a size the page already uses; the first clip's still is shown as it
 * opens, the others as they look where the fade-up hands over.
 */
export function reelCover(built: BuiltUrl, stillUrl: (publicId: string, clip: number) => string): ReelCover {
  const clips = reelClipsFromUrl(built);
  const fade = reelFade(built);
  const per = clips[0]?.seconds || 0;
  const card = reelCard(built);
  return {
    stills: clips.map((c, i) => ({ url: stillUrl(c.publicId, i), transform: kenBurnsAt(c.move, i === 0 ? 0 : Math.min(1, (fade + HANDOFF / 2) / (c.seconds || per || 1))) })),
    starts: clipStarts(clips.map((c) => c.seconds || per)),
    fade,
    mask: card ? cardHoleMask(card) : null,
  };
}
