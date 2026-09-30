"use client";

import { Smartphone } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import * as React from "react";
import type { ButtonProps } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { newSku } from "@/lib/client/sku";
import type { RawInfo } from "@/lib/client/upload";
import type { Sku } from "@/lib/types";

// The QR library and dialog only load when someone asks for them.
const QrDialog = dynamic(() => import("./qr-dialog"), { ssr: false });

/**
 * "Snap with your phone". On a laptop it shows a QR code and waits for the
 * photo; on a phone it goes straight to the camera page.
 * Without `onArrived`, it continues in /studio.
 */
export function PhoneButton({
  onArrived,
  children,
  variant = "secondary",
  size,
  className,
  ...props
}: Omit<ButtonProps, "onClick" | "asChild"> & { onArrived?: (sku: Sku, info: RawInfo) => void }) {
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
      {/* a plain <button> with the Button classes: the full Button (Slot, tailwind-merge) would double this island's JS */}
      <button type="button" className={buttonVariants({ variant, size, className })} onClick={start} {...props}>
        <Smartphone />
        {children ?? "Snap with your phone"}
      </button>
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
