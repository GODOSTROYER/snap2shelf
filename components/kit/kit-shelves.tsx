"use client";

import { animate } from "motion/react";
import * as React from "react";
import { frameProduct, shelvesFor } from "@/lib/client/kit-view";
import type { Kit } from "@/lib/types";
import { KitCard } from "./kit-card";
import { Shelf } from "./shelf";
import { XrayHost } from "./xray-button";

export interface DealRequest {
  key: number; // bump to deal again
  from: () => DOMRect | null; // where the deck sits (the stage hero)
}

/**
 * Every asset of a kit on shelves, each in its real-world frame, with an X-ray
 * on every card. When `deal` changes, the cards are dealt from the hero onto
 * the shelves, and the reel starts once they've landed.
 */
export function KitShelves({ kit, deal, onDealt, rendering = [] }: { kit: Kit; deal?: DealRequest | null; onDealt?: () => void; rendering?: string[] }) {
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
    <XrayHost>
      <div ref={root} className="grid gap-4">
        {rendering.length ? (
          <p role="status" className="mx-4 flex items-center gap-2.5 rounded-xl bg-stage px-4 py-3 text-sm text-dim ring-1 ring-line sm:mx-8 sm:w-fit">
            <span aria-hidden className="size-2 animate-pulse rounded-full bg-marigold" />
            Still rendering: {rendering.map(formatName).join(", ")}. They land on the shelf as soon as Cloudinary finishes.
          </p>
        ) : null}
        {groups.map((g) => (
          <Shelf key={g.id} title={g.title}>
            {g.items.map((item) => (
              <KitCard key={item.key} item={item} product={product} reelReady={reelReady} />
            ))}
          </Shelf>
        ))}
      </div>
    </XrayHost>
  );
}

const NAMES: Record<string, string> = { story: "story", banner: "web banner", marketplace: "marketplace image", whatsapp: "catalog tile", offer: "festive offer", feed: "feed post" };
const formatName = (id: string) => NAMES[id] ?? (id.startsWith("recolor-") ? "a colour variant" : id);


/**
 * Deal the cards onto their shelves, then reveal the real cards. Each card's
 * outline (its data-slot) shows while it is in flight, so a shelf is never an
 * empty ledge. Wide screens: the clones fan out over the hero like a hand of
 * cards and are dealt across to their places (a fixed layer, so scrollers can't
 * clip them). Narrow screens: each card drops in from just above its own shelf,
 * inside the shelf's scroller, so nothing ever flies over a heading or a button.
 * Reduced motion: a plain fade.
 */
export function dealCards(root: HTMLElement, cards: HTMLElement[], from: () => DOMRect | null) {
  const state = { cancelled: false, layer: null as HTMLElement | null };
  const cancel = () => {
    state.cancelled = true;
    state.layer?.remove();
    cards.forEach((c) => {
      c.style.opacity = "";
      c.style.removeProperty("transform");
      tagOf(c)?.style.removeProperty("opacity");
      slotOf(c)?.style.removeProperty("opacity");
    });
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

/** Below this width the deal stays on the shelves (short drops, no cross-page flight). */
const NARROW = 640;

async function flyCards(root: HTMLElement, cards: HTMLElement[], from: () => DOMRect | null, state: { cancelled: boolean; layer: HTMLElement | null }) {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const narrow = window.innerWidth < NARROW;
  // before the first paint: every card hidden, its outline on the shelf instead
  cards.forEach((c) => {
    c.style.opacity = "0";
    tagOf(c)?.style.setProperty("opacity", "0"); // shelf-edge tags arrive with their card
    slotOf(c)?.style.setProperty("opacity", "1");
  });
  const land = (c: HTMLElement) => {
    c.style.opacity = "";
    slotOf(c)?.style.setProperty("opacity", "0");
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
    Promise.race([Promise.all(imgs.map((i) => i.decode().catch(() => undefined))), new Promise((r) => setTimeout(r, narrow ? 1400 : 2200))]),
  ]);
  if (state.cancelled) return;
  if (reduced || !cards.length) {
    await Promise.all(cards.map((c) => animate(c, { opacity: [0, 1] }, { duration: 0.25 }).then(() => land(c))));
    return;
  }

  if (narrow) {
    // Each card drops a few px from above its own place and settles on the ledge. The shelf's
    // scroller clips it, so the drop stays inside the shelf; cards off to the right land unseen.
    const at = new Map(cards.map((c) => [c, c.getBoundingClientRect()] as const));
    const order = [...cards].sort((a, b) => at.get(a)!.top - at.get(b)!.top || at.get(a)!.left - at.get(b)!.left);
    let k = 0;
    await Promise.all(
      order.map((c) => {
        const r = at.get(c)!;
        const onScreen = r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight;
        const delay = 0.05 + (onScreen ? k++ : k) * 0.09;
        return animate(c, { opacity: [0, 1], y: [-26, 0], rotate: [-2.5, 0], scale: [0.96, 1] }, { type: "spring", stiffness: 260, damping: 20, mass: 0.8, delay }).then(() => {
          if (state.cancelled) return;
          c.style.removeProperty("transform");
          land(c);
        });
      }),
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
      land(g.card);
      g.ghost.remove();
    }),
  );
  await Promise.all(flights);
  layer.remove();
}

const tagOf = (card: HTMLElement) => card.parentElement?.querySelector<HTMLElement>("[data-tag]") ?? null;
const slotOf = (card: HTMLElement) => card.parentElement?.querySelector<HTMLElement>("[data-slot]") ?? null;

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
