"use client";

import { CodeXml } from "lucide-react";
import dynamic from "next/dynamic";
import * as React from "react";
import type { KitAsset } from "@/lib/types";

// The sheet (dialog, URL anatomy, copy button) loads the first time someone opens an X-ray.
const XraySheet = dynamic(() => import("./xray-sheet").then((m) => m.XraySheet), { ssr: false });

const XrayContext = React.createContext<((a: KitAsset) => void) | null>(null);

/**
 * One X-ray sheet for every card inside it. Cards can be server-rendered: only
 * their small X-ray buttons are client islands, and they open the sheet here.
 */
export function XrayHost({ children }: { children: React.ReactNode }) {
  const [asset, setAsset] = React.useState<KitAsset | null>(null);
  const [armed, setArmed] = React.useState(false);
  const open = React.useCallback((a: KitAsset) => {
    setArmed(true);
    setAsset(a);
  }, []);
  return (
    <XrayContext.Provider value={open}>
      {children}
      {armed ? <XraySheet asset={asset} onOpenChange={(o) => !o && setAsset(null)} /> : null}
    </XrayContext.Provider>
  );
}

const TIP = "See the Cloudinary URL behind this";

/**
 * The code button under a card: opens that asset's X-ray. Its hint is a CSS
 * tooltip (hover or keyboard focus, after the same short delay as the site's
 * other tooltips), so a shelf of cards needs no tooltip library.
 */
export function XrayButton({ asset }: { asset: KitAsset }) {
  const open = React.useContext(XrayContext);
  const tipId = React.useId();
  // warm the sheet's chunk on intent, so the first open doesn't wait on the network
  const warm = () => void import("./xray-sheet");
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => open?.(asset)}
        onPointerEnter={warm}
        onFocus={warm}
        aria-label={`X-ray: how ${asset.label} is made`}
        aria-describedby={tipId}
        // drawn at 28 px; the invisible ::before grows the touch target to 44 px (WCAG 2.5.5) without changing the look
        className="peer relative grid size-7 place-items-center rounded-md bg-stage-2 text-dim ring-1 ring-line-strong transition-colors ring-inset before:absolute before:-inset-2 before:content-[''] hover:bg-stage-3 hover:text-marigold"
      >
        <CodeXml className="size-4" />
      </button>
      <span
        id={tipId}
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-[calc(100%+8px)] left-1/2 z-[60] w-max max-w-64 -translate-x-1/2 rounded-lg bg-paper px-3 py-2 text-[0.8rem] leading-snug font-medium text-studio opacity-0 shadow-[0_12px_30px_-8px_rgb(0_0_0/0.6)] transition-[opacity,visibility] duration-150 peer-hover:visible peer-hover:opacity-100 peer-hover:delay-250 peer-focus-visible:visible peer-focus-visible:opacity-100"
      >
        {TIP}
        <span aria-hidden className="absolute top-full left-1/2 -translate-x-1/2 border-x-[6px] border-t-[6px] border-x-transparent border-t-paper" />
      </span>
    </span>
  );
}
