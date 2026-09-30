import "server-only";

/**
 * SSRF / cost-abuse guard for image URLs sent by the client (QA, pack hero).
 * Cloudinary fetches these URLs on our behalf (upload-by-URL, AI Vision), so
 * only delivery URLs of our own main cloud are accepted, and transformations
 * that would fetch remote content or trigger paid generative effects are refused.
 */

const MAX_URL = 2048;

/** Transformation components we never accept from the client. */
const DENIED_COMPONENTS = [
  /(?:^|[/,])[lu]_fetch:/i, // remote-fetch overlays / underlays
  /(?:^|[/,])[lu]_(?:video|subtitles|audio):/i,
  /(?:^|[/,])e_gen_[a-z_]*/i, // generative effects (billed per use)
  /(?:^|[/,])b_gen_fill/i,
  /(?:^|[/,])e_(?:background_removal|upscale|enhance|extract|generative_[a-z_]+|replace|remove)\b/i,
  /(?:^|[/,])fl_attachment/i,
];

/** Public ids a client URL may deliver. Layers inside the transformation must be our own assets anyway. */
const ALLOWED_ASSET = /\/snap2shelf\/(?:products|scenes|spikes)\/[a-z0-9/_-]+(?:\.(?:jpg|jpeg|png|webp|avif))?$/i;

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

export function checkMainImageUrl(raw: unknown, cloud: string): UrlCheck {
  if (typeof raw !== "string" || !raw || raw.length > MAX_URL) return { ok: false, reason: "length" };
  if (/[\s\\]/.test(raw)) return { ok: false, reason: "chars" };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "parse" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "protocol" };
  if (u.hostname !== "res.cloudinary.com" || u.port !== "") return { ok: false, reason: "host" };
  if (u.username || u.password) return { ok: false, reason: "userinfo" };
  if (u.search || u.hash) return { ok: false, reason: "query" };
  if (!u.pathname.startsWith(`/${cloud}/image/upload/`)) return { ok: false, reason: "cloud" };
  let decoded: string;
  try {
    decoded = decodeURIComponent(u.pathname);
  } catch {
    return { ok: false, reason: "encoding" };
  }
  if (decoded.includes("..") || /[\\?#]/.test(decoded)) return { ok: false, reason: "path" };
  if (DENIED_COMPONENTS.some((re) => re.test(u.pathname) || re.test(decoded))) return { ok: false, reason: "transformation" };
  if (!ALLOWED_ASSET.test(u.pathname)) return { ok: false, reason: "asset" };
  return { ok: true, url: u };
}

/**
 * Version of a delivery URL that Cloudinary can fetch for itself (upload by URL,
 * AI Vision): f_auto would negotiate on the fetcher's Accept header, so pin JPEG.
 * `quality` replaces a q_auto next to it when given (e.g. "q_90" for a saved hero).
 */
export function pinJpeg(url: string, quality?: string): string {
  let out = url.replace(/(^|[/,])f_auto(?=[,/])/g, "$1f_jpg");
  if (quality) out = out.replace(/(^|[/,])q_auto(?::[a-z]+)?(?=[,/])/g, `$1${quality}`);
  return out;
}
