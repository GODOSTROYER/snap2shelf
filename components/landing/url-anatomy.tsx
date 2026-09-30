import { XrayLegend, XraySteps, XrayUrl } from "@/components/kit/xray-parts";
import type { BuiltUrl } from "@/lib/types";

/** A real transformation URL, colour-coded, with a plain-language key. Server-only markup. */
export function UrlAnatomy({ built, note }: { built: BuiltUrl; note?: React.ReactNode }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-12">
      <div className="grid content-start gap-4">
        <XrayUrl built={built} className="p-5 text-[0.75rem] leading-[1.8] sm:p-7 sm:text-[0.85rem]" />
        <XrayLegend segments={built.segments} />
        {note ? <p className="max-w-[40rem] text-[0.85rem] leading-relaxed text-dim">{note}</p> : null}
      </div>
      <XraySteps segments={built.segments} />
    </div>
  );
}
