"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";
import type { ApiError, ReadinessResponse } from "@/lib/api-contract";
import type { ReadinessCheck, ReadinessReport } from "@/lib/readiness";
import { ReadinessGauge } from "./ReadinessGauge";

/**
 * ReadinessGauge wired to the API: one-click server fixes (POST /api/readiness/:sku)
 * and a re-measure button. Fixes that need the studio (restage / repack) are explained,
 * not faked. `onReport` lets a parent (e.g. the kit view) refresh its marketplace image.
 */
export function ReadinessPanel({ initial, onReport }: { initial: ReadinessReport; onReport?: (r: ReadinessReport) => void }) {
  const [report, setReport] = useState(initial);
  const [fixing, setFixing] = useState<ReadinessCheck["id"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>("");

  const update = (r: ReadinessReport) => {
    setReport(r);
    onReport?.(r);
  };

  async function call(init?: RequestInit): Promise<ReadinessResponse | null> {
    const res = await fetch(`/api/readiness/${report.sku}`, { cache: "no-store", ...init });
    const body = (await res.json()) as ReadinessResponse | ApiError;
    if (!res.ok || "error" in body) {
      setNote("error" in body ? body.error : "Something went wrong. Try again.");
      return null;
    }
    return body;
  }

  const onFix = async (check: ReadinessCheck) => {
    const fix = check.fix;
    if (!fix) return;
    if (fix.kind === "transformation" && fix.apply && !fix.paid) {
      setFixing(check.id);
      setNote("");
      const before = report.score;
      const out = await call({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fixes: [fix.apply] }) });
      setFixing(null);
      if (out) {
        update(out.report);
        setNote(`Applied “${fix.label}”: ${before} → ${out.report.score}.`);
      }
      return;
    }
    if (fix.kind === "restage") setNote(`Open this product in the studio and ${fix.label.toLowerCase()} — the sliders are pre-set for you.`);
    else if (fix.kind === "repack") setNote(`${fix.label} in the studio's Channel Pack, then re-check.`);
    else if (fix.kind === "transformation" && fix.paid) setNote(`${fix.label} spends AI credits, so it runs from the studio.`);
  };

  const remeasure = async () => {
    setBusy(true);
    setNote("");
    const out = await call();
    setBusy(false);
    if (out) update(out.report);
  };

  return (
    <div>
      <ReadinessGauge report={report} onFix={onFix} fixing={fixing} />
      <div className="mt-4 flex min-h-11 flex-wrap items-center justify-between gap-3 px-1">
        <p role="status" aria-live="polite" className="text-sm text-[#a89f92]">
          {note}
        </p>
        <button
          type="button"
          onClick={remeasure}
          disabled={busy}
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#f4efe7]/15 px-4 text-sm text-[#f4efe7] transition-colors hover:border-[#f4efe7]/35 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f5a524]"
        >
          <RotateCcw className={`h-4 w-4 ${busy ? "animate-spin [animation-direction:reverse]" : ""}`} aria-hidden />
          {busy ? "Measuring…" : "Measure again"}
        </button>
      </div>
    </div>
  );
}
