"use client";

import * as React from "react";
import { Notice } from "@/components/features/shared";
import type { ApiError, ReadinessResponse } from "@/lib/api-contract";
import { sampleReadiness } from "@/lib/client/sample-data";
import { isAborted, sleep } from "@/lib/client/util";
import type { ReadinessReport } from "@/lib/readiness";
import { ReadinessPanel, type ReadinessPanelProps } from "./ReadinessPanel";

type State = { kind: "loading"; slow?: boolean } | { kind: "ready"; report: ReadinessReport; canFix?: boolean } | { kind: "error"; message: string; busy: boolean } | { kind: "none" };

const RETRY_MS = [4000, 8000, 16000];

/**
 * The kit view's readiness card: measures the marketplace image once the pack
 * has saved it (one GET /api/readiness/:sku, retried calmly while Cloudinary is
 * busy), or reads a sample's stored measurement without any request.
 */
export function KitReadiness({
  sku,
  sample,
  measureKey,
  waiting,
  ...panel
}: Omit<ReadinessPanelProps, "initial"> & {
  sku: string;
  /** A saved sample: its measurement ships with the page, fixes are read-only. */
  sample?: boolean;
  /** Change it to measure again (e.g. a new pack of the same product). */
  measureKey?: string | number;
  /** The marketplace image is still rendering: hold the skeleton, don't measure yet. */
  waiting?: boolean;
}) {
  const [state, setState] = React.useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    if (waiting) return;
    const ac = new AbortController();
    // deferred a tick: a remount (StrictMode, fast refresh) must not measure twice
    const t = setTimeout(async () => {
      if (sample) {
        const r = await sampleReadiness(sku);
        if (!ac.signal.aborted) setState(r ? { kind: "ready", report: r } : { kind: "none" });
        return;
      }
      setState({ kind: "loading" });
      for (let i = 0; ; i++) {
        try {
          const res = await fetch(`/api/readiness/${sku}`, { cache: "no-store", credentials: "same-origin", signal: ac.signal });
          const body = (await res.json().catch(() => null)) as ReadinessResponse | ApiError | null;
          if (res.ok && body && "report" in body) {
            // canFix (newer contract field): false = a kit this browser may look at but not change
            const canFix = (body as ReadinessResponse & { canFix?: boolean }).canFix;
            setState({ kind: "ready", report: body.report, canFix: typeof canFix === "boolean" ? canFix : undefined });
            return;
          }
          const code = body && "code" in body ? body.code : undefined;
          const busy = [420, 429, 502, 503, 504].includes(res.status) || code === "pending";
          if (busy && i < RETRY_MS.length) {
            setState({ kind: "loading", slow: true });
            await sleep(body && "retryAfterMs" in body && body.retryAfterMs ? Math.max(body.retryAfterMs, RETRY_MS[i]) : RETRY_MS[i], ac.signal);
            continue;
          }
          setState({
            kind: "error",
            busy: busy || code === "quota_low",
            message: code === "quota_low" ? "Measuring is paused to protect the shared quota. The kit itself is ready to use." : body && "error" in body ? body.error : "We couldn't measure the marketplace image just now.",
          });
          return;
        } catch (e) {
          if (isAborted(e) || ac.signal.aborted) return;
          setState({ kind: "error", busy: false, message: "Can't reach Snap2Shelf. Check your connection and try again." });
          return;
        }
      }
    }, 0);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [sku, sample, measureKey, attempt, waiting]);

  if (state.kind === "none") return null;
  if (state.kind === "error" && !waiting) {
    return (
      <Notice tone={state.busy ? "busy" : "error"} title={state.busy ? "Readiness check is waiting" : "Couldn't check readiness"} onRetry={() => setAttempt((n) => n + 1)} className={panel.className}>
        {state.message}
      </Notice>
    );
  }
  if (state.kind !== "ready" || waiting) {
    const slow = state.kind === "loading" && state.slow;
    return (
      <div aria-busy="true" className={`rounded-[22px] bg-stage p-5 ring-1 ring-line sm:p-7 ${panel.className ?? ""}`}>
        <div className="grid gap-7 md:grid-cols-[auto_minmax(0,1fr)] md:gap-10">
          <div className="grid justify-items-center gap-3">
            <div className="skeleton size-[184px] rounded-full [mask:radial-gradient(circle,transparent_78px,#000_79px)]" />
            <p role="status" className="text-center text-[0.82rem] text-dim">
              {waiting ? "Waiting for the marketplace image…" : slow ? "Cloudinary is busy. Measuring shortly…" : "Measuring the marketplace image…"}
            </p>
          </div>
          <div className="grid content-start gap-3">
            <div className="skeleton h-7 w-56 max-w-full rounded-lg" />
            <div className="skeleton h-4 w-72 max-w-full rounded-md" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton mt-2 h-10 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }
  return <ReadinessPanel initial={state.report} canFix={state.canFix} {...panel} />;
}
