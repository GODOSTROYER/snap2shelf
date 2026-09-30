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

/*
 * Shelf drop (ShelfGrid): the product falls onto the ledge (ease-in, like
 * gravity), squashes a touch on impact, settles; its contact shadow grows as
 * it nears the ledge and spreads wide at the moment it lands. Each product's
 * [data-drop] sets --d (its turn); [data-wait] holds one until it scrolls in.
 */
const CSS = `
@keyframes s2s-rise { from { opacity: 0; transform: translateY(22px) scale(.985); filter: blur(5px); } to { opacity: 1; transform: none; filter: none; } }
.s2s-rise { animation: s2s-rise 900ms cubic-bezier(.22, 1, .36, 1) both; }
@keyframes s2s-drop {
  0% { opacity: 0; transform: translateY(-72px) rotate(-1.4deg); animation-timing-function: cubic-bezier(.5, 0, .9, .45); }
  22% { opacity: 1; }
  56% { opacity: 1; transform: translateY(0) rotate(0); animation-timing-function: cubic-bezier(.2, .7, .3, 1); }
  66% { transform: translateY(0) scale(1.024, .968); animation-timing-function: cubic-bezier(.3, 0, .3, 1); }
  80% { transform: translateY(-4px) scale(.994, 1.01); animation-timing-function: cubic-bezier(.4, 0, .6, 1); }
  100% { opacity: 1; transform: none; }
}
@keyframes s2s-contact {
  0% { opacity: 0; transform: scaleX(.4); animation-timing-function: cubic-bezier(.5, 0, .9, .45); }
  56% { opacity: .8; transform: scaleX(1); animation-timing-function: cubic-bezier(.2, .7, .3, 1); }
  66% { opacity: 1; transform: scaleX(1.14); }
  80% { opacity: .75; transform: scaleX(.96); }
  100% { opacity: 1; transform: none; }
}
@keyframes s2s-tag { from { opacity: 0; transform: translateY(-5px) rotate(-2.5deg); } to { opacity: 1; transform: none; } }
.s2s-drop { transform-origin: 50% 100%; animation: s2s-drop 1050ms var(--d, 0ms) backwards; }
.s2s-contact { animation: s2s-contact 1050ms var(--d, 0ms) backwards; }
.s2s-tag { transform-origin: 12% 0; animation: s2s-tag 520ms cubic-bezier(.22, 1, .36, 1) calc(var(--d, 0ms) + 640ms) backwards; }
[data-wait] .s2s-drop, [data-wait] .s2s-contact, [data-wait] .s2s-tag { animation: none; opacity: 0; }
@media (prefers-reduced-motion: reduce) { .s2s-rise, .s2s-drop, .s2s-contact, .s2s-tag { animation: none; } }
`;

/** Hoisted once per page by React 19 (href + precedence dedupe it). */
export function ShelfKeyframes() {
  return (
    <style href="s2s-shelf-keyframes" precedence="default">
      {CSS}
    </style>
  );
}
