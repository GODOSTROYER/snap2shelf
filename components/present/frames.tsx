"use client";

/**
 * Generic device and placement frames for the Channel Pack, reel and shelf
 * chapters. Deliberately brand-free: no real app's chrome, colours or logos,
 * just enough of a feed post, story, listing card, chat or browser for a
 * viewer to recognise where each format lives. No invented prices, ratings
 * or reviews: a price shows only when the shop really has one.
 */
import { BadgeCheck, Bookmark, CheckCheck, ChevronLeft, Heart, Lock, MessageCircle, MoreHorizontal, Send, Share2, ShoppingBag } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { KitAsset } from "@/lib/types";
import { Img } from "./stage";

export interface ShopFacts {
  name: string;
  handle: string;
  initial: string;
  /** Only when the shop sets one; the demo shelf has none. */
  price?: string;
  title: string;
  host: string;
}

const icon = { width: 18, height: 18, strokeWidth: 1.9 } as const;

export function FeedPostFrame({ asset, shop, style }: { asset: Pick<KitAsset, "url" | "alt" | "width" | "height">; shop: ShopFacts; style?: CSSProperties }) {
  return (
    <div className="pz-frame" style={style}>
      <div className="pz-frame-bar" style={{ height: 46 }}>
        <span className="pz-avatar" style={{ width: 28, height: 28, fontSize: 14 }}>
          {shop.initial}
        </span>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{shop.handle}</span>
        <BadgeCheck {...icon} width={14} height={14} color="#e0701b" />
        <MoreHorizontal {...icon} style={{ marginLeft: "auto" }} color="#6f6962" />
      </div>
      <Img src={asset.url} alt={asset.alt} className="pz-frame-img" style={{ aspectRatio: `${asset.width} / ${asset.height}` }} />
      <div className="pz-frame-bar" style={{ height: 44, gap: 14 }}>
        <Heart {...icon} />
        <MessageCircle {...icon} />
        <Send {...icon} />
        <Bookmark {...icon} style={{ marginLeft: "auto" }} />
      </div>
      <div style={{ padding: "0 12px 12px", fontSize: 13, lineHeight: 1.35, color: "#3b352f" }}>
        <b>{shop.handle}</b> {shop.title}
        {shop.price ? `, ${shop.price}` : ""}
      </div>
    </div>
  );
}

export function StoryFrame({ asset, shop, style }: { asset: Pick<KitAsset, "url" | "alt">; shop: ShopFacts; style?: CSSProperties }) {
  return (
    <div className="pz-frame" data-dark="true" style={{ borderRadius: 26, padding: 7, ...style }}>
      <div style={{ position: "relative", width: "100%", aspectRatio: "9 / 16", borderRadius: 20, overflow: "hidden" }}>
        <Img src={asset.url} alt={asset.alt} className="pz-fill" />
        <div style={{ position: "absolute", top: 10, left: 10, right: 10, display: "flex", gap: 4 }}>
          {[1, 0.9, 0].map((f, i) => (
            <span key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: "rgb(255 255 255 / 0.35)", overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${f * 100}%`, background: "#fff" }} />
            </span>
          ))}
        </div>
        <div style={{ position: "absolute", top: 22, left: 10, display: "flex", alignItems: "center", gap: 8, color: "#fff", fontSize: 13, fontWeight: 700, textShadow: "0 1px 4px rgb(0 0 0 / 0.5)" }}>
          <span className="pz-avatar" style={{ width: 26, height: 26, fontSize: 13 }}>
            {shop.initial}
          </span>
          {shop.handle}
        </div>
        <div style={{ position: "absolute", left: 10, right: 10, bottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, height: 36, borderRadius: 999, border: "1.5px solid rgb(255 255 255 / 0.75)", color: "#fff", fontSize: 13, display: "flex", alignItems: "center", paddingLeft: 14 }}>
            Send message
          </span>
          <Heart {...icon} color="#fff" />
        </div>
      </div>
    </div>
  );
}

export function ListingCardFrame({ asset, shop, style }: { asset: Pick<KitAsset, "url" | "alt">; shop: ShopFacts; style?: CSSProperties }) {
  return (
    <div className="pz-frame" style={style}>
      <div style={{ position: "relative", aspectRatio: "1 / 1", background: "#fff", borderBottom: "1px solid var(--pz-frame-line)" }}>
        <Img src={asset.url} alt={asset.alt} className="pz-fill" style={{ objectFit: "contain" }} />
      </div>
      <div style={{ padding: "12px 14px 14px", display: "grid", gap: 6 }}>
        <div style={{ fontSize: 14, lineHeight: 1.3, fontWeight: 600 }}>{shop.title}</div>
        {shop.price && <div style={{ fontSize: 19, fontWeight: 800 }}>{shop.price}</div>}
        <div style={{ height: 36, borderRadius: 9, background: "#1c1712", color: "#fff", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <ShoppingBag width={15} height={15} /> Add to cart
        </div>
      </div>
    </div>
  );
}

/** A chat catalogue item: the square tile (and its price, if any), inside a message bubble. */
export function CatalogTileFrame({ asset, shop, style }: { asset: Pick<KitAsset, "url" | "alt">; shop: ShopFacts; style?: CSSProperties }) {
  return (
    <div className="pz-frame" data-dark="true" style={{ background: "#171310", padding: 12, ...style }}>
      <div style={{ borderRadius: 14, overflow: "hidden", background: "var(--pz-bubble)" }}>
        <Img src={asset.url} alt={asset.alt} className="pz-frame-img" style={{ aspectRatio: "1 / 1" }} />
        <div style={{ padding: "10px 12px 12px", display: "grid", gap: 4 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#f2eee8" }}>{shop.title}</div>
          {shop.price && <div style={{ fontSize: 15, fontWeight: 800, color: "#ffc76a" }}>{shop.price}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "#a79c8e" }}>
            <span>View in catalogue</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              10:42 <CheckCheck width={15} height={15} color="#8fc7ff" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WebBannerFrame({ asset, shop, style }: { asset: Pick<KitAsset, "url" | "alt" | "width" | "height">; shop: ShopFacts; style?: CSSProperties }) {
  return (
    <div className="pz-frame" style={{ background: "#faf8f5", ...style }}>
      <div className="pz-browser-bar" style={{ height: 34, gap: 10, padding: "0 12px" }}>
        <span className="pz-dots" style={{ gap: 6 }}>
          <i style={{ width: 9, height: 9 }} />
          <i style={{ width: 9, height: 9 }} />
          <i style={{ width: 9, height: 9 }} />
        </span>
        <span className="pz-url-pill" style={{ height: 22, fontSize: 11, borderRadius: 6, padding: "0 10px" }}>
          <Lock width={11} height={11} /> {shop.host}
        </span>
      </div>
      <Img src={asset.url} alt={asset.alt} className="pz-frame-img" style={{ aspectRatio: `${asset.width} / ${asset.height}` }} />
    </div>
  );
}

/** A shared link, as it unfurls inside a chat bubble. */
export function LinkPreviewFrame({ asset, title, description, host, style }: { asset: Pick<KitAsset, "url" | "alt">; title: string; description: string; host: string; style?: CSSProperties }) {
  return (
    <div className="pz-frame" data-dark="true" style={{ background: "var(--pz-bubble-out)", padding: 8, ...style }}>
      <div style={{ borderRadius: 10, overflow: "hidden", background: "rgb(0 0 0 / 0.22)" }}>
        <Img src={asset.url} alt={asset.alt} className="pz-frame-img" style={{ aspectRatio: "1200 / 630" }} />
        <div style={{ padding: "9px 12px 11px", display: "grid", gap: 3 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#f6efe4" }}>{title}</div>
          <div style={{ fontSize: 12.5, color: "#c9bba6" }}>{description}</div>
          <div style={{ fontSize: 12, color: "#9c8f7e" }}>{host}</div>
        </div>
      </div>
    </div>
  );
}

export function PhoneFrame({ children, style, label }: { children: ReactNode; style?: CSSProperties; label?: string }) {
  return (
    <div className="pz-phone" style={style} role={label ? "group" : undefined} aria-label={label}>
      <div className="pz-phone-screen">
        <div className="pz-phone-island" aria-hidden />
        {children}
      </div>
    </div>
  );
}

export function BrowserFrame({ host, children, style, dark = false }: { host: string; children: ReactNode; style?: CSSProperties; dark?: boolean }) {
  return (
    <div className="pz-browser" data-dark={dark || undefined} style={style}>
      <div className="pz-browser-bar">
        <span className="pz-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="pz-url-pill">
          <Lock width={14} height={14} /> {host}
        </span>
        <Share2 width={18} height={18} color={dark ? "#a89f92" : "#6f6962"} />
      </div>
      {children}
    </div>
  );
}

export function ChatHeader({ title, subtitle, initial }: { title: string; subtitle: string; initial: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "56px 16px 12px", background: "#1b1612", borderBottom: "1px solid rgb(255 255 255 / 0.06)" }}>
      <ChevronLeft width={22} height={22} color="#c9bba6" />
      <span className="pz-avatar" style={{ width: 38, height: 38, fontSize: 17 }}>
        {initial}
      </span>
      <div style={{ display: "grid", lineHeight: 1.25 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: "#f6efe4" }}>{title}</span>
        <span style={{ fontSize: 13, color: "#a79c8e" }}>{subtitle}</span>
      </div>
    </div>
  );
}
