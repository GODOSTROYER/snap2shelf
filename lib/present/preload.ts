/**
 * Keeps the next chapter's pixels decoded before it starts, so transitions
 * never wait on the network. Browser-only; every function is a no-op on the
 * server. Images are kept referenced so the memory cache holds them.
 */
const images = new Map<string, HTMLImageElement>();
const videos = new Map<string, Promise<string>>();
const videoReady = new Map<string, string>();

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
      .catch(() => url)
      .then((u) => {
        videoReady.set(url, u);
        return u;
      });
    videos.set(url, p);
  }
  return p;
}

/** The object URL of a video preloadVideo already finished, else null (so a player can start on it at mount). */
export function preloadedVideo(url: string): string | null {
  return videoReady.get(url) ?? null;
}
