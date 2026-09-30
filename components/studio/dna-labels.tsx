"use client";

import { motion } from "motion/react";
import * as React from "react";
import { lightDirection, shadowDirection, textZoneRect } from "@/components/present/SceneDnaOverlay";
import { cn } from "@/lib/client/util";
import { PLATE, type SceneDNA } from "@/lib/types";

/** A box on the 1080x1350 plate (px) that labels should stay off, e.g. the product. */
export interface PlateBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

type H = "left" | "center" | "right"; // which edge of the pill sits on the point
type V = "top" | "center" | "bottom";
interface Spot {
  x: number; // plate px
  y: number;
  h: H;
  v: V;
  gx?: number; // extra gap in css px, away from the point
  gy?: number;
}
interface Label {
  id: string;
  texts: string[]; // longest first; a shorter wording is tried only when nothing fits
  delay: number;
  warm?: boolean;
  spots: Spot[];
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const W = PLATE.width;
const HT = PLATE.height;
const DEG = Math.PI / 180;
const PAD = 6; // css px between pills, and from the stage edge

/**
 * The words next to the Scene DNA marks, as HTML pills over the overlay (which
 * draws only the lines): readable on any plate, and laid out so no two collide.
 * Positions come from the same numbers the overlay draws with (SceneDnaOverlay),
 * the timing matches its marks. `avoid` keeps them off the product where it can;
 * `keepOut` are the stage's own buttons (css px from the stage's corners).
 */
export function DnaLabels({
  dna,
  shadow = true,
  step = 0.32,
  avoid,
  keepOut = [],
}: {
  dna: SceneDNA;
  shadow?: boolean;
  step?: number;
  avoid?: PlateBox | null;
  keepOut?: { corner: "tl" | "tr" | "bl" | "br"; w: number; h: number }[];
}) {
  const labels = React.useMemo(() => labelsFor(dna, shadow, step), [dna, shadow, step]);
  const box = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);
  const [placed, setPlaced] = React.useState<Record<string, { text: string; x: number; y: number }> | null>(null);

  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setSize((s) => (s && s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const keep = JSON.stringify(keepOut);
  const avoidKey = avoid ? `${avoid.x},${avoid.y},${avoid.w},${avoid.h}` : "";
  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el || !size) return;
    // pill sizes, measured from the hidden copies below
    const measure = (id: string, i: number) => {
      const m = el.querySelector<HTMLElement>(`[data-measure="${id}-${i}"]`);
      return m ? { w: m.offsetWidth, h: m.offsetHeight } : { w: 0, h: 0 };
    };
    const k = size.w / W;
    const taken: Rect[] = (JSON.parse(keep) as typeof keepOut).map((c) => ({
      x: c.corner.endsWith("l") ? 0 : size.w - c.w,
      y: c.corner.startsWith("t") ? 0 : size.h - c.h,
      w: c.w,
      h: c.h,
    }));
    const a = avoidKey ? avoidKey.split(",").map(Number) : null;
    const soft: Rect[] = a ? [{ x: a[0] * k, y: a[1] * k, w: a[2] * k, h: a[3] * k }] : [];
    const inside = (r: Rect) => r.x >= PAD && r.y >= PAD && r.x + r.w <= size.w - PAD && r.y + r.h <= size.h - PAD;
    const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + PAD) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + PAD);
    const cost = (r: Rect, withSoft: boolean) => [...taken, ...(withSoft ? soft : [])].reduce((n, t) => n + overlap(r, t), 0);
    const rectAt = (s: Spot, m: { w: number; h: number }): Rect => {
      const px = s.x * k;
      const py = s.y * k;
      const gx = s.gx ?? 8;
      const gy = s.gy ?? 8;
      const x = s.h === "left" ? px + gx : s.h === "right" ? px - gx - m.w : px - m.w / 2;
      const y = s.v === "top" ? py + gy : s.v === "bottom" ? py - gy - m.h : py - m.h / 2;
      return { x, y, w: m.w, h: m.h };
    };
    const SLIDE = [0, -10, 10, -20, 20, -32, 32, -46, 46, -62, 62];
    const out: Record<string, { text: string; x: number; y: number }> = {};
    for (const l of labels) {
      let best: { r: Rect; text: string; c: number } | null = null;
      // strict pass (clear of everything, the product too), then allow the product, then shorter words
      search: for (const withSoft of [true, false]) {
        for (let ti = 0; ti < l.texts.length; ti++) {
          const m = measure(l.id, ti);
          for (const s of l.spots) {
            const base = rectAt(s, m);
            for (const dx of SLIDE) {
              const r = { ...base, x: base.x + dx };
              if (!inside(r)) continue;
              const c = cost(r, withSoft);
              if (c === 0) {
                best = { r, text: l.texts[ti], c };
                break search;
              }
              if (!best || c < best.c) best = { r, text: l.texts[ti], c };
            }
          }
        }
      }
      if (!best) {
        // nothing fits inside the frame: the first spot, pulled back in
        const m = measure(l.id, 0);
        const r = rectAt(l.spots[0], m);
        best = { r: { ...r, x: Math.min(Math.max(PAD, r.x), size.w - PAD - r.w), y: Math.min(Math.max(PAD, r.y), size.h - PAD - r.h) }, text: l.texts[0], c: 0 };
      }
      taken.push(best.r);
      out[l.id] = { text: best.text, x: best.r.x, y: best.r.y };
    }
    setPlaced(out);
  }, [labels, size, avoidKey, keep]);

  return (
    <div ref={box} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* hidden copies, for measuring */}
      <div className="invisible absolute top-0 left-0">
        {labels.flatMap((l) =>
          l.texts.map((t, i) => (
            <span key={`${l.id}-${i}`} data-measure={`${l.id}-${i}`} className={cn(PILL, "absolute top-0 left-0")}>
              {t}
            </span>
          )),
        )}
      </div>
      {placed
        ? labels.map((l) =>
            placed[l.id] ? (
              <motion.span
                key={l.id}
                className={cn(PILL, "absolute top-0 left-0", l.warm ? "text-[#ffd99a]" : "text-white")}
                style={{ x: placed[l.id].x, y: placed[l.id].y }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: l.delay, duration: 0.4 }}
              >
                {placed[l.id].text}
              </motion.span>
            ) : null,
          )
        : null}
    </div>
  );
}

const PILL = "rounded-full bg-black/55 px-2.5 py-1 font-sans text-[14px] leading-[1.25] font-semibold whitespace-nowrap backdrop-blur-[6px]";

/** The same geometry SceneDnaOverlay draws (weight 1.6 on the studio stage), as label spots. */
function labelsFor(dna: SceneDNA, shadowOn: boolean, step: number): Label[] {
  const ax = dna.anchor_x * W;
  const ay = dna.anchor_y * HT;
  const half = (dna.surface_width * W) / 2;
  const x0 = Math.max(W * 0.04, ax - half);
  const x1 = Math.min(W * 0.96, ax + half);
  const cross = W * 0.055; // the anchor's crosshair arms

  const L = Math.min(W, HT) * 0.4;
  const ld = lightDirection(dna);
  const clampX = (v: number) => Math.min(W * 0.93, Math.max(W * 0.07, v));
  const clampY = (v: number) => Math.min(HT * 0.93, Math.max(HT * 0.07, v));
  const sx = clampX(ax + ld.x * L);
  const sy = clampY(ay + ld.y * L);
  const sun = W * 0.065;

  const sd = shadowDirection(dna);
  const sLen = W * 0.22 * Math.min(1.6, Math.max(0.6, 1 / Math.tan(Math.max(10, dna.light_elevation) * DEG)));
  const shX = ax + sd.x * sLen;
  const shY = ay + sd.y * sLen;
  // the anchor's label goes to the side the shadow doesn't: `away` is the pill edge on the point
  const side = sd.x >= 0 ? -1 : 1;
  const away: H = sd.x >= 0 ? "right" : "left";
  const along: H = sd.x >= 0 ? "left" : "right";

  // the overlay's timing: surface, anchor, light, shadow, text zone, one after another
  const zone = textZoneRect(dna.text_zone);
  let n = 0;
  const at = { surface: n++ * step, anchor: n++ * step, light: n++ * step, shadow: shadowOn ? n++ * step : 0, zone: zone ? n++ * step : 0 };

  const out: Label[] = [];
  if (shadowOn) {
    out.push({
      id: "shadow",
      texts: ["Shadow falls this way", "Shadow"],
      delay: at.shadow + 0.5,
      spots: [
        { x: shX, y: shY, h: along, v: "center", gx: 12 },
        { x: shX, y: shY, h: "center", v: "top", gy: 10 },
        { x: shX, y: shY, h: away, v: "top", gx: -24, gy: 10 },
        { x: shX, y: shY, h: "center", v: "bottom", gy: 10 },
        { x: shX, y: shY, h: "center", v: "top", gy: 44 },
      ],
    });
  }
  out.push(
    {
      id: "anchor",
      texts: [`Anchor ${dna.anchor_x.toFixed(2)}, ${dna.anchor_y.toFixed(2)}`],
      delay: at.anchor + 0.3,
      spots: [
        { x: ax + side * cross * 0.4, y: ay + cross * 0.4, h: away, v: "top" },
        { x: ax, y: ay + cross, h: "center", v: "top", gy: 6 },
        { x: ax + side * cross, y: ay, h: away, v: "bottom", gy: 6 },
        { x: ax, y: ay + cross, h: "center", v: "top", gy: 40 },
        { x: ax - side * cross * 0.4, y: ay + cross * 0.4, h: along, v: "top" },
      ],
    },
    {
      id: "surface",
      texts: [`Surface y ${dna.anchor_y.toFixed(2)}`, `y ${dna.anchor_y.toFixed(2)}`],
      delay: at.surface + 0.5,
      spots: [
        { x: x0, y: ay, h: "left", v: "top", gx: 4, gy: 12 },
        { x: x0, y: ay, h: "left", v: "bottom", gx: 4, gy: 12 },
        { x: x1, y: ay, h: "right", v: "top", gx: 4, gy: 12 },
        { x: x1, y: ay, h: "right", v: "bottom", gx: 4, gy: 12 },
        { x: x0, y: ay, h: "left", v: "top", gx: 4, gy: 44 },
      ],
    },
    {
      id: "light",
      texts: [`Light ${Math.round(dna.light_azimuth)}°, ${Math.round(dna.light_elevation)}° up`, `Light ${Math.round(dna.light_azimuth)}°`],
      delay: at.light + 0.5,
      warm: true,
      // above the sun, then beside it (on its own side of the anchor), below it last: that's where its arrow runs
      spots: [
        { x: sx, y: sy - sun, h: "center", v: "bottom", gy: 4 },
        ...(sx < ax
          ? [
              { x: sx - sun, y: sy, h: "right" as const, v: "center" as const, gx: 4 },
              { x: sx + sun, y: sy, h: "left" as const, v: "center" as const, gx: 4 },
            ]
          : [
              { x: sx + sun, y: sy, h: "left" as const, v: "center" as const, gx: 4 },
              { x: sx - sun, y: sy, h: "right" as const, v: "center" as const, gx: 4 },
            ]),
        { x: sx, y: sy + sun, h: "center", v: "top", gy: 4 },
      ],
    },
  );
  if (zone) {
    out.push({
      id: "zone",
      texts: ["Text-safe zone"],
      delay: at.zone,
      spots: [
        { x: zone.x * W, y: zone.y * HT, h: "left", v: "top", gx: 10, gy: 10 },
        { x: (zone.x + zone.w) * W, y: zone.y * HT, h: "right", v: "top", gx: 10, gy: 10 },
        { x: zone.x * W, y: (zone.y + zone.h) * HT, h: "left", v: "bottom", gx: 10, gy: 10 },
      ],
    });
  }
  return out;
}
