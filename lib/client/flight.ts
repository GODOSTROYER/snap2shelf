"use client";

import { animate } from "motion/react";

/**
 * Shared-element flight: a copy of `img` travels from where it is to `to`
 * (e.g. a creative take into the stage), then fades as the real image takes over.
 */
export function flyImage(img: HTMLImageElement | null, to: DOMRect | null) {
  if (!img || !to || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const from = img.getBoundingClientRect();
  if (!from.width || !from.height) return;
  const ghost = img.cloneNode() as HTMLImageElement;
  ghost.removeAttribute("id");
  ghost.alt = "";
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    margin: "0",
    zIndex: "45",
    objectFit: "cover",
    borderRadius: "12px",
    pointerEvents: "none",
    transformOrigin: "0 0",
    boxShadow: "0 40px 80px -30px rgb(0 0 0 / 0.9)",
  });
  document.body.appendChild(ghost);
  animate(
    ghost,
    { x: [0, to.left - from.left], y: [0, to.top - from.top], scaleX: [1, to.width / from.width], scaleY: [1, to.height / from.height] },
    { type: "spring", stiffness: 150, damping: 22 },
  )
    .then(() => animate(ghost, { opacity: [1, 0] }, { duration: 0.45, delay: 0.25 }))
    .finally(() => ghost.remove());
}
