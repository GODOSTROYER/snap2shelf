"use client";

/* eslint-disable @next/next/no-img-element -- local object URL preview */
import { Camera, Check, ImagePlus, Laptop, Maximize2, RefreshCw, Scissors, Sun } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { prepareForUpload, signedUpload, UploadError } from "@/lib/client/upload";
import { cn, newSku } from "@/lib/client/util";
import { SKU_RE, type Sku } from "@/lib/types";

type Phase = { kind: "idle" } | { kind: "uploading"; progress: number } | { kind: "done" } | { kind: "error"; message: string; retry?: File };

/** Phone side of "snap with your phone": camera → signed direct upload → "look at your laptop". */
export function Capture({ sku: given }: { sku?: string }) {
  const [sku] = React.useState<Sku>(() => (given && SKU_RE.test(given) ? given : newSku()));
  const paired = !!given && SKU_RE.test(given);
  const [phase, setPhase] = React.useState<Phase>({ kind: "idle" });
  const [preview, setPreview] = React.useState<string | null>(null);
  const camera = React.useRef<HTMLInputElement>(null);
  const gallery = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const upload = async (file: File) => {
    setPreview(URL.createObjectURL(file));
    setPhase({ kind: "uploading", progress: 0 });
    try {
      const blob = await prepareForUpload(file);
      await signedUpload(blob, sku, (f) => setPhase({ kind: "uploading", progress: f }));
      setPhase({ kind: "done" });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof UploadError ? e.message : "The upload didn't finish. Try again.", retry: file });
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setPhase({ kind: "error", message: "That file isn't a photo. Take a picture or pick an image." });
      return;
    }
    void upload(f);
  };

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-md flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={onPick} />
      <input ref={gallery} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden onChange={onPick} />

      {phase.kind === "done" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 py-10 text-center">
          <span className="grid size-20 place-items-center rounded-full bg-leaf text-studio shadow-[0_0_0_10px_rgb(151_212_141/0.15)]">
            <Check className="size-10" strokeWidth={2.5} aria-hidden />
          </span>
          {paired ? (
            <>
              <h1 className="text-4xl leading-none font-extrabold tracking-[-0.03em]">Look at your laptop</h1>
              <p className="max-w-xs text-lg text-dim">Your photo is in. The studio is staging it now.</p>
            </>
          ) : (
            <>
              <h1 className="text-4xl leading-none font-extrabold tracking-[-0.03em]">Photo uploaded</h1>
              <p className="max-w-xs text-lg text-dim">Open the studio to stage it and build your kit.</p>
            </>
          )}
          {preview ? <img src={preview} alt="The photo you uploaded" className="h-40 w-32 rounded-2xl object-cover ring-1 ring-line-strong" /> : null}
          <div className="flex w-full flex-col gap-3">
            <Link href={`/studio?sku=${sku}`} className={buttonVariants({ size: "lg", variant: paired ? "secondary" : "primary" })}>
              {paired ? "Or continue on this phone" : "Open the studio"}
            </Link>
            <Button
              variant="ghost"
              onClick={() => {
                setPhase({ kind: "idle" });
                setPreview(null);
              }}
            >
              Take a different photo
            </Button>
          </div>
          {paired ? (
            <p className="flex items-center gap-2 text-sm text-faint">
              <Laptop className="size-4" aria-hidden /> Your laptop finds the photo by itself
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="pt-4">
            <h1 className="text-[2.4rem] leading-[0.95] font-extrabold tracking-[-0.035em] [font-variation-settings:'wdth'_86,'opsz'_96]">Take one photo of your product</h1>
            <ul className="mt-5 grid gap-2.5 text-[0.95rem] text-dim">
              <li className="flex items-center gap-3">
                <Maximize2 className="size-5 shrink-0 text-marigold" aria-hidden />
                Let the product fill most of the frame
              </li>
              <li className="flex items-center gap-3">
                <Sun className="size-5 shrink-0 text-marigold" aria-hidden />
                Daylight or a bright room works best
              </li>
              <li className="flex items-center gap-3">
                <Scissors className="size-5 shrink-0 text-marigold" aria-hidden />
                Any background. We remove it
              </li>
            </ul>
          </div>

          <div className="relative mt-6 flex flex-1 items-center justify-center">
            <div className="relative aspect-[4/5] h-[min(40dvh,28rem)] overflow-hidden rounded-3xl bg-stage ring-1 ring-line">
              {preview ? (
                <img src={preview} alt="Your photo" className="absolute inset-0 size-full object-cover" />
              ) : (
                <div aria-hidden className="absolute inset-6 rounded-2xl border-2 border-dashed border-line-strong">
                  <span className="absolute inset-x-6 bottom-8 h-3 rounded-full bg-marigold/15" />
                </div>
              )}
              {phase.kind === "uploading" ? (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-5 pt-16">
                  <p role="status" className="tabular text-sm font-semibold text-white">
                    Uploading {Math.round(phase.progress * 100)}%
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20">
                    <div className="h-full rounded-full bg-marigold transition-[width] duration-200" style={{ width: `${Math.max(4, phase.progress * 100)}%` }} />
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {phase.kind === "error" ? (
            <div role="alert" className="mt-5 rounded-xl bg-sindoor/10 px-4 py-3 text-sm text-sindoor ring-1 ring-sindoor/30">
              <p>{phase.message}</p>
              <Link href="/studio?sample=sneaker1" className="mt-1.5 inline-block font-semibold text-paper underline decoration-sindoor/60">
                Try the sample product
              </Link>
            </div>
          ) : null}

          <div className="mt-6 grid gap-3">
            <button
              type="button"
              disabled={phase.kind === "uploading"}
              onClick={() => (phase.kind === "error" && phase.retry ? void upload(phase.retry) : camera.current?.click())}
              className={cn(
                "flex h-16 items-center justify-center gap-3 rounded-full bg-marigold text-lg font-bold text-marigold-ink shadow-[0_14px_40px_-12px_rgb(245_165_36/0.7)] transition-transform active:scale-[0.97] disabled:opacity-60",
              )}
            >
              {phase.kind === "error" && phase.retry ? <RefreshCw className="size-6" aria-hidden /> : <Camera className="size-6" aria-hidden />}
              {phase.kind === "uploading" ? "Uploading…" : phase.kind === "error" && phase.retry ? "Try the upload again" : "Open camera"}
            </button>
            <Button variant="ghost" size="lg" disabled={phase.kind === "uploading"} onClick={() => gallery.current?.click()}>
              <ImagePlus />
              Choose from gallery
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
