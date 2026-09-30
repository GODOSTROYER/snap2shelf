"use client";

/**
 * SceneDnaOverlay — draws a scene's DNA over its plate so people can SEE what
 * AI Vision read: the surface line, the anchor where the product's base goes,
 * where the light comes from (azimuth + elevation), which way shadows fall,
 * the text-safe zone and the light temperature / surface finish.
 *
 * Put it in a box with the plate's aspect ratio, on top of the plate image:
 *
 *   <div style={{ position: "relative", aspectRatio: "4 / 5" }}>
 *     <img src={plateUrl} alt="" />
 *     <SceneDnaOverlay dna={scene.dna} animate />
 *   </div>
 *
 * Coordinates use the canonical plate (1080×1350 by default), the same space
 * Scene DNA is measured in, so fractions map straight onto the image.
 * `animate` draws the marks one after another (reduced motion: fades only).
 *
 * Marks are SVG; labels are HTML pills (black 55 %, 6 px backdrop blur,
 * Hanken Grotesk 600) placed in the same plate space, so they stay crisp and
 * readable on any plate, bright marble included, and never sit on each other:
 * the shadow label rides past the shadow's tip, the surface and anchor labels
 * take the side the shadow leaves free.
 */
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PLATE, type SceneDNA } from "@/lib/types";

export type DnaMark = "surface" | "anchor" | "light" | "shadow" | "textZone" | "temperature" | "finish";

export interface DnaRect {
  x: number; // fractions of the plate
  y: number;
  w: number;
  h: number;
}

export interface SceneDnaOverlayProps {
  dna: SceneDNA;
  /** Size of the plate the DNA was measured on. Default 1080×1350. */
  width?: number;
  height?: number;
  /** Marks to draw. Default: everything except `shadow`. */
  show?: Partial<Record<DnaMark, boolean>>;
  /** Text-safe rectangle (fractions). Defaults to the zone named by dna.text_zone; null hides it. */
  textZone?: DnaRect | null;
  /** Label for the text-safe rectangle. */
  textZoneLabel?: string;
  /** Draw the marks one after another. */
  animate?: boolean;
  /** Seconds before the first mark. */
  delay?: number;
  /** Seconds between marks. */
  step?: number;
  /** Show the small text labels next to each mark. */
  labels?: boolean;
  /** Stroke colour. Default marigold. */
  accent?: string;
  /** Stroke size multiplier, for small viewers (the studio stage). Default 1. */
  weight?: number;
  /** Label pill text size, in CSS px (screen pixels, whatever size the plate is drawn at). Default 14. */
  labelPx?: number;
  /** Step back once a render is on top: the marks fade to a hint and the labels go. */
  dim?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const DEG = Math.PI / 180;
const FORESHORTEN = 0.3; // eye-level plates: depth on the table appears ~30% as long

/** Where the light sits relative to the anchor, on the image plane (unit-ish vector, y down). */
export function lightDirection(dna: Pick<SceneDNA, "light_azimuth" | "light_elevation">) {
  const az = dna.light_azimuth * DEG;
  const el = Math.min(85, Math.max(5, dna.light_elevation)) * DEG;
  // azimuth is on the ground plane (0 = from the back/top, clockwise); elevation lifts it
  const x = Math.sin(az) * Math.cos(el);
  const y = -Math.cos(az) * Math.cos(el) * FORESHORTEN - Math.sin(el);
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

/** Direction a cast shadow falls on the surface (image plane, y down), matching lib/transform/composite.ts. */
export function shadowDirection(dna: Pick<SceneDNA, "light_azimuth">) {
  const az = (((dna.light_azimuth % 360) + 360) % 360) * DEG;
  const sx = -Math.sin(az);
  let sy = Math.cos(az);
  if (Math.abs(sy) < 0.25) sy = -0.45; // side light: assume a slightly frontal key, shadow slants back
  return { x: sx, y: sy * FORESHORTEN };
}

const ZONES: Record<Exclude<SceneDNA["text_zone"], "none">, DnaRect> = {
  top: { x: 0.06, y: 0.04, w: 0.88, h: 0.2 },
  bottom: { x: 0.06, y: 0.76, w: 0.88, h: 0.2 },
  left: { x: 0.04, y: 0.08, w: 0.4, h: 0.42 },
  right: { x: 0.56, y: 0.08, w: 0.4, h: 0.42 },
  top_left: { x: 0.04, y: 0.04, w: 0.5, h: 0.22 },
  top_right: { x: 0.46, y: 0.04, w: 0.5, h: 0.22 },
};

export function textZoneRect(zone: SceneDNA["text_zone"]): DnaRect | null {
  return zone === "none" ? null : ZONES[zone];
}

const compass = (az: number) => {
  const names = ["the back", "the back right", "the right", "the front right", "the front", "the front left", "the left", "the back left"];
  return names[Math.round((((az % 360) + 360) % 360) / 45) % 8];
};

/** Plain-language summary, used as the overlay's accessible description. */
export function describeDna(dna: SceneDNA): string {
  const zone = dna.text_zone === "none" ? "no fixed text zone" : `room for text at the ${dna.text_zone.replace("_", " ")}`;
  return (
    `Surface at ${Math.round(dna.anchor_y * 100)}% of the height; product anchor at ${dna.anchor_x.toFixed(2)}, ${dna.anchor_y.toFixed(2)}. ` +
    `Light from ${compass(dna.light_azimuth)} (${Math.round(dna.light_azimuth)}°), ${Math.round(dna.light_elevation)}° above the surface. ` +
    `${dna.temperature[0].toUpperCase()}${dna.temperature.slice(1)} light, ${dna.glossy ? "glossy" : "matte"} surface, ${zone}.`
  );
}

const TEMP_COLOR: Record<SceneDNA["temperature"], string> = { warm: "#ffb45a", neutral: "#ece4d6", cool: "#9ec3ff" };

/** Shadow marks use the X-ray "Shadows" colour, so a shadow reads the same here, in the URL X-ray and in the studio. */
const SHADOW_INK = "var(--xray-shadow, #b8a3ff)";

type Anchor = "start" | "middle" | "end";

interface Pill {
  key: string;
  x: number; // plate units
  y: number; // plate units: the pill's vertical centre
  anchor: Anchor;
  text: string;
  color?: string;
  dot?: string;
  at: number; // seconds (animate)
}

const PILL: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.5em",
  padding: "0.42em 0.78em",
  borderRadius: 999,
  background: "rgb(0 0 0 / 0.55)",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  color: "#f4ece0",
  fontFamily: "var(--pz-font-text), 'Hanken Grotesk', system-ui, sans-serif",
  fontWeight: 600,
  lineHeight: 1.1,
  letterSpacing: "0.005em",
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
};

const Dot = ({ color }: { color: string }) => <i style={{ width: "0.6em", height: "0.6em", borderRadius: 999, background: color, flex: "none" }} />;

// useLayoutEffect warns during SSR; the label layer only measures on the client
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Screen px per plate unit (the SVG uses "slice", so the larger ratio wins); 0 until measured. */
function usePlateScale(W: number, H: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setK(Math.max(el.clientWidth / W, el.clientHeight / H));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);
  return [ref, k] as const;
}

export function SceneDnaOverlay({
  dna,
  width = PLATE.width,
  height = PLATE.height,
  show,
  textZone,
  textZoneLabel = "Text-safe zone",
  animate = false,
  delay = 0,
  step = 0.7,
  labels = true,
  accent = "var(--pz-marigold, #f5a524)",
  weight = 1,
  labelPx = 14,
  dim = false,
  className,
  style,
}: SceneDnaOverlayProps) {
  const reduced = useReducedMotion();
  const uid = useId().replace(/:/g, "");
  const [layer, k] = usePlateScale(width, height);
  const W = width;
  const H = height;
  const on: Record<DnaMark, boolean> = {
    surface: true,
    anchor: true,
    light: true,
    shadow: false,
    textZone: true,
    temperature: true,
    finish: true,
    ...show,
  };
  const zone = textZone === undefined ? textZoneRect(dna.text_zone) : textZone;
  if (!zone) on.textZone = false;

  // timing: each visible mark gets the next slot; chips share one slot
  const order: DnaMark[] = ["surface", "anchor", "light", "shadow", "textZone", "temperature"];
  const slot: Partial<Record<DnaMark, number>> = {};
  let n = 0;
  for (const m of order) if (on[m]) slot[m] = delay + step * n++;
  slot.finish = slot.temperature ?? delay + step * n;
  const at = (m: DnaMark) => slot[m] ?? 0;

  const fs = W * 0.024 * Math.sqrt(weight); // spacing unit, plate units
  const sw = W * 0.0035 * weight; // stroke width
  const ax = dna.anchor_x * W;
  const ay = dna.anchor_y * H;
  const half = (dna.surface_width * W) / 2;
  const x0 = Math.max(W * 0.04, ax - half);
  const x1 = Math.min(W * 0.96, ax + half);

  const L = Math.min(W, H) * 0.4;
  const ld = lightDirection(dna);
  const clampX = (v: number) => Math.min(W * 0.93, Math.max(W * 0.07, v));
  const clampY = (v: number) => Math.min(H * 0.93, Math.max(H * 0.07, v));
  const sx = clampX(ax + ld.x * L);
  const sy = clampY(ay + ld.y * L);
  const tipX = ax + (sx - ax) * 0.22;
  const tipY = ay + (sy - ay) * 0.22;
  const ang = Math.atan2(tipY - sy, tipX - sx);
  const head = W * 0.022;

  const sd = shadowDirection(dna);
  const sLen = W * 0.22 * Math.min(1.6, Math.max(0.6, 1 / Math.tan(Math.max(10, dna.light_elevation) * DEG)));
  const shX = ax + sd.x * sLen;
  const shY = ay + sd.y * sLen;
  const shadowRight = sd.x >= 0;

  const draw = (m: DnaMark, d = 0.9) =>
    animate
      ? { initial: { pathLength: reduced ? 1 : 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 }, transition: { delay: at(m), duration: reduced ? 0.3 : d, ease: [0.65, 0, 0.35, 1] as const } }
      : {};
  const fade = (m: DnaMark, extra = 0) =>
    animate ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { delay: at(m) + extra, duration: 0.45 } } : {};
  const pop = (m: DnaMark) =>
    animate
      ? {
          initial: { opacity: 0, scale: reduced ? 1 : 1.8 },
          animate: { opacity: 1, scale: 1 },
          transition: { delay: at(m), type: "spring" as const, stiffness: 320, damping: 22 },
        }
      : {};

  // ── label pills, laid out in plate units ─────────────────────────────────
  // estimated pill width (plate units, k = screen px per plate unit), so a pill can be kept inside the plate
  // a phone-sized plate (under 420 px wide) gets slightly smaller pills
  const px = k && W * k < 420 ? Math.max(11, labelPx - 2) : labelPx;
  const pillW = (t: string, dot = false) => (k ? (t.length * px * 0.56 + px * (dot ? 2.66 : 1.56)) / k : 0);
  const inside = (x: number, a: Anchor, w: number): { x: number; anchor: Anchor } => {
    if (!w) return { x, anchor: a };
    const left = a === "start" ? x : a === "middle" ? x - w / 2 : x - w;
    const lo = W * 0.03;
    const hi = W * 0.97 - w;
    return left < lo ? { x: lo, anchor: "start" } : left > hi ? { x: hi, anchor: "start" } : { x, anchor: a };
  };
  const pills: Pill[] = [];
  const add = (p: Pill) => pills.push({ ...p, ...inside(p.x, p.anchor, pillW(p.text, !!p.dot)) });

  if (on.textZone && zone) add({ key: "zone", x: zone.x * W + fs * 0.5, y: zone.y * H + fs * 1.15, anchor: "start", text: textZoneLabel, at: at("textZone") });
  // surface: at the end of the line away from the shadow, just above it
  if (on.surface) {
    add({
      key: "surface",
      x: shadowRight ? x0 + fs * 0.2 : x1 - fs * 0.2,
      y: ay - fs * 1.25,
      anchor: shadowRight ? "start" : "end",
      text: `Surface  y ${dna.anchor_y.toFixed(2)}`,
      at: at("surface") + 0.5,
    });
  }
  // anchor: below the line, beside the product (never under it), on the side the shadow leaves free
  if (on.anchor) {
    add({
      key: "anchor",
      x: shadowRight ? ax - W * 0.1 : ax + W * 0.1,
      y: ay + fs * 1.55,
      anchor: shadowRight ? "end" : "start",
      text: `Anchor  ${dna.anchor_x.toFixed(2)}, ${dna.anchor_y.toFixed(2)}`,
      at: at("anchor") + 0.3,
    });
  }
  // light: by the sun, extending away from the anchor (where the product will stand)
  if (on.light) {
    add({
      key: "light",
      x: sx,
      y: sy + (ld.y < 0 ? -W * 0.075 : W * 0.085),
      anchor: Math.abs(sx - ax) < W * 0.04 ? "middle" : sx < ax ? "end" : "start",
      text: `Light ${Math.round(dna.light_azimuth)}° · ${Math.round(dna.light_elevation)}° up`,
      color: "#ffd99a",
      at: at("light") + 0.5,
    });
  }
  // shadow: past the tip of its line when there is room, else just short of the tip, above the line
  // (on a small plate, like the studio's, the short form keeps it past the tip)
  if (on.shadow) {
    const room = shadowRight ? W * 0.97 - (shX + fs * 0.6) : shX - fs * 0.6 - W * 0.03;
    const t = room >= pillW("Shadow falls this way", true) ? "Shadow falls this way" : "Shadow";
    const past = room >= pillW(t, true);
    add({
      key: "shadow",
      x: past ? shX + (shadowRight ? fs * 0.6 : -fs * 0.6) : shX,
      y: past ? shY : shY - fs * 1.35,
      anchor: past === shadowRight ? "start" : "end",
      text: t,
      dot: SHADOW_INK,
      at: at("shadow") + 0.5,
    });
  }

  const tempText = `${dna.temperature[0].toUpperCase()}${dna.temperature.slice(1)} light`;
  const finishText = dna.glossy ? "Glossy: reflection on" : "Matte: no reflection";

  const reveal = (key: string, t: number, children: ReactNode) =>
    animate ? (
      <motion.span key={key} style={{ display: "inline-flex" }} initial={{ opacity: 0, y: reduced ? 0 : 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: t, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}>
        {children}
      </motion.span>
    ) : (
      <span key={key} style={{ display: "inline-flex" }}>
        {children}
      </span>
    );
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const shift: Record<Anchor, string> = { start: "0", middle: "-50%", end: "-100%" };

  return (
    <>
      <motion.svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-labelledby={`${uid}-t ${uid}-d`}
        className={className}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none", ...style }}
        initial={false}
        animate={{ opacity: dim ? 0.3 : 1 }}
        transition={{ duration: 0.9 }}
      >
        <title id={`${uid}-t`}>Scene DNA</title>
        <desc id={`${uid}-d`}>{describeDna(dna)}</desc>
        <defs>
          <radialGradient id={`${uid}-sun`}>
            <stop offset="0" stopColor="#fff3d6" />
            <stop offset="0.35" stopColor="#ffc76a" />
            <stop offset="1" stopColor="#f5a524" stopOpacity="0" />
          </radialGradient>
        </defs>

        {on.textZone && zone && (
          <motion.g {...fade("textZone")}>
            <rect
              x={zone.x * W}
              y={zone.y * H}
              width={zone.w * W}
              height={zone.h * H}
              rx={W * 0.018}
              fill="rgb(245 165 36 / 0.1)"
              stroke={accent}
              strokeWidth={sw}
              strokeDasharray={`${sw * 4} ${sw * 3}`}
            />
          </motion.g>
        )}

        {on.surface && (
          <g>
            <motion.line x1={x0} y1={ay} x2={x1} y2={ay} stroke={accent} strokeWidth={sw} strokeDasharray={`${sw * 5} ${sw * 3}`} {...draw("surface", 1.1)} />
            <motion.g {...fade("surface", 0.5)}>
              <line x1={x0} y1={ay - fs * 0.6} x2={x0} y2={ay + fs * 0.6} stroke={accent} strokeWidth={sw} />
              <line x1={x1} y1={ay - fs * 0.6} x2={x1} y2={ay + fs * 0.6} stroke={accent} strokeWidth={sw} />
            </motion.g>
          </g>
        )}

        {on.anchor && (
          <motion.g {...pop("anchor")} style={{ transformBox: "fill-box", transformOrigin: "center" }}>
            <circle cx={ax} cy={ay} r={W * 0.024} fill="none" stroke={accent} strokeWidth={sw * 1.2} />
            <line x1={ax - W * 0.055} y1={ay} x2={ax - W * 0.031} y2={ay} stroke={accent} strokeWidth={sw * 1.2} />
            <line x1={ax + W * 0.031} y1={ay} x2={ax + W * 0.055} y2={ay} stroke={accent} strokeWidth={sw * 1.2} />
            <line x1={ax} y1={ay - W * 0.055} x2={ax} y2={ay - W * 0.031} stroke={accent} strokeWidth={sw * 1.2} />
            <line x1={ax} y1={ay + W * 0.031} x2={ax} y2={ay + W * 0.055} stroke={accent} strokeWidth={sw * 1.2} />
            <circle cx={ax} cy={ay} r={W * 0.006} fill={accent} />
          </motion.g>
        )}

        {on.light && (
          <g>
            <motion.g {...fade("light")}>
              <circle cx={sx} cy={sy} r={W * 0.06} fill={`url(#${uid}-sun)`} opacity={0.9} />
              <circle cx={sx} cy={sy} r={W * 0.016} fill="#fff3d6" />
            </motion.g>
            <motion.line x1={sx} y1={sy} x2={tipX} y2={tipY} stroke="#ffc76a" strokeWidth={sw * 1.3} strokeLinecap="round" {...draw("light", 0.9)} />
            <motion.path
              d={`M ${tipX} ${tipY} L ${tipX - head * Math.cos(ang - 0.45)} ${tipY - head * Math.sin(ang - 0.45)} M ${tipX} ${tipY} L ${tipX - head * Math.cos(ang + 0.45)} ${tipY - head * Math.sin(ang + 0.45)}`}
              stroke="#ffc76a"
              strokeWidth={sw * 1.3}
              strokeLinecap="round"
              fill="none"
              {...fade("light", 0.8)}
            />
          </g>
        )}

        {on.shadow && (
          <motion.line x1={ax} y1={ay} x2={shX} y2={shY} stroke={SHADOW_INK} strokeWidth={sw * 1.1} strokeLinecap="round" strokeDasharray={`${sw * 3} ${sw * 3}`} {...draw("shadow", 0.8)} />
        )}
      </motion.svg>

      {labels && (
        // the SVG's plate space ("slice": centred, covering), so a label's fractions land on its mark
        <motion.div
          ref={layer}
          aria-hidden
          style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", borderRadius: "inherit", fontSize: px }}
          initial={false}
          animate={{ opacity: dim ? 0 : 1 }}
          transition={{ duration: 0.6 }}
        >
          <div style={{ position: "absolute", left: "50%", top: "50%", width: W * k, height: H * k, translate: "-50% -50%", visibility: k ? "visible" : "hidden" }}>
            {pills.map((p) => (
              <div key={p.key} style={{ position: "absolute", left: pct(p.x, W), top: pct(p.y, H), translate: `${shift[p.anchor]} -50%` }}>
                {reveal(
                  p.key,
                  p.at,
                  <span style={{ ...PILL, color: p.color ?? PILL.color }}>
                    {p.dot && <Dot color={p.dot} />}
                    {p.text}
                  </span>,
                )}
              </div>
            ))}

            {(on.temperature || on.finish) && (
              <div style={{ position: "absolute", left: "4%", top: "93.5%", translate: "0 -100%", display: "flex", gap: "0.5em" }}>
                {on.temperature &&
                  reveal(
                    "temperature",
                    at("temperature"),
                    <span style={PILL}>
                      <Dot color={TEMP_COLOR[dna.temperature]} />
                      {tempText}
                    </span>,
                  )}
                {on.finish &&
                  reveal(
                    "finish",
                    at("finish"),
                    <span style={PILL}>
                      <Dot color={dna.glossy ? "var(--xray-reflection, #82ded2)" : "#8e806c"} />
                      {finishText}
                    </span>,
                  )}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </>
  );
}
