"use client";

import { CodeXml } from "lucide-react";
import { animate } from "motion/react";
import * as React from "react";
import { AssetFrame } from "@/components/frames/asset-frame";
import { Tip } from "@/components/ui/controls";
import { frameProduct, shelvesFor, type ShelfItem } from "@/lib/client/kit-view";
import type { Kit, KitAsset } from "@/lib/types";
import { QaBadge } from "./qa-badge";
import { ReelVideo } from "./reel-video";
import { Shelf, ShelfTag } from "./shelf";
import { XraySheet } from "./xray-sheet";

export interface DealRequest {
  key: number; // bump to deal again
  from: () => DOMRect | null; // where the deck sits (the stage hero)
}

/**
 * Every asset of a kit on shelves, each in its real-world frame, with an X-ray
 * on every card. When `deal` changes, the cards are dealt from the hero onto
 * the shelves, and the reel starts once they've landed.
 */
export function KitShelves({ kit, deal, onDealt }: { kit: Kit; deal?: DealRequest | null; onDealt?: () => void }) {
  const [xray, setXray] = React.useState<KitAsset | null>(null);
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
      {groups.map((g) => (
        <Shelf key={g.id} title={g.title}>
          {g.items.map((item) => (
            <li key={item.key} className="flex shrink-0 snap-start flex-col items-start">
              <Card item={item} product={product} reelReady={reelReady} onXray={setXray} />
            </li>
          ))}
        </Shelf>
      ))}
      <XraySheet asset={xray} onOpenChange={(o) => !o && setXray(null)} />
    </div>
  );
}

function Card({ item, product, reelReady, onXray }: { item: ShelfItem; product: ReturnType<typeof frameProduct>; reelReady: boolean; onXray: (a: KitAsset) => void }) {
  const a = item.asset;
  return (
    <>
      <div data-card className="shadow-[0_18px_28px_-16px_rgb(0_0_0/0.9)]" style={{ borderRadius: 16 }}>
        <AssetFrame
          asset={a}
          product={product}
          media={item.kind === "reel" ? <ReelVideo src={item.src} poster={item.poster} label={a.alt} ready={reelReady} /> : undefined}
        />
      </div>
      <ShelfTag asset={a}>
        <Tip label="See the Cloudinary URL behind this">
          <button
            type="button"
            onClick={() => onXray(a)}
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
 * fly the clone from the deck to the card's place, then reveal the real card.
 */
function dealCards(root: HTMLElement, cards: HTMLElement[], from: () => DOMRect | null) {
  const state = { cancelled: false, layer: null as HTMLElement | null };
  const cancel = () => {
    state.cancelled = true;
    state.layer?.remove();
    cards.forEach((c) => (c.style.opacity = ""));
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
  await bringIntoView(root, reduced);
  if (state.cancelled) return;
  if (reduced || !cards.length) {
    await Promise.all(
      cards.map((c) =>
        animate(c, { opacity: [0, 1] }, { duration: 0.25 }).then(() => {
          c.style.opacity = "";
        }),
      ),
    );
    return;
  }
  const vw = window.innerWidth;
  const deck = from() ?? new DOMRect(vw / 2 - 120, -320, 240, 300);
  const layer = document.createElement("div");
  state.layer = layer;
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:40;overflow:hidden";
  document.body.appendChild(layer);

  const flights = cards.map((card, i) => {
    const r = card.getBoundingClientRect();
    const ghost = card.cloneNode(true) as HTMLElement;
    ghost.removeAttribute("data-card");
    ghost.querySelectorAll("video").forEach((v) => v.removeAttribute("src"));
    ghost.style.setProperty("--h", getComputedStyle(card).getPropertyValue("--h"));
    Object.assign(ghost.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: "0", opacity: "0" });
    layer.appendChild(ghost);
    card.style.opacity = "0";

    const dx = deck.left + deck.width / 2 - (r.left + r.width / 2);
    const dy = deck.top + deck.height / 2 - (r.top + r.height / 2);
    const scale = Math.min(1, Math.max(0.35, (deck.height * 0.6) / r.height));
    const tilt = (i % 2 ? 1 : -1) * (5 + ((i * 7) % 9));
    const delay = 0.12 + i * 0.085;

    const fly = animate(ghost, { x: [dx, 0], y: [dy, 0], scale: [scale, 1], rotate: [tilt, 0] }, { type: "spring", stiffness: 150, damping: 19, mass: 0.9, delay });
    const show = animate(ghost, { opacity: [0, 1] }, { duration: 0.18, delay });
    return Promise.all([fly, show]).then(() => {
      if (state.cancelled) return;
      card.style.opacity = "";
      ghost.remove();
    });
  });
  await Promise.all(flights);
  layer.remove();
}

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
