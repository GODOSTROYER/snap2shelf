"use client";

import * as React from "react";
import { HERO_INTRO_DONE } from "@/components/landing/before-after";

/**
 * The landing acting out its headline: once the hero's compare intro has played,
 * the kit is dealt out of the hero onto the shelf strip below it.
 *
 * Until then the strip's cards are hidden (CSS, only where scripting is on and
 * motion is allowed, with a late fallback reveal); nothing moves in layout, the
 * flying cards are clones in a fixed layer, and no work happens before the hero
 * has loaded and played. The deal waits for the strip to be on screen and plays
 * once. A small Web Animations equivalent of dealCards() (components/kit/kit-shelves.tsx):
 * no scrolling the page, and no animation library on the landing.
 */
export function KitDeal({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.dataset.deal = "off";
      return;
    }
    el.dataset.deal = "armed";

    const hero = () => document.querySelector<HTMLElement>("[data-hero-compare]");
    let introDone = !hero() || hero()!.dataset.intro === "done";
    let inView = false;
    let run: { cancel: () => void } | null = null;

    const go = () => {
      if (run || !inView) return;
      const deck = onScreen(hero());
      // let the hero finish its own act first, if anyone can see it
      if (!introDone && deck) return;
      run = dealFrom(el, deck);
    };
    const onIntro = () => {
      introDone = true;
      go();
    };
    // never leave the shelf bare for long, whatever happened to the intro
    const late = window.setTimeout(onIntro, 9000);
    window.addEventListener(HERO_INTRO_DONE, onIntro);
    const io = new IntersectionObserver(
      ([e]) => {
        inView = e.intersectionRatio >= 0.5;
        go();
      },
      { threshold: [0, 0.5, 1] },
    );
    io.observe(el);
    return () => {
      window.clearTimeout(late);
      window.removeEventListener(HERO_INTRO_DONE, onIntro);
      io.disconnect();
      run?.cancel();
    };
  }, []);

  return (
    <div ref={ref} data-deal="auto" className={className}>
      {children}
    </div>
  );
}

/** The part of the hero that's on screen, if enough of it is to deal from. */
function onScreen(el: HTMLElement | null): DOMRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const top = Math.max(0, r.top);
  const bottom = Math.min(window.innerHeight, r.bottom);
  if (bottom - top < 160) return null;
  return new DOMRect(r.left, top, r.width, bottom - top);
}

const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

/** A slightly underdamped spring (the shelves' deal: stiffness 135, damping 17, mass 0.9) as a CSS linear() easing. */
function springEasing(): { easing: string; ms: number } {
  const k = 135;
  const c = 17;
  const m = 0.9;
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  const T = 0.9; // s: settled to well under a pixel by then
  const pts: string[] = [];
  for (let i = 0; i <= 36; i++) {
    const t = (i / 36) * T;
    const x = 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
    pts.push(x.toFixed(4));
  }
  const easing = `linear(${pts.join(", ")})`;
  const ok = typeof CSS !== "undefined" && CSS.supports("animation-timing-function", easing);
  return ok ? { easing, ms: T * 1000 } : { easing: "cubic-bezier(0.22, 1.25, 0.36, 1)", ms: 820 };
}

/**
 * Fan the strip's cards out over the hero like a hand of cards, then deal them one
 * by one onto their places on the shelf. Cards whose place is off screen (the strip
 * scrolls sideways on phones) simply appear.
 */
function dealFrom(root: HTMLElement, from: DOMRect | null): { cancel: () => void } {
  const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-card]"));
  const layer = document.createElement("div");
  const anims: Animation[] = [];
  let cancelled = false;
  const reveal = (c: HTMLElement) => c.style.removeProperty("opacity");
  const finish = () => {
    layer.remove();
    cards.forEach(reveal);
    root.dataset.deal = "done";
  };
  const cancel = () => {
    cancelled = true;
    anims.forEach((a) => a.cancel());
    finish();
  };

  // keep them hidden while "armed" gives way to per-card control
  cards.forEach((c) => (c.style.opacity = "0"));
  root.dataset.deal = "dealing";

  void (async () => {
    const imgs = cards.flatMap((c) => Array.from(c.querySelectorAll("img")));
    imgs.forEach((i) => (i.loading = "eager"));
    await Promise.race([Promise.all(imgs.map((i) => i.decode().catch(() => undefined))), new Promise((r) => setTimeout(r, 1500))]);
    if (cancelled) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const strip = root.getBoundingClientRect();
    const deck = from ?? new DOMRect(strip.left + strip.width / 2 - 90, Math.max(16, strip.top - 260), 180, 220);
    const deckX = deck.left + deck.width / 2;
    const deckY = deck.top + deck.height / 2;

    const placed = cards.map((card) => ({ card, r: card.getBoundingClientRect() }));
    const flying = placed.filter(({ r }) => r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh);
    placed.filter((p) => !flying.includes(p)).forEach((p) => reveal(p.card));
    if (!flying.length) return finish();

    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:40;overflow:hidden";
    document.body.appendChild(layer);

    const n = flying.length;
    const spring = springEasing();
    const ghosts = flying.map(({ card, r }, i) => {
      const ghost = card.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("data-card");
      Object.assign(ghost.style, {
        position: "fixed",
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        margin: "0",
        opacity: "0",
        transformOrigin: "50% 100%",
      });
      layer.appendChild(ghost);
      const spread = i - (n - 1) / 2;
      // held up over the hero, a little larger than on the shelf; the fan pivots on the cards' feet
      const s = Math.min(1.7, Math.max(1, (deck.height * 0.24) / r.height));
      const dx = deckX - (r.left + r.width / 2);
      const dy = deckY + s * r.height * 0.35 - r.bottom;
      const fan = `translate(${dx + spread * 10}px, ${dy}px) scale(${s}) rotate(${spread * Math.min(7, 48 / n)}deg)`;
      return { card, ghost, i, dx, dy, s, fan };
    });

    // 1. the hand fans open over the hero
    await Promise.all(
      ghosts.map((g) => {
        const a = g.ghost.animate(
          [
            { opacity: 0, transform: `translate(${g.dx}px, ${g.dy + 40}px) scale(${g.s * 0.85}) rotate(0deg)` },
            { opacity: 1, transform: g.fan },
          ],
          { duration: 460, delay: g.i * 24, easing: EASE_OUT, fill: "both" },
        );
        anims.push(a);
        return a.finished.catch(() => undefined);
      }),
    );
    if (cancelled) return;

    // 2. dealt onto the shelf one by one, landing with a little spring
    await Promise.all(
      ghosts.map((g) => {
        const a = g.ghost.animate([{ opacity: 1, transform: g.fan }, { opacity: 1, transform: "translate(0px, 0px) scale(1) rotate(0deg)" }], {
          duration: spring.ms,
          delay: 70 + g.i * 80,
          easing: spring.easing,
          fill: "both",
        });
        anims.push(a);
        return a.finished.then(
          () => {
            if (cancelled) return;
            reveal(g.card);
            g.ghost.remove();
          },
          () => undefined,
        );
      }),
    );
    if (!cancelled) finish();
  })();

  return { cancel };
}
