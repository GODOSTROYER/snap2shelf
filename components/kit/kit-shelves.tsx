"use client";

import { CodeXml } from "lucide-react";
import { animate } from "motion/react";
import dynamic from "next/dynamic";
import * as React from "react";
import { AssetFrame } from "@/components/frames/asset-frame";
import { Tip } from "@/components/ui/tip";
import { frameProduct, shelvesFor, type ShelfItem } from "@/lib/client/kit-view";
import type { Kit, KitAsset } from "@/lib/types";
import { QaBadge } from "./qa-badge";
import { ReelVideo } from "./reel-video";
import { Shelf, ShelfTag } from "./shelf";

// The X-ray sheet (a Radix dialog plus the URL anatomy) loads when first wanted:
// warmed on hover/focus of an X-ray button, mounted on the first click.
const loadXray = () => import("./xray-sheet");
const XraySheet = dynamic(() => loadXray().then((m) => m.XraySheet), { ssr: false });

/**
 * With `rowsWhenNear` (the kit page, where the shelves start two screens down on a
 * phone) each row renders, and fetches its pictures, only as it nears the viewport.
 * The reserved height is the row's real one (h3 + ledge + card at --h 292/330/372 +
 * the tag row with its X-ray button). Not for the studio: its deal measures the cards.
 */
const ROW_WHEN_NEAR = "[content-visibility:auto] [contain-intrinsic-height:auto_418px] sm:[contain-intrinsic-height:auto_456px] lg:[contain-intrinsic-height:auto_498px]";

export interface DealRequest {
  key: number; // bump to deal again
  from: () => DOMRect | null; // where the deck sits (the stage hero)
}

/**
 * Every asset of a kit on shelves, each in its real-world frame, with an X-ray
 * on every card. When `deal` changes, the cards are dealt from the hero onto
 * the shelves, and the reel starts once they've landed.
 */
export function KitShelves({
  kit,
  deal,
  onDealt,
  rendering = [],
  rowsWhenNear = false,
}: {
  kit: Kit;
  deal?: DealRequest | null;
  onDealt?: () => void;
  rendering?: string[];
  rowsWhenNear?: boolean;
}) {
  const [xray, setXray] = React.useState<KitAsset | null>(null);
  const [xrayWanted, setXrayWanted] = React.useState(false);
  const openXray = React.useCallback((a: KitAsset) => {
    setXrayWanted(true);
    setXray(a);
  }, []);
  const [reelReady, setReelReady] = React.useState(!deal);
  const root = React.useRef<HTMLDivElement>(null);
  const groups = React.useMemo(() => shelvesFor(kit), [kit]);
  const product = frameProduct(kit);
  const onDealtRef = React.useRef(onDealt);
  React.useEffect(() => {
    onDealtRef.current = onDealt;
  });

  const dealKey = deal?.key ?? 0;
  const dealFrom = deal?.from;
  React.useLayoutEffect(() => {
    const el = root.current;
    if (!el || !dealKey || !dealFrom) return;
    const cards = Array.from(el.querySelectorAll<HTMLElement>("[data-card]"));
    const section = (el.closest("[data-kit]") as HTMLElement | null) ?? el;
    const run = dealCards(section, cards, dealFrom);
    run.done.then((finished) => {
      if (!finished) return;
      setReelReady(true);
      onDealtRef.current?.();
    });
    return run.cancel;
  }, [dealKey, dealFrom]);

  return (
    <div ref={root} className="grid gap-4">
      {rendering.length ? (
        <p role="status" className="mx-4 flex items-center gap-2.5 rounded-xl bg-stage px-4 py-3 text-sm text-dim ring-1 ring-line sm:mx-8 sm:w-fit">
          <span aria-hidden className="size-2 animate-pulse rounded-full bg-marigold" />
          Still rendering: {rendering.map(formatName).join(", ")}. They land on the shelf as soon as Cloudinary finishes.
        </p>
      ) : null}
      {groups.map((g) => (
        <Shelf key={g.id} title={g.title} className={rowsWhenNear ? ROW_WHEN_NEAR : undefined}>
          {g.items.map((item) => (
            <li key={item.key} className="flex shrink-0 snap-start flex-col items-start">
              <Card item={item} product={product} reelReady={reelReady} onXray={openXray} />
            </li>
          ))}
        </Shelf>
      ))}
      {xrayWanted ? <XraySheet asset={xray} onOpenChange={(o) => !o && setXray(null)} /> : null}
    </div>
  );
}

const warmXray = () => void loadXray();

const NAMES: Record<string, string> = { story: "story", banner: "web banner", marketplace: "marketplace image", whatsapp: "catalog tile", offer: "festive offer", feed: "feed post" };
const formatName = (id: string) => NAMES[id] ?? (id.startsWith("recolor-") ? "a colour variant" : id);

function Card({ item, product, reelReady, onXray }: { item: ShelfItem; product: ReturnType<typeof frameProduct>; reelReady: boolean; onXray: (a: KitAsset) => void }) {
  const a = item.asset;
  return (
    <>
      <div data-card className="lift rounded-2xl shadow-[0_18px_28px_-16px_rgb(0_0_0/0.9)]">
        <AssetFrame
          asset={a}
          product={product}
          frame={item.kind === "reel" ? "reel" : undefined}
          media={item.kind === "reel" ? <ReelVideo src={item.src} poster={item.poster} label={a.alt} ready={reelReady} /> : undefined}
        />
      </div>
      <ShelfTag asset={a}>
        <Tip label="See the Cloudinary URL behind this">
          <button
            type="button"
            onClick={() => onXray(a)}
            onPointerEnter={warmXray}
            onFocus={warmXray}
            aria-label={`X-ray: how ${a.label} is made`}
            className="grid size-7 place-items-center rounded-md bg-stage-2 text-dim ring-1 ring-line-strong transition-colors ring-inset hover:bg-stage-3 hover:text-marigold"
          >
            <CodeXml className="size-4" />
          </button>
        </Tip>
        {a.qa && a.id.startsWith("creative") ? <QaBadge qa={a.qa} /> : null}
      </ShelfTag>
    </>
  );
}

/**
 * Deal: clone each card into a fixed layer (so shelf scrollers can't clip it),
 * fan the clones out over the hero like a hand of cards, then deal each one to
 * its place on the shelf and reveal the real card underneath.
 */
function dealCards(root: HTMLElement, cards: HTMLElement[], from: () => DOMRect | null) {
  const state = { cancelled: false, layer: null as HTMLElement | null };
  const cancel = () => {
    state.cancelled = true;
    state.layer?.remove();
    cards.forEach((c) => (c.style.opacity = ""));
    cards.forEach((c) => tagOf(c)?.style.removeProperty("opacity"));
  };
  const done = flyCards(root, cards, from, state).then(
    () => !state.cancelled,
    () => {
      cancel();
      return false;
    },
  );
  return { done, cancel };
}

async function flyCards(root: HTMLElement, cards: HTMLElement[], from: () => DOMRect | null, state: { cancelled: boolean; layer: HTMLElement | null }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  cards.forEach((c) => (c.style.opacity = "0"));
  // shelf-edge tags arrive with their card
  cards.forEach((c) => tagOf(c)?.style.setProperty("opacity", "0"));
  const showTag = (c: HTMLElement) => {
    const t = tagOf(c);
    if (!t) return;
    t.style.removeProperty("opacity");
    void animate(t, { opacity: [0, 1], y: [-4, 0] }, { duration: 0.35, ease: [0.16, 1, 0.3, 1] });
  };
  // Load every card's image while we scroll, so no card is dealt face-down.
  const imgs = cards.flatMap((c) => Array.from(c.querySelectorAll("img")));
  imgs.forEach((i) => (i.loading = "eager"));
  await Promise.all([
    bringIntoView(root, reduced),
    Promise.race([Promise.all(imgs.map((i) => i.decode().catch(() => undefined))), new Promise((r) => setTimeout(r, 2200))]),
  ]);
  if (state.cancelled) return;
  if (reduced || !cards.length) {
    await Promise.all(
      cards.map((c) =>
        animate(c, { opacity: [0, 1] }, { duration: 0.25 }).then(() => {
          c.style.opacity = "";
          showTag(c);
        }),
      ),
    );
    return;
  }
  // The deck sits where the hero is; if the hero has scrolled away, just above the shelves.
  const sec = root.getBoundingClientRect();
  let deck = from();
  if (!deck || deck.bottom < 40 || deck.top > window.innerHeight - 40) deck = new DOMRect(sec.left + sec.width / 2 - 110, Math.max(24, sec.top - 60), 220, 280);
  const deckX = deck.left + deck.width / 2;
  const deckY = deck.top + deck.height / 2;

  const layer = document.createElement("div");
  state.layer = layer;
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:40;overflow:hidden";
  document.body.appendChild(layer);

  const n = cards.length;
  const ghosts = cards.map((card, i) => {
    const r = card.getBoundingClientRect();
    const ghost = card.cloneNode(true) as HTMLElement;
    ghost.removeAttribute("data-card");
    ghost.querySelectorAll("video").forEach((v) => v.removeAttribute("src"));
    ghost.style.setProperty("--h", getComputedStyle(card).getPropertyValue("--h"));
    Object.assign(ghost.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: "0", opacity: "0", transformOrigin: "50% 115%" });
    layer.appendChild(ghost);
    card.style.opacity = "0";
    const spread = i - (n - 1) / 2;
    return {
      card,
      ghost,
      i,
      dx: deckX - (r.left + r.width / 2),
      dy: deckY - (r.top + r.height / 2),
      s: Math.min(1, Math.max(0.28, (deck.height * 0.62) / r.height)),
      fanRot: spread * Math.min(7, 64 / n),
      fanX: spread * 9,
      side: Math.sign(r.left + r.width / 2 - deckX) || 1,
    };
  });

  // 1. The deck fans open like a hand of cards, right where the hero is.
  const ease = [0.16, 1, 0.3, 1] as const;
  await Promise.all(
    ghosts.map((g) =>
      animate(
        g.ghost,
        { x: [g.dx, g.dx + g.fanX], y: [g.dy + 36, g.dy], scale: [g.s * 0.86, g.s], rotate: [0, g.fanRot], opacity: [0, 1] },
        { duration: 0.46, ease, delay: g.i * 0.022 },
      ),
    ),
  );
  if (state.cancelled) return;

  // 2. Deal them onto the shelves one by one, tipping in from 3D as they land.
  const flights = ghosts.map((g) =>
    animate(
      g.ghost,
      { x: [g.dx + g.fanX, 0], y: [g.dy, 0], scale: [g.s, 1], rotate: [g.fanRot, 0], rotateY: [g.side * 9, 0], rotateX: [10, 0], transformPerspective: [1800, 1800] },
      { type: "spring", stiffness: 135, damping: 17, mass: 0.9, delay: 0.06 + g.i * 0.075 },
    ).then(() => {
      if (state.cancelled) return;
      g.card.style.opacity = "";
      showTag(g.card);
      g.ghost.remove();
    }),
  );
  await Promise.all(flights);
  layer.remove();
}

const tagOf = (card: HTMLElement) => card.parentElement?.querySelector<HTMLElement>("[data-tag]") ?? null;

/** Scroll the shelves to the top of the viewport (if they aren't already) and wait for it to settle. */
function bringIntoView(el: HTMLElement, reduced: boolean) {
  const top = el.getBoundingClientRect().top;
  if (top >= 0 && top < window.innerHeight * 0.35) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(t);
      window.removeEventListener("scrollend", done);
      resolve();
    };
    const t = setTimeout(done, reduced ? 50 : 900);
    window.addEventListener("scrollend", done, { once: true });
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  });
}
