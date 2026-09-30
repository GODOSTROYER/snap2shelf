/**
 * Keeps the next chapter's pixels decoded before it starts, so transitions
 * never wait on the network. Browser-only; every function is a no-op on the
 * server. Images are kept referenced so the memory cache holds them.
 */
const images = new Map<string, HTMLImageElement>();
const videos = new Map<string, Promise<string>>();

export function preloadImages(urls: readonly string[]) {
  if (typeof window === "undefined") return;
  for (const url of urls) {
    if (!url || images.has(url)) continue;
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    images.set(url, img);
    img.decode?.().catch(() => {
      /* a failed preload just means the chapter loads it itself */
    });
  }
}

/** Idle-time preload of everything else, one chapter at a time. */
export function preloadWhenIdle(groups: readonly (readonly string[])[]) {
  if (typeof window === "undefined") return () => {};
  let cancelled = false;
  let i = 0;
  const idle: (cb: () => void) => number =
    "requestIdleCallback" in window ? (cb) => window.requestIdleCallback(cb, { timeout: 1500 }) : (cb) => window.setTimeout(cb, 400);
  const step = () => {
    if (cancelled || i >= groups.length) return;
    preloadImages(groups[i++]);
    idle(step);
  };
  idle(step);
  return () => {
    cancelled = true;
  };
}

/**
 * Downloads a video once and hands back an object URL, so the phone frame
 * starts playing instantly. Falls back to the network URL on any error.
 */
export function preloadVideo(url: string): Promise<string> {
  if (typeof window === "undefined") return Promise.resolve(url);
  let p = videos.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => URL.createObjectURL(b))
      .catch(() => url);
    videos.set(url, p);
  }
  return p;
}

/**
 * Size the browser actually downloaded for an image already on the page,
 * from Resource Timing (Cloudinary sends Timing-Allow-Origin: *). Falls back
 * to fetching it with the same Accept header an <img> sends.
 */
export async function measureDelivered(url: string): Promise<{ bytes: number; format: string | null } | null> {
  if (typeof window === "undefined") return null;
  const entry = performance.getEntriesByName(url).find((e): e is PerformanceResourceTiming => "encodedBodySize" in e && (e as PerformanceResourceTiming).encodedBodySize > 0);
  try {
    const res = await fetch(url, { headers: { Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" } });
    if (!res.ok) return entry ? { bytes: entry.encodedBodySize, format: null } : null;
    const type = res.headers.get("content-type");
    const bytes = entry?.encodedBodySize || (await res.blob()).size;
    return { bytes, format: type ? type.replace(/^image\//, "").toUpperCase() : null };
  } catch {
    return entry ? { bytes: entry.encodedBodySize, format: null } : null;
  }
}
