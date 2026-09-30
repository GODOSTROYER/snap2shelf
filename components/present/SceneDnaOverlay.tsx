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
 */
import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";
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
  /** Stroke and label size multiplier, for small viewers (the studio stage). Default 1. */
  weight?: number;
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
  className,
  style,
}: SceneDnaOverlayProps) {
  const reduced = useReducedMotion();
  const uid = useId().replace(/:/g, "");
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

  const fs = W * 0.024 * Math.sqrt(weight); // label size in plate units
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

  const halo = { stroke: "rgb(14 12 10 / 0.78)", strokeWidth: fs * 0.3, paintOrder: "stroke" as const, strokeLinejoin: "round" as const };
  const label = (x: number, y: number, t: string, anchor: "start" | "middle" | "end" = "start", color = "#f4ece0") =>
    labels ? (
      <text x={x} y={y} textAnchor={anchor} fontSize={fs} fontWeight={600} fill={color} style={{ fontFamily: "var(--pz-font-text), system-ui, sans-serif" }} {...halo}>
        {t}
      </text>
    ) : null;

  const chip = (x: number, y: number, t: string, dot: string) => {
    const cw = t.length * fs * 0.54 + fs * 2.2;
    const ch = fs * 1.9;
    return (
      <g>
        <rect x={x} y={y} width={cw} height={ch} rx={ch / 2} fill="rgb(14 12 10 / 0.78)" stroke="rgb(244 236 224 / 0.25)" strokeWidth={sw * 0.5} />
        <circle cx={x + fs * 0.95} cy={y + ch / 2} r={fs * 0.32} fill={dot} />
        <text x={x + fs * 1.6} y={y + ch / 2 + fs * 0.35} fontSize={fs} fontWeight={600} fill="#f4ece0" style={{ fontFamily: "var(--pz-font-text), system-ui, sans-serif" }}>
          {t}
        </text>
      </g>
    );
  };

  const tempText = `${dna.temperature[0].toUpperCase()}${dna.temperature.slice(1)} light`;
  const finishText = dna.glossy ? "Glossy: reflection on" : "Matte: no reflection";
  const tempW = tempText.length * fs * 0.54 + fs * 2.2;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-labelledby={`${uid}-t ${uid}-d`}
      className={className}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible", pointerEvents: "none", ...style }}
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
          {label(zone.x * W + fs * 0.8, zone.y * H + fs * 1.5, textZoneLabel)}
        </motion.g>
      )}

      {on.surface && (
        <g>
          <motion.line x1={x0} y1={ay} x2={x1} y2={ay} stroke={accent} strokeWidth={sw} strokeDasharray={`${sw * 5} ${sw * 3}`} {...draw("surface", 1.1)} />
          <motion.g {...fade("surface", 0.5)}>
            <line x1={x0} y1={ay - fs * 0.6} x2={x0} y2={ay + fs * 0.6} stroke={accent} strokeWidth={sw} />
            <line x1={x1} y1={ay - fs * 0.6} x2={x1} y2={ay + fs * 0.6} stroke={accent} strokeWidth={sw} />
            {label(x0 + fs * 0.6, ay + fs * 1.7, `Surface  y ${dna.anchor_y.toFixed(2)}`)}
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
      {on.anchor && <motion.g {...fade("anchor", 0.3)}>{label(ax + W * 0.04, ay + fs * 2.1, `Anchor  ${dna.anchor_x.toFixed(2)}, ${dna.anchor_y.toFixed(2)}`)}</motion.g>}

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
          <motion.g {...fade("light", 0.5)}>
            {label(sx, sy + (ld.y < 0 ? -W * 0.075 : W * 0.095), `Light ${Math.round(dna.light_azimuth)}°`, sx < W * 0.3 ? "start" : sx > W * 0.7 ? "end" : "middle", "#ffd99a")}
            {label(sx, sy + (ld.y < 0 ? -W * 0.075 : W * 0.095) + fs * 1.25, `${Math.round(dna.light_elevation)}° up`, sx < W * 0.3 ? "start" : sx > W * 0.7 ? "end" : "middle", "#ffd99a")}
          </motion.g>
        </g>
      )}

      {on.shadow && (
        <g>
          <motion.line x1={ax} y1={ay} x2={shX} y2={shY} stroke="#d8cebf" strokeWidth={sw} strokeDasharray={`${sw * 3} ${sw * 3}`} {...draw("shadow", 0.8)} />
          <motion.g {...fade("shadow", 0.5)}>{label(shX, shY - fs * 0.9, "Shadow falls this way", shX > W * 0.6 ? "end" : "start", "#e8dfd2")}</motion.g>
        </g>
      )}

      {(on.temperature || on.finish) && (
        <motion.g {...fade("temperature")}>
          {on.temperature && chip(W * 0.04, H * 0.935 - fs * 1.9, tempText, TEMP_COLOR[dna.temperature])}
          {on.finish && chip(W * 0.04 + (on.temperature ? tempW + fs * 0.6 : 0), H * 0.935 - fs * 1.9, finishText, dna.glossy ? "#9fe6f2" : "#8e806c")}
        </motion.g>
      )}
    </svg>
  );
}
