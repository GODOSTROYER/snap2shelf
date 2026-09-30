"use client";

import { CldUploadWidget, type CloudinaryUploadWidgetResults } from "next-cloudinary";
import * as React from "react";
import { TOKENS, UPLOAD_WIDGET_STYLES } from "@/lib/client/theme";
import { rawPublicId, rawTags, UPLOAD_PRESET, type RawInfo } from "@/lib/client/upload";
import type { Sku } from "@/lib/types";

/**
 * The widget in the studio's own colours, backdrop included: `frame.background` is the full-screen
 * scrim behind the modal (Cloudinary's default is a slate blue, #0E2F5B99). Our studio black at 80%.
 */
const STYLES = { ...UPLOAD_WIDGET_STYLES, frame: { background: `${TOKENS.studio}CC` } };

/** One photo, in our words (keys: https://widget.cloudinary.com/v2.0/global/text.json). */
const TEXT = {
  en: {
    queue: {
      title: "Your photo",
      title_uploading_with_counter: "Uploading your photo…",
      title_uploading: "Uploading your photo…",
      mini_title: "Uploaded",
      mini_title_uploading: "Uploading your photo…",
      mini_upload_count: "Photo uploaded",
    },
  },
};

function isInfo(x: unknown): x is { public_id: string; width: number; height: number; bytes: number } {
  return !!x && typeof x === "object" && "public_id" in x && "width" in x;
}

/**
 * Cloudinary's Upload Widget for one product photo. Loaded only when a seller
 * reaches for the upload button (source-picker.tsx): the widget script and what
 * it pulls in are over a megabyte, and most visits start with a sample.
 * `wantOpen` opens it as soon as the script is ready (the click came first).
 */
export function UploadWidget({
  sku,
  wantOpen,
  onOpened,
  onUploaded,
  onError,
  children,
}: {
  sku: Sku;
  wantOpen: boolean;
  onOpened: () => void;
  onUploaded: (info: RawInfo) => void;
  onError: () => void;
  children: (w: { open: () => void; isLoading: boolean }) => React.ReactNode;
}) {
  const onSuccess = (r: CloudinaryUploadWidgetResults) => {
    if (!isInfo(r.info)) return;
    onUploaded({ width: r.info.width, height: r.info.height, bytes: r.info.bytes });
  };
  return (
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
        styles: STYLES,
        text: TEXT,
      }}
      onSuccess={onSuccess}
      onQueuesEnd={(_, { widget }) => widget.close()}
      onError={onError}
    >
      {({ open, isLoading }) => (
        <OpenWhenReady open={open} ready={!isLoading} want={wantOpen} onOpened={onOpened}>
          {children({ open, isLoading: !!isLoading })}
        </OpenWhenReady>
      )}
    </CldUploadWidget>
  );
}

function OpenWhenReady({ open, ready, want, onOpened, children }: { open: () => void; ready: boolean; want: boolean; onOpened: () => void; children: React.ReactNode }) {
  React.useEffect(() => {
    if (!want || !ready) return;
    open();
    onOpened();
  }, [want, ready, open, onOpened]);
  return <>{children}</>;
}
