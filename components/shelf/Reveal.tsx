/**
 * Entrance animation that needs no JavaScript: server-rendered content (the LCP
 * title and hero images) animates in with CSS as soon as it paints, instead of
 * waiting for hydration. Springs and hover physics stay in motion/react.
 * Keyframes come from <ShelfKeyframes/> (rendered by <Backdrop/>); off under reduced motion.
 */
export function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <div className={`s2s-rise ${className}`} style={{ animationDelay: `${Math.round(delay * 1000)}ms` }}>
      {children}
    </div>
  );
}

const CSS = `
@keyframes s2s-rise { from { opacity: 0; transform: translateY(22px) scale(.985); filter: blur(5px); } to { opacity: 1; transform: none; filter: none; } }
.s2s-rise { animation: s2s-rise 900ms cubic-bezier(.22, 1, .36, 1) both; }
@media (prefers-reduced-motion: reduce) { .s2s-rise { animation: none; } }
`;

/** Hoisted once per page by React 19 (href + precedence dedupe it). */
export function ShelfKeyframes() {
  return (
    <style href="s2s-shelf-keyframes" precedence="default">
      {CSS}
    </style>
  );
}
