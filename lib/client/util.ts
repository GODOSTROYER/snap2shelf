import { clsx, type ClassValue } from "clsx";
import { customAlphabet } from "nanoid";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/** 8 lower-case alphanumerics, matching SKU_RE in lib/types.ts. */
export const newSku = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

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

/** Resolve no sooner than `ms`, so a fast step still reads as a step. */
export async function atLeast<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  const [v] = await Promise.all([p, sleep(ms, signal)]);
  return v;
}

/** Resolve when an image URL has finished rendering on the CDN (or fail). */
export function preloadImage(url: string, signal?: AbortSignal, timeoutMs = 45_000) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Aborted());
    const img = new Image();
    const t = setTimeout(() => done(new Error("The image took too long to render.")), timeoutMs);
    const onAbort = () => done(new Aborted());
    function done(err?: Error) {
      clearTimeout(t);
      signal?.removeEventListener("abort", onAbort);
      img.onload = img.onerror = null;
      if (err) reject(err);
      else resolve();
    }
    img.onload = () => done();
    img.onerror = () => done(new Error("Cloudinary couldn't render this image."));
    signal?.addEventListener("abort", onAbort, { once: true });
    img.src = url;
  });
}
