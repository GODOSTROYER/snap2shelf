/**
 * X-ray: explain a Cloudinary delivery URL as colour-coded, labelled pieces.
 * Our builders (composite/channels/reel) return BuiltUrl.segments already;
 * describeTransformation() is the fallback for any URL we didn't build
 * (materialised assets, pasted URLs, the SDK's output). Pure and client-safe.
 */
import type { BuiltUrl, XraySegment } from "../types";

type Kind = XraySegment["kind"];

/**
 * Colour token per segment kind. `token` is the CSS custom property the UI
 * defines (e.g. `--xray-shadow`); `swatch` is a fallback colour that reads on
 * light and dark backgrounds; `legend` is the short key shown under the URL.
 */
export const XRAY_KINDS: Record<Kind, { token: string; swatch: string; legend: string }> = {
  crop: { token: "--xray-crop", swatch: "#3b82f6", legend: "Size & crop" },
  layer: { token: "--xray-layer", swatch: "#10b981", legend: "Your product (layer)" },
  placement: { token: "--xray-placement", swatch: "#14b8a6", legend: "Placement" },
  shadow: { token: "--xray-shadow", swatch: "#8b5cf6", legend: "Shadows" },
  reflection: { token: "--xray-reflection", swatch: "#06b6d4", legend: "Reflection" },
  effect: { token: "--xray-effect", swatch: "#f59e0b", legend: "Light-match & effects" },
  "gen-ai": { token: "--xray-gen-ai", swatch: "#ec4899", legend: "Generative AI" },
  text: { token: "--xray-text", swatch: "#f97316", legend: "Text overlay" },
  format: { token: "--xray-format", swatch: "#64748b", legend: "Format & quality" },
  asset: { token: "--xray-asset", swatch: "#94a3b8", legend: "Source asset" },
  video: { token: "--xray-video", swatch: "#ef4444", legend: "Video" },
};

/** Legend entries in display order, only for kinds present in `segments`. */
export function xrayLegend(segments: XraySegment[]) {
  const seen = new Set(segments.map((s) => s.kind));
  return (Object.keys(XRAY_KINDS) as Kind[]).filter((k) => seen.has(k)).map((k) => ({ kind: k, ...XRAY_KINDS[k] }));
}

// ── Parsing ─────────────────────────────────────────────────────────────

/** Transformation parameter prefixes (URL API). Anything else starts the public id. */
const PARAMS = new Set([
  "a", "ac", "af", "ar", "b", "bl", "bo", "br", "c", "co", "cs", "d", "dl", "dn", "dpr", "du", "e", "eo", "f", "fl", "fn",
  "fps", "g", "h", "if", "ki", "l", "o", "p", "pg", "q", "r", "so", "sp", "t", "u", "vc", "vs", "w", "x", "y", "z",
]);

const isParam = (token: string) => {
  if (token.startsWith("$")) return true; // user-defined variable
  const m = /^([a-z]+)_/.exec(token);
  return Boolean(m && PARAMS.has(m[1]));
};

/**
 * A component is a transformation if every comma-separated token is a
 * parameter. Commas inside (...) and inside l_text strings don't split.
 */
function isTransformationComponent(component: string) {
  if (!component) return false;
  return splitTokens(component).every(isParam);
}

function splitTokens(component: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of component) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const GEN = /(^|[,/])(e_gen_[a-z_]+|b_gen_fill|e_background_removal|e_upscale|e_enhance|e_extract|e_auto_enhance)/;

function classifyLayer(block: string): { kind: Kind; label: string } {
  if (/fl_splice/.test(block)) return { kind: "video", label: "Another clip spliced onto the video timeline" };
  if (/l_text:/.test(block)) return { kind: "text", label: "Text overlay rendered by Cloudinary" };
  if (/a_vflip/.test(block)) return { kind: "reflection", label: "Mirrored, faded copy of the layer (reflection)" };
  if (/e_dropshadow|e_shadow/.test(block)) return { kind: "shadow", label: "Layer with a drop shadow" };
  if (/e_colorize/.test(block) && /e_blur|e_distort/.test(block)) return { kind: "shadow", label: "Silhouette darkened and blurred into a shadow" };
  if (/e_colorize/.test(block)) return { kind: "effect", label: "Silhouette used as a light/colour wash or card" };
  if (GEN.test(block)) return { kind: "gen-ai", label: "Layer with a generative AI effect" };
  return { kind: "layer", label: "Image layered on top, then positioned" };
}

function classify(component: string): { kind: Kind; label: string } {
  const tokens = splitTokens(component);
  const has = (p: string) => tokens.some((t) => t === p || t.startsWith(p));
  if (GEN.test(component)) {
    if (has("b_gen_fill")) return { kind: "gen-ai", label: "Generative fill extends the image to the new shape" };
    if (has("e_gen_recolor")) return { kind: "gen-ai", label: "Generative recolor of the named part" };
    if (has("e_background_removal")) return { kind: "gen-ai", label: "AI background removal" };
    return { kind: "gen-ai", label: "Generative AI effect" };
  }
  if (has("e_zoompan")) return { kind: "video", label: "Ken Burns zoom/pan turns the image into a video clip" };
  if (has("e_fade") || has("du_") || has("so_") || has("eo_") || has("fps_")) return { kind: "video", label: "Video timing / fade" };
  if (has("t_")) return { kind: "effect", label: `Named transformation ${tokens.find((t) => t.startsWith("t_"))!.slice(2)}` };
  if (tokens.every((t) => /^(f|q|vc|ac|dpr|fl_(lossy|progressive|preserve_transparency|attachment))[_:]/.test(t) || /^(f|q|vc|ac|dpr)_/.test(t)))
    return { kind: "format", label: formatLabel(tokens) };
  if (has("e_")) return { kind: "effect", label: `Effect: ${tokens.filter((t) => t.startsWith("e_")).map((t) => t.slice(2).split(":")[0].replace(/_/g, " ")).join(", ")}` };
  if (has("c_") || has("w_") || has("h_") || has("ar_") || has("g_")) return { kind: "crop", label: cropLabel(tokens) };
  if (has("a_") || has("r_") || has("bo_") || has("o_")) return { kind: "effect", label: "Rotate / round / border / opacity" };
  return { kind: "effect", label: "Transformation step" };
}

function formatLabel(tokens: string[]) {
  const f = tokens.find((t) => t.startsWith("f_"))?.slice(2);
  const q = tokens.find((t) => t.startsWith("q_"))?.slice(2);
  const parts = [f ? (f === "auto" ? "best format for the browser" : `${f.toUpperCase()} format`) : "", q ? (q.startsWith("auto") ? `automatic quality${q.includes(":") ? ` (${q.split(":")[1]})` : ""}` : `quality ${q}`) : ""];
  return parts.filter(Boolean).join(", ") || "Delivery format";
}

function cropLabel(tokens: string[]) {
  const mode = tokens.find((t) => t.startsWith("c_"))?.slice(2);
  const w = tokens.find((t) => t.startsWith("w_"))?.slice(2);
  const h = tokens.find((t) => t.startsWith("h_"))?.slice(2);
  const ar = tokens.find((t) => t.startsWith("ar_"))?.slice(3);
  const names: Record<string, string> = { fill: "Crop to fill", fit: "Fit inside", pad: "Pad to", mpad: "Pad (no upscale) to", lpad: "Pad (no upscale) to", scale: "Resize to", crop: "Cut out", limit: "Limit to", thumb: "Thumbnail", auto: "Smart crop to" };
  const size = [w, h].filter(Boolean).join("×") || (ar ? `aspect ${ar}` : "");
  return `${names[mode ?? ""] ?? "Resize"} ${size}`.trim();
}

/**
 * Split any Cloudinary delivery URL into X-ray segments: layer blocks
 * (l_… through fl_layer_apply) stay together, the version and public id
 * become one `asset` segment. Non-Cloudinary URLs come back as one asset.
 */
export function describeTransformation(url: string): BuiltUrl {
  let path: string;
  try {
    const u = new URL(url);
    path = u.pathname;
  } catch {
    path = url;
  }
  const parts = path.split("/").filter(Boolean);
  // /<cloud>/<resource_type>/<delivery_type>/...
  const start = parts.findIndex((p, i) => i >= 1 && ["image", "video", "raw"].includes(p) && parts[i + 1] && /^(upload|fetch|private|authenticated|list|text)$/.test(parts[i + 1]));
  if (start < 0) return { url, transformation: "", segments: [{ text: path, kind: "asset", label: "Source asset" }] };
  const rest = parts.slice(start + 2);

  const segs: XraySegment[] = [];
  let i = 0;
  while (i < rest.length && !/^v\d+$/.test(rest[i]) && isTransformationComponent(rest[i])) {
    const comp = rest[i];
    const tokens = splitTokens(comp);
    const opensLayer = tokens.some((t) => /^(l|u)_/.test(t));
    if (opensLayer) {
      // gather the whole layer block up to and including its fl_layer_apply
      const block = [comp];
      let j = i + 1;
      if (!tokens.includes("fl_layer_apply")) {
        while (j < rest.length && isTransformationComponent(rest[j])) {
          block.push(rest[j]);
          if (splitTokens(rest[j]).includes("fl_layer_apply")) {
            j++;
            break;
          }
          j++;
        }
      }
      const text = block.join("/");
      segs.push({ text, ...classifyLayer(text) });
      i = j;
      continue;
    }
    segs.push({ text: comp, ...classify(comp) });
    i++;
  }
  const transformation = rest.slice(0, i).join("/");
  const leaf = rest.slice(i).join("/");
  if (leaf) segs.push({ text: decodeURIComponent(leaf), kind: "asset", label: /^v\d+\//.test(leaf) ? "Version + source asset" : "Source asset" });
  return { url, transformation, segments: segs };
}
