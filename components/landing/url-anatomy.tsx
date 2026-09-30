import { KIND_META } from "@/lib/client/kit-view";
import type { BuiltUrl } from "@/lib/types";

/** A real transformation URL, colour-coded, with a plain-language key. Server-only markup. */
export function UrlAnatomy({ built }: { built: BuiltUrl }) {
  const host = built.url.slice(0, built.url.indexOf("/upload/") + 8);
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:gap-12">
      <p className="rounded-2xl bg-stage p-5 font-mono text-[0.78rem] leading-[1.8] break-all ring-1 ring-line sm:p-7 sm:text-[0.85rem]">
        <span className="text-faint">{host.replace("https://", "")}</span>
        {built.segments.map((s, i) => (
          <span key={i}>
            {i > 0 ? <span className="text-faint">/</span> : null}
            <span style={{ color: KIND_META[s.kind].color }}>{s.text}</span>
          </span>
        ))}
      </p>
      <ol className="grid content-start gap-4">
        {built.segments.map((s, i) => (
          <li key={i} className="grid grid-cols-[auto_1fr] gap-x-3 text-[0.95rem]">
            <span aria-hidden className="mt-2 size-2.5 rounded-full" style={{ background: KIND_META[s.kind].color }} />
            <p className="text-dim">
              <span className="font-semibold" style={{ color: KIND_META[s.kind].color }}>
                {KIND_META[s.kind].label}.
              </span>{" "}
              {s.label}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
