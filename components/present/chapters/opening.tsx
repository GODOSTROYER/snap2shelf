"use client";

import { Layers, Package, ScanLine, Scissors, ShieldCheck, SunMedium, WandSparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { PipelineStepId } from "@/lib/types";
import { CountUp, EASE, Img, useBeat } from "../stage";
import { abs, fmtBytes, Rise, type ChapterProps } from "./common";

// ─── 1. Cold open ─────────────────────────────────────────────────────────────

function Corners({ w, h, len = 46, t = 3, color = "var(--pz-marigold-hi)" }: { w: number; h: number; len?: number; t?: number; color?: string }) {
  const c = { position: "absolute" as const, width: len, height: len, borderColor: color, borderStyle: "solid" as const };
  return (
    <div style={{ position: "relative", width: w, height: h }} aria-hidden>
      <span style={{ ...c, left: 0, top: 0, borderWidth: `${t}px 0 0 ${t}px`, borderTopLeftRadius: 10 }} />
      <span style={{ ...c, right: 0, top: 0, borderWidth: `${t}px ${t}px 0 0`, borderTopRightRadius: 10 }} />
      <span style={{ ...c, left: 0, bottom: 0, borderWidth: `0 0 ${t}px ${t}px`, borderBottomLeftRadius: 10 }} />
      <span style={{ ...c, right: 0, bottom: 0, borderWidth: `0 ${t}px ${t}px 0`, borderBottomRightRadius: 10 }} />
    </div>
  );
}

export function ColdOpen({ d }: ChapterProps) {
  const reduced = useReducedMotion();
  const raw = d.product.raw;
  const h = 800;
  const w = Math.round((h * raw.width) / raw.height);
  const cx = 1390;
  const left = cx - w / 2;
  const top = 132;
  const shot = 0.85; // shutter moment

  return (
    <>
      {/* focus lock, then the shutter */}
      <motion.div
        style={abs(left - 36, top - 36)}
        initial={{ opacity: 0, scale: 1.12 }}
        animate={{ opacity: [0, 1, 1, 0], scale: [1.12, 1, 1, 0.985] }}
        transition={{ duration: shot + 0.35, times: [0, 0.35, 0.8, 1], ease: EASE }}
      >
        <Corners w={w + 72} h={h + 72} />
      </motion.div>

      <motion.figure
        style={{ ...abs(left, top), width: w, height: h, margin: 0 }}
        initial={{ opacity: 0, y: reduced ? 0 : -70, rotate: reduced ? -2.5 : -8, scale: reduced ? 1 : 1.07 }}
        animate={{ opacity: 1, y: 0, rotate: -2.5, scale: 1 }}
        transition={{ delay: shot, type: "spring", stiffness: 150, damping: 17, mass: 1.1 }}
      >
        <div className="pz-plate" style={{ inset: 0, borderRadius: 22, boxShadow: "0 60px 90px -30px rgb(0 0 0 / 0.95), 0 0 0 1px rgb(255 255 255 / 0.08)" }}>
          <Img src={raw.url} alt={raw.alt} fade={false} fetchPriority="high" />
        </div>
      </motion.figure>

      <motion.div
        aria-hidden
        style={{ position: "absolute", inset: -40, background: "#fff8ec", zIndex: 40, pointerEvents: "none" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, reduced ? 0.35 : 0.95, 0] }}
        transition={{ delay: shot - 0.05, duration: 0.55, times: [0, 0.1, 1], ease: "easeOut" }}
      />

      {/* 164 px: "A whole shelf." is 871 px wide at wdth 92, so it holds one line clear of the photo (x 1070) */}
      <div style={abs(120, 300, { width: 920 })}>
        <Rise delay={1.2} y={26} as="h1" className="pz-display" style={{ fontSize: 164, margin: 0, whiteSpace: "nowrap" }}>
          One photo.
        </Rise>
        <Rise delay={2.7} y={26} as="p" className="pz-display" style={{ fontSize: 164, margin: "6px 0 0", color: "var(--pz-faint)", whiteSpace: "nowrap" }}>
          A whole shelf.
        </Rise>
      </div>

      <div style={abs(120, 790, { display: "flex", gap: 12 })}>
        {[raw.source, `${raw.width} × ${raw.height}`, `${raw.format} · ${fmtBytes(raw.bytes)}`].map((t, i) => (
          <Rise key={t} delay={1.7 + i * 0.12} y={10} className="pz-chip" style={i === 0 && raw.disclosure ? { borderColor: "rgb(245 165 36 / 0.55)", color: "var(--pz-marigold-hi)" } : undefined}>
            {t}
          </Rise>
        ))}
      </div>
      {raw.disclosure && (
        <Rise delay={2.1} y={8} as="p" className="pz-small" style={abs(120, 852, { margin: 0, width: 800, fontSize: 19, color: "var(--pz-dim)" })}>
          {raw.disclosure}
        </Rise>
      )}
    </>
  );
}

// ─── 2. Pipeline ──────────────────────────────────────────────────────────────

const STEP_ICON: Record<PipelineStepId, typeof Layers> = {
  fix: WandSparkles,
  cutout: Scissors,
  stage: Layers,
  light: SunMedium,
  qa: ShieldCheck,
  pack: Package,
};

export function Pipeline({ d }: ChapterProps) {
  const steps = d.pipeline.steps;
  const total = d.pipeline.totalSeconds;
  const T0 = 1.0;
  const SPAN = 5.2;
  const minSeg = 0.35;
  // weights only pace the rail; the single time on screen is the measured total
  const k = SPAN / (steps.reduce((n, s) => n + s.weight, 0) || 1);
  const dur = steps.map((s) => Math.max(minSeg, s.weight * k));
  const start = dur.map((_, i) => T0 + dur.slice(0, i).reduce((a, b) => a + b, 0));
  const end = start.map((s, i) => s + dur[i]);
  const started = useBeat(start);
  const finished = useBeat(end);
  const n = steps.length;
  const active = (i: number) => started > i && finished <= i;
  const done = (i: number) => finished > i;

  const X0 = 250;
  const X1 = 1670;
  const cx = (i: number) => X0 + ((X1 - X0) * i) / (n - 1);
  const RY = 560;
  const R = 60;

  const frac = (i: number) => i / (n - 1);
  const fillTimes = [0, ...start.map((s) => s / (end[n - 1] + 0.2)), 1];
  const fillVals = [0, ...start.map((_, i) => frac(i)), 1];

  return (
    <>
      <div style={abs(120, 110, { width: 1500 })}>
        <Rise as="h1" className="pz-display pz-h1" style={{ margin: 0 }}>
          Six steps. {total} seconds.
        </Rise>
        <Rise delay={0.25} as="p" className="pz-lede" style={{ margin: "22px 0 0", maxWidth: "none" }}>
          From one photo to a finished, approved kit, zipped and ready to download.
        </Rise>
      </div>

      {/* track */}
      <div style={abs(X0, RY - 1, { width: X1 - X0, height: 2, background: "var(--pz-line-strong)" })} />
      <motion.div
        style={abs(X0, RY - 2, { width: X1 - X0, height: 4, borderRadius: 2, background: "linear-gradient(90deg, var(--pz-saffron), var(--pz-marigold-hi))", transformOrigin: "left center", boxShadow: "0 0 18px rgb(245 165 36 / 0.6)" })}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: fillVals }}
        transition={{ duration: end[n - 1] + 0.2, times: fillTimes, ease: "linear" }}
      />

      {steps.map((s, i) => {
        const Icon = STEP_ICON[s.id] ?? ScanLine;
        const lit = active(i) || done(i);
        return (
          <div key={s.id} style={abs(cx(i) - 150, RY - R, { width: 300, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" })}>
            <motion.div
              style={{ width: R * 2, height: R * 2, borderRadius: "50%", display: "grid", placeItems: "center", position: "relative", border: "2px solid var(--pz-line-strong)", background: "var(--pz-umber)" }}
              animate={{
                backgroundColor: done(i) ? "#f5a524" : active(i) ? "#2c2116" : "#1a1511",
                borderColor: lit ? "#f5a524" : "rgba(244,236,224,0.24)",
                scale: active(i) ? 1.08 : 1,
                color: done(i) ? "#221400" : lit ? "#ffc76a" : "#8e806c",
              }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              <Icon width={44} height={44} strokeWidth={1.7} />
              {active(i) && (
                <motion.span
                  aria-hidden
                  style={{ position: "absolute", inset: -8, borderRadius: "50%", border: "2px solid #f5a524" }}
                  initial={{ opacity: 0.9, scale: 1 }}
                  animate={{ opacity: 0, scale: 1.35 }}
                  transition={{ duration: 0.9, repeat: Infinity, ease: "easeOut" }}
                />
              )}
            </motion.div>
            <div className="pz-display" style={{ fontSize: 38, marginTop: 26, color: lit ? "var(--pz-paper)" : "var(--pz-faint)", transition: "color 300ms" }}>
              {s.label}
            </div>
            <div className="pz-body" style={{ fontSize: 20, marginTop: 14, maxWidth: 236, lineHeight: 1.35, opacity: lit ? 1 : 0.35, transition: "opacity 400ms" }}>
              {s.detail}
            </div>
          </div>
        );
      })}

      {/* one clock for the whole run: it reaches the measured total as the last step lands */}
      <Rise delay={0.6} style={abs(120, 880, { display: "flex", alignItems: "center", gap: 18 })}>
        <span className="pz-chip" data-tone="lit" style={{ height: 52, fontSize: 24, padding: "0 22px" }}>
          <CountUp to={total} delay={T0} duration={end[n - 1] - T0} linear format={(v) => `${Math.floor(v)} s photo → ZIP`} />
        </span>
        <motion.span className="pz-small" style={{ fontSize: 19 }} initial={{ opacity: 0 }} animate={{ opacity: finished >= n ? 1 : 0 }} transition={{ duration: 0.5 }}>
          {d.pipeline.note}
        </motion.span>
      </Rise>
    </>
  );
}

// ─── 3. Cutout reveal ─────────────────────────────────────────────────────────

export function Cutout({ d }: ChapterProps) {
  const reduced = useReducedMotion();
  const raw = d.product.raw;
  const cut = d.product.cutout;
  const H = 880;
  const W = Math.round((H * raw.width) / raw.height);
  const L = 1020;
  const T = 100;
  // wipe: 0 → 100% (background dissolves), back to a 50% split, forward again
  const wipe = reduced ? [0, 100, 100, 50, 50, 100, 100] : [0, 100, 100, 50, 50, 100, 100];
  const times = [0, 0.26, 0.45, 0.58, 0.72, 0.85, 1];
  const DUR = 7.4;
  const D0 = 1.0;
  const beat = useBeat([D0 + DUR * 0.28, D0 + DUR * 0.6, D0 + DUR * 0.86]);
  // unknown position in the photo: centre it, true to its aspect ratio
  const fitH = Math.min(0.6, (0.84 * W * cut.height) / cut.width / H);
  const fitW = (fitH * H * cut.width) / cut.height / W;
  const box = cut.box ?? { x: (1 - fitW) / 2, y: 0.5 - fitH / 2, w: fitW, h: fitH };

  return (
    <>
      <div style={abs(120, 150, { width: 780 })}>
        <Rise as="h1" className="pz-display pz-h1" style={{ margin: 0 }}>
          Cut out once.
        </Rise>
        <Rise delay={0.2} as="p" className="pz-lede" style={{ margin: "26px 0 0" }}>
          The background is removed a single time. Every scene, format and video after this reuses the same transparent cutout.
        </Rise>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 44, maxWidth: 700 }}>
          {[
            { t: "e_background_removal", mono: true },
            { t: "e_trim", mono: true },
            { t: `${cut.width} × ${cut.height} PNG` },
            ...(cut.seconds ? [{ t: `${cut.seconds.toFixed(1)} s, once` }] : []),
          ].map((c, i) => (
            <Rise key={c.t} delay={D0 + DUR * 0.3 + i * 0.12} y={10} className={`pz-chip${c.mono ? " pz-mono" : ""}`} style={c.mono ? { fontSize: 17 } : undefined}>
              {c.t}
            </Rise>
          ))}
        </div>
      </div>

      <div className="pz-plate pz-checker" style={{ left: L, top: T, width: W, height: H, borderRadius: 20 }}>
        {/* the cutout, exactly where it sits in the photo */}
        <motion.div
          style={{ position: "absolute", left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
          animate={beat >= 3 && !reduced ? { y: -16, scale: 1.02 } : { y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 180, damping: 20 }}
        >
          <motion.div
            aria-hidden
            style={{ position: "absolute", left: "8%", right: "8%", bottom: "-5%", height: "12%", borderRadius: "50%", background: "radial-gradient(closest-side, rgb(0 0 0 / 0.6), transparent)", filter: "blur(6px)" }}
            animate={{ opacity: beat >= 3 ? 1 : 0, scaleX: beat >= 3 ? 1 : 0.7 }}
            transition={{ duration: 0.6, ease: EASE }}
          />
          <Img src={cut.url} alt={cut.alt} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} fade={false} />
          <motion.div
            aria-hidden
            style={{ position: "absolute", inset: 0, backgroundImage: `url(${cut.url})`, backgroundSize: "100% 100%", filter: "drop-shadow(0 0 2px #ffc76a) drop-shadow(0 0 10px rgb(245 165 36 / 0.7))", opacity: 0 }}
            animate={{ opacity: [0, 0, 0.85, 0.85, 0] }}
            transition={{ delay: D0, duration: DUR * 0.45, times: [0, 0.15, 0.5, 0.75, 1] }}
          />
        </motion.div>

        {/* the phone photo on top, wiped away */}
        <motion.div
          style={{ position: "absolute", inset: 0 }}
          initial={{ clipPath: "inset(0% 0% 0% 0%)" }}
          animate={{ clipPath: wipe.map((p) => `inset(0% 0% 0% ${p}%)`) }}
          transition={{ delay: D0, duration: DUR, times, ease: [0.65, 0, 0.35, 1] }}
        >
          <Img src={raw.url} alt={raw.alt} className="pz-fill" fade={false} />
          {/* the label rides on the photo, so it is on screen exactly as long as the photo is (samples are AI-generated test images) */}
          <span className="pz-chip" style={{ position: "absolute", right: 22, top: 22 }}>
            {raw.disclosure ? `${raw.source} · AI test image` : raw.source}
          </span>
        </motion.div>
        {!reduced && (
          <motion.div
            className="pz-scanline"
            style={{ left: 0 }}
            initial={{ x: 0, opacity: 0 }}
            animate={{ x: wipe.map((p) => (p / 100) * W), opacity: [0, 1, 0, 1, 1, 1, 0] }}
            transition={{ delay: D0, duration: DUR, times, ease: [0.65, 0, 0.35, 1] }}
          />
        )}

        <motion.div style={{ position: "absolute", left: 22, top: 22, pointerEvents: "none" }} initial={{ opacity: 0 }} animate={{ opacity: beat === 2 ? 1 : 0 }} transition={{ duration: 0.35 }}>
          <span className="pz-chip">Cutout</span>
        </motion.div>
      </div>
    </>
  );
}
