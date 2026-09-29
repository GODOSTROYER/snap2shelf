// Spikes 5, 7, 8 + archive check.
//  5: save the approved composite as a hero asset; b_gen_fill 9:16 + 16:9, e_gen_recolor, Devanagari l_text (Google font)
//  7: client-side tag list  res.cloudinary.com/<cloud>/image/list/<tag>.json  (needs "Resource list" unrestricted)
//  8: Visual Search by text (docs say Enterprise only)
//  +: zip via a signed download_zip_url (free plans block ZIP delivery unless enabled)
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { v2 as cloudinary } from "cloudinary";
import { loadEnv } from "../lib/env.mjs";

loadEnv();
const { getMainAccount, basicAuth } = await import("../../lib/cloudinary/accounts.ts");
const main = getMainAccount();
const auth = { cloud_name: main.cloudName, api_key: main.apiKey, api_secret: main.apiSecret };
const VIEW = process.env.SPIKE_VIEW_DIR ?? "scripts/spikes/out/view";
mkdirSync(VIEW, { recursive: true });
const B = `https://res.cloudinary.com/${main.cloudName}/image/upload`;
const log = (rec: Record<string, unknown>) => {
  appendFileSync("scripts/spikes/out/usage-log.jsonl", JSON.stringify({ at: new Date().toISOString(), ...rec }) + "\n");
  console.log(JSON.stringify(rec));
};

/** Fetch a derived URL, retrying while Cloudinary answers 423 (AI derivation still processing). */
async function derive(name: string, url: string, save = true) {
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    if (res.status === 423 || res.status === 420) {
      await new Promise((r) => setTimeout(r, 2500));
      continue;
    }
    if (res.ok && save) writeFileSync(`${VIEW}/${name}`, buf);
    log({ spike: "05", step: name, http: res.status, ms: Date.now() - t0, bytes: buf.length, type: res.headers.get("content-type"), cld_error: res.headers.get("x-cld-error"), url });
    return res.status;
  }
  log({ spike: "05", step: name, http: 423, ms: Date.now() - t0, note: "still processing after retries", url });
  return 423;
}

// Hero = the tuned Exact composite (spike 4, variant J), saved once as an asset.
const L = "snap2shelf:spikes:cutouts:samples_shoe_trim";
const composite =
  `${B}/c_fill,w_1080,h_1350/` +
  `l_${L}/c_scale,w_440,h_26/co_black,e_colorize:100/e_blur:150/o_70/fl_layer_apply,g_north_west,x_318,y_862/` +
  `l_${L}/c_scale,w_497/c_mpad,w_657,h_488,g_north,b_rgb:00000000/e_dropshadow:azimuth_315;elevation_50;spread_45/fl_layer_apply,g_north_west,x_212,y_510/` +
  `f_jpg,q_90/snap2shelf/spikes/scenes/diwali_teak_42`;
const heroId = "snap2shelf/spikes/heroes/shoe_diwali";
try {
  await cloudinary.api.resource(heroId, auth);
} catch {
  await cloudinary.uploader.upload(composite, { ...auth, public_id: heroId, overwrite: false, tags: ["s2s", "hero", "spike", "s2s-spike-list"] });
}
log({ spike: "05", step: "hero-saved", public_id: heroId });

// 5. generative channel formats + recolor + Hindi overlay
await derive("ch_story_9x16.jpg", `${B}/ar_9:16,b_gen_fill,c_pad,w_1080/f_jpg,q_80/${heroId}`);
await derive("ch_banner_16x9.jpg", `${B}/ar_16:9,b_gen_fill,c_pad,w_1920/f_jpg,q_80/${heroId}`);
await derive("ch_recolor_blue.jpg", `${B}/e_gen_recolor:prompt_sneaker;to-color_2563eb/c_limit,w_1080/f_jpg,q_80/${heroId}`);
const hindi = encodeURIComponent("दिवाली सेल"); // UTF-8 percent-encoded once
const offer = encodeURIComponent("20% छूट").replace(/%25/g, "%2525"); // double-encode the literal %
await derive(
  "ch_hindi_offer.jpg",
  `${B}/c_fill,w_1080,h_1350/` +
    `l_text:Noto%20Sans%20Devanagari@google_88_700:${hindi},co_white/fl_layer_apply,g_north,y_70/` +
    `l_text:Noto%20Sans%20Devanagari@google_64_700:${offer},co_rgb:f5a524/fl_layer_apply,g_north,y_190/` +
    `f_jpg,q_80/${heroId}`,
);
await derive("ch_amazon_white.jpg", `${B}/c_fit,w_1700,h_1700/c_pad,w_2000,h_2000,b_white/f_jpg,q_auto:best/snap2shelf/spikes/cutouts/samples_shoe_trim`);

// 7. client-side list by tag (freshly tagged asset may take up to 60 s to appear)
{
  const url = `https://res.cloudinary.com/${main.cloudName}/image/list/s2s-spike-list.json`;
  const res = await fetch(url);
  const text = await res.text();
  log({ spike: "07-list", http: res.status, cld_error: res.headers.get("x-cld-error"), cache_control: res.headers.get("cache-control"), body: text.slice(0, 300) });
}

// 8. Visual Search by text
{
  const res = await fetch(`https://api.cloudinary.com/v1_1/${main.cloudName}/resources/visual_search?text=${encodeURIComponent("wooden table with brass lamps")}`, {
    headers: { Authorization: basicAuth(main) },
  });
  log({ spike: "08-visual-search", http: res.status, body: (await res.text()).slice(0, 300) });
}

// + archive: signed download URL (not stored), then check whether ZIP delivery is allowed
{
  const zipUrl = cloudinary.utils.download_zip_url({ ...auth, public_ids: [heroId, "snap2shelf/spikes/cutouts/samples_shoe_trim"], resource_type: "image" });
  const res = await fetch(zipUrl);
  const buf = Buffer.from(await res.arrayBuffer());
  log({ spike: "05-zip", http: res.status, type: res.headers.get("content-type"), bytes: buf.length, cld_error: res.headers.get("x-cld-error"), zip_magic: buf.subarray(0, 2).toString() === "PK" });
}
