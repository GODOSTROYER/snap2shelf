import "server-only";
import { z } from "zod";
import { withPooledAccount } from "../cloudinary/pool";
import { parseJsonAnswer, visionGeneral, visionTagging, type TagDefinition } from "../cloudinary/vision";
import { layerId } from "../transform/composite";
import type { QaResult, Sku } from "../types";
import { deliveryUrl, probe } from "./cld";
import { HttpError } from "./http";
import { pinJpeg } from "./guard";
import { prebuiltQa } from "./prebuilt";
import { cutoutId } from "./products";

/**
 * AI Vision QA gate.
 *  exact    — the composite (real cutout on a scene): does it look pasted/wrong?
 *  creative — reference-vs-candidate sheet (SPIKES.md §3b): is it still the same product?
 * Tag names: lower-case letters, digits and hyphens only (the API rejects underscores).
 */

export const EXACT_TAGS: TagDefinition[] = [
  { name: "product-visible", description: "One physical product is clearly visible, in focus, and not cut off by the image edges." },
  {
    name: "product-floating",
    description:
      "The product clearly hovers in the air: there is a visible gap of background between the bottom of the product and the surface it should rest on, or it is placed off the surface entirely (e.g. in the sky or on a wall).",
  },
  { name: "scale-implausible", description: "The product's size is clearly implausible for the scene, e.g. a bottle as tall as a lamp post or a shoe smaller than a coin next to props." },
  { name: "garbled-text", description: "The image contains unreadable, misspelled, nonsensical or fake-looking AI-generated text, letters or logos." },
  { name: "unsafe", description: "The image contains nudity, violence, weapons, drugs, or offensive symbols." },
  {
    name: "compositing-artifact",
    description:
      "There is an obvious editing artifact: a dark or light rectangle, box or band with a straight hard edge (for example a shadow cut off by a straight vertical or horizontal line), a visible halo or outline around the product, or a sharp seam that does not belong to the scene.",
  },
];

const EXACT_REJECT: Record<string, string> = {
  "compositing-artifact": "There is a visible editing artifact (for example a cut-off shadow box). Try turning the cast shadow off or moving the product.",
  "product-floating": "The product looks like it is floating or pasted on. Try moving it down or turning on the contact shadow.",
  "scale-implausible": "The product's size looks implausible for this scene. Try a smaller or larger scale.",
  "garbled-text": "The image contains garbled text or fake logos.",
  unsafe: "The image may contain unsafe content.",
};

export const FIDELITY_TAGS: TagDefinition[] = [
  { name: "same-product", description: "The product on the RIGHT half is the same product as the reference product on the LEFT half: same shape, same colours, same materials and the same details." },
  { name: "product-redesigned", description: "The product on the RIGHT differs from the LEFT reference: colours changed, logos or badges added/removed/changed, shape altered, or parts missing or added." },
  { name: "extra-product", description: "The RIGHT half shows more than one copy of the product, or a fragment of a second product." },
  { name: "garbled-text", description: "The RIGHT half contains unreadable, misspelled or fake-looking letters, text or logos." },
  { name: "unsafe", description: "The RIGHT half contains nudity, violence, weapons, drugs, or offensive symbols." },
];

const FIDELITY_REJECT: Record<string, string> = {
  "product-redesigned": "The AI changed the product's design.",
  "extra-product": "The AI added a second copy or fragment of the product.",
  "garbled-text": "The image contains garbled text or fake logos.",
  unsafe: "The image may contain unsafe content.",
};

const verdictSchema = z.object({
  same_product: z.boolean(),
  fidelity_score: z.number().min(0).max(100),
  differences: z.array(z.string().max(120)).max(8).default([]),
});

const VERDICT_PROMPT = `The LEFT half of this image is a reference product photo. The RIGHT half is an AI-generated photo that must show the exact same product.
Compare them carefully (shape, colours, logos/badges, materials, parts, count). Return ONLY JSON:
{"same_product": boolean, "fidelity_score": 0-100, "differences": ["short phrase", ...]}`;

export interface QaOutcome {
  qa: QaResult;
  tokens: number;
  sheetUrl?: string;
}

/**
 * Is this delivery path an image of `sku`: one of its stored assets, or a composite
 * with its cutout as a layer? Decides which product's cost ledger QA tokens go to.
 */
export function imageOfProduct(sku: Sku, pathname: string): boolean {
  let p = pathname;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  return p.includes(`/snap2shelf/products/${sku}/`) || p.includes(`l_${layerId(`snap2shelf/products/${sku}/`)}`);
}

/** Make sure Cloudinary can render the URL before AI Vision fetches it (and fail fast on a bad one). */
async function ensureRenderable(url: string, budgetMs = 8000): Promise<void> {
  const p = await probe(url, budgetMs);
  if (p.status === 200) return;
  if (p.status === 423 || p.status === 420 || p.status === 429 || p.status === 0) throw new HttpError(202, "pending", "The image is still rendering, try again shortly.", 2000);
  throw new HttpError(400, "bad_request", "That image could not be rendered.");
}

export function decideExact(matched: string[]): QaResult {
  const reasons: string[] = [];
  if (!matched.includes("product-visible")) reasons.push("The product isn't clearly visible.");
  for (const t of matched) if (EXACT_REJECT[t]) reasons.push(EXACT_REJECT[t]);
  return { status: reasons.length ? "rejected" : "approved", matched, reasons, checkedAt: new Date().toISOString() };
}

export function decideFidelity(matched: string[], verdict: z.infer<typeof verdictSchema> | null): QaResult {
  const reasons: string[] = [];
  for (const t of matched) if (FIDELITY_REJECT[t]) reasons.push(FIDELITY_REJECT[t]);
  if (verdict && !verdict.same_product) reasons.push(...(verdict.differences.length ? verdict.differences : ["It no longer looks like the same product."]));
  if (!matched.includes("same-product") && !(verdict?.same_product ?? false)) {
    if (!reasons.length) reasons.push("Couldn't confirm it is the same product.");
  }
  // The numeric score is informative only (SPIKES.md §3b: it isn't calibrated).
  return {
    status: reasons.length ? "rejected" : "approved",
    matched,
    reasons: [...new Set(reasons)].slice(0, 6),
    fidelity: verdict ? Math.round(verdict.fidelity_score) : undefined,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Exact-QA verdicts by composite URL (this instance, 6 h): the same URL is the
 * same image, so asking again (sample runs, "Update kit" with nothing changed)
 * costs no AI Vision tokens. Showcase composites answer from their recorded verdict.
 */
const EXACT_TTL_MS = 6 * 3_600_000;
const exactVerdicts = new Map<string, { qa: QaResult; at: number }>();

export async function exactQa(url: string): Promise<QaOutcome> {
  // q_90 JPEG: the very derivative POST /api/pack saves as the hero, so QA and pack share it.
  const fetchable = pinJpeg(url, "q_90");
  const recorded = prebuiltQa(url);
  if (recorded) return { qa: recorded, tokens: 0 };
  const hit = exactVerdicts.get(fetchable);
  if (hit && Date.now() - hit.at < EXACT_TTL_MS) return { qa: hit.qa, tokens: 0 };
  await ensureRenderable(fetchable);
  const { result } = await withPooledAccount("ai_vision", (a) => visionTagging(a, { uri: fetchable }, EXACT_TAGS));
  const qa = decideExact(result.matched);
  exactVerdicts.delete(fetchable);
  exactVerdicts.set(fetchable, { qa, at: Date.now() });
  if (exactVerdicts.size > 300) exactVerdicts.delete(exactVerdicts.keys().next().value as string);
  return { qa, tokens: result.quota?.usedByRequest ?? 0 };
}

/** Reference cutout (left) next to the candidate (right) as one transformation URL. */
export function fidelitySheetUrl(sku: Sku, candidatePublicId: string): string {
  const L = layerId(cutoutId(sku));
  return deliveryUrl(
    candidatePublicId,
    `c_fill,w_512,h_683,g_auto/c_pad,w_1024,h_683,g_east,b_white/l_${L}/c_fit,w_480,h_640/fl_layer_apply,g_west,x_16/f_jpg,q_85`,
  );
}

/**
 * `renderBudgetMs`: how long to wait for the sheet's derivation before answering 202 pending
 * (the creative job poll passes a short budget and simply asks again on its next poll).
 */
export async function fidelityQa(sku: Sku, candidatePublicId: string, opts: { renderBudgetMs?: number } = {}): Promise<QaOutcome> {
  const sheetUrl = fidelitySheetUrl(sku, candidatePublicId);
  await ensureRenderable(sheetUrl, opts.renderBudgetMs);
  const [tags, verdict] = await Promise.all([
    withPooledAccount("ai_vision", (a) => visionTagging(a, { uri: sheetUrl }, FIDELITY_TAGS)),
    withPooledAccount("ai_vision", (a) => visionGeneral(a, { uri: sheetUrl }, [VERDICT_PROMPT])),
  ]);
  const v = parseJsonAnswer(verdict.result.answers[0] ?? "", verdictSchema);
  return {
    qa: decideFidelity(tags.result.matched, v),
    tokens: (tags.result.quota?.usedByRequest ?? 0) + (verdict.result.quota?.usedByRequest ?? 0),
    sheetUrl,
  };
}

/** QA result <-> flat context strings, so a finished verdict is never recomputed. */
export function qaToContext(q: QaResult): Record<string, string> {
  return {
    qa_status: q.status,
    qa_matched: q.matched.join(","),
    qa_reasons: q.reasons.join(" ; ").slice(0, 800),
    ...(q.fidelity !== undefined ? { qa_fidelity: String(q.fidelity) } : {}),
    qa_at: q.checkedAt ?? new Date().toISOString(),
  };
}

export function qaFromContext(c: Record<string, string>): QaResult | null {
  if (c.qa_status !== "approved" && c.qa_status !== "rejected") return null;
  const fidelity = Number(c.qa_fidelity);
  return {
    status: c.qa_status,
    matched: c.qa_matched ? c.qa_matched.split(",") : [],
    reasons: c.qa_reasons ? c.qa_reasons.split(" ; ") : [],
    fidelity: c.qa_fidelity && Number.isFinite(fidelity) ? fidelity : undefined,
    checkedAt: c.qa_at,
  };
}
