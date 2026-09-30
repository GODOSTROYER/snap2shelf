/**
 * "Peel the URL": take whole groups of a composite delivery URL out (shadows,
 * light-match, the product layer…) and rebuild the URL from what is left.
 * Pure string work on BuiltUrl.segments, client-safe.
 *
 * Only groups whose removal still leaves a valid URL are peelable:
 *  - a layer group, when every one of its segments is a whole layer block
 *    (l_… through its fl_layer_apply), so a layer never loses its apply step;
 *  - the delivery format (f_/q_ only), which falls back to the source format;
 *  - light-match also owns the tone step inside the product layer
 *    (e_tint / e_brightness between the layer's resize and its apply).
 * The canvas (size & crop) and the source asset always stay.
 *
 * Every peeled variant is rendered at ONE fixed width (PEEL_WIDTH), so the set
 * of derived images is bounded: 2^(peelable groups) per featured product.
 */
import { snapWidth } from "@/lib/client/img";
import { XRAY_KINDS } from "@/lib/transform/xray";
import { PLATE, type BuiltUrl, type XraySegment } from "@/lib/types";

export type Kind = XraySegment["kind"];

/** One of the site's fixed widths (lib/client/img.ts): no new derivative sizes. */
export const PEEL_WIDTH = snapWidth(720);
export const PEEL_HEIGHT = Math.round((PEEL_WIDTH * PLATE.height) / PLATE.width);

/** A run of a segment's text, coloured (and peeled) with the group that owns it. */
export interface Piece {
  text: string;
  group: Kind;
}

export interface PeelSegment {
  text: string;
  kind: Kind;
  label: string;
  pieces: Piece[];
  /** Not in the source recipe: the fixed width this view renders at. */
  added?: boolean;
}

export interface PeelGroup {
  kind: Kind;
  legend: string;
  peelable: boolean;
}

export interface PeelModel {
  /** https://res.cloudinary.com/<cloud>/image/upload */
  prefix: string;
  /** Transformation segments in URL order, then the source asset. */
  segments: PeelSegment[];
  /** The delivered public id (with version, if any). */
  tail: string;
  /** Every colour in the URL, peelable ones first. */
  groups: PeelGroup[];
}

const comps = (text: string) => text.split("/");
const tokens = (component: string) => component.split(",");

/** l_… (or u_…) through a component carrying fl_layer_apply: removable as a whole. */
export function isLayerBlock(text: string) {
  const c = comps(text);
  return /^(l|u)_/.test(c[0]) && tokens(c[c.length - 1]).includes("fl_layer_apply");
}

/** The light-match tone inside the product layer (composite.ts harmoniseTone). */
const isTone = (component: string) => tokens(component).every((t) => /^e_(tint|brightness):/.test(t));

const isFormatOnly = (text: string) => !text.includes("/") && tokens(text).every((t) => /^(f|q)_/.test(t));

/** A plain trailing resize (the "Resize for this view" step composite.ts adds for previews). */
const isResize = (text: string) => !text.includes("/") && /^c_(scale|limit|fit),w_\d+$/.test(text);

function piecesOf(seg: Pick<XraySegment, "text" | "kind">): Piece[] {
  if (seg.kind !== "layer" || !isLayerBlock(seg.text)) return [{ text: seg.text, group: seg.kind }];
  const out: Piece[] = [];
  comps(seg.text).forEach((c, i) => {
    const group: Kind = i > 0 && isTone(c) ? "effect" : "layer";
    const text = i > 0 ? `/${c}` : c;
    const last = out[out.length - 1];
    if (last && last.group === group) last.text += text;
    else out.push({ text, group });
  });
  return out;
}

const NEVER: ReadonlySet<Kind> = new Set<Kind>(["crop", "asset", "placement", "video"]);

function peelableKind(kind: Kind, segs: PeelSegment[]) {
  if (NEVER.has(kind)) return false;
  const own = segs.filter((s) => s.kind === kind);
  if (kind === "format") return own.length > 0 && own.every((s) => isFormatOnly(s.text));
  // light-match can live only as the tone inside the product layer
  if (own.length === 0) return kind === "effect" && segs.some((s) => s.pieces.some((p) => p.group === "effect"));
  return own.every((s) => isLayerBlock(s.text));
}

export function peelModel(built: BuiltUrl, width = PEEL_WIDTH): PeelModel {
  const t = built.transformation;
  const at = t ? built.url.indexOf(`/${t}/`) : -1;
  const up = built.url.indexOf("/upload/");
  const prefix = at >= 0 ? built.url.slice(0, at) : up >= 0 ? built.url.slice(0, up + 7) : built.url.replace(/\/[^/]*$/, "");
  const assetSeg = built.segments.find((s) => s.kind === "asset");
  const tail = at >= 0 ? built.url.slice(at + t.length + 2) : (assetSeg?.text ?? built.url.slice(prefix.length + 1));

  const body = built.segments.filter((s) => s.kind !== "asset");
  const lastLayer = body.reduce((n, s, i) => (isLayerBlock(s.text) ? i : n), -1);
  // drop a trailing resize: this view renders at its own fixed width
  const kept = body.filter((s, i) => !(i > lastLayer && s.kind === "crop" && isResize(s.text)));
  const segments: PeelSegment[] = kept.map((s) => ({ text: s.text, kind: s.kind, label: s.label, pieces: piecesOf(s) }));
  const resize: PeelSegment = {
    text: `c_scale,w_${width}`,
    kind: "crop",
    label: `Resize to ${width} px wide for this view`,
    pieces: [{ text: `c_scale,w_${width}`, group: "crop" }],
    added: true,
  };
  const firstFormat = segments.findIndex((s, i) => i > lastLayer && s.kind === "format");
  segments.splice(firstFormat >= 0 ? firstFormat : segments.length, 0, resize);
  segments.push({ text: tail, kind: "asset", label: assetSeg?.label ?? "Source asset", pieces: [{ text: tail, group: "asset" }] });

  const present = new Set(segments.flatMap((s) => s.pieces.map((p) => p.group)));
  const groups = (Object.keys(XRAY_KINDS) as Kind[])
    .filter((k) => present.has(k))
    .map((k) => ({ kind: k, legend: XRAY_KINDS[k].legend, peelable: peelableKind(k, segments) }))
    .sort((a, b) => Number(b.peelable) - Number(a.peelable));

  return { prefix, segments, tail, groups };
}

/** Only peelable groups can be switched off; anything else in `off` is ignored. */
export function effectiveOff(model: PeelModel, off: Iterable<Kind>): Set<Kind> {
  const ok = new Set(model.groups.filter((g) => g.peelable).map((g) => g.kind));
  return new Set([...off].filter((k) => ok.has(k)));
}

/** Is this piece of the URL taken out? */
export const isOff = (seg: PeelSegment, piece: Piece, off: ReadonlySet<Kind>) => off.has(seg.kind) || off.has(piece.group);

/** The delivery URL with the `off` groups peeled out, at the model's fixed width. */
export function peelUrl(model: PeelModel, off: Iterable<Kind> = []): string {
  const o = effectiveOff(model, off);
  const parts = model.segments
    .filter((s) => s.kind !== "asset" && !o.has(s.kind))
    .map((s) =>
      s.pieces
        .filter((p) => !o.has(p.group))
        .map((p) => p.text)
        .join("")
        .replace(/^\//, ""),
    )
    .filter(Boolean);
  return `${model.prefix}/${parts.join("/")}/${model.tail}`;
}

/** Stable key for a set of peeled groups (for comparing states). */
export const offKey = (off: Iterable<Kind>) => [...off].sort().join(",");

/** What the picture shows once a group is taken out (product-agnostic). */
export const OFF_NOTE: Partial<Record<Kind, string>> = {
  layer: "Product layer off: only what the URL builds around the product is left.",
  shadow: "Shadows off: the product floats above the surface.",
  reflection: "Reflection off: the glossy surface stops mirroring the product.",
  effect: "Light-match off: the product looks pasted on.",
  format: "Format & quality off: the source format at full quality. Compare the file size.",
};

export const offNote = (kind: Kind) => OFF_NOTE[kind] ?? `${XRAY_KINDS[kind].legend} off.`;
export const onNote = (kind: Kind) => `${XRAY_KINDS[kind].legend} back on.`;
