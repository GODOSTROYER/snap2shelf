"use client";

/* eslint-disable @next/next/no-img-element -- Cloudinary delivery URL, already sized */
import { CodeXml, Eye } from "lucide-react";
import * as React from "react";
import { QaBadge } from "@/components/kit/qa-badge";
import { XraySheet } from "@/components/kit/xray-sheet";
import { cn } from "@/lib/client/util";
import type { KitAsset, QaResult } from "@/lib/types";
import { CrossfadeImage } from "./crossfade-image";

/**
 * The big 4:5 viewer. Shows whatever the pipeline has so far (raw photo →
 * cut-out on a transparency checker → staged hero) and cross-fades between them.
 */
export const Stage = React.forwardRef<
  HTMLDivElement,
  {
    src: string | null;
    alt: string;
    placeholder?: string;
    originalSrc?: string | null;
    scanning?: string | null; // label while a step works on the photo
    qa?: QaResult | null;
    onBusy?: (busy: boolean) => void;
    busyLabel?: string | null;
    xray?: KitAsset | null; // what the X-ray button explains
  }
>(function Stage({ src, alt, placeholder, originalSrc, scanning, qa, onBusy, busyLabel, xray }, ref) {
  const [showOriginal, setShowOriginal] = React.useState(false);
  const [xrayOpen, setXrayOpen] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);

  return (
    <div
      ref={ref}
      className="checker relative isolate aspect-[4/5] w-full overflow-hidden rounded-[22px] shadow-[0_50px_90px_-40px_rgb(0_0_0/0.95)] ring-1 ring-line"
    >
      {src ? (
        <CrossfadeImage
          src={src}
          alt={alt}
          width={1080}
          height={1350}
          placeholder={placeholder}
          onBusy={onBusy}
          onError={() => setFailed(src)}
          className="absolute inset-0"
          imgClassName="object-cover"
        />
      ) : (
        <div className="skeleton absolute inset-0" />
      )}

      {originalSrc ? (
        <img
          src={originalSrc}
          alt=""
          aria-hidden
          className={cn("pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-300", showOriginal ? "opacity-100" : "opacity-0")}
        />
      ) : null}

      {scanning ? (
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute inset-x-0 h-1/3 animate-sweep bg-gradient-to-b from-transparent via-marigold/25 to-transparent">
            <div className="absolute inset-x-0 top-1/2 h-px bg-marigold/80 shadow-[0_0_16px_rgb(245_165_36/0.9)]" />
          </div>
        </div>
      ) : null}

      <div className="absolute top-3 left-3 flex flex-wrap gap-2">
        {qa ? <QaBadge qa={qa} className="bg-studio/85 backdrop-blur-sm" /> : null}
        {busyLabel ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-studio/85 px-2.5 py-1 text-[0.74rem] leading-none font-semibold text-paper backdrop-blur-sm">
            <span className="size-1.5 animate-pulse rounded-full bg-marigold" />
            {busyLabel}
          </span>
        ) : null}
      </div>

      {failed && failed === src ? (
        <p role="alert" className="absolute inset-x-3 bottom-16 rounded-xl bg-studio/90 p-3 text-center text-sm text-paper">
          Cloudinary couldn&apos;t render this version. Move a slider to try a slightly different one.
        </p>
      ) : null}

      {xray ? (
        <button
          type="button"
          onClick={() => setXrayOpen(true)}
          className="absolute top-3 right-3 inline-flex h-9 items-center gap-2 rounded-full bg-studio/85 px-3.5 text-[0.8rem] font-semibold text-paper backdrop-blur-sm transition-colors hover:bg-studio hover:text-marigold"
        >
          <CodeXml className="size-4" aria-hidden />
          See the URL
        </button>
      ) : null}
      <XraySheet asset={xrayOpen ? (xray ?? null) : null} onOpenChange={setXrayOpen} />

      {originalSrc ? (
        <button
          type="button"
          aria-pressed={showOriginal}
          onPointerDown={() => setShowOriginal(true)}
          onPointerUp={() => setShowOriginal(false)}
          onPointerLeave={() => setShowOriginal(false)}
          onKeyDown={(e) => (e.key === " " || e.key === "Enter") && setShowOriginal(true)}
          onKeyUp={() => setShowOriginal(false)}
          className="absolute right-3 bottom-3 inline-flex h-9 items-center gap-2 rounded-full bg-studio/85 px-3.5 text-[0.8rem] font-semibold text-paper backdrop-blur-sm transition-colors select-none hover:bg-studio"
        >
          <Eye className="size-4" aria-hidden />
          Hold to see your photo
        </button>
      ) : null}
    </div>
  );
});
