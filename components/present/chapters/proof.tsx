"use client";

import { CircleCheck, CircleX, Film } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { SAMPLE_PHOTO_LABEL } from "@/lib/claims";
import type { QaCard } from "@/lib/present/data";
import { preloadVideo } from "@/lib/present/preload";
import type { KitAsset } from "@/lib/types";
import { CatalogTileFrame, FeedPostFrame, ListingCardFrame, PhoneFrame, StoryFrame, WebBannerFrame, type ShopFacts } from "../frames";
import { EASE, Img, Mark, useBeat } from "../stage";
import { abs, Rise, type ChapterProps } from "./common";

// ─── 6. QA gate ───────────────────────────────────────────────────────────────

function Verdict({ card, x, at, markAt, stampAt }: { card: QaCard; x: number; at: number; markAt: number; stampAt: number }) {
  const reduced = useReducedMotion();
  const W = 780;
  const H = Math.round((W * card.sheet.height) / card.sheet.width);
  const ok = card.result.status === "approved";
  const beat = useBeat([stampAt]);
  return (
    <Rise delay={at} y={30} style={abs(x, 272, { width: W })}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, height: 52 }}>
        <span className="pz-mono" style={{ fontSize: 25, color: "var(--pz-paper)" }}>
          {card.model}
        </span>
        <span className="pz-body" style={{ fontSize: 19 }}>
          {card.tier}
          {card.credits ? ` · ${card.credits} credit${card.credits === 1 ? "" : "s"}` : ""}
          {card.seconds ? ` · ${card.seconds.toFixed(1)} s` : ""}
        </span>
      </div>
      <div className="pz-plate" style={{ position: "relative", width: W, height: H, borderRadius: 16 }}>
        <Img src={card.sheet.url} alt={card.sheet.alt} className="pz-fill" fade={false} />
        <div style={{ position: "absolute", left: 14, right: 14, top: 14, display: "flex", justifyContent: "space-between" }}>
          {/* the reference is an AI-generated test sneaker, never "the original" of a real product */}
          <span className="pz-chip" style={{ height: 36, fontSize: 16 }}>
            {SAMPLE_PHOTO_LABEL} · AI test image
          </span>
          <span className="pz-chip" style={{ height: 36, fontSize: 16 }}>
            AI take
          </span>
        </div>
        {/* AI Vision comparing the halves */}
        {!reduced && (
          <motion.div
            aria-hidden
            className="pz-scanline"
            style={{ left: 0, opacity: 0 }}
            animate={{ x: [W * 0.25, W * 0.75, W * 0.25, W * 0.75], opacity: [0, 1, 1, 0] }}
            transition={{ delay: at + 0.7, duration: 1.4, ease: "easeInOut" }}
          />
        )}
        <svg viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }} aria-hidden>
          {card.marks.map((m, i) => {
            const cx = m.x * W;
            const cy = m.y * H;
            const r = m.r * W;
            // numbered pin at the top-right of each ring; the reasons below carry the same numbers
            const bx = cx + r * 0.72;
            const by = cy - r * 0.72;
            return (
              <motion.g key={m.label} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: markAt + i * 0.6, duration: 0.3 }}>
                <motion.circle
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="rgb(242 112 90 / 0.14)"
                  stroke="var(--pz-reject)"
                  strokeWidth={3.5}
                  initial={{ pathLength: reduced ? 1 : 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ delay: markAt + i * 0.6, duration: 0.5, ease: EASE }}
                />
                <circle cx={bx} cy={by} r={15} fill="var(--pz-reject)" stroke="rgb(14 12 10 / 0.6)" strokeWidth={2} />
                <text x={bx} y={by + 6} textAnchor="middle" fontSize={17} fontWeight={800} fill="#1a0a06" style={{ fontFamily: "var(--pz-font-text)" }}>
                  {i + 1}
                </text>
              </motion.g>
            );
          })}
        </svg>
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 22, marginTop: 22, minHeight: 120 }}>
        <motion.div
          initial={{ opacity: 0, scale: reduced ? 1 : 1.35, rotate: reduced ? 0 : ok ? -4 : 4 }}
          animate={beat >= 1 ? { opacity: 1, scale: 1, rotate: ok ? -2 : 2 } : {}}
          transition={{ type: "spring", stiffness: 420, damping: 18 }}
        >
          <span className="pz-stamp" data-tone={ok ? "approve" : "reject"}>
            {ok ? <CircleCheck /> : <CircleX />}
            {ok ? "Approved" : "Rejected"}
          </span>
        </motion.div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: beat >= 1 ? 1 : 0 }} transition={{ delay: 0.25, duration: 0.4 }} style={{ display: "grid", gap: 6 }}>
          <div className="pz-mono" style={{ fontSize: 17, color: ok ? "var(--pz-approve)" : "var(--pz-reject)" }}>
            {card.result.matched.join("  ")}
          </div>
          {card.marks.length ? (
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: "6px 20px" }}>
              {card.marks.map((m, i) => (
                <li key={m.label} className="pz-body" style={{ fontSize: 20, color: "var(--pz-paper)", display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <span aria-hidden style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--pz-reject)", color: "#1a0a06", fontSize: 14, fontWeight: 800, display: "grid", placeItems: "center" }}>
                    {i + 1}
                  </span>
                  {m.label}
                </li>
              ))}
            </ol>
          ) : (
            <div className="pz-body" style={{ fontSize: 20, color: "var(--pz-paper)" }}>
              {ok ? card.result.reasons[0] : card.result.reasons.join(" · ")}
            </div>
          )}
          <div className="pz-small">
            same_product: {String(card.sameProduct)}
            {card.result.fidelity !== undefined ? ` · score ${card.result.fidelity}` : ""}
          </div>
        </motion.div>
      </div>
    </Rise>
  );
}

export function QaGate({ d }: ChapterProps) {
  const qa = d.qa!;
  const rejectedMarks = qa.rejected.marks.length;
  const markAt = 3.6;
  const rejectStamp = markAt + rejectedMarks * 0.6 + 0.5;
  return (
    <>
      <div style={abs(120, 86, { width: 1700 })}>
        <Rise as="h1" className="pz-display" style={{ fontSize: 72, margin: 0 }}>
          Nothing ships unless it&rsquo;s still your product.
        </Rise>
        <Rise delay={0.2} as="p" className="pz-lede" style={{ margin: "18px 0 0", maxWidth: "none", fontSize: 26 }}>
          Creative mode restages the product with an image model. AI Vision compares every take with the input photo, side by side, and rejects any take that changed the product, whatever its score.
        </Rise>
      </div>
      <Verdict card={qa.approved} x={120} at={0.5} markAt={99} stampAt={2.5} />
      <Verdict card={qa.rejected} x={1020} at={0.75} markAt={markAt} stampAt={rejectStamp} />
    </>
  );
}

// ─── 7. Channel Pack: cards dealt onto the table ─────────────────────────────

interface Slot {
  x: number; // centre on the stage
  y: number;
  w: number;
  r: number; // tilt, degrees
}

/*
 * Composed for the 1920×1080 stage with nothing overlapping: every card, its
 * caption and its tilt stay inside x 120..1840 and above y 990, clear of the
 * rail and chapter label. Top: title, web banner, the colour trio. Bottom: an
 * arc of the portrait formats with the story at the crown.
 */
const SLOTS: Record<string, Slot> = {
  banner: { x: 1000, y: 205, w: 520, r: -1.5 },
  marketplace: { x: 300, y: 742, w: 250, r: -6 },
  feed: { x: 640, y: 700, w: 250, r: -3 },
  story: { x: 960, y: 676, w: 280, r: 0 },
  offer: { x: 1280, y: 700, w: 250, r: 3 },
  whatsapp: { x: 1612, y: 742, w: 230, r: 6 },
};
/** The colour variants land as a trio of plain tiles, top right, with one shared caption. */
const TRIO = { left: 1330, top: 70, w: 158, gap: 18 };

const DEAL_ORDER = ["story", "feed", "offer", "marketplace", "whatsapp", "banner", "recolor"];

function PackFrame({ a, shop, style }: { a: KitAsset; shop: ShopFacts; style?: CSSProperties }) {
  switch (a.frame) {
    case "story":
      return <StoryFrame asset={a} shop={shop} style={style} />;
    case "feed-post":
      return <FeedPostFrame asset={a} shop={shop} style={style} />;
    case "listing-card":
      return <ListingCardFrame asset={a} shop={shop} style={style} />;
    case "catalog-tile":
      return <CatalogTileFrame asset={a} shop={shop} style={style} />;
    case "web-banner":
      return <WebBannerFrame asset={a} shop={shop} style={style} />;
    default:
      return <FeedPostFrame asset={a} shop={shop} style={style} />;
  }
}

export function shopFacts(d: ChapterProps["d"]): ShopFacts {
  return {
    name: d.shop.name,
    handle: d.shop.name.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, ""),
    initial: d.shop.name.trim()[0]?.toUpperCase() ?? "S",
    title: d.product.listingTitle,
    host: d.shop.host.split("/")[0],
  };
}

const RECOLOR_TILT = [-4, 1.5, 5];

export function ChannelPack({ d }: ChapterProps) {
  const reduced = useReducedMotion();
  const shop = shopFacts(d);
  const recolors = d.pack.filter((a) => a.format === "recolor").slice(0, 3);
  const TH = Math.round((TRIO.w * 1350) / 1080);
  const placed = [
    ...d.pack
      .filter((a) => a.format !== "recolor" && SLOTS[a.id])
      .map((a) => ({ a, key: a.id, slot: SLOTS[a.id], tile: false })),
    ...recolors.map((a, i) => ({
      a,
      key: "recolor",
      slot: { x: TRIO.left + TRIO.w / 2 + i * (TRIO.w + TRIO.gap), y: TRIO.top + TH / 2, w: TRIO.w, r: RECOLOR_TILT[i % RECOLOR_TILT.length] },
      tile: true,
    })),
  ].sort((p, q) => DEAL_ORDER.indexOf(p.key) - DEAL_ORDER.indexOf(q.key));
  const DECK = { x: 960, y: 1300 };
  const at = (i: number) => (reduced ? 0.3 + i * 0.1 : 0.45 + i * 0.16);
  const trioLanded = at(placed.length - 1) + 0.6;
  const colourNames = recolors.map((a) => a.label.replace(/^Colour variant, /, ""));

  return (
    <>
      <div style={abs(120, 80, { width: 520 })}>
        <Rise as="h1" className="pz-display pz-h3" style={{ margin: 0, fontSize: 64 }}>
          One hero.
          <br />
          Every channel.
        </Rise>
        <Rise delay={0.2} as="p" className="pz-lede" style={{ margin: "20px 0 0", fontSize: 24, maxWidth: 460 }}>
          {d.pack.length} formats, all transformations of one approved hero. 0 new generation credits.
        </Rise>
      </div>

      <div style={{ position: "absolute", inset: 0, perspective: 2400, perspectiveOrigin: "50% 30%" }}>
        {placed.map(({ a, slot, tile }, i) => (
          <motion.div
            key={a.id}
            className="pz-card3d"
            style={{ left: slot.x, top: slot.y, width: slot.w, translate: "-50% -50%", zIndex: i + 1 }}
            initial={reduced ? { opacity: 0, rotate: slot.r } : { x: DECK.x - slot.x, y: DECK.y - slot.y, rotate: 0, rotateY: 180, scale: 0.55, opacity: 1 }}
            animate={{ x: 0, y: 0, rotate: slot.r, rotateY: 0, scale: 1, opacity: 1 }}
            transition={reduced ? { delay: at(i), duration: 0.4 } : { delay: at(i), type: "spring", stiffness: 95, damping: 17, mass: 0.9 }}
          >
            <div className="pz-face">
              {tile ? (
                <div className="pz-frame" style={{ aspectRatio: `${a.width} / ${a.height}`, borderRadius: 14 }}>
                  <Img src={a.url} alt={a.alt} className="pz-fill" />
                </div>
              ) : (
                <>
                  <PackFrame a={a} shop={shop} />
                  <span className="pz-caption-tag">{a.label}</span>
                </>
              )}
            </div>
            <div className="pz-back" aria-hidden>
              <Mark size={Math.round(slot.w * 0.28)} />
            </div>
          </motion.div>
        ))}
      </div>

      {recolors.length > 0 && (
        <Rise
          delay={trioLanded}
          y={8}
          style={abs(TRIO.left, TRIO.top + TH + 26, { width: recolors.length * TRIO.w + (recolors.length - 1) * TRIO.gap, textAlign: "center", fontSize: 17, color: "var(--pz-dim)", whiteSpace: "nowrap" })}
        >
          {recolors.length === 1 ? "Colour variant" : `${recolors.length} colour variants`}: {colourNames.join(", ")}
        </Rise>
      )}
    </>
  );
}

// ─── 8. Kit Reel ──────────────────────────────────────────────────────────────

export function Reel({ d }: ChapterProps) {
  const reel = d.reel!;
  const [src, setSrc] = useState<string>(reel.url);
  const [t, setT] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let live = true;
    preloadVideo(reel.url).then((u) => live && setSrc(u));
    return () => {
      live = false;
    };
  }, [reel.url]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => {});
  }, [src]);
  // clips are read back from the reel URL (lib/present/data.ts reelClipsFromUrl), so this count is the video's
  const clips = reel.clips.length;
  const per = reel.clips[0]?.seconds || reel.seconds / Math.max(1, clips);
  const sameLength = reel.clips.every((c) => c.seconds === per);
  let activeClip = 0;
  for (let i = 0, acc = 0; i < clips; i++) {
    acc += reel.clips[i].seconds || per;
    activeClip = i;
    if (t < acc) break;
  }

  const PW = 470;
  const CX = 1250;
  const PH = Math.round((PW - 28) * (16 / 9)) + 28;
  const cap = (m: string) => m[0].toUpperCase() + m.slice(1);

  return (
    <>
      <div style={abs(120, 110, { width: 820 })}>
        <Rise as="h1" className="pz-display pz-h1" style={{ margin: 0 }}>
          Even the reel is one URL.
        </Rise>
        <Rise delay={0.2} as="p" className="pz-lede" style={{ margin: "26px 0 0" }}>
          {clips} stored {clips === 1 ? "image becomes a" : "images become"} {sameLength ? `${per}-second ` : ""}Ken Burns {clips === 1 ? "clip" : "clips"}, spliced into a {Math.round(reel.seconds)}-second video with the offer held on top. No generation credits.
        </Rise>
      </div>

      <div style={abs(120, 610, { display: "flex", gap: 26 })}>
        {reel.clips.map((c, i) => (
          <Rise key={`${c.publicId}-${i}`} delay={0.5 + i * 0.1} y={14} style={{ display: "grid", gap: 10, justifyItems: "center" }}>
            <div
              style={{
                position: "relative",
                width: 124,
                height: 220,
                borderRadius: 14,
                overflow: "hidden",
                outline: i === activeClip ? "3px solid var(--pz-marigold)" : "1px solid var(--pz-line-strong)",
                outlineOffset: i === activeClip ? 3 : 0,
                transition: "outline-color 200ms, outline-offset 200ms",
                background: "var(--pz-umber)",
              }}
            >
              <Img src={c.url} alt="" className="pz-fill" />
            </div>
            <span className="pz-small" style={{ width: 150, textAlign: "center", lineHeight: 1.3, whiteSpace: "nowrap", color: i === activeClip ? "var(--pz-marigold-hi)" : undefined }}>
              {cap(c.move)}
            </span>
          </Rise>
        ))}
      </div>

      <Rise delay={0.9} style={abs(120, 936, { display: "flex", gap: 10 })}>
        {["e_zoompan", "fl_splice", "e_fade", "l_text", ".mp4"].map((t) => (
          <span key={t} className="pz-chip pz-mono" style={{ fontSize: 17 }}>
            {t}
          </span>
        ))}
      </Rise>

      <motion.div style={abs(CX - PW / 2, 540 - PH / 2)} initial={{ opacity: 0, y: 60, rotate: 4 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ type: "spring", stiffness: 110, damping: 18 }}>
        <PhoneFrame style={{ position: "relative", width: PW, height: PH }} label="Kit reel playing on a phone">
          <video
            ref={video}
            src={src}
            poster={reel.poster}
            muted
            playsInline
            autoPlay
            loop
            preload="auto"
            onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
            aria-label={`Kit reel, ${Math.round(reel.seconds)} seconds`}
          />
          <div style={{ position: "absolute", left: 16, right: 16, bottom: 18, height: 4, borderRadius: 2, background: "rgb(255 255 255 / 0.3)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(100, (t / reel.seconds) * 100)}%`, background: "#fff" }} />
          </div>
        </PhoneFrame>
      </motion.div>

      <Rise delay={1.1} style={abs(CX + PW / 2 + 44, 540 - 22)}>
        <span className="pz-chip" data-tone="lit">
          <Film /> {reel.seconds.toFixed(0)} s · H.264 · 720×1280
        </span>
      </Rise>
    </>
  );
}
