import type { JobResponse } from "@/lib/api-contract";
import { pollCreative } from "@/lib/server/creative";
import { HttpError, routeWithParams } from "@/lib/server/http";
import { decodeJob } from "@/lib/server/job-token";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/jobs/:job → poll a generation (await each response, then wait ~2 s).
 * When done: copied into main, fidelity-QA'd, returned as a KitAsset with the request JSON for X-ray.
 */
export const GET = routeWithParams<{ job: string }>("jobs", async (_req, _session, { job }) => {
  const claims = decodeJob(job);
  if (!claims) throw new HttpError(404, "not_found", "Unknown or expired job.");
  const out = await pollCreative(claims);
  const body: JobResponse = {
    status: out.status,
    asset: out.asset,
    modelId: out.modelId,
    credits: out.credits,
    latencyMs: out.latencyMs,
    request: out.request,
    error: out.error,
  };
  return { body };
});
