"use client";

import { Sun } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { CSSProperties } from "react";
import { SceneDnaOverlay, shadowDirection } from "../SceneDnaOverlay";
import { EASE, Img, useBeat } from "../stage";
import { abs, Rise, type ChapterProps } from "./common";

/** Label on top of a photo: dark glass, so it reads on bright marble and dark wood alike. */
const GLASS: CSSProperties = {
  background: "rgb(0 0 0 / 0.55)",
  backdropFilter: "blur(6px)",
  WebkitBackdropFilter: "blur(6px)",
  borderColor: "rgb(244 236 224 / 0.16)",
};
const GLASS_LIT: CSSProperties = { ...GLASS, borderColor: "rgb(245 165 36 / 0.55)", color: "var(--pz-marigold-hi)" };

/** Thin corner brackets around a box (fractions of the parent), marking something that stays put. */
function LockBrackets({ box, pad = 10, len = 22 }: { box: { x: number; y: number; w: number; h: number }; pad?: number; len?: number }) {
  const c: CSSProperties = { position: "absolute", width: len, height: len, borderColor: "var(--pz-marigold-hi)", borderStyle: "solid", opacity: 0.85 };
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: `calc(${box.x * 100}% - ${pad}px)`,
        top: `calc(${box.y * 100}% - ${pad}px)`,
        width: `calc(${box.w * 100}% + ${pad * 2}px)`,
        height: `calc(${box.h * 100}% + ${pad * 2}px)`,
        filter: "drop-shadow(0 0 6px rgb(0 0 0 / 0.6))",
      }}
    >
      <span style={{ ...c, left: 0, top: 0, borderWidth: "2px 0 0 2px", borderTopLeftRadius: 6 }} />
      <span style={{ ...c, right: 0, top: 0, borderWidth: "2px 2px 0 0", borderTopRightRadius: 6 }} />
      <span style={{ ...c, left: 0, bottom: 0, borderWidth: "0 0 2px 2px", borderBottomLeftRadius: 6 }} />
      <span style={{ ...c, right: 0, bottom: 0, borderWidth: "0 2px 2px 0", borderBottomRightRadius: 6 }} />
    </div>
  );
}

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
  const PROOF = 10.6; // pixel proof: the cut-out, difference-blended over the render
  const PROOF_IN = 1.5;
  const beat = useBeat([0.9, LAND, LAND + 0.3, RENDER, PROOF]);
  const proof = beat >= 5;
  // d.landing.box is the geometry the hero URL was built with (lib/present/data.ts), so the
  // sketch, the render and the pixel proof all sit on exactly the same pixels
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

      <motion.dl style={abs(120, 560, { width: 760, margin: 0, display: "grid", gap: 0 })} animate={{ opacity: proof ? 0 : 1, y: proof && !reduced ? -10 : 0 }} transition={{ duration: 0.5, ease: EASE }}>
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
      </motion.dl>

      {/* pixel proof: what the difference blend on the plate means */}
      {proof && (
        <div style={abs(120, 560, { width: 760 })}>
          <Rise delay={0.3} y={14} className="pz-small" style={{ margin: 0, fontSize: 17, fontWeight: 650, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--pz-marigold)" }}>
            Pixel proof
          </Rise>
          <Rise delay={0.45} y={14} as="h2" className="pz-display pz-h3" style={{ margin: "14px 0 0" }}>
            Only the light changed.
          </Rise>
          <Rise delay={PROOF_IN} y={10} as="p" className="pz-body" style={{ margin: "22px 0 0", maxWidth: 700 }}>
            The original cut-out, laid over Cloudinary&rsquo;s render in difference mode. Pixels that match cancel to black, and the product goes black: it was never redrawn.
          </Rise>
          <Rise delay={PROOF_IN + 0.5} y={10} as="p" className="pz-body" style={{ margin: "14px 0 0", maxWidth: 700, color: "var(--pz-paper)" }}>
            The faint glow is the light-match: the scene&rsquo;s light falling across it.
          </Rise>
        </div>
      )}

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

        {/* pixel proof: the untouched cut-out on the render's own product box, difference-blended.
            Same pixels cancel to black; what is left is the light-match. Swept in top to bottom. */}
        <motion.div
          aria-hidden
          style={{ position: "absolute", left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, mixBlendMode: "difference" }}
          initial={reduced ? { opacity: 0 } : { clipPath: "inset(0% 0% 100% 0%)" }}
          animate={reduced ? { opacity: proof ? 1 : 0 } : { clipPath: proof ? "inset(0% 0% 0% 0%)" : "inset(0% 0% 100% 0%)" }}
          transition={{ duration: reduced ? 0.5 : PROOF_IN, ease: [0.65, 0, 0.35, 1] }}
        >
          <Img src={d.product.cutout.url} alt="" className="pz-fill" fade={false} />
        </motion.div>
        {proof && !reduced && (
          <motion.div
            aria-hidden
            style={{ position: "absolute", left: `${(box.x - box.w * 0.35) * 100}%`, width: `${box.w * 170}%`, top: `${box.y * 100}%`, height: 3, marginTop: -1.5, background: "var(--pz-marigold-hi)", boxShadow: "0 0 16px 4px rgb(245 165 36 / 0.6)", borderRadius: 2 }}
            initial={{ y: 0, opacity: 0 }}
            animate={{ y: [0, box.h * H], opacity: [0, 1, 1, 0] }}
            transition={{ y: { duration: PROOF_IN, ease: [0.65, 0, 0.35, 1] }, opacity: { duration: PROOF_IN, times: [0, 0.08, 0.9, 1] } }}
          />
        )}

        <motion.div style={{ position: "absolute", inset: 0, borderRadius: "inherit" }} animate={{ opacity: proof ? 0 : 1 }} transition={{ duration: 0.5 }}>
          <SceneDnaOverlay dna={dna} animate delay={DELAY} step={STEP} textZone={d.landing.textZone} textZoneLabel="Text-safe zone (offer card)" show={{ shadow: true }} dim={beat >= 4} />
        </motion.div>

        {/* bottom right: clear of the text-safe zone (top) and the mood pills (bottom left) */}
        <motion.div
          style={{ position: "absolute", right: 22, bottom: 22 }}
          initial={{ opacity: 0, y: 8 }}
          animate={beat >= 4 && !proof ? { opacity: 1, y: 0 } : { opacity: 0, y: beat >= 4 ? 0 : 8 }}
          transition={{ delay: beat >= 4 && !proof ? 0.5 : 0, duration: 0.45 }}
        >
          <span className="pz-chip" style={GLASS_LIT}>
            <Sun /> Rendered by Cloudinary from one URL
          </span>
        </motion.div>
        <motion.div style={{ position: "absolute", right: 22, bottom: 22 }} initial={{ opacity: 0, y: 8 }} animate={proof ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }} transition={{ delay: proof ? 0.4 : 0, duration: 0.45 }}>
          <span className="pz-chip pz-mono" style={{ ...GLASS, fontSize: 16 }}>
            cut-out · mix-blend-mode: difference
          </span>
        </motion.div>
      </motion.div>
    </>
  );
}

// ─── 5. One cutout, every stage: the product-locked wipe ──────────────────────

/*
 * Every stage URL is composited with the SAME placement (lib/present/data.ts),
 * so the four renders share the product's pixels exactly. Stacked in one
 * frame, each scene wipes in over the last and the product never moves; then
 * the stack fans out into a row. The wipe line is the cutout chapter's.
 */
export function Stages({ d }: ChapterProps) {
  const reduced = useReducedMotion();
  const shots = d.stages.slice(0, 4);
  const n = shots.length;
  const box = d.landing.box; // the hero's placement, which every stage shares
  // the frame sits exactly where chapter 4's plate was (same box, same product pixels), so the
  // pixel-proof silhouette dissolves straight into this first, identical render
  const FH = 880;
  const FW = Math.round((FH * shots[0].image.width) / shots[0].image.height);
  const A = { cx: 1080 + FW / 2, cy: 100 + FH / 2 };
  const WIPE = 0.95;
  const wipes = shots.slice(1).map((_, i) => 1.4 + i * 1.6); // shot i + 1 wipes in at wipes[i]
  const SPREAD = (wipes.at(-1) ?? 0.4) + WIPE + 0.8;
  const started = useBeat(wipes);
  const named = useBeat(wipes.map((t) => t + WIPE * 0.45)); // the copy switches as the line crosses the middle
  const spread = useBeat([SPREAD]) >= 1;
  const cur = shots[Math.min(n - 1, named)];

  const s = (0.64 * 560) / FW; // spread card scale: a row of 358 px cards
  const gap = 40;
  const cw = FW * s;
  const rowW = n * cw + (n - 1) * gap;
  const B = { y: 606 };
  // the library's one-off cost, spelled out: 5 + 4 + 4 + 4 = 17 (each kit then reuses these for 0)
  const libraryCredits = shots.reduce((t, x) => t + x.scene.credits, 0);
  const credits = (c: number) => `${c} ${c === 1 ? "credit" : "credits"}`;
  const bx = (i: number) => 960 - rowW / 2 + cw * (i + 0.5) + gap * i;

  return (
    <>
      <div style={abs(120, 100, { width: 780 })}>
        <Rise as="h1" className="pz-display pz-h1" style={{ margin: 0 }}>
          One cutout.
          <br />
          Every stage.
        </Rise>
      </div>

      <motion.div style={abs(120, 390, { width: 800 })} animate={{ opacity: spread ? 0 : 1 }} transition={{ duration: 0.4 }}>
        <Rise delay={0.2} as="p" className="pz-lede" style={{ margin: 0 }}>
          The product never moves and is never regenerated. Only the scene and its light change.
        </Rise>
        <div style={{ marginTop: 50, minHeight: 150 }}>
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
        // i = 0 is the base of the stack; every later shot starts fully clipped and wipes in from the left
        const shown = i === 0 || started >= i;
        return (
          <motion.div
            key={shot.scene.publicId}
            className="pz-plate"
            style={{
              left: A.cx - FW / 2,
              top: A.cy - FH / 2,
              width: FW,
              height: FH,
              borderRadius: 20,
              zIndex: i + 1,
              background: i === 0 ? undefined : "transparent",
              // stacked plates share one drop shadow until they fan out
              boxShadow: i === 0 || spread ? undefined : "none",
            }}
            // no fade of its own: the chapter crossfade alone hands chapter 4's identical render over to this one
            initial={{ opacity: 1 }}
            animate={spread ? { opacity: 1, x: bx(i) - A.cx, y: B.y - A.cy, scale: s } : { opacity: 1, x: 0, y: 0, scale: 1 }}
            transition={spread ? { type: "spring", stiffness: 120, damping: 20, delay: (n - 1 - i) * 0.06 } : { duration: 0.5 }}
          >
            <motion.div
              style={{ position: "absolute", inset: 0, borderRadius: "inherit", overflow: "hidden" }}
              initial={i === 0 ? false : reduced ? { opacity: 0 } : { clipPath: "inset(0% 100% 0% 0%)" }}
              animate={i === 0 ? {} : reduced ? { opacity: shown ? 1 : 0 } : { clipPath: shown ? "inset(0% 0% 0% 0%)" : "inset(0% 100% 0% 0%)" }}
              transition={{ duration: reduced ? 0.45 : WIPE, ease: [0.65, 0, 0.35, 1] }}
            >
              <Img src={shot.image.url} alt={shot.image.alt} className="pz-fill" fade={false} />
              {/* the scene's name rides in with its wipe; the one underneath steps out of its way */}
              <motion.span
                className="pz-chip"
                style={{ ...GLASS, position: "absolute", left: 20, top: 20, height: 38, fontSize: 17 }}
                animate={{ opacity: spread || started > i ? 0 : 1 }}
                transition={{ duration: started > i ? 0.15 : 0.3 }}
              >
                {shot.scene.title}
              </motion.span>
            </motion.div>
          </motion.div>
        );
      })}

      {/* the lock: brackets around the product, and the wipe line (same as the cutout chapter's) */}
      <div aria-hidden style={abs(A.cx - FW / 2, A.cy - FH / 2, { width: FW, height: FH, zIndex: n + 2, pointerEvents: "none" })}>
        <motion.div style={{ position: "absolute", inset: 0 }} initial={{ opacity: 0 }} animate={{ opacity: spread ? 0 : started >= 1 ? 1 : 0 }} transition={{ duration: spread ? 0.25 : 0.5 }}>
          <LockBrackets box={box} />
          <span className="pz-chip" style={{ ...GLASS, position: "absolute", left: `${(box.x + box.w / 2) * 100}%`, top: `calc(${box.y * 100}% - 64px)`, translate: "-50% 0", height: 34, fontSize: 15, color: "var(--pz-marigold-hi)" }}>
            Same pixels in every scene
          </span>
        </motion.div>
        {!reduced &&
          wipes.map(
            (t, k) =>
              started > k && (
                <motion.div
                  key={t}
                  className="pz-scanline"
                  style={{ left: 0, top: 0, bottom: 0 }}
                  initial={{ x: 0, opacity: 0 }}
                  animate={{ x: [0, FW], opacity: [0, 1, 1, 0] }}
                  transition={{ x: { duration: WIPE, ease: [0.65, 0, 0.35, 1] }, opacity: { duration: WIPE, times: [0, 0.08, 0.88, 1] } }}
                />
              ),
          )}
      </div>

      {shots.map((shot, i) => (
        <motion.div
          key={`cap-${shot.scene.publicId}`}
          style={abs(bx(i) - cw / 2, B.y + (FH * s) / 2 + 18, { width: cw, textAlign: "center" })}
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
