import { ChevronDown, ScanLine } from "lucide-react";

export interface XrayNoteProps {
  count: number;
  ogUrl: string;
  /** Layers in the share card (heroes + text). */
  ogLayers: number;
  heroTransformation: string;
}

const code = "rounded-md bg-[#f4efe7]/[0.06] px-1.5 py-0.5 font-mono text-[12px] text-[#f4efe7]/90 break-all";

/** "Built with Cloudinary" footnote: how the shelf was made, in four plain lines. */
export function XrayNote({ count, ogUrl, ogLayers, heroTransformation }: XrayNoteProps) {
  return (
    <details className="group rounded-2xl border border-[#f4efe7]/10 bg-[#f4efe7]/[0.02] open:bg-[#f4efe7]/[0.035]">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 text-sm text-[#a89f92] transition-colors hover:text-[#f4efe7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f5a524] [&::-webkit-details-marker]:hidden">
        <ScanLine className="h-4 w-4 shrink-0 text-[#f5a524]" aria-hidden />
        <span>
          <span className="font-medium text-[#f4efe7]">Built with Cloudinary</span>
          <span className="hidden sm:inline"> · how this shelf was made</span>
        </span>
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 transition-transform duration-300 group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <ol className="grid gap-4 px-4 pb-5 pt-1 text-[13px] leading-relaxed text-[#a89f92] sm:grid-cols-2 sm:text-sm">
        <li>
          <strong className="block font-semibold text-[#f4efe7]">Photo pixels kept, AI-built stage</strong>
          Each product is cut out of its own photo with <code className={code}>e_background_removal</code> and layered onto one
          AI-generated scene in a single transformation URL. The product pixels are never redrawn.
        </li>
        <li>
          <strong className="block font-semibold text-[#f4efe7]">One scene, one light</strong>
          All {count}{" "}products share the scene&apos;s light direction, shadow and baseline, and are sized to the same visual weight, so the
          catalog reads as one shoot.
        </li>
        <li>
          <strong className="block font-semibold text-[#f4efe7]">Right-sized for every screen</strong>
          <code className={code}>{heroTransformation}</code> as a responsive <code className={code}>srcset</code>, with a 24&nbsp;px blurred
          placeholder while it loads.
        </li>
        <li>
          <strong className="block font-semibold text-[#f4efe7]">The share card is a URL</strong>
          The WhatsApp preview is a 1200×630 collage built from {ogLayers} layers with Google-font text, no upload.{" "}
          <a
            href={ogUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[#f5a524] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f5a524]"
          >
            Open the card
          </a>
        </li>
      </ol>
    </details>
  );
}
