"use client";

import { Smartphone } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import type { RawInfo } from "@/lib/client/upload";
import { newSku } from "@/lib/client/util";
import type { Sku } from "@/lib/types";

// The QR library and dialog only load when someone asks for them.
const QrDialog = dynamic(() => import("./qr-dialog"), { ssr: false });

/**
 * "Snap with your phone". On a laptop it shows a QR code and waits for the
 * photo; on a phone it goes straight to the camera page.
 * Without `onArrived`, it continues in /studio.
 */
export function PhoneButton({ onArrived, children, ...props }: Omit<ButtonProps, "onClick"> & { onArrived?: (sku: Sku, info: RawInfo) => void }) {
  const router = useRouter();
  const [sku, setSku] = React.useState<Sku | null>(null);

  const start = () => {
    const next = newSku();
    if (window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 768) {
      router.push(`/capture?sku=${next}`);
      return;
    }
    setSku(next);
  };

  return (
    <>
      <Button variant="secondary" onClick={start} {...props}>
        <Smartphone />
        {children ?? "Snap with your phone"}
      </Button>
      {sku ? (
        <QrDialog
          open
          sku={sku}
          onOpenChange={(o) => !o && setSku(null)}
          onArrived={(s, info) => {
            setSku(null);
            if (onArrived) onArrived(s, info);
            else router.push(`/studio?sku=${s}`);
          }}
        />
      ) : null}
    </>
  );
}
