"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, SheetContent } from "@/components/ui/dialog";
import { isBuiltUrl } from "@/lib/client/img";
import type { KitAsset, QaResult } from "@/lib/types";
import { QaBadge } from "./qa-badge";
import { XrayLegend, XraySteps, XrayUrl } from "./xray-parts";

/** The X-ray: the exact Cloudinary URL (or generation request) behind an asset. */
export function XraySheet({ asset, onOpenChange }: { asset: KitAsset | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={!!asset} onOpenChange={onOpenChange}>
      {asset ? (
        <SheetContent
          title={`X-ray: ${asset.label}`}
          description={isBuiltUrl(asset.xray) ? "One Cloudinary URL makes this. Each colour is one step." : "This one was generated. Here is the request that made it."}
        >
          <XrayBody asset={asset} />
        </SheetContent>
      ) : null}
    </Dialog>
  );
}

function XrayBody({ asset }: { asset: KitAsset }) {
  const [copied, setCopied] = React.useState(false);
  const x = asset.xray;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(isBuiltUrl(x) ? x.url : JSON.stringify(x.json, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="grid gap-6">
      {asset.qa ? <QaPanel qa={asset.qa} /> : null}

      {isBuiltUrl(x) ? (
        <>
          <div className="grid gap-3">
            <XrayUrl built={x} className="rounded-xl p-4 text-[0.76rem] leading-[1.7]" />
            <XrayLegend segments={x.segments} className="text-[0.76rem]" />
          </div>
          <XraySteps segments={x.segments} withCode />
        </>
      ) : (
        <pre className="overflow-x-auto rounded-xl bg-studio p-4 font-mono text-[0.74rem] leading-relaxed text-dim ring-1 ring-line">
          {JSON.stringify(x.json, null, 2)}
        </pre>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={copy}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : isBuiltUrl(x) ? "Copy URL" : "Copy request"}
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <a href={asset.url} target="_blank" rel="noreferrer">
            <ExternalLink />
            Open full size
          </a>
        </Button>
      </div>
    </div>
  );
}

function QaPanel({ qa }: { qa: QaResult }) {
  return (
    <div className="rounded-xl bg-stage-2 p-4 ring-1 ring-line">
      <QaBadge qa={qa} />
      <ul className="mt-3 grid gap-1 text-sm text-dim">
        {qa.reasons.length ? (
          qa.reasons.map((r) => <li key={r}>{r}</li>)
        ) : qa.status === "approved" ? (
          <li>
            {qa.matched.includes("same-product")
              ? "AI Vision confirmed it is the same product as your photo."
              : "AI Vision found the product clearly visible, resting on the surface, with no editing artifacts."}
          </li>
        ) : null}
      </ul>
      {qa.matched.length ? <p className="mt-3 font-mono text-[0.72rem] text-faint">AI Vision tags: {qa.matched.join(", ")}</p> : null}
    </div>
  );
}
