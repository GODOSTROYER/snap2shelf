"use client";

import { Sun } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { SceneDnaOverlay, shadowDirection } from "../SceneDnaOverlay";
import { EASE, Img, useBeat } from "../stage";
import { abs, Rise, type ChapterProps } from "./common";

// ─── 4. Scene DNA ─────────────────────────────────────────────────────────────

export function SceneDnaChapter({ d }: ChapterProps) {
  const reduced = useReducedMotion();
  const sc = d.scene;
  const dna = sc.dna;
  const H = 880;
  const W = Math.round((H * sc.image.width) / sc.image.height);
  const L = 1080;
  const T = 100;
  const DELAY = 1.7;
  const STEP = 0.75;
  const LAND = 5.9;
  const RENDER = 8.6;
  const beat = useBeat([0.9, LAND, LAND + 0.3, RENDER]);
  const box = d.landing.box;
  const baseY = box.y + box.h;
  // cast-shadow sketch, using the same geometry as the composite's shadow layer
  // (lib/transform/composite.ts castShadow): length from elevation, direction from azimuth
  const sd = shadowDirection(dna);
  const away = sd.y <= 0; // falls back, away from the camera: upright and squashed
  const ph = box.h * sc.image.height;
  const pw = box.w * sc.image.width;
  const el = (Math.min(75, Math.max(20, dna.light_elevation)) * Math.PI) / 180;
  const len = ph * Math.min(1.1, Math.max(0.45, 1 / Math.tan(el)));
  const shiftX = sd.x * len * 0.85;
  const depth = Math.max(Math.abs(sd.y) * len, 0.09 * pw, 14);
  const skew = (-Math.atan2(shiftX, ph) * 180) / Math.PI;
  const squash = depth / ph;

  const rows = [
    { k: "Surface", v: `y ${dna.anchor_y.toFixed(2)} · ${Math.round(dna.surface_width * 100)}% wide`, at: DELAY },
    { k: "Anchor", v: `${dna.anchor_x.toFixed(2)}, ${dna.anchor_y.toFixed(2)}`, at: DELAY + STEP },
    { k: "Light", v: `from ${Math.round(dna.light_azimuth)}° · ${Math.round(dna.light_elevation)}° up`, at: DELAY + STEP * 2 },
    { k: "Text", v: d.landing.textZone ? (dna.text_zone === "none" ? "offer card, clearest band" : `${dna.text_zone.replace("_", " ")} band`) : "none", at: DELAY + STEP * 3 },
    { k: "Mood", v: `${dna.temperature} · ${dna.glossy ? "glossy" : "matte"}`, at: DELAY + STEP * 4 },
  ];

  return (
    <>
      <div style={abs(120, 110, { width: 820 })}>
        <Rise as="h1" className="pz-display pz-h2" style={{ margin: 0 }}>
          The scene tells us where the light is.
        </Rise>
        <Rise delay={0.2} as="p" className="pz-lede" style={{ margin: "26px 0 0" }}>
          AI Vision reads each scene plate once. We call it Scene DNA, and every composite on that scene is placed and lit from it.
        </Rise>
      </div>

      <dl style={abs(120, 560, { width: 760, margin: 0, display: "grid", gap: 0 })}>
        {rows.map((r) => (
          <Rise key={r.k} delay={r.at} y={10} style={{ display: "grid", gridTemplateColumns: "150px 1fr", alignItems: "baseline", padding: "13px 0", borderTop: "1px solid var(--pz-line)" }}>
            <dt className="pz-body" style={{ fontSize: 20 }}>
              {r.k}
            </dt>
            <dd className="pz-mono pz-num" style={{ margin: 0, fontSize: 26, color: "var(--pz-paper)" }}>
              {r.v}
            </dd>
          </Rise>
        ))}
      </dl>

      <motion.div className="pz-plate" style={{ left: L, top: T, width: W, height: H, borderRadius: 20 }} initial={{ opacity: 0, scale: 1.03 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1, ease: EASE }}>
        <Img src={sc.image.url} alt={sc.image.alt} className="pz-fill" fade={false} />

        {/* AI Vision reading pass */}
        {!reduced && (
          <motion.div
            aria-hidden
            style={{ position: "absolute", left: 0, right: 0, top: 0, height: 3, background: "var(--pz-marigold-hi)", boxShadow: "0 0 24px 6px rgb(245 165 36 / 0.55)" }}
            initial={{ y: 0, opacity: 0 }}
            animate={{ y: [0, H], opacity: [0, 1, 1, 0] }}
            transition={{ delay: 0.7, duration: 1.1, ease: [0.65, 0, 0.35, 1] }}
          />
        )}

        {/* the product lands on the anchor (a live sketch of what the URL does) */}
        {beat >= 2 && (
          <div style={{ position: "absolute", inset: 0 }}>
            <motion.div
              aria-hidden
              style={{
                position: "absolute",
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.w * 100}%`,
                height: `${box.h * 100}%`,
                transformOrigin: "50% 100%",
                backgroundImage: `url(${d.product.cutout.url})`,
                backgroundSize: "100% 100%",
                filter: "brightness(0) blur(7px)",
                mixBlendMode: "multiply",
              }}
              initial={{ opacity: 0, scaleY: 0.05, skewX: 0 }}
              animate={{ opacity: 0.55, scaleY: away ? squash : -squash, skewX: skew }}
              transition={{ delay: 0.3, duration: 1.1, ease: EASE }}
            />
            <motion.div
              aria-hidden
              style={{ position: "absolute", left: `${(box.x + box.w * 0.05) * 100}%`, width: `${box.w * 90}%`, top: `${baseY * 100 - 1.2}%`, height: "2.4%", borderRadius: "50%", background: "radial-gradient(closest-side, rgb(20 10 4 / 0.85), transparent)", filter: "blur(3px)" }}
              initial={{ opacity: 0, scaleX: 0.5 }}
              animate={{ opacity: 1, scaleX: 1 }}
              transition={{ delay: 0.12, duration: 0.5, ease: EASE }}
            />
            <motion.div
              style={{ position: "absolute", left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
              initial={{ y: reduced ? 0 : -H * 0.42, opacity: reduced ? 0 : 1 }}
              animate={{ y: 0, opacity: 1 }}
              transition={reduced ? { duration: 0.4 } : { type: "spring", stiffness: 260, damping: 19, mass: 1 }}
            >
              <Img src={d.product.cutout.url} alt="" className="pz-fill" fade={false} />
            </motion.div>
          </div>
        )}

        {/* Cloudinary's render of the same placement */}
        <motion.div style={{ position: "absolute", inset: 0 }} initial={{ opacity: 0 }} animate={{ opacity: beat >= 4 ? 1 : 0 }} transition={{ duration: 1.2, ease: EASE }}>
          <Img src={d.hero.url} alt={d.hero.alt} className="pz-fill" fade={false} />
        </motion.div>

        <motion.div style={{ position: "absolute", inset: 0 }} animate={{ opacity: beat >= 4 ? 0.3 : 1 }} transition={{ duration: 1 }}>
          <SceneDnaOverlay dna={dna} animate delay={DELAY} step={STEP} textZone={d.landing.textZone} textZoneLabel="Text-safe zone (offer card)" show={{ shadow: true }} />
        </motion.div>

        <motion.div
          style={{ position: "absolute", right: 22, top: 22 }}
          initial={{ opacity: 0, y: 8 }}
          animate={beat >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
          transition={{ delay: 0.5, duration: 0.5 }}
        >
          <span className="pz-chip" data-tone="lit">
            <Sun /> Rendered by Cloudinary from one URL
          </span>
        </motion.div>
      </motion.div>
    </>
  );
}

// ─── 5. One cutout, every stage ───────────────────────────────────────────────

export function Stages({ d }: ChapterProps) {
  const reduced = useReducedMotion();
  const shots = d.stages.slice(0, 4);
  const n = shots.length;
  const CW = 560;
  const CH = 700;
  const A = { cx: 1250, cy: 555 };
  const SCALE_IN = 1.2; // image zoom inside the card while the product is locked in place
  const ref = shots.reduce((s, x) => s + x.baseY, 0) / n;
  const flips = shots.map((_, i) => 0.25 + i * 1.25);
  const SPREAD = 0.25 + n * 1.25 + 0.2;
  const beat = useBeat([...flips, SPREAD]);
  const current = Math.min(n - 1, Math.max(0, beat - 1));
  const spread = beat > n;

  const s = 0.64;
  const gap = 40;
  const rowW = n * CW * s + (n - 1) * gap;
  const B = { y: 606 };
  // the library's one-off cost, spelled out: 5 + 4 + 4 + 4 = 17 (each kit then reuses these for 0)
  const libraryCredits = shots.reduce((t, x) => t + x.scene.credits, 0);
  const credits = (c: number) => `${c} ${c === 1 ? "credit" : "credits"}`;
  const bx = (i: number) => 960 - rowW / 2 + CW * s * (i + 0.5) + gap * i;
  const cur = shots[current];

  return (
    <>
      <div style={abs(120, 100, { width: 780 })}>
        <Rise as="h1" className="pz-display pz-h1" style={{ margin: 0 }}>
          One cutout.
          <br />
          Every stage.
        </Rise>
      </div>

      <motion.div style={abs(120, 390, { width: 780 })} animate={{ opacity: spread ? 0 : 1 }} transition={{ duration: 0.4 }}>
        <Rise delay={0.2} as="p" className="pz-lede" style={{ margin: 0 }}>
          The product is never regenerated. Each scene is generated once for a shared library, so every reuse costs 0 credits.
        </Rise>
        <div style={{ marginTop: 56, minHeight: 150 }}>
          <motion.div key={cur.scene.publicId} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, ease: EASE }}>
            <div className="pz-display pz-h3">{cur.scene.title}</div>
            <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
              <span className="pz-chip">Light {Math.round(cur.scene.dna.light_azimuth)}°</span>
              <span className="pz-chip">{cur.scene.dna.glossy ? "glossy: reflection" : "matte"}</span>
              <span className="pz-chip">Made once: {credits(cur.scene.credits)}</span>
              <span className="pz-chip" data-tone="lit">
                Reused here: {credits(cur.credits)}
              </span>
            </div>
          </motion.div>
        </div>
      </motion.div>

      {shots.map((shot, i) => {
        const dy = (ref - shot.baseY) * CH * SCALE_IN;
        const visibleA = i <= current;
        return (
          <motion.div
            key={shot.scene.publicId}
            className="pz-plate"
            style={{ left: A.cx - CW / 2, top: A.cy - CH / 2, width: CW, height: CH, borderRadius: 22, zIndex: spread ? 1 : i + 1, transformPerspective: 1600 }}
            initial={{ opacity: 0 }}
            animate={
              spread
                ? { opacity: 1, x: bx(i) - A.cx, y: B.y - A.cy, scale: s, rotateY: 0 }
                : { opacity: visibleA ? 1 : 0, x: 0, y: 0, scale: 1, rotateY: reduced ? 0 : visibleA ? 0 : -24 }
            }
            transition={spread ? { type: "spring", stiffness: 120, damping: 20, delay: i * 0.06 } : { duration: 0.55, ease: EASE }}
          >
            <motion.div
              style={{ position: "absolute", inset: 0 }}
              animate={spread ? { scale: 1, y: 0 } : { scale: SCALE_IN, y: dy }}
              transition={spread ? { type: "spring", stiffness: 120, damping: 20 } : { duration: 0 }}
            >
              <Img src={shot.image.url} alt={shot.image.alt} className="pz-fill" fade={false} />
            </motion.div>
          </motion.div>
        );
      })}

      {shots.map((shot, i) => (
        <motion.div
          key={`cap-${shot.scene.publicId}`}
          style={abs(bx(i) - (CW * s) / 2, B.y + (CH * s) / 2 + 18, { width: CW * s, textAlign: "center" })}
          initial={{ opacity: 0, y: 8 }}
          animate={spread ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
          transition={{ delay: spread ? 0.35 + i * 0.08 : 0, duration: 0.45 }}
        >
          <div className="pz-display" style={{ fontSize: 28 }}>
            {shot.scene.title}
          </div>
          <div className="pz-small" style={{ marginTop: 4 }}>
            {shot.scene.dna.glossy ? "Glossy, so a reflection" : "Matte surface"} · made once, {credits(shot.scene.credits)}
          </div>
        </motion.div>
      ))}

      <motion.div
        style={abs(960, 930, { translate: "-50% 0", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 18 })}
        initial={{ opacity: 0 }}
        animate={{ opacity: spread ? 1 : 0 }}
        transition={{ delay: spread ? 0.8 : 0, duration: 0.5 }}
      >
        <span className="pz-chip" data-tone="lit">
          1 cutout · {n} scenes · {shots.reduce((t, x) => t + x.credits, 0)} new generation credits
        </span>
        <span className="pz-small" style={{ fontSize: 19, color: "var(--pz-dim)" }}>
          The library paid {shots.map((x) => x.scene.credits).join(" + ")} = {credits(libraryCredits)} once, when these scenes were made.
        </span>
      </motion.div>
    </>
  );
}
