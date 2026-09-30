"use client";

import { useState } from "react";
import type { ReadinessReport } from "@/lib/readiness";
import { ReadinessPanel } from "./ReadinessPanel";

/** Demo layout: original photo vs the measured marketplace image, kept in sync with fixes. */
export function ReadinessDemo({ initial, name, rawUrl }: { initial: ReadinessReport; name: string; rawUrl: string }) {
  const [report, setReport] = useState(initial);
  const thumb = report.image.url.replace("/upload/", "/upload/c_limit,w_720,h_720/");
  const images = [
    { label: "Phone photo", url: rawUrl, bg: "bg-[#1a1612]" },
    { label: report.image.materialised ? "Marketplace image (saved)" : "Marketplace image (recipe)", url: thumb, bg: "bg-white" },
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start lg:gap-8">
      <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:sticky lg:top-8 lg:grid-cols-1 lg:gap-4">
        {images.map((img) => (
          <figure key={img.label} className="min-w-0">
            <div className={`aspect-square overflow-hidden rounded-2xl ring-1 ring-[#f4efe7]/10 ${img.bg}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary delivery URL, already resized */}
              <img key={img.url} src={img.url} alt={`${name}: ${img.label.toLowerCase()}`} className="h-full w-full object-contain" />
            </div>
            <figcaption className="mt-2 text-[13px] text-[#a89f92]">{img.label}</figcaption>
          </figure>
        ))}
      </div>
      <ReadinessPanel initial={initial} onReport={setReport} />
    </div>
  );
}
