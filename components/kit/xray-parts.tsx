/**
 * The pieces of an X-ray: a delivery URL coloured by what each part does, the
 * colour key, and the plain-language walk-through. Server-safe (no hooks);
 * used by the landing's URL anatomy and the X-ray sheet.
 */
import * as React from "react";
import { xrayColor } from "@/lib/client/kit-view";
import { cn } from "@/lib/client/util";
import { segmentLabel, XRAY_KINDS, xrayLegend } from "@/lib/transform/xray";
import type { BuiltUrl, XraySegment } from "@/lib/types";

export function XrayUrl({ built, className }: { built: BuiltUrl; className?: string }) {
  const at = built.url.indexOf("/upload/");
  const host = at >= 0 ? built.url.slice(0, at + 8).replace(/^https:\/\//, "") : "";
  return (
    <p className={cn("rounded-2xl bg-studio font-mono break-all ring-1 ring-line", className)}>
      <span className="text-faint">{host}</span>
      {built.segments.map((s, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <span className="text-faint">/</span> : null}
          <span style={{ color: xrayColor(s.kind) }} title={segmentLabel(s)}>
            {s.text}
          </span>
        </React.Fragment>
      ))}
    </p>
  );
}

export function XrayLegend({ segments, className }: { segments: XraySegment[]; className?: string }) {
  return (
    <ul aria-label="Colour key" className={cn("flex flex-wrap gap-x-4 gap-y-2 text-[0.8rem] text-dim", className)}>
      {xrayLegend(segments).map((k) => (
        <li key={k.kind} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full" style={{ background: xrayColor(k.kind) }} />
          {k.legend}
        </li>
      ))}
    </ul>
  );
}

const same = (a: string, b: string) => a.trim().replace(/\.$/, "").toLowerCase() === b.trim().replace(/\.$/, "").toLowerCase();

export function XraySteps({ segments, withCode, className }: { segments: XraySegment[]; withCode?: boolean; className?: string }) {
  return (
    <ol className={cn("grid content-start gap-4", className)}>
      {segments.map((s, i) => {
        const legend = XRAY_KINDS[s.kind].legend;
        // a plain stored asset's label is its legend ("Source asset"): say it once
        const label = same(s.label, legend) ? null : segmentLabel(s);
        return (
        <li key={i} className="grid grid-cols-[auto_1fr] gap-x-3">
          <span aria-hidden className="mt-[0.45em] size-2.5 rounded-full" style={{ background: xrayColor(s.kind) }} />
          <div className="min-w-0">
            <p className="text-[0.95rem] text-dim">
              <span className="font-semibold" style={{ color: xrayColor(s.kind) }}>
                {legend}
                {label ? "." : null}
              </span>
              {label ? (
                <>
                  {" "}
                  <span className="text-paper/90">{label}</span>
                </>
              ) : null}
            </p>
            {withCode ? (
              <code className="mt-1 block truncate font-mono text-[0.75rem] text-faint" title={s.text}>
                {s.text}
              </code>
            ) : null}
          </div>
        </li>
        );
      })}
    </ol>
  );
}
