"use client";

import { CheckCheck, Share2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { BrowserFrame, ChatHeader, LinkPreviewFrame, PhoneFrame } from "../frames";
import { QrCode } from "../QrCode";
import { EASE, Img, Mark, useBeat } from "../stage";
import { abs, Rise, type ChapterProps } from "./common";

// ─── 11. The shelf ────────────────────────────────────────────────────────────

export function Shelf({ d }: ChapterProps) {
  const reduced = useReducedMotion();
  const products = d.shelf.products.slice(0, 6);
  const beat = useBeat([2.9, 4.6]);
  const BW = 1140;
  const TILE_W = (BW - 48 * 2 - 28 * 2) / 3;
  const initial = d.shop.name.trim()[0]?.toUpperCase() ?? "S";

  return (
    <>
      <div style={abs(120, 70, { width: 1100 })}>
        <Rise as="h1" className="pz-display pz-h2" style={{ margin: 0, fontSize: 76 }}>
          A shop, ready to share.
        </Rise>
      </div>

      <motion.div style={abs(120, 190)} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.7, ease: EASE }}>
        <BrowserFrame host={d.shop.host} style={{ position: "relative", width: BW, height: 800 }}>
          <div style={{ padding: "26px 48px 0", display: "flex", alignItems: "center", gap: 16 }}>
            <span className="pz-avatar" style={{ width: 52, height: 52, fontSize: 24 }}>
              {initial}
            </span>
            <div style={{ display: "grid", lineHeight: 1.2 }}>
              <span style={{ fontFamily: "var(--pz-font-display)", fontSize: 32, fontWeight: 760, letterSpacing: "-0.02em" }}>{d.shop.name}</span>
              <span style={{ fontSize: 16, color: "#6f6962" }}>
                {products.length} products · Diwali collection
              </span>
            </div>
            <span style={{ marginLeft: "auto", height: 42, padding: "0 18px", borderRadius: 999, background: "#1c1712", color: "#fff", fontSize: 16, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Share2 width={17} height={17} /> Share shop
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(3, ${TILE_W}px)`, gap: "24px 28px", padding: "26px 48px" }}>
            {products.map((p, i) => (
              <motion.div
                key={p.image.url}
                initial={{ opacity: 0, y: reduced ? 0 : 24, scale: reduced ? 1 : 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 0.6 + i * 0.12, duration: 0.55, ease: EASE }}
              >
                <div style={{ position: "relative", height: 250, borderRadius: 14, overflow: "hidden", background: "#e9e3da" }}>
                  <Img src={p.image.url} alt={p.image.alt} className="pz-fill" style={{ objectPosition: "50% 62%" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, marginTop: 10 }}>
                  <span style={{ fontSize: 16, fontWeight: 600, color: "#2a241e", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title}</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: "#17130f" }}>{p.price}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </BrowserFrame>
      </motion.div>

      <motion.div style={abs(1340, 70)} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.6, duration: 0.8, ease: EASE }}>
        <PhoneFrame style={{ position: "relative", width: 460, height: 940 }} label="Sharing the shop in a chat">
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: "#120f0c" }}>
            <ChatHeader title="Diwali customers" subtitle="Broadcast list · 142 recipients" initial={initial} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "18px 16px 30px", gap: 14 }}>
              <span style={{ alignSelf: "center", fontSize: 12.5, color: "#a79c8e", background: "#1f1914", borderRadius: 8, padding: "4px 10px" }}>Today</span>
              <motion.div
                style={{ alignSelf: "flex-end", width: 350, display: "grid", gap: 0 }}
                initial={{ opacity: 0, y: reduced ? 0 : 40, scale: reduced ? 1 : 0.94 }}
                animate={beat >= 1 ? { opacity: 1, y: 0, scale: 1 } : {}}
                transition={{ type: "spring", stiffness: 240, damping: 22 }}
              >
                <LinkPreviewFrame asset={d.shelf.share.image} title={d.shelf.share.title} description={d.shelf.share.description} host={d.shop.host.split("/")[0]} style={{ borderRadius: "16px 16px 4px 4px" }} />
                <div style={{ background: "var(--pz-bubble-out)", borderRadius: "0 0 4px 16px", padding: "4px 14px 10px", color: "#f6efe4", fontSize: 15.5, lineHeight: 1.4 }}>
                  {d.shelf.share.message}
                  <div style={{ color: "#ffc76a", wordBreak: "break-all" }}>{d.shop.url.replace(/^https?:\/\//, "")}</div>
                  <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4, fontSize: 12, color: "#a79c8e", marginTop: 2 }}>
                    19:30 <CheckCheck width={16} height={16} color={beat >= 2 ? "#8fc7ff" : "#a79c8e"} style={{ transition: "color 300ms" }} />
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </PhoneFrame>
      </motion.div>
    </>
  );
}

// ─── 12. Closing ──────────────────────────────────────────────────────────────

export function Closing({ d }: ChapterProps) {
  const reduced = useReducedMotion();
  return (
    <>
      <div style={abs(0, 190, { width: 1920, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" })}>
        <motion.div initial={{ opacity: 0, y: reduced ? 0 : -140 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 170, damping: 16, delay: 0.2 }}>
          <Mark size={120} />
        </motion.div>
        <Rise delay={0.6} y={24} as="h1" className="pz-display" style={{ fontSize: 196, margin: "18px 0 0", fontWeight: 780 }}>
          Snap2Shelf
        </Rise>
        <Rise delay={1.1} as="p" className="pz-display" style={{ fontSize: 48, margin: "28px 0 0", fontWeight: 600, letterSpacing: "-0.02em" }}>
          One photo. A whole shelf.
        </Rise>
        <Rise delay={1.4} as="p" className="pz-lede" style={{ margin: "14px 0 0", maxWidth: "none", fontSize: 30 }}>
          AI builds the stage. Your product stays real.
        </Rise>
      </div>
      <Rise delay={2.2} style={abs(0, 800, { width: 1920, display: "flex", justifyContent: "center", alignItems: "center", gap: 40 })}>
        <QrCode value={d.site.url} size={168} />
        <div style={{ display: "grid", gap: 8, textAlign: "left" }}>
          <a href={d.site.url} className="pz-display" style={{ fontSize: 46, color: "var(--pz-marigold-hi)", textDecoration: "none", letterSpacing: "-0.02em" }}>
            {d.site.host}
          </a>
          <span className="pz-body" style={{ fontSize: 22 }}>
            Try it, no signup · {d.site.repoLabel}
          </span>
        </div>
      </Rise>
    </>
  );
}
