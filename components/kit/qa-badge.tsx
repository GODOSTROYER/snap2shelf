import { ShieldAlert, ShieldCheck, ShieldEllipsis } from "lucide-react";
import { cn } from "@/lib/client/util";
import type { QaResult } from "@/lib/types";

const COPY = {
  approved: { label: "QA passed", Icon: ShieldCheck, cls: "bg-leaf/15 text-leaf ring-leaf/35" },
  rejected: { label: "QA rejected", Icon: ShieldAlert, cls: "bg-sindoor/15 text-sindoor ring-sindoor/40" },
  pending: { label: "Checking", Icon: ShieldEllipsis, cls: "bg-stage-3 text-dim ring-line-strong" },
} as const;

export function QaBadge({ qa, className }: { qa: Pick<QaResult, "status">; className?: string }) {
  const c = COPY[qa.status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.74rem] leading-none font-semibold ring-1 ring-inset", c.cls, className)}>
      <c.Icon className="size-3.5" aria-hidden />
      {c.label}
    </span>
  );
}
