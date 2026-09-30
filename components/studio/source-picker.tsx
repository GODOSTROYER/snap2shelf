"use client";

import { ImageUp, Sparkles } from "lucide-react";
import { CldUploadWidget, type CloudinaryUploadWidgetResults } from "next-cloudinary";
import * as React from "react";
import { CloudImg } from "@/components/cloud-img";
import { PhoneButton } from "@/components/phone/phone-button";
import { Button } from "@/components/ui/button";
import type { UsageResponse } from "@/lib/api-contract";
import * as api from "@/lib/client/api";
import { UPLOAD_WIDGET_STYLES } from "@/lib/client/theme";
import { rawPublicId, rawTags, UPLOAD_PRESET, type RawInfo } from "@/lib/client/upload";
import { PHOTO_TO_KIT_COPY } from "@/lib/claims";
import { cn, newSku } from "@/lib/client/util";
import { heroAt, LISTED_SAMPLES, rawAt, type SampleProduct } from "@/lib/showcase";
import type { Sku } from "@/lib/types";

export interface SourceReady {
  sku: Sku;
  info: RawInfo;
  via: "upload" | "phone" | "sample";
}

function isInfo(x: unknown): x is { public_id: string; width: number; height: number; bytes: number } {
  return !!x && typeof x === "object" && "public_id" in x && "width" in x;
}

/** The studio's empty state: three ways to bring a product in. */
export function SourcePicker({ onReady }: { onReady: (s: SourceReady) => void }) {
  const [sku] = React.useState(() => newSku());
  const [error, setError] = React.useState<string | null>(null);
  // live kits paused (transformation floor or Admin API limit): lead with the samples
  const [paused, setPaused] = React.useState(false);

  React.useEffect(() => {
    const ac = new AbortController();
    const t = setTimeout(() => {
      api
        .usage(ac.signal)
        .then((u) => {
          const d = u.data as UsageResponse & { livePipeline?: boolean; stale?: boolean };
          if (d.livePipeline === false && !d.stale) setPaused(true);
        })
        .catch(() => {});
    }, 600);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, []);

  const onSuccess = (r: CloudinaryUploadWidgetResults) => {
    if (!isInfo(r.info)) return;
    onReady({ sku, info: { width: r.info.width, height: r.info.height, bytes: r.info.bytes }, via: "upload" });
  };

  return (
    <div className="mx-auto grid w-full max-w-[64rem] gap-10 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-16 lg:py-14">
      <div className={cn(paused && "order-last lg:order-none")}>
        <h1 className="text-[clamp(2.4rem,6vw,4rem)] leading-[0.95] font-extrabold tracking-[-0.035em] [font-variation-settings:'wdth'_86,'opsz'_96]">Add one product photo</h1>
        <p className="mt-4 max-w-[30rem] text-lg text-dim">Any background, any light. A phone photo on your table is perfect. We&apos;ll do the rest in {PHOTO_TO_KIT_COPY}.</p>
        {paused ? (
          <p role="status" className="mt-5 max-w-[30rem] rounded-xl bg-marigold/10 px-4 py-3 text-sm text-paper ring-1 ring-marigold/30">
            <span className="font-semibold text-marigold">Live kits are paused for now</span> to protect the shared Cloudinary quota. Every sample still replays the whole
            pipeline, step by step.
          </p>
        ) : null}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <CldUploadWidget
            signatureEndpoint="/api/sign-upload"
            uploadPreset={UPLOAD_PRESET}
            options={{
              publicId: rawPublicId(sku),
              tags: rawTags(sku).split(","),
              context: { origin: "upload" },
              sources: ["local", "camera", "url"],
              multiple: false,
              maxFiles: 1,
              maxFileSize: 10_000_000,
              clientAllowedFormats: ["jpg", "jpeg", "png", "webp", "heic", "avif"],
              styles: UPLOAD_WIDGET_STYLES,
            }}
            onSuccess={onSuccess}
            onQueuesEnd={(_, { widget }) => widget.close()}
            onError={() => setError("That upload didn't go through. Check the file is a photo under 10 MB and try again, or try a sample.")}
          >
            {({ open, isLoading }) => (
              <Button
                size="lg"
                variant={paused ? "secondary" : "primary"}
                disabled={isLoading}
                onClick={() => {
                  setError(null);
                  open();
                }}
              >
                <ImageUp />
                {isLoading ? "Opening uploader…" : "Upload a photo"}
              </Button>
            )}
          </CldUploadWidget>
          <PhoneButton size="lg" onArrived={(s, info) => onReady({ sku: s, info, via: "phone" })} />
        </div>
        {error ? (
          <p role="alert" className="mt-4 max-w-[30rem] rounded-xl bg-sindoor/10 px-4 py-3 text-sm text-sindoor ring-1 ring-sindoor/30">
            {error}
          </p>
        ) : null}
      </div>

      <SamplePicker onPick={(s) => onReady({ sku: s.sku, info: { width: s.product.rawWidth, height: s.product.rawHeight, bytes: s.product.rawBytes }, via: "sample" })} />
    </div>
  );
}

/**
 * Every sample as its input photo that turns into its hero on hover or focus.
 * Phones: a swipeable row. Tablets: one row. Desktop: the primary sample (the
 * QA catch) large, the other four around it.
 */
export function SamplePicker({ onPick, compact, className }: { onPick: (s: SampleProduct) => void; compact?: boolean; className?: string }) {
  const [featured, ...rest] = LISTED_SAMPLES;
  // samples that share a listing name (the two bottle kits) always show which photo they are
  const shared = new Set(LISTED_SAMPLES.filter((s, i, all) => all.findIndex((o) => o.title === s.title) !== i).map((s) => s.title));
  return (
    <div className={cn("min-w-0 rounded-3xl bg-stage p-5 ring-1 ring-line sm:p-6", compact && "p-4 sm:p-4", className)}>
      {compact ? null : (
        <>
          <p className="flex items-center gap-2 font-display text-lg font-semibold">
            <Sparkles className="size-5 text-marigold" aria-hidden />
            No photo handy? Try a sample
          </p>
          <p className="mt-1 text-sm text-dim">Each one replays a finished live run step by step, in about 10 to 15 seconds, with no AI quota used. The sample photos are AI-generated test images.</p>
        </>
      )}
      <ul
        aria-label="Sample products"
        className={cn(
          "no-scrollbar -mx-5 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-1 sm:mx-0 sm:grid sm:grid-cols-5 sm:overflow-visible sm:px-0 sm:pb-0",
          compact ? "-mx-4 scroll-px-4 px-4 lg:grid-cols-5" : "mt-4 lg:grid-cols-4 lg:grid-rows-2",
        )}
      >
        {featured ? <SampleTile sample={featured} featured={!compact} onPick={onPick} /> : null}
        {rest.map((s) => (
          <SampleTile key={s.sku} sample={s} onPick={onPick} blurbAlways={shared.has(s.title)} />
        ))}
      </ul>
    </div>
  );
}

function SampleTile({ sample: s, featured, blurbAlways, onPick }: { sample: SampleProduct; featured?: boolean; blurbAlways?: boolean; onPick: (s: SampleProduct) => void }) {
  // the sample photo as taken, then its hero on hover (fixed widths: lib/client/img.ts)
  const w = featured ? 720 : 360;
  const before = rawAt(s.product, w);
  const after = heroAt(s.kit, w);
  return (
    <li className={cn("w-[42%] max-w-44 shrink-0 snap-start sm:w-auto sm:max-w-none", featured && "lg:col-span-2 lg:row-span-2")}>
      <button
        type="button"
        onClick={() => onPick(s)}
        aria-label={`Replay the ${s.title} sample: ${s.blurb.toLowerCase()}, staged on ${s.scene.title}.${s.highlight ? ` ${s.highlight}.` : ""}`}
        className="group relative block aspect-[4/5] w-full overflow-hidden rounded-2xl bg-stage-2 text-left ring-1 ring-line transition-[box-shadow,transform] duration-300 ease-(--ease-out-expo) ring-inset hover:-translate-y-0.5 hover:shadow-[0_24px_40px_-24px_rgb(0_0_0/0.95)] hover:ring-marigold/50 focus-visible:ring-marigold"
      >
        <CloudImg src={before} alt="" width={w} height={w * 1.25} className="absolute inset-0 size-full object-cover" />
        <CloudImg
          src={after}
          alt=""
          width={w}
          height={w * 1.25}
          className="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-focus-visible:opacity-100"
        />
        {featured && s.highlight ? (
          <span aria-hidden className="absolute top-2 left-2 hidden max-w-[calc(100%-1rem)] rounded-full bg-marigold px-2.5 py-1 text-[0.75rem] leading-tight font-semibold text-marigold-ink shadow-[0_6px_16px_-6px_rgb(0_0_0/0.8)] lg:inline-block">
            {s.highlight}
          </span>
        ) : null}
        <span aria-hidden className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2.5 pt-10 pb-2.5 sm:px-3">
          <span className={cn("block leading-tight font-semibold text-white", featured ? "text-[0.8rem] sm:text-[0.95rem] lg:text-base" : "text-[0.8rem]")}>{s.title}</span>
          {/* the photo's story, then (with the hero) where it was staged */}
          <span className={cn("mt-0.5 grid text-xs leading-snug", !featured && !blurbAlways && "lg:hidden")}>
            <span className="text-white/75 transition-opacity duration-300 [grid-area:1/1] group-hover:opacity-0 group-focus-visible:opacity-0">{s.blurb}</span>
            <span className="font-semibold text-marigold-hi opacity-0 transition-opacity duration-300 [grid-area:1/1] group-hover:opacity-100 group-focus-visible:opacity-100">
              Staged on {s.scene.title}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}
