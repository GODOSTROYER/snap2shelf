"use client";

import { Check, Link2, Share2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState, useSyncExternalStore } from "react";
import { whatsappShareUrl } from "@/lib/shelf/slug";
import { WhatsAppIcon } from "./icons";

export interface ShareBarProps {
  /** Canonical absolute URL from the server (used until the client knows its real origin). */
  shareUrl: string;
  title: string;
  /** Message shown above the link in WhatsApp. */
  message: string;
  className?: string;
}

const noop = () => () => {};

/** The page's own URL on the client (dev ports, preview deploys), the canonical one on the server. */
function useShareUrl(fallback: string): string {
  return useSyncExternalStore(
    noop,
    () => `${window.location.origin}${window.location.pathname}`,
    () => fallback,
  );
}

function useCanNativeShare(): boolean {
  return useSyncExternalStore(
    noop,
    () => typeof navigator !== "undefined" && typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API unavailable (http, old browser): fall back to a hidden textarea
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function ShareBar({ shareUrl, title, message, className = "" }: ShareBarProps) {
  const url = useShareUrl(shareUrl);
  const canShare = useCanNativeShare();
  const reduce = useReducedMotion();
  const [copied, setCopied] = useState(false);
  // always a whileTap object (motion adds tabindex for it), so server and client markup match under reduced motion
  const tap = reduce ? {} : { scale: 0.97 };

  const onCopy = async () => {
    if (await copyText(url)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    }
  };

  const onShare = async () => {
    try {
      await navigator.share({ title, text: message, url });
    } catch {
      // user dismissed the sheet
    }
  };

  return (
    <div className={`flex items-center gap-2.5 sm:gap-3 ${className}`}>
      <motion.a
        whileTap={tap}
        href={whatsappShareUrl(message, url)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-2.5 whitespace-nowrap rounded-full bg-[#f5a524] px-5 text-[15px] font-semibold sm:flex-none text-[#1a1208] shadow-[0_10px_30px_-10px_rgba(245,165,36,0.65)] transition-colors hover:bg-[#ffb73d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f4efe7] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e0c0a]"
      >
        <WhatsAppIcon className="h-5 w-5" />
        Share on WhatsApp
      </motion.a>

      <motion.button
        whileTap={tap}
        type="button"
        onClick={onCopy}
        aria-label={copied ? "Link copied" : "Copy link"}
        className="inline-flex h-12 w-12 shrink-0 items-center justify-center gap-2 rounded-full border border-[#f4efe7]/20 bg-[#f4efe7]/[0.04] sm:w-auto sm:px-5 text-[15px] font-medium text-[#f4efe7] transition-colors hover:border-[#f4efe7]/40 hover:bg-[#f4efe7]/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f5a524] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e0c0a]"
      >
        {copied ? <Check className="h-4 w-4 text-[#f5a524]" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
        <span className="hidden sm:inline">{copied ? "Link copied" : "Copy link"}</span>
      </motion.button>

      {canShare && (
        <motion.button
          whileTap={tap}
          type="button"
          onClick={onShare}
          aria-label="Share with another app"
          className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-[#f4efe7]/20 bg-[#f4efe7]/[0.04] text-[#f4efe7] transition-colors hover:border-[#f4efe7]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f5a524] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0e0c0a]"
        >
          <Share2 className="h-4 w-4" aria-hidden />
        </motion.button>
      )}

      <span className="sr-only" role="status" aria-live="polite">
        {copied ? "Shelf link copied to the clipboard" : ""}
      </span>
    </div>
  );
}
