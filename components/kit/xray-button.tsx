"use client";

import { CodeXml } from "lucide-react";
import dynamic from "next/dynamic";
import * as React from "react";
import { Tip } from "@/components/ui/controls";
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

/** The code button under a card: opens that asset's X-ray. */
export function XrayButton({ asset }: { asset: KitAsset }) {
  const open = React.useContext(XrayContext);
  // warm the sheet's chunk on intent, so the first open doesn't wait on the network
  const warm = () => void import("./xray-sheet");
  return (
    <Tip label="See the Cloudinary URL behind this">
      <button
        type="button"
        onClick={() => open?.(asset)}
        onPointerEnter={warm}
        onFocus={warm}
        aria-label={`X-ray: how ${asset.label} is made`}
        className="grid size-7 place-items-center rounded-md bg-stage-2 text-dim ring-1 ring-line-strong transition-colors ring-inset hover:bg-stage-3 hover:text-marigold"
      >
        <CodeXml className="size-4" />
      </button>
    </Tip>
  );
}
