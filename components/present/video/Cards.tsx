"use client";

/**
 * 1920×1080 title and outro cards for screen capture. Each builds in over
 * ~2.5 s, then holds with an ambient loop whose period is 6 s, so any 6 s of
 * the hold loops seamlessly. `?hold=1` starts in the settled state (no build),
 * R replays the build. Reduced motion: the build is a crossfade, no loop.
 */
import { motion, MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { PRESENT } from "@/lib/present/data";
import { QrCode } from "../QrCode";
import { Artboard, Backdrop, EASE, Img, Mark } from "../stage";

const LOOP = 6;

function useReplay() {
  const [run, setRun] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey) setRun((r) => r + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return run;
}

function Shell({ children, light, label }: { children: React.ReactNode; light: { x: number; y: number }; label: string }) {
  return (
    <MotionConfig reducedMotion="user">
      <main className="pz-video-root" aria-label={label}>
        <Backdrop light={light} />
        <Artboard label={label}>{children}</Artboard>
      </main>
    </MotionConfig>
  );
}

/** Ambient breathing of the key light, 6 s period. */
function Breath({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      aria-hidden
      style={{ position: "absolute", left: cx - r, top: cy - r, width: r * 2, height: r * 2, borderRadius: "50%", background: "radial-gradient(closest-side, rgb(255 180 80 / 0.16), transparent)", pointerEvents: "none" }}
      animate={reduced ? { opacity: 0.8 } : { opacity: [0.65, 1, 0.65], scale: [1, 1.05, 1] }}
      transition={{ duration: LOOP, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

/** True once every image is decoded (or after `maxMs`), so a build never starts on missing pixels. */
function useImagesReady(urls: readonly string[], maxMs = 2500) {
  const [ready, setReady] = useState(false);
  const key = urls.join("|");
  useEffect(() => {
    let live = true;
    const done = () => live && setReady(true);
    const timer = window.setTimeout(done, maxMs);
    Promise.all(
      key.split("|").map((u) => {
        const img = new Image();
        img.src = u;
        return img.decode().catch(() => {});
      }),
    ).then(done);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [key, maxMs]);
  return ready;
}

/**
 * Standing height on the title shelf (px), so the products keep believable
 * relative sizes. Every cutout is drawn at or below its native resolution
 * (crisp at 1920×1080): the tallest, the bottle, is 400 px from 1223 px.
 */
const TITLE_HEIGHT: Record<string, number> = { s2candle: 170, s2trlmix: 300, "9uo8w8pc": 400, zi86lf6a: 180 };
const TITLE_GAP = 64;
/** Depth of the ledge's top face (px) and where a product's base rests on it: just behind the lit front edge. */
const LEDGE_DEPTH = 24;
const BASE_INSET = 7;

export function TitleCard({ hold = false }: { hold?: boolean }) {
  const run = useReplay();
  const d = PRESENT;
  const reduced = useReducedMotion();
  const SHELF_Y = 470;
  const BASE_Y = SHELF_Y - BASE_INSET;
  // the real Demo Studio shelf, standing on the ledge: native-resolution cutouts, only ever scaled down
  const items = d.shelf.products.map((p) => {
    const h = Math.min(TITLE_HEIGHT[p.sku] ?? 300, p.cutout.height);
    return { ...p.cutout, sku: p.sku, h, w: Math.round((h * p.cutout.width) / p.cutout.height) };
  });
  const rowW = items.reduce((n, it) => n + it.w, 0) + TITLE_GAP * Math.max(0, items.length - 1);
  const xs = items.map((_, i) => 960 - rowW / 2 + items.slice(0, i).reduce((n, it) => n + it.w + TITLE_GAP, 0));
  const ready = useImagesReady(items.map((it) => it.url));
  const skip = hold && run === 0;
  const t = (s: number) => (skip ? 0 : s);
  const dur = (s: number) => (skip ? 0 : s);

  return (
    <Shell light={{ x: 0.5, y: 0.4 }} label="Snap2Shelf title card">
      {/* the build mounts only once every cutout is decoded, so its timeline starts on real pixels */}
      {(ready || skip) && (
      <div key={run} style={{ position: "absolute", inset: 0 }}>
        <Breath cx={960} cy={SHELF_Y - 60} r={620} />

        {/* shutter flash */}
        {!skip && (
          <motion.div
            aria-hidden
            style={{ position: "absolute", inset: 0, background: "#fff8ec", zIndex: 30 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, reduced ? 0.3 : 0.9, 0] }}
            transition={{ delay: 0.15, duration: 0.5, times: [0, 0.12, 1] }}
          />
        )}

        {/* the shelf: a lit ledge the product lands on */}
        <motion.div
          aria-hidden
          style={{ position: "absolute", left: 960 - 520, top: SHELF_Y, width: 1040, height: 4, borderRadius: 2, background: "linear-gradient(90deg, transparent, var(--pz-saffron) 18%, var(--pz-marigold-hi) 50%, var(--pz-saffron) 82%, transparent)", boxShadow: "0 0 28px rgb(245 165 36 / 0.55)", transformOrigin: "center" }}
          initial={{ scaleX: skip ? 1 : 0, opacity: skip ? 1 : 0 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ delay: t(0.35), duration: dur(0.9), ease: EASE }}
        />
        {!reduced && (
          <motion.div
            aria-hidden
            style={{ position: "absolute", left: 960 - 520, top: SHELF_Y - 3, width: 90, height: 10, borderRadius: 5, background: "radial-gradient(closest-side, #fff4dc, transparent)", filter: "blur(1px)" }}
            initial={{ x: 0, opacity: 0 }}
            animate={{ x: [0, 950], opacity: [0, 1, 1, 0] }}
            transition={{ delay: t(2.4), duration: LOOP, repeat: Infinity, ease: "easeInOut" }}
          />
        )}

        {/* the ledge's top face: a sliver of lit surface for the products to stand on, and to shadow */}
        <motion.div
          aria-hidden
          style={{
            position: "absolute",
            left: 960 - 540,
            top: SHELF_Y - LEDGE_DEPTH,
            width: 1080,
            height: LEDGE_DEPTH,
            background: "linear-gradient(180deg, rgb(150 104 52 / 0), rgb(175 121 60 / 0.24) 50%, rgb(210 146 70 / 0.4))",
            WebkitMaskImage: "linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent)",
            maskImage: "linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent)",
            transformOrigin: "center",
          }}
          initial={{ scaleX: skip ? 1 : 0, opacity: skip ? 1 : 0 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ delay: t(0.35), duration: dur(0.9), ease: EASE }}
        />

        {/* the products land one by one; each contact shadow blooms as it touches down:
            a soft ambient pool a little wider than the product, and a tight dark line right under its base */}
        {items.map((it, i) => (
          <motion.div
            key={`shadow-${it.sku}`}
            aria-hidden
            style={{ position: "absolute", left: xs[i] - it.w * 0.14, top: BASE_Y - 11, width: it.w * 1.28, height: 22, transformOrigin: "50% 50%" }}
            initial={{ opacity: skip ? 1 : 0, scaleX: skip ? 1 : 0.35 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ delay: t(0.78 + i * 0.16), duration: dur(0.55), ease: EASE }}
          >
            <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "radial-gradient(closest-side, rgb(8 5 2 / 0.62), rgb(8 5 2 / 0.25) 60%, transparent)", filter: "blur(4px)" }} />
            <span style={{ position: "absolute", left: "13%", right: "13%", top: 7, height: 8, borderRadius: "50%", background: "radial-gradient(closest-side, rgb(4 2 0 / 0.95), rgb(4 2 0 / 0.55) 55%, transparent)", filter: "blur(1.5px)" }} />
          </motion.div>
        ))}
        {items.map((it, i) => (
          <motion.div
            key={it.sku}
            style={{ position: "absolute", left: xs[i], top: BASE_Y - it.h, width: it.w, height: it.h }}
            initial={skip ? false : { y: reduced ? 0 : -380, opacity: reduced ? 0 : 1 }}
            animate={{ y: 0, opacity: 1 }}
            transition={reduced ? { delay: t(0.6 + i * 0.16), duration: 0.5 } : { delay: t(0.6 + i * 0.16), type: "spring", stiffness: 240, damping: 17 }}
          >
            <Img src={it.url} alt={it.alt} className="pz-fill" fade={false} fetchPriority="high" style={{ objectFit: "contain" }} />
          </motion.div>
        ))}

        <div style={{ position: "absolute", left: 0, top: 540, width: 1920, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <motion.h1
            className="pz-display"
            style={{ fontSize: 232, margin: 0, fontWeight: 790, letterSpacing: "-0.026em" }}
            initial={skip ? false : { opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: t(1.15), duration: dur(0.9), ease: EASE }}
          >
            Snap2Shelf
          </motion.h1>
          <motion.p
            className="pz-display"
            style={{ fontSize: 46, margin: "18px 0 0", fontWeight: 560, letterSpacing: "-0.02em", color: "var(--pz-paper)" }}
            initial={skip ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: t(1.6), duration: dur(0.8), ease: EASE }}
          >
            One photo. A whole shelf. <span style={{ color: "var(--pz-dim)" }}>AI builds the stage — your product stays real.</span>
          </motion.p>
          <motion.p
            style={{ fontSize: 26, margin: "56px 0 0", color: "var(--pz-dim)", display: "flex", alignItems: "center", gap: 14 }}
            initial={skip ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: t(2.1), duration: dur(0.8) }}
          >
            <Mark size={30} />
            Track 2 · Generative Content Workflows · built on Cloudinary
          </motion.p>
        </div>
      </div>
      )}
    </Shell>
  );
}

function Corners({ size, color = "var(--pz-marigold-hi)" }: { size: number; color?: string }) {
  const len = size * 0.14;
  const c = { position: "absolute" as const, width: len, height: len, borderColor: color, borderStyle: "solid" as const };
  return (
    <div aria-hidden style={{ position: "absolute", inset: -26 }}>
      <span style={{ ...c, left: 0, top: 0, borderWidth: "4px 0 0 4px", borderTopLeftRadius: 14 }} />
      <span style={{ ...c, right: 0, top: 0, borderWidth: "4px 4px 0 0", borderTopRightRadius: 14 }} />
      <span style={{ ...c, left: 0, bottom: 0, borderWidth: "0 0 4px 4px", borderBottomLeftRadius: 14 }} />
      <span style={{ ...c, right: 0, bottom: 0, borderWidth: "0 4px 4px 0", borderBottomRightRadius: 14 }} />
    </div>
  );
}

export function OutroCard({ hold = false }: { hold?: boolean }) {
  const run = useReplay();
  const reduced = useReducedMotion();
  const d = PRESENT;
  const skip = hold && run === 0;
  const t = (s: number) => (skip ? 0 : s);
  const QR = 380;
  const rise = (delay: number) => ({
    initial: skip ? (false as const) : { opacity: 0, y: 26 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: t(delay), duration: skip ? 0 : 0.8, ease: EASE },
  });

  return (
    <Shell light={{ x: 0.66, y: 0.46 }} label="Snap2Shelf outro card">
      <div key={run} style={{ position: "absolute", inset: 0 }}>
        <Breath cx={1450} cy={500} r={560} />

        <div style={{ position: "absolute", left: 150, top: 200, width: 1000 }}>
          <motion.h1 className="pz-display" style={{ fontSize: 150, margin: 0, fontWeight: 780, lineHeight: 0.95 }} {...rise(0.2)}>
            Try it —
            <br />
            no signup.
          </motion.h1>
          <motion.a
            href={d.site.url}
            className="pz-display"
            style={{ display: "block", fontSize: 76, marginTop: 64, color: "var(--pz-marigold-hi)", textDecoration: "none", fontWeight: 700, letterSpacing: "-0.03em" }}
            {...rise(0.7)}
          >
            {d.site.host}
          </motion.a>
          <motion.p style={{ fontSize: 34, margin: "22px 0 0", color: "var(--pz-dim)" }} {...rise(1.0)}>
            Code: <span style={{ color: "var(--pz-paper)" }}>{d.site.repoLabel}</span>
          </motion.p>
        </div>

        <motion.div style={{ position: "absolute", left: 1450 - QR / 2, top: 500 - QR / 2 - 20, width: QR, height: QR }} {...rise(0.5)}>
          <motion.div
            style={{ position: "absolute", inset: 0 }}
            animate={reduced ? {} : { scale: [1.06, 1, 1, 1.06] }}
            transition={{ delay: t(1.4), duration: LOOP, repeat: Infinity, times: [0, 0.12, 0.88, 1], ease: EASE }}
          >
            <Corners size={QR} />
          </motion.div>
          <div style={{ position: "absolute", inset: 0, borderRadius: 26, overflow: "hidden", boxShadow: "0 40px 80px -30px rgb(0 0 0 / 0.9), 0 0 0 1px rgb(255 255 255 / 0.08)" }}>
            <QrCode value={d.site.url} size={QR} quiet={3} />
          </div>
          <p style={{ position: "absolute", top: QR + 44, left: -60, right: -60, textAlign: "center", fontSize: 26, color: "var(--pz-dim)", margin: 0 }}>Scan to open the live site</p>
        </motion.div>

        <motion.div
          style={{ position: "absolute", left: 150, right: 150, bottom: 110, display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--pz-line)", paddingTop: 34 }}
          {...rise(1.3)}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 14 }}>
            <Mark size={40} />
            <span className="pz-display" style={{ fontSize: 40, fontWeight: 760, letterSpacing: "-0.03em" }}>
              Snap2Shelf
            </span>
          </span>
          <span style={{ fontSize: 26, color: "var(--pz-dim)" }}>Pixels to Products · Track 2 · built on Cloudinary</span>
        </motion.div>
      </div>
    </Shell>
  );
}
