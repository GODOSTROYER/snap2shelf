"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, SheetContent } from "@/components/ui/dialog";
import { isBuiltUrl } from "@/lib/client/img";
import { KIND_META } from "@/lib/client/kit-view";
import type { KitAsset, QaResult } from "@/lib/types";
import { QaBadge } from "./qa-badge";

/** The X-ray: the exact Cloudinary URL (or generation request) behind an asset. */
export function XraySheet({ asset, onOpenChange }: { asset: KitAsset | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={!!asset} onOpenChange={onOpenChange}>
      {asset ? (
        <SheetContent
          title={`X-ray: ${asset.label}`}
          description={isBuiltUrl(asset.xray) ? "One Cloudinary URL makes this. Each colour is one step." : "This one was generated. Here is the request we sent."}
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
          <p className="rounded-xl bg-studio p-4 font-mono text-[0.76rem] leading-[1.7] break-all ring-1 ring-line">
            <span className="text-faint">{x.url.slice(0, x.url.indexOf("/upload/") + 8)}</span>
            {x.segments.map((s, i) => (
              <React.Fragment key={i}>
                {i > 0 ? <span className="text-faint">/</span> : null}
                <span style={{ color: KIND_META[s.kind].color }} title={s.label}>
                  {s.text}
                </span>
              </React.Fragment>
            ))}
          </p>
          <ol className="grid gap-4">
            {x.segments.map((s, i) => (
              <li key={i} className="grid grid-cols-[auto_1fr] gap-x-3">
                <span aria-hidden className="mt-1.5 size-2.5 rounded-full" style={{ background: KIND_META[s.kind].color }} />
                <div className="min-w-0">
                  <p className="text-sm text-paper">
                    <span className="font-semibold" style={{ color: KIND_META[s.kind].color }}>
                      {KIND_META[s.kind].label}.
                    </span>{" "}
                    {s.label}
                  </p>
                  <code className="mt-1 block truncate font-mono text-[0.72rem] text-faint" title={s.text}>
                    {s.text}
                  </code>
                </div>
              </li>
            ))}
          </ol>
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
      {qa.reasons.length ? (
        <ul className="mt-3 grid gap-1 text-sm text-dim">
          {qa.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {qa.matched.length ? (
        <p className="mt-3 font-mono text-[0.72rem] text-faint">AI Vision tags: {qa.matched.join(", ")}</p>
      ) : null}
    </div>
  );
}
