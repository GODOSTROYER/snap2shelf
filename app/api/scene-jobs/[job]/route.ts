import type { SceneJobResponse } from "@/lib/api-contract";
import { HttpError, routeWithParams } from "@/lib/server/http";
import { pollSceneJob } from "@/lib/server/scene-jobs";
import { decodeSceneJob } from "@/lib/server/scene-job-token";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/scene-jobs/:job → poll an on-demand scene (await each response, then wait ~2 s).
 * processing → the plate is being normalised / analysed; completed → a library Scene with DNA;
 * failed → generation failed or scene QA kept the plate out of the library.
 */
export const GET = routeWithParams<{ job: string }>("scene-jobs", async (_req, session, { job }) => {
  const claims = decodeSceneJob(job);
  // A job token only works for the session that started it (same 404 as an unknown token, so nothing leaks).
  if (!claims || claims.sid !== session.sid) throw new HttpError(404, "not_found", "Unknown or expired scene job.");
  const out = await pollSceneJob(claims);
  const body: SceneJobResponse = {
    status: out.status,
    scene: out.scene,
    credits: out.credits,
    latencyMs: out.latencyMs,
    qa: out.qa,
    request: out.request,
    error: out.error,
  };
  return { body };
});
