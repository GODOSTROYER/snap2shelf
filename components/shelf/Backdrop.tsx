import { ShelfKeyframes } from "./Reveal";

/** Warm studio backdrop: a low marigold glow from above plus fine film grain. Decorative only. */
const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.55 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")";

export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#0e0c0a]">
      <ShelfKeyframes />
      <div className="absolute -top-[28rem] left-1/2 h-[46rem] w-[70rem] max-w-[200vw] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,rgba(245,165,36,0.20),rgba(226,113,29,0.08)_45%,transparent_75%)]" />
      <div className="absolute inset-x-0 bottom-0 h-64 bg-[linear-gradient(to_top,rgba(0,0,0,0.5),transparent)]" />
      <div className="absolute inset-0 opacity-[0.07] mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
    </div>
  );
}
