"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { ApiError, ReadinessResponse } from "@/lib/api-contract";
import type { ReadinessCheck, ReadinessReport } from "@/lib/readiness";
import type { CompositeControls, SceneDNA } from "@/lib/types";
import { ReadinessGauge } from "./ReadinessGauge";

export interface ReadinessPanelProps {
  initial: ReadinessReport;
  /** Every new report (a fix, a re-measure): e.g. refresh the marketplace image on the shelf. */
  onReport?: (r: ReadinessReport) => void;
  /** "Move the product up 20 px": the studio applies the controls and re-stages. Without it, the fix is explained. */
  onRestage?: (controls: Partial<CompositeControls>, label: string) => void;
  /** "Move the offer text to the bottom": the studio re-packs with that text zone. */
  onRepack?: (textZone: SceneDNA["text_zone"], label: string) => void;
  /** Read-only (a saved sample): fixes explain themselves instead of running. */
  readOnly?: string;
  /** The studio is busy (re-staging, packing): hold the fix buttons. */
  busy?: boolean;
  /** What the baseline image is (the gauge compares it with the kit): "Your photo" or the sample label. */
  photoLabel?: string;
  className?: string;
}

const BUSY_CODES = new Set([420, 429, 502, 503, 504]);

/**
 * ReadinessGauge wired to the API: one-click server fixes (POST /api/readiness/:sku),
 * studio fixes (re-stage / re-pack) handed to the parent, and a re-measure button.
 */
export function ReadinessPanel({ initial, onReport, onRestage, onRepack, readOnly, busy, photoLabel, className }: ReadinessPanelProps) {
  const [report, setReport] = useState(initial);
  const [fixing, setFixing] = useState<ReadinessCheck["id"] | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [note, setNote] = useState<string>("");

  // a new kit (re-pack) brings a new first report
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setReport(initial);
    setNote("");
  }

  const update = (r: ReadinessReport) => {
    setReport(r);
    onReport?.(r);
  };

  async function call(init?: RequestInit): Promise<ReadinessResponse | null> {
    try {
      const res = await fetch(`/api/readiness/${report.sku}`, { cache: "no-store", credentials: "same-origin", ...init });
      const body = (await res.json().catch(() => null)) as ReadinessResponse | ApiError | null;
      if (!res.ok || !body || "error" in body) {
        const code = body && "code" in body ? body.code : undefined;
        setNote(
          BUSY_CODES.has(res.status) || code === "pending"
            ? "Cloudinary is busy for a moment. Try the fix again in a minute."
            : code === "quota_low"
              ? "Fixes are paused to protect the shared quota. The score above is still current."
              : body && "error" in body
                ? body.error
                : "Something went wrong. Try again.",
        );
        return null;
      }
      return body;
    } catch {
      setNote("Can't reach Snap2Shelf. Check your connection and try again.");
      return null;
    }
  }

  const onFix = async (check: ReadinessCheck) => {
    const fix = check.fix;
    if (!fix) return;
    if (readOnly) {
      setNote(readOnly);
      return;
    }
    if (fix.kind === "transformation" && fix.apply && !fix.paid) {
      setFixing(check.id);
      setNote("");
      const before = report.score;
      const out = await call({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fixes: [fix.apply] }) });
      setFixing(null);
      if (out) {
        update(out.report);
        setNote(`Applied “${fix.label}”: ${before} → ${out.report.score}. The marketplace image on the shelf is the fixed one.`);
      }
      return;
    }
    if (fix.kind === "restage") {
      if (onRestage) {
        setNote(`${fix.label}: re-staging and re-packing the kit.`);
        onRestage(fix.controls, fix.label);
      } else setNote(`Open this product in the studio to ${fix.label.toLowerCase()}.`);
      return;
    }
    if (fix.kind === "repack") {
      if (onRepack) {
        setNote(`${fix.label}: re-packing the kit.`);
        onRepack(fix.textZone, fix.label);
      } else setNote(`${fix.label} in the studio, then check again.`);
      return;
    }
    if (fix.kind === "transformation" && fix.paid) setNote(`${fix.label} spends AI credits, so it isn't a one-click fix here.`);
    else if (fix.kind === "transformation") setNote(`${fix.label} is already how the pack exports it.`);
  };

  const remeasure = async () => {
    setMeasuring(true);
    setNote("");
    const out = await call();
    setMeasuring(false);
    if (out) update(out.report);
  };

  return (
    <div className={className}>
      <ReadinessGauge report={report} onFix={onFix} fixing={fixing} fixesDisabled={busy || measuring} quietFixes={!!readOnly} photoLabel={photoLabel} />
      <div className="mt-3 flex min-h-11 flex-wrap items-center justify-between gap-3 px-1">
        <p role="status" aria-live="polite" className="min-w-0 flex-1 text-sm text-dim">
          {note}
        </p>
        {readOnly ? null : (
          <Button variant="ghost" size="sm" onClick={remeasure} disabled={measuring || busy || fixing !== null} className="-mr-2">
            <RotateCcw className={measuring ? "animate-spin [animation-direction:reverse]" : undefined} />
            {measuring ? "Measuring…" : "Measure again"}
          </Button>
        )}
      </div>
    </div>
  );
}
