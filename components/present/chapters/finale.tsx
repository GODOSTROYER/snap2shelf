"use client";

import { ArrowUpRight, CheckCheck, Link2, MessageCircle } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { BrowserFrame, ChatHeader, LinkPreviewFrame, PhoneFrame } from "../frames";
import { QrCode } from "../QrCode";
import { EASE, Img, Mark, useBeat } from "../stage";
import { STAGE_LINE } from "@/lib/claims";
import { abs, Rise, type ChapterProps } from "./common";

// ─── 11. The shelf ────────────────────────────────────────────────────────────

/*
 * The live storefront as it really looks (/shelf/demo-studio, dark, no prices),
 * from the snapshot in lib/present/data.ts: same products, same crops, same
 * og:image in the shared link. Inks are the shelf page's own.
 */
const SHELF_INK = { paper: "#f4efe7", dim: "#a89f92", marigold: "#f5a524", onMarigold: "#1a1208", line: "rgb(244 239 231 / 0.12)" } as const;

export function Shelf({ d }: ChapterProps) {
  const reduced = useReducedMotion();
  const shelf = d.shelf;
  const products = shelf.products.slice(0, 4);
  const beat = useBeat([2.9, 4.6]);
  const BW = 1140;
  const PAD = 48;
  const GAP = 24;
  const TILE_W = Math.floor((BW - PAD * 2 - GAP * (products.length - 1)) / products.length);
  const initial = shelf.title.trim()[0]?.toUpperCase() ?? "S";
  const count = `${products.length} ${products.length === 1 ? "product" : "products"}`;

  return (
    <>
      <div style={abs(120, 70, { width: 1100 })}>
        <Rise as="h1" className="pz-display pz-h2" style={{ margin: 0, fontSize: 76 }}>
          A shop, ready to share.
        </Rise>
      </div>

      <motion.div style={abs(120, 190)} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.7, ease: EASE }}>
        <BrowserFrame host={d.shop.host} dark style={{ position: "relative", width: BW, height: 776 }}>
          <div style={{ padding: `24px ${PAD}px 0`, color: SHELF_INK.paper }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="pz-shelf-serif" style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.01em" }}>
                Snap<span style={{ color: SHELF_INK.marigold }}>2</span>Shelf
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 30, padding: "0 12px", borderRadius: 999, border: `1px solid ${SHELF_INK.line}`, fontSize: 13, color: SHELF_INK.dim }}>
                <i style={{ width: 8, height: 8, borderRadius: 999, background: SHELF_INK.marigold }} />
                Live shelf
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 32, marginTop: 30 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 650, letterSpacing: "0.22em", textTransform: "uppercase", color: SHELF_INK.marigold }}>Shop · {count}</div>
                <div className="pz-shelf-serif" style={{ fontSize: 84, fontWeight: 600, lineHeight: 0.9, letterSpacing: "-0.035em", marginTop: 14 }}>
                  {shelf.title}
                </div>
                <div style={{ fontSize: 17, color: SHELF_INK.dim, marginTop: 16 }}>{shelf.tagline}</div>
              </div>
              <div style={{ display: "flex", gap: 12, flex: "none" }}>
                <span style={{ height: 46, padding: "0 20px", borderRadius: 999, background: SHELF_INK.marigold, color: SHELF_INK.onMarigold, fontSize: 16, fontWeight: 650, display: "inline-flex", alignItems: "center", gap: 8, boxShadow: "0 10px 30px -10px rgb(245 165 36 / 0.6)" }}>
                  <MessageCircle width={18} height={18} strokeWidth={2} /> Share on WhatsApp
                </span>
                <span style={{ height: 46, padding: "0 20px", borderRadius: 999, border: "1px solid rgb(244 239 231 / 0.22)", fontSize: 16, fontWeight: 650, display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Link2 width={18} height={18} strokeWidth={2} /> Copy link
                </span>
              </div>
            </div>

            <div aria-hidden style={{ height: 1, marginTop: 28, background: "linear-gradient(90deg, transparent, rgb(245 165 36 / 0.45), transparent)" }} />

            <div style={{ display: "grid", gridTemplateColumns: `repeat(${products.length}, ${TILE_W}px)`, gap: GAP, marginTop: 28 }}>
              {products.map((p, i) => (
                <motion.div
                  key={p.sku}
                  initial={{ opacity: 0, y: reduced ? 0 : 24, scale: reduced ? 1 : 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: 0.6 + i * 0.12, duration: 0.55, ease: EASE }}
                >
                  <div style={{ position: "relative", height: Math.round((TILE_W * 5) / 4), borderRadius: 18, overflow: "hidden", background: "#241c16", boxShadow: "0 24px 48px -24px rgb(0 0 0 / 0.9), 0 0 0 1px rgb(244 239 231 / 0.1)" }}>
                    <Img src={p.image.url} srcSet={p.image.srcSet} alt={p.image.alt} className="pz-fill" />
                    <span style={{ position: "absolute", left: 12, top: 12, padding: "4px 10px", borderRadius: 999, background: "rgb(14 12 10 / 0.6)", fontSize: 11, fontWeight: 650, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgb(244 239 231 / 0.9)" }}>
                      No. {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="pz-shelf-serif" style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.2, marginTop: 14 }}>
                    {p.title}
                  </div>
                  <div style={{ fontSize: 14, color: SHELF_INK.dim, marginTop: 4 }}>{p.facts}</div>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10, fontSize: 14, fontWeight: 550, color: SHELF_INK.marigold }}>
                    <MessageCircle width={15} height={15} strokeWidth={2} /> Ask about this <ArrowUpRight width={14} height={14} />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </BrowserFrame>
      </motion.div>

      <motion.div style={abs(1340, 76)} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.6, duration: 0.8, ease: EASE }}>
        <PhoneFrame style={{ position: "relative", width: 460, height: 900 }} label="Sharing the shop in a chat">
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: "#120f0c" }}>
            <ChatHeader title="Diwali customers" subtitle="Broadcast list" initial={initial} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "18px 16px 30px", gap: 14 }}>
              <span style={{ alignSelf: "center", fontSize: 12.5, color: "#a79c8e", background: "#1f1914", borderRadius: 8, padding: "4px 10px" }}>Today</span>
              <motion.div
                style={{ alignSelf: "flex-end", width: 360, display: "grid", gap: 0 }}
                initial={{ opacity: 0, y: reduced ? 0 : 40, scale: reduced ? 1 : 0.94 }}
                animate={beat >= 1 ? { opacity: 1, y: 0, scale: 1 } : {}}
                transition={{ type: "spring", stiffness: 240, damping: 22 }}
              >
                <LinkPreviewFrame asset={shelf.share.image} title={shelf.share.title} description={shelf.share.description} host={d.shop.host.split("/")[0]} style={{ borderRadius: "16px 16px 4px 4px" }} />
                <div style={{ background: "var(--pz-bubble-out)", borderRadius: "0 0 4px 16px", padding: "4px 14px 10px", color: "#f6efe4", fontSize: 15.5, lineHeight: 1.4 }}>
                  {shelf.share.message}
                  <div style={{ color: "#ffc76a", wordBreak: "break-all" }}>{d.shop.host}</div>
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
        <Rise delay={1.1} as="p" className="pz-display" style={{ fontSize: 48, margin: "28px 0 0", fontWeight: 600, letterSpacing: "-0.01em" }}>
          One photo. A whole shelf.
        </Rise>
        <Rise delay={1.4} as="p" className="pz-lede" style={{ margin: "14px 0 0", maxWidth: "none", fontSize: 30 }}>
          {STAGE_LINE}
        </Rise>
      </div>
      <Rise delay={2.2} style={abs(0, 800, { width: 1920, display: "flex", justifyContent: "center", alignItems: "center", gap: 40 })}>
        <QrCode value={d.site.url} size={168} />
        <div style={{ display: "grid", gap: 8, textAlign: "left" }}>
          <a href={d.site.url} className="pz-display" style={{ fontSize: 46, color: "var(--pz-marigold-hi)", textDecoration: "none", letterSpacing: "-0.01em" }}>
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
