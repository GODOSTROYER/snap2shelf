"use client";

/* eslint-disable @next/next/no-img-element -- data: URL QR code and a tiny Cloudinary thumbnail */
import { Check, Smartphone } from "lucide-react";
import QRCode from "qrcode";
import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { publicUrl } from "@/lib/client/img";
import { rawPublicId, waitForRaw, type RawInfo } from "@/lib/client/upload";
import { isAborted } from "@/lib/client/util";
import type { Sku } from "@/lib/types";

export function captureLink(sku: Sku) {
  return `${window.location.origin}/capture?sku=${sku}`;
}

/**
 * Laptop side of "snap with your phone": a QR code to /capture?sku=…, then
 * wait (polling Cloudinary) until that photo lands and hand it over.
 */
export default function QrDialog({ open, sku, onOpenChange, onArrived }: { open: boolean; sku: Sku; onOpenChange: (o: boolean) => void; onArrived: (sku: Sku, info: RawInfo) => void }) {
  const [qr, setQr] = React.useState<string | null>(null);
  const [arrived, setArrived] = React.useState(false);
  const [waitError, setWaitError] = React.useState(false);
  const link = typeof window === "undefined" ? "" : captureLink(sku);
  const isLocal = /localhost|127\.0\.0\.1/.test(link);
  const onArrivedRef = React.useRef(onArrived);
  React.useEffect(() => {
    onArrivedRef.current = onArrived;
  });

  React.useEffect(() => {
    if (!open || !link) return;
    let live = true;
    QRCode.toDataURL(link, { margin: 1, width: 480, errorCorrectionLevel: "M", color: { dark: "#15110dff", light: "#f5ede1ff" } })
      .then((u) => live && setQr(u))
      .catch(() => live && setQr(null));
    return () => {
      live = false;
    };
  }, [open, link]);

  React.useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    let timedOut = false;
    const stop = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, 15 * 60_000);
    waitForRaw(sku, ac.signal)
      .then((info) => {
        setArrived(true);
        setTimeout(() => onArrivedRef.current(sku, info), 900);
      })
      .catch((e) => {
        if (timedOut || !isAborted(e)) setWaitError(true);
      });
    return () => {
      clearTimeout(stop);
      ac.abort();
    };
  }, [open, sku]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={arrived ? "Photo received" : "Snap it with your phone"} description={arrived ? "Opening the studio…" : "Scan this with your phone camera. This page carries on by itself once your photo lands."}>
        {arrived ? (
          <div className="grid place-items-center gap-4 py-4">
            <div className="relative size-40 overflow-hidden rounded-2xl ring-1 ring-line-strong">
              <img src={publicUrl(rawPublicId(sku), { w: 360, h: 360, crop: "c_fill" })} alt="The photo you just took" className="size-full object-cover" />
              <span className="absolute right-2 bottom-2 grid size-8 place-items-center rounded-full bg-leaf text-studio">
                <Check className="size-5" />
              </span>
            </div>
          </div>
        ) : (
          <div className="grid gap-5">
            <div className="mx-auto grid aspect-square w-full max-w-64 place-items-center overflow-hidden rounded-2xl bg-paper p-3">
              {qr ? <img src={qr} alt={`QR code linking to ${link}`} width={240} height={240} className="size-full [image-rendering:pixelated]" /> : <div className="skeleton size-full rounded-lg" />}
            </div>
            <ol className="grid gap-2 text-[0.95rem] text-dim">
              <li className="flex gap-3">
                <span className="tabular font-display font-bold text-marigold">1</span>Point your phone camera at the code.
              </li>
              <li className="flex gap-3">
                <span className="tabular font-display font-bold text-marigold">2</span>Take one photo of your product.
              </li>
              <li className="flex gap-3">
                <span className="tabular font-display font-bold text-marigold">3</span>Look back here. The studio starts on its own.
              </li>
            </ol>
            <p role="status" className="flex items-center gap-2.5 rounded-xl bg-stage-2 px-4 py-3 text-sm text-paper ring-1 ring-line">
              {waitError ? (
                <>We stopped waiting after 15 minutes. Close this and try again.</>
              ) : (
                <>
                  <span className="relative flex size-2.5">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-marigold opacity-60" />
                    <span className="relative inline-flex size-2.5 rounded-full bg-marigold" />
                  </span>
                  Waiting for your photo
                  <Smartphone className="ml-auto size-4 text-dim" aria-hidden />
                </>
              )}
            </p>
            {isLocal ? (
              <p className="text-[0.8rem] text-dim">
                This is a local address your phone can&apos;t reach. Open the live site on your laptop, or open <span className="break-all text-paper">{link}</span> on this computer.
              </p>
            ) : (
              <p className="text-[0.8rem] break-all text-faint">{link}</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
