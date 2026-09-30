/**
 * Cost & savings, set like a shop receipt. Server-safe.
 */
import { PHOTOSHOOT_INR_ESTIMATE, PHOTOSHOOT_NOTE } from "@/lib/claims";
import { formatBytes } from "@/lib/client/img";
import { cn } from "@/lib/client/util";
import type { CostSummary, GenerationMode } from "@/lib/types";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function Receipt({ cost, mode, assetCount, replay, className }: { cost: CostSummary; mode: GenerationMode; assetCount: number; replay?: boolean; className?: string }) {
  const saved = cost.bytesOriginal > 0 && cost.bytesDelivered > 0 ? 1 - cost.bytesDelivered / cost.bytesOriginal : 0;
  const rows: { label: string; value: string; note?: string; strong?: boolean }[] = [
    {
      label: "Generation credits used",
      value: String(cost.generationCredits),
      note: cost.generationCredits === 0 && mode === "exact" ? "Exact mode composites your real photo, no generation" : undefined,
    },
    { label: "Saved by reusing a scene", value: `${cost.creditsSavedByReuse} credits`, note: "A scene is generated once, then shared" },
    { label: "Photoshoot you skipped", value: `≈ ${inr(PHOTOSHOOT_INR_ESTIMATE)}`, note: PHOTOSHOOT_NOTE, strong: true },
  ];
  if (cost.aiVisionTokens > 0) {
    rows.push({ label: "AI Vision", value: `${cost.aiVisionTokens.toLocaleString("en-IN")} tokens`, note: replay ? "Reading the product and the QA check, on the live run (this replay used none)" : "Reading the product and the QA check" });
  }
  if (cost.bytesOriginal > 0 && cost.bytesDelivered > 0) {
    rows.push({
      label: "Hero weight",
      value: `${formatBytes(cost.bytesOriginal)} → ${formatBytes(cost.bytesDelivered)}`,
      note: saved > 0 ? `${Math.round(saved * 100)}% lighter with automatic format and quality` : undefined,
    });
  }
  if (cost.seconds > 0) rows.push({ label: "Cloudinary processing", value: `${cost.seconds} s`, note: replay ? "Every step after the upload, on the live run of this photo" : "Every step after the upload" });

  return (
    <section aria-labelledby="receipt-title" className={cn("rounded-2xl bg-stage p-6 ring-1 ring-line sm:p-7", className)}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="receipt-title" className="font-display text-xl font-bold tracking-[-0.02em]">
          What this kit cost
        </h2>
        <span className="tabular text-sm text-dim">{assetCount} images</span>
      </div>
      <dl className="mt-5 grid gap-4">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="flex items-baseline gap-2">
              <dt className="shrink-0 text-[0.95rem] text-paper">{r.label}</dt>
              <span aria-hidden className="min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-line-strong" />
              <dd className={cn("tabular shrink-0 text-[0.95rem] font-semibold", r.strong ? "text-marigold" : "text-paper")}>{r.value}</dd>
            </div>
            {r.note ? <p className="mt-0.5 text-[0.8rem] text-dim">{r.note}</p> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
