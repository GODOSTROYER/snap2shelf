/** Abortable waiting. Own module so small client islands (the reel) can use it without util's tailwind-merge. */
export class Aborted extends Error {
  constructor() {
    super("aborted");
    this.name = "Aborted";
  }
}

export const isAborted = (e: unknown) => e instanceof Aborted || (e instanceof DOMException && e.name === "AbortError");

export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Aborted());
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Aborted());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
