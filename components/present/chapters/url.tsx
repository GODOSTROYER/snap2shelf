"use client";

import { ExternalLink } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { measureDelivered } from "@/lib/present/preload";
import { XRAY_KINDS, xrayLegend } from "@/lib/transform/xray";
import type { XraySegment } from "@/lib/types";
import { CountUp, EASE, Mark, useBeat } from "../stage";
import { abs, fmtBytes, fmtInt, Rise, type ChapterProps } from "./common";

// ─── 9. X-ray: it's just a URL ────────────────────────────────────────────────

type Kind = XraySegment["kind"];
const kindColor = (k: Kind) => `var(${XRAY_KINDS[k].token}, ${XRAY_KINDS[k].swatch})`;

/** Human-readable text for a segment (Devanagari overlays shown decoded). */
const readable = (s: XraySegment) => {
  if (s.kind !== "text") return s.text;
  try {
    return decodeURIComponent(decodeURIComponent(s.text));
  } catch {
    return s.text;
  }
};

export function Xray({ d }: ChapterProps) {
  const reduced = useReducedMotion();
  const built = d.xray.hero;
  const at = built.url.indexOf(built.transformation);
  const base = at > 0 ? built.url.slice(0, at) : "";
  const pieces = useMemo(() => {
    const out: { text: string; seg: XraySegment | null; i: number }[] = [{ text: base, seg: null, i: -1 }];
    built.segments.forEach((s, i) => {
      out.push({ text: s.text, seg: s, i });
      if (i < built.segments.length - 1) out.push({ text: "/", seg: null, i });
    });
    return out;
  }, [base, built.segments]);
  const total = pieces.reduce((n, p) => n + p.text.length, 0);

  const TYPE_START = 0.9;
  const TYPE_DUR = 4.6;
  const [typed, setN] = useState(0);
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - t0 - TYPE_START * 1000) / (TYPE_DUR * 1000)));
      setN(Math.round(total * p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [total, reduced]);
  const beat = useBeat([TYPE_START + TYPE_DUR + 0.6]);
  const n = reduced ? total : typed;

  // which segment the cursor is in
  let seen = 0;
  let active: XraySegment | null = null;
  for (const p of pieces) {
    if (seen + p.text.length >= n && p.seg) {
      active = p.seg;
      break;
    }
    if (p.seg && seen < n) active = p.seg;
    seen += p.text.length;
  }
  const done = n >= total;
  const shown = done && beat >= 1 ? null : active;

  const PANEL = { x: 120, y: 300, w: 1680, h: 450, pad: 34 };
  const fs = Math.max(15, Math.min(28, Math.floor(Math.sqrt(((PANEL.w - PANEL.pad * 2) * (PANEL.h - PANEL.pad * 2)) / (total * 0.6 * 1.6)))));

  let left = n;
  return (
    <>
      <div style={abs(120, 90, { width: 1680, display: "flex", justifyContent: "space-between", alignItems: "flex-end" })}>
        <div>
          <Rise as="h1" className="pz-display pz-h1" style={{ margin: 0 }}>
            It&rsquo;s just a URL.
          </Rise>
          <Rise delay={0.2} as="p" className="pz-lede" style={{ margin: "20px 0 0", maxWidth: "none" }}>
            Every image in this deck is a Cloudinary delivery URL. This one renders the hero.
          </Rise>
        </div>
        <Rise delay={0.5} style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "8px 18px", maxWidth: 640, paddingBottom: 6 }}>
          {xrayLegend(built.segments).map((k) => (
            <span key={k.kind} style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 17, color: "var(--pz-dim)" }}>
              <i className="pz-swatch" style={{ background: kindColor(k.kind) }} />
              {k.legend}
            </span>
          ))}
        </Rise>
      </div>

      <motion.a
        href={built.url}
        target="_blank"
        rel="noreferrer"
        aria-label="Open the hero URL in a new tab"
        className="pz-panel pz-url"
        style={abs(PANEL.x, PANEL.y, { width: PANEL.w, height: PANEL.h, padding: PANEL.pad, fontSize: fs, color: "var(--pz-faint)", textDecoration: "none", overflow: "hidden", display: "block" })}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.6, ease: EASE }}
      >
        {pieces.map((p, k) => {
          if (left <= 0) return null;
          const t = p.text.slice(0, left);
          left -= p.text.length;
          const lit = !p.seg || !shown || p.seg === shown;
          return (
            <span
              key={k}
              style={{
                color: p.seg ? kindColor(p.seg.kind) : "var(--pz-faint)",
                opacity: lit ? 1 : 0.38,
                transition: "opacity 250ms",
                textShadow: p.seg && p.seg === shown ? `0 0 14px ${kindColor(p.seg.kind)}` : undefined,
              }}
            >
              {t}
            </span>
          );
        })}
        {!done && <span className="pz-caret" aria-hidden />}
      </motion.a>

      <div style={abs(120, 776, { width: 1680, height: 40 })}>
        {shown && (
          <motion.div key={shown.text} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 24 }}>
            <i className="pz-swatch" style={{ width: 18, height: 18, background: kindColor(shown.kind) }} />
            <span style={{ color: kindColor(shown.kind), fontWeight: 650 }}>{XRAY_KINDS[shown.kind].legend}</span>
            <span style={{ color: "var(--pz-dim)" }}>{shown.label}</span>
          </motion.div>
        )}
        {done && beat >= 1 && (
          <Rise y={6} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 22, color: "var(--pz-dim)" }}>
            <ExternalLink width={20} height={20} /> {fmtInt(built.url.length)} characters. Open it and Cloudinary renders the same image.
          </Rise>
        )}
      </div>

      {d.xray.extras.length > 0 && (
        <div style={abs(120, 846, { width: 1680, display: "grid", gap: 12 })}>
          {d.xray.extras.map((x, i) => (
            <motion.div
              key={x.title}
              style={{ display: "grid", gridTemplateColumns: "200px 1fr", alignItems: "center", gap: 20 }}
              initial={{ opacity: 0, x: -14 }}
              animate={beat >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -14 }}
              transition={{ delay: beat >= 1 ? 0.3 + i * 0.25 : 0, duration: 0.5, ease: EASE }}
            >
              <span style={{ fontSize: 21, color: "var(--pz-dim)" }}>{x.title}</span>
              <span className="pz-mono" style={{ fontSize: 19, color: kindColor(x.segment.kind), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {readable(x.segment)}
              </span>
            </motion.div>
          ))}
        </div>
      )}
    </>
  );
}

// ─── 10. Cost meter ───────────────────────────────────────────────────────────

function Row({ l, r, strong }: { l: string; r: string; strong?: boolean }) {
  return (
    <div className="pz-receipt-row" style={strong ? { fontWeight: 700 } : undefined}>
      <span>{l}</span>
      <span>{r}</span>
    </div>
  );
}

function Meter({ label, value, ratio, delay, color, dim }: { label: string; value: React.ReactNode; ratio: number; delay: number; color: string; dim?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "250px 1fr 190px", alignItems: "center", gap: 22 }}>
      <span style={{ fontSize: 21, color: dim ? "var(--pz-faint)" : "var(--pz-dim)" }}>{label}</span>
      <div className="pz-meter">
        <motion.i style={{ background: color }} initial={{ scaleX: 0 }} animate={{ scaleX: Math.max(0.012, Math.min(1, ratio)) }} transition={{ delay, duration: 1.3, ease: EASE }} />
      </div>
      <span className="pz-num" style={{ fontSize: 26, fontWeight: 650, textAlign: "right", color: dim ? "var(--pz-dim)" : "var(--pz-paper)" }}>
        {value}
      </span>
    </div>
  );
}

export function Cost({ d }: ChapterProps) {
  const c = d.cost;
  const [delivered, setDelivered] = useState<{ bytes: number; format: string | null }>({ bytes: c.bytesDeliveredFallback, format: null });
  const [measured, setMeasured] = useState(false);
  useEffect(() => {
    let live = true;
    measureDelivered(c.deliveredUrl).then((m) => {
      if (live && m && m.bytes > 0) {
        setDelivered(m);
        setMeasured(true);
      }
    });
    return () => {
      live = false;
    };
  }, [c.deliveredUrl]);

  const kitCredits = c.generationCredits + c.transformations / 1000;
  const kitInr = Math.max(1, Math.round(kitCredits * c.inrPerCredit));
  const reelSeconds = d.reel ? Math.round(d.reel.seconds) : null;

  const RECEIPT_H = 700;
  return (
    <>
      {/* the printer slot and the receipt feeding out of it */}
      <div aria-hidden style={abs(100, 128, { width: 600, height: 16, borderRadius: 8, background: "#060504", boxShadow: "inset 0 2px 6px rgb(0 0 0 / 0.9), 0 1px 0 rgb(255 255 255 / 0.06)", zIndex: 2 })} />
      <div style={abs(120, 136, { width: 560, height: RECEIPT_H + 60, overflow: "hidden" })}>
        <motion.div className="pz-receipt" initial={{ y: -RECEIPT_H - 40 }} animate={{ y: 0 }} transition={{ delay: 0.4, duration: 2.8, ease: [0.3, 0.1, 0.2, 1] }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontFamily: "var(--pz-font-display)", fontSize: 28, fontWeight: 760, letterSpacing: "-0.02em" }}>
            <Mark size={30} /> Snap2Shelf
          </div>
          <div style={{ textAlign: "center", fontSize: 16, opacity: 0.7, marginTop: 4 }}>Kit for: {d.product.name}</div>
          <hr />
          <Row l="Background removal" r="once" />
          <Row l={`Scene: ${d.scene.title}`} r="reused" />
          <Row l="Composite + light-match" r="1 URL" />
          <Row l="QA gate (AI Vision)" r="approved" />
          <Row l="Channel pack" r={`${d.pack.length} formats`} />
          {reelSeconds !== null && <Row l="Kit reel" r={`${reelSeconds} s video`} />}
          <hr />
          <Row l="Generation credits" r={String(c.generationCredits)} strong />
          <Row l="Transformations" r={`≈${fmtInt(c.transformations)} tx`} />
          <Row l="Credits saved by reuse" r={String(c.creditsSavedByReuse)} />
          <Row l="Photo to kit" r={`${c.seconds.toFixed(1)} s`} />
          <hr />
          <div style={{ textAlign: "center", fontSize: 15, opacity: 0.7 }}>Every line is a URL. Thank you for shopping.</div>
        </motion.div>
      </div>

      <div style={abs(800, 110, { width: 1000 })}>
        <Rise as="h1" className="pz-display pz-h1" style={{ margin: 0 }}>
          What it cost.
        </Rise>
      </div>

      <div style={abs(800, 330, { width: 1000, display: "grid", gap: 64 })}>
        <Rise delay={0.6} style={{ display: "grid", gap: 18 }}>
          <div className="pz-display" style={{ fontSize: 44 }}>
            <CountUp to={c.generationCredits} from={0} duration={0.6} delay={0.8} /> generation credits
            <span style={{ color: "var(--pz-faint)" }}> for this kit</span>
          </div>
          <Meter label="Fresh scene per stage" value={`${c.creditsSavedByReuse} credits`} ratio={1} delay={1} color="rgb(244 236 224 / 0.28)" dim />
          <Meter label="Reused from the library" value={<CountUp to={0} from={c.creditsSavedByReuse} delay={1.4} duration={1.2} format={(v) => `${Math.round(v)} credits`} />} ratio={0.012} delay={1.4} color="var(--pz-marigold)" />
        </Rise>

        <Rise delay={1.6} style={{ display: "grid", gap: 18 }}>
          <div className="pz-display" style={{ fontSize: 44 }}>
            {fmtBytes(c.bytesOriginal)} → <CountUp key={delivered.bytes} to={delivered.bytes / 1024} from={c.bytesOriginal / 1024} delay={1.9} duration={1.6} format={(v) => `${Math.round(v)} KB`} />
            <span style={{ color: "var(--pz-faint)" }}> delivered</span>
          </div>
          <Meter label="Phone photo as shot" value={fmtBytes(c.bytesOriginal)} ratio={1} delay={1.9} color="rgb(244 236 224 / 0.28)" dim />
          <Meter label={`Delivered${delivered.format ? ` as ${delivered.format}` : ""}`} value={fmtBytes(delivered.bytes)} ratio={delivered.bytes / c.bytesOriginal} delay={2.2} color="var(--pz-marigold)" />
          <span className="pz-small">{measured ? "Measured in this browser just now, same pixels, f_auto,q_auto." : "Measured offline; the live number appears when the photo has loaded."}</span>
        </Rise>

        <Rise delay={2.8} style={{ display: "grid", gap: 18 }}>
          <div className="pz-display" style={{ fontSize: 44 }}>
            ≈ ₹<CountUp to={kitInr} delay={3} duration={1} format={(v) => fmtInt(v)} />
            <span style={{ color: "var(--pz-faint)" }}> vs ≈ ₹{fmtInt(c.photoshootInr)} for a photoshoot</span>
          </div>
          <Meter label="Studio photoshoot" value={`₹${fmtInt(c.photoshootInr)}`} ratio={1} delay={3} color="rgb(244 236 224 / 0.28)" dim />
          <Meter label="This kit" value={`₹${fmtInt(kitInr)}`} ratio={kitInr / c.photoshootInr} delay={3.3} color="var(--pz-marigold)" />
          <span className="pz-small">
            Estimates: {c.photoshootNote.toLowerCase()}; {c.inrNote.replace(/^≈ /, "")}.
          </span>
        </Rise>
      </div>
    </>
  );
}
