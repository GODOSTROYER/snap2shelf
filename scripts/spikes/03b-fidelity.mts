// Spike 3b: fidelity QA. Copy each image_to_image result into main (copyToMain), build a
// side-by-side "reference | candidate" sheet as a pure Cloudinary transformation, then ask
// AI Vision (tagging + general JSON) whether the candidate is the same product.
import { appendFileSync } from "node:fs";
import { z } from "zod";
import { loadEnv } from "../lib/env.mjs";
import { lastUrl } from "../lib/spike-log.mjs";

loadEnv();
const { getAccounts, getMainAccount } = await import("../../lib/cloudinary/accounts.ts");
const { copyToMain } = await import("../../lib/cloudinary/copy.ts");
const pool = await import("../../lib/cloudinary/pool.ts");
const { visionTagging, visionGeneral, parseJsonAnswer } = await import("../../lib/cloudinary/vision.ts");

const main = getMainAccount();
const i2iAccount = (m: string) => getAccounts().find((a) => lastUrl((r: { spike: string; requested_model: string }) => r.spike === "02-i2i" && r.requested_model === m, m).includes(`/${a.cloudName}/`))!;
const cutoutLayer = "snap2shelf:spikes:cutouts:samples_shoe";
const candidates = [
  { model: "flux-2-flash-edit", url: lastUrl((r: { spike: string; requested_model: string }) => r.spike === "02-i2i" && r.requested_model === "flux-2-flash-edit", "flux-2-flash-edit") },
  { model: "nano-banana-2-edit", url: lastUrl((r: { spike: string; requested_model: string }) => r.spike === "02-i2i" && r.requested_model === "nano-banana-2-edit", "nano-banana-2-edit") },
];

const FIDELITY_TAGS = [
  { name: "same-product", description: "The product on the RIGHT half is the same product as the reference product on the LEFT half: same shape, same colours, same materials and the same details." },
  { name: "product-redesigned", description: "The product on the RIGHT differs from the LEFT reference: colours changed, logos or badges added/removed/changed, shape altered, or parts missing or added." },
  { name: "extra-product", description: "The RIGHT half shows more than one copy of the product, or a fragment of a second product." },
  { name: "garbled-text", description: "The RIGHT half contains unreadable, misspelled or fake-looking letters, text or logos." },
];
const verdictSchema = z.object({
  same_product: z.boolean(),
  fidelity_score: z.number().min(0).max(100),
  differences: z.array(z.string()).max(8),
});
const VERDICT_PROMPT = `The LEFT half of this image is a reference product photo. The RIGHT half is an AI-generated photo that must show the exact same product.
Compare them carefully (shape, colours, logos/badges, materials, parts, count). Return ONLY JSON:
{"same_product": boolean, "fidelity_score": 0-100, "differences": ["short phrase", ...]}`;

for (const c of candidates) {
  const t0 = Date.now();
  const copied = await copyToMain(i2iAccount(c.model), { secure_url: c.url }, {
    public_id: `snap2shelf/spikes/i2i_main/${c.model}`,
    tags: ["s2s", "spike", "creative"],
    context: { model_id: c.model },
  });
  const copyMs = Date.now() - t0;
  const baseId = copied.public_id;
  // Candidate on the right (512x683), canvas padded to 1024 wide, reference cutout fitted into the left half.
  const sheet =
    `https://res.cloudinary.com/${main.cloudName}/image/upload/` +
    `c_fill,w_512,h_683,g_auto/c_pad,w_1024,h_683,g_east,b_white/` +
    `l_${cutoutLayer}/c_fit,w_480,h_640/fl_layer_apply,g_west,x_16/f_jpg,q_85/${baseId}`;
  const warm = await fetch(sheet);
  await warm.arrayBuffer();

  const t1 = Date.now();
  const [tags, verdict] = await Promise.all([
    pool.withPooledAccount("ai_vision", (a) => visionTagging(a, { uri: sheet }, FIDELITY_TAGS)),
    pool.withPooledAccount("ai_vision", (a) => visionGeneral(a, { uri: sheet }, [VERDICT_PROMPT])),
  ]);
  const rec = {
    spike: "03b-fidelity",
    at: new Date().toISOString(),
    model: c.model,
    copied: copied.copied,
    copy_ms: copyMs,
    sheet_http: warm.status,
    sheet,
    qa_ms: Date.now() - t1,
    matched: tags.result.matched,
    verdict: parseJsonAnswer(verdict.result.answers[0], verdictSchema),
    raw: verdict.result.answers[0].slice(0, 300),
    tokens: (tags.result.quota?.usedByRequest ?? 0) + (verdict.result.quota?.usedByRequest ?? 0),
  };
  appendFileSync("scripts/spikes/out/usage-log.jsonl", JSON.stringify(rec) + "\n");
  console.log(JSON.stringify(rec, null, 2));
}
