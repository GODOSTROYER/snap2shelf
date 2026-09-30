"use client";

import { ImageUp, Sparkles } from "lucide-react";
import { CldUploadWidget, type CloudinaryUploadWidgetResults } from "next-cloudinary";
import * as React from "react";
import { CloudImg } from "@/components/cloud-img";
import { PhoneButton } from "@/components/phone/phone-button";
import { Button } from "@/components/ui/button";
import { UPLOAD_WIDGET_STYLES } from "@/lib/client/theme";
import { rawPublicId, rawTags, UPLOAD_PRESET, type RawInfo } from "@/lib/client/upload";
import { newSku } from "@/lib/client/util";
import { heroAt, rawAt, SAMPLES } from "@/lib/showcase";
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

  const onSuccess = (r: CloudinaryUploadWidgetResults) => {
    if (!isInfo(r.info)) return;
    onReady({ sku, info: { width: r.info.width, height: r.info.height, bytes: r.info.bytes }, via: "upload" });
  };

  return (
    <div className="mx-auto grid w-full max-w-[64rem] gap-10 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-16 lg:py-14">
      <div>
        <h1 className="text-[clamp(2.4rem,6vw,4rem)] leading-[0.95] font-extrabold tracking-[-0.035em] [font-variation-settings:'wdth'_86,'opsz'_96]">Add one product photo</h1>
        <p className="mt-4 max-w-[30rem] text-lg text-dim">Any background, any light. A phone photo on your table is perfect. We&apos;ll do the rest in about a minute.</p>
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

      <div className="rounded-3xl bg-stage p-5 ring-1 ring-line sm:p-6">
        <p className="flex items-center gap-2 font-display text-lg font-semibold">
          <Sparkles className="size-5 text-marigold" aria-hidden />
          No photo handy? Try a sample
        </p>
        <p className="mt-1 text-sm text-dim">Replays a finished live run, so it&apos;s instant and uses no AI quota.</p>
        <ul className="mt-4 grid gap-3">
          {SAMPLES.map((s) => (
            <li key={s.sku}>
              <button
                type="button"
                onClick={() => onReady({ sku: s.sku, info: { width: s.product.rawWidth, height: s.product.rawHeight, bytes: s.product.rawBytes }, via: "sample" })}
                aria-label={`Stage the ${s.title.toLowerCase()} sample`}
                className="group flex w-full items-center gap-4 rounded-2xl bg-stage-2 p-3 text-left ring-1 ring-line transition-colors ring-inset hover:bg-stage-3"
              >
                <span className="relative h-[120px] w-24 shrink-0">
                  <CloudImg src={rawAt(s.product, 192)} alt="" width={96} height={120} className="absolute inset-0 size-full rounded-xl object-cover ring-1 ring-line" />
                  <CloudImg
                    src={heroAt(s.kit, 192)}
                    alt=""
                    width={96}
                    height={120}
                    className="absolute inset-0 size-full rounded-xl object-cover opacity-0 ring-1 ring-marigold/50 transition-opacity duration-500 group-hover:opacity-100 group-focus-visible:opacity-100"
                  />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-paper">{s.title}</span>
                  <span className="mt-0.5 block text-sm text-dim">
                    {s.blurb}, staged on {s.scene.title}
                  </span>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-marigold group-hover:underline">Stage this sample</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
