import type { ApiError } from "../api-contract";

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public body: ApiError,
  ) {
    super(body.error);
    this.name = "ApiFailure";
  }
}

/**
 * The server's write lock (HTTP 403, code "read_only"): samples, showcase kits,
 * demo-shelf products and other people's kits can be viewed but not changed.
 * Not an error on the visitor's side: say so calmly and point to their own upload.
 * (The code is newer than this branch's ApiError union, so it is compared as a string.)
 */
export const READ_ONLY_CODE = "read_only";
export const READ_ONLY_FALLBACK = "Samples are read-only — upload your photo to try it.";

/** The lock's message when `body` is a read-only answer, else null. */
export function readOnlyMessage(body: unknown): string | null {
  if (!body || typeof body !== "object" || (body as { code?: unknown }).code !== READ_ONLY_CODE) return null;
  const error = (body as { error?: unknown }).error;
  return typeof error === "string" && error ? error : READ_ONLY_FALLBACK;
}

export function isReadOnly(e: unknown): e is ApiFailure {
  return e instanceof ApiFailure && readOnlyMessage(e.body) !== null;
}
