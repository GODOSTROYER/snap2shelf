<div align="center">

<!-- TODO(final): swap this still for an ~8 s GIF (QR capture → pipeline lights up → kit deals out), hosted on Cloudinary and delivered with f_auto. -->
<a href="https://snap2shelf.vercel.app"><img src="https://res.cloudinary.com/nyxyma1i/image/upload/f_auto,q_auto,w_1200/snap2shelf/spikes/heroes/shoe_diwali" width="440" alt="A white and tan sneaker standing on a teak table with brass diyas and marigold garlands behind it. The sneaker is the real product photo; only the scene is AI-generated."></a>

# Snap2Shelf

**One photo. A whole shelf. AI builds the stage — your product stays real.**

[**Live demo**](https://snap2shelf.vercel.app) · [Demo video](#demo-video) · [How it uses Cloudinary](#cloudinary-feature-map) · [Architecture](#architecture)

[![Live](https://img.shields.io/badge/live-snap2shelf.vercel.app-f5a524?style=flat-square)](https://snap2shelf.vercel.app)
[![Track 2](https://img.shields.io/badge/Track%202-Generative%20Content%20Workflows-2b2118?style=flat-square)](#)
[![Built on Cloudinary](https://img.shields.io/badge/built%20on-Cloudinary-3448c5?style=flat-square)](https://cloudinary.com/documentation)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-111111?style=flat-square)](https://nextjs.org)
[![MIT](https://img.shields.io/badge/license-MIT-4b5563?style=flat-square)](LICENSE)

Entry for **Pixels to Products — Cloudinary AI Hackathon 2026** (HackIndia) · **Track 2 — Generative Content Workflows**

</div>

> [!TIP]
> **Try it in 60 seconds, no signup, nothing to install**
> 1. Open **[snap2shelf.vercel.app](https://snap2shelf.vercel.app)** and press **Try a sample product (no signup)**.
> 2. Watch the pipeline light up: **Fix → Cut out → Stage → Light-match → QA → Pack**.
> 3. Scroll to **Your shelf** and press the code button (**`</>`**) under any image. This X-ray shows the one Cloudinary URL that made it, colour-coded and explained.
> 4. Optional: press **Snap with your phone**, scan the QR code and photograph anything on your desk. It lands on the laptop a few seconds later.
> 5. Live AI generation (Creative mode) is behind an access code, which is in our submission form. Everything else works without it.

<a id="demo-video"></a>
**Demo video:** <!-- TODO(final): paste the YouTube/Loom link (2:45–3:15) --> *coming with the submission.*

---

## Contents

[The problem](#the-problem) · [What it does](#what-it-does) · [Cloudinary feature map](#cloudinary-feature-map) · [Architecture](#architecture) · [Exact, Creative and Blend](#exact-creative-and-blend) · [Scene DNA](#scene-dna) · [The QA gate](#the-qa-gate) · [Cost engineering](#cost-engineering) · [How judges can test](#how-judges-can-test) · [Run it locally](#run-it-locally) · [How we built it with AI](#how-we-built-it-with-ai) · [Security](#security) · [Limitations and roadmap](#limitations-and-roadmap)

## The problem

Small sellers in India list on marketplaces, Instagram and WhatsApp catalogues, often from a phone photo taken on the kitchen table.

- **A proper shoot is expensive and slow.** Studio photography is priced per product and takes days, which doesn't work for a seller adding stock every week.
- **Generic AI image tools change the product.** Ask a model to "put my shoe on a festive table" and it quietly redraws the logo, the colours or the shape. A listing that doesn't match the item that arrives is a returns problem, not a marketing win.
- **Every channel wants a different image.** Marketplaces reject main images that aren't on a pure white background; Stories need 9:16, banners 16:9, catalogues a light square tile. Doing each one by hand is where the evening goes.

## What it does

A seller uploads one photo (or snaps it with their phone through a QR code). Snap2Shelf runs six steps, and each one lights up in the UI as the real Cloudinary call finishes:

| Step | What happens | Cloudinary does the work with |
|---|---|---|
| **1. Fix** | Reads the photo: an alt-text caption, a focus score, and a structured description of the product (name, colour, material, the part a colour variant should change, and whether it stands, lies flat or hangs). <!-- TODO(final): describe auto-retouch if it ships; AnalyzeResponse.fixes.applied is [] today --> | Captioning, `quality_analysis`, AI Vision General |
| **2. Cut out** | Removes the background **once** and saves the trimmed cut-out as its own asset. Every later image reuses it. | `e_background_removal/e_trim/f_png`, Upload API |
| **3. Stage** | Places the **real** cut-out on a scene plate from a shared, pre-generated library, exactly where the scene's surface is (Exact mode), or asks an image model to reshoot the scene around it (Creative mode). | Layers, Image Generation `image_to_image` |
| **4. Light-match** | Casts a shadow away from the scene's light, adds contact shadows where the product touches the surface, a reflection on glossy surfaces, and a subtle warm or cool light-match. | `e_distort`, `e_blur`, `e_multiply`, `e_screen`, `e_tint` |
| **5. QA** | AI Vision checks the result. In Creative mode it compares the product against the original, side by side, and rejects anything that changed. | AI Vision Tagging + General |
| **6. Pack** | Turns the approved hero into every format a seller needs, one zip, a video reel and a shareable shelf. | `b_gen_fill`, `e_gen_recolor`, `l_text`, `e_zoompan` + `fl_splice`, `download_zip_url` |

### One photo, one shelf

Every tile below is a Cloudinary delivery URL. Click one to open the exact URL that renders it.

<table>
<tr>
<td align="center" width="25%"><a href="https://res.cloudinary.com/nyxyma1i/image/upload/f_jpg,q_85/snap2shelf/dev/heroes/sneaker-diwali"><img src="https://res.cloudinary.com/nyxyma1i/image/upload/f_jpg,q_85/snap2shelf/dev/heroes/sneaker-diwali" width="190" alt="Hero: a grey and white sneaker on a teak table in a Diwali scene, with a soft shadow"></a><br><sub><b>Hero / feed 4:5</b><br>layers on a scene plate</sub></td>
<td align="center" width="25%"><a href="https://res.cloudinary.com/nyxyma1i/image/upload/ar_9:16,b_gen_fill,c_pad,w_1080/f_jpg,q_85/snap2shelf/dev/heroes/sneaker-diwali"><img src="https://res.cloudinary.com/nyxyma1i/image/upload/ar_9:16,b_gen_fill,c_pad,w_1080/f_jpg,q_85/snap2shelf/dev/heroes/sneaker-diwali" width="150" alt="The same hero extended upward and downward to a 9:16 story"></a><br><sub><b>Story 9:16</b><br><code>b_gen_fill</code></sub></td>
<td align="center" width="25%"><a href="https://res.cloudinary.com/nyxyma1i/image/upload/c_fit,w_1700,h_1700/c_mpad,w_2000,h_2000,b_white/f_jpg,q_auto:best/snap2shelf/dev/sneaker_decent/cutout"><img src="https://res.cloudinary.com/nyxyma1i/image/upload/c_fit,w_1700,h_1700/c_mpad,w_2000,h_2000,b_white/f_jpg,q_auto:best/snap2shelf/dev/sneaker_decent/cutout" width="190" alt="The sneaker cut-out on a pure white square"></a><br><sub><b>Marketplace 2000 px</b><br>pure white, ~85% fill</sub></td>
<td align="center" width="25%"><a href="https://res.cloudinary.com/nyxyma1i/image/upload/c_crop,g_north_west,x_103,y_297,w_875,h_875/c_scale,w_600,h_600/f_jpg,q_85/snap2shelf/dev/heroes/sneaker-diwali"><img src="https://res.cloudinary.com/nyxyma1i/image/upload/c_crop,g_north_west,x_103,y_297,w_875,h_875/c_scale,w_600,h_600/f_jpg,q_85/snap2shelf/dev/heroes/sneaker-diwali" width="190" alt="A square crop centred on the sneaker for a WhatsApp catalogue"></a><br><sub><b>WhatsApp tile 600 px</b><br>crop centred on the product</sub></td>
</tr>
<tr>
<td align="center" colspan="2"><a href="https://res.cloudinary.com/nyxyma1i/image/upload/ar_16:9,b_gen_fill,c_pad,w_1920/f_jpg,q_85/snap2shelf/dev/heroes/sneaker-diwali"><img src="https://res.cloudinary.com/nyxyma1i/image/upload/ar_16:9,b_gen_fill,c_pad,w_1920/f_jpg,q_85/snap2shelf/dev/heroes/sneaker-diwali" width="400" alt="The same hero widened to a 16:9 web banner"></a><br><sub><b>Web banner 16:9</b> · <code>b_gen_fill</code></sub></td>
<td align="center"><a href="https://res.cloudinary.com/nyxyma1i/image/upload/e_gen_recolor:prompt_suede%20panels;to-color_1e3a8a/f_jpg,q_85/snap2shelf/dev/heroes/sneaker-diwali"><img src="https://res.cloudinary.com/nyxyma1i/image/upload/e_gen_recolor:prompt_suede%20panels;to-color_1e3a8a/f_jpg,q_85/snap2shelf/dev/heroes/sneaker-diwali" width="190" alt="The sneaker with its suede panels recoloured navy"></a><br><sub><b>Colour variant</b><br><code>e_gen_recolor</code> on a part</sub></td>
<td align="center"><a href="https://res.cloudinary.com/nyxyma1i/image/upload/l_snap2shelf:dev:heroes:sneaker-diwali/c_scale,w_900,h_249/co_rgb:1c130c,e_colorize:100/r_28/o_72/fl_layer_apply,g_north_west,x_90,y_48/l_text:Noto%20Sans%20Devanagari@google_84_700:%E0%A4%A6%E0%A4%BF%E0%A4%B5%E0%A4%BE%E0%A4%B2%E0%A5%80%20%E0%A4%B8%E0%A5%87%E0%A4%B2%20%C2%B7%2020%2525%20%E0%A4%9B%E0%A5%82%E0%A4%9F,co_white/c_limit,w_828/fl_layer_apply,g_north,x_0,y_84/l_text:Noto%20Sans@google_44_600:Diwali%20sale%252C%2020%2525%20off%20%252F%20this%20week%20only,co_rgb:ffc56b/c_limit,w_828/fl_layer_apply,g_north,x_0,y_201/f_jpg,q_85/snap2shelf/dev/heroes/sneaker-diwali"><img src="https://res.cloudinary.com/nyxyma1i/image/upload/l_snap2shelf:dev:heroes:sneaker-diwali/c_scale,w_900,h_249/co_rgb:1c130c,e_colorize:100/r_28/o_72/fl_layer_apply,g_north_west,x_90,y_48/l_text:Noto%20Sans%20Devanagari@google_84_700:%E0%A4%A6%E0%A4%BF%E0%A4%B5%E0%A4%BE%E0%A4%B2%E0%A5%80%20%E0%A4%B8%E0%A5%87%E0%A4%B2%20%C2%B7%2020%2525%20%E0%A4%9B%E0%A5%82%E0%A4%9F,co_white/c_limit,w_828/fl_layer_apply,g_north,x_0,y_84/l_text:Noto%20Sans@google_44_600:Diwali%20sale%252C%2020%2525%20off%20%252F%20this%20week%20only,co_rgb:ffc56b/c_limit,w_828/fl_layer_apply,g_north,x_0,y_201/f_jpg,q_85/snap2shelf/dev/heroes/sneaker-diwali" width="190" alt="The hero with a Hindi and English Diwali sale card at the top"></a><br><sub><b>Festive offer</b><br>Hindi + English <code>l_text</code></sub></td>
</tr>
</table>

Plus a **Kit Reel**: <a href="https://res.cloudinary.com/nyxyma1i/image/upload/c_fill,w_720,h_1280,g_center/e_zoompan:du_3;fps_25;from_(zoom_1.0);to_(zoom_1.15)/c_scale,w_720,h_1280/fl_splice,l_snap2shelf:dev:heroes:sneaker-diwali/c_fill,w_720,h_1280,g_center/e_zoompan:du_3;fps_25;from_(zoom_1.2);to_(zoom_1.02)/c_scale,w_720,h_1280/e_fade:400/fl_layer_apply/fl_splice,l_snap2shelf:dev:kit:sneaker-diwali:recolor-1e3a8a/c_fill,w_720,h_1280,g_center/e_zoompan:du_3;fps_25;from_(zoom_1.15;x_0.42);to_(zoom_1.15;x_0.58)/c_scale,w_720,h_1280/e_fade:400/fl_layer_apply/fl_splice,l_snap2shelf:dev:heroes:pouch-jute/c_fill,w_720,h_1280,g_center/e_zoompan:du_3;fps_25;from_(zoom_1.05;y_0.46);to_(zoom_1.2;y_0.54)/c_scale,w_720,h_1280/e_fade:400/fl_layer_apply/l_snap2shelf:dev:kit:sneaker-diwali:story/c_scale,w_619,h_161/co_rgb:1c130c,e_colorize:100/r_22/o_72/fl_layer_apply,g_north,y_77/l_text:Noto%20Sans%20Devanagari@google_54_700:%E0%A4%A6%E0%A4%BF%E0%A4%B5%E0%A4%BE%E0%A4%B2%E0%A5%80%20%E0%A4%B8%E0%A5%87%E0%A4%B2%20%C2%B7%2020%2525%20%E0%A4%9B%E0%A5%82%E0%A4%9F,co_white/c_limit,w_569/fl_layer_apply,g_north,y_102/l_text:Noto%20Sans@google_30_600:Diwali%20sale%252C%2020%2525%20off%20%252F%20this%20week%20only,co_rgb:ffc56b/c_limit,w_569/fl_layer_apply,g_north,y_172/vc_h264,q_auto/snap2shelf/dev/kit/sneaker-diwali/story.mp4">12-second 720×1280 MP4, made by one URL</a> ·
a **zip** of every format (one signed `download_zip_url`) ·
a **shop shelf** at `/shelf/<shop>` with a <a href="https://res.cloudinary.com/nyxyma1i/image/upload/c_fill,w_1200,h_630,g_auto/e_blur:1200/e_brightness:-35/l_snap2shelf:dev:heroes:sneaker-diwali/c_fill,w_272,h_340,g_auto/r_18/fl_layer_apply,g_north_west,x_20,y_250/l_snap2shelf:dev:heroes:bottle-kitchen/c_fill,w_272,h_340,g_auto/r_18/fl_layer_apply,g_north_west,x_316,y_250/l_snap2shelf:dev:heroes:pouch-jute/c_fill,w_272,h_340,g_auto/r_18/fl_layer_apply,g_north_west,x_612,y_250/l_snap2shelf:dev:kit:sneaker-diwali:recolor-1e3a8a/c_fill,w_272,h_340,g_auto/r_18/fl_layer_apply,g_north_west,x_908,y_250/l_text:Noto%20Sans@google_64_700:Meera's%20Home%20Store,co_white/c_limit,w_1080/fl_layer_apply,g_north,y_52/l_text:Noto%20Sans@google_32_500:Shop%20the%20shelf,co_rgb:ffc56b/c_limit,w_1080/fl_layer_apply,g_north,y_150/f_jpg,q_80/snap2shelf/dev/heroes/sneaker-diwali">dynamic 1200×630 link-preview image</a> for WhatsApp. <!-- TODO(final): link a real /shelf/<shop> page and its Readiness Score once the shelf workstream merges. -->

<sub>These tiles come from our development kit, built from a synthetic test photo of a sneaker. <!-- TODO(final): swap to the final showcase kit if it uses different assets. --></sub>

---

## Cloudinary feature map

Cloudinary is the entire backend: storage, image processing, AI, video, search-by-tag and delivery. There is no database and no image server of our own. Each row below does real work in the product.

| # | Cloudinary capability | Where in the code | Exactly what we send |
|---|---|---|---|
| 1 | **Signed uploads** with the Upload Widget and a signed upload preset | [`app/api/sign-upload/route.ts`](app/api/sign-upload/route.ts), [`lib/server/upload-sign.ts`](lib/server/upload-sign.ts), [`scripts/setup-cloudinary.mjs`](scripts/setup-cloudinary.mjs) | `CldUploadWidget signatureEndpoint="/api/sign-upload"`; preset `s2s_ingest`: signed, `overwrite: false`, incoming `c_limit,w_2400,h_2400`, `jpg,jpeg,png,webp,heic` only |
| 2 | **Captioning** (AI Content Analysis) for alt text | [`lib/cloudinary/vision.ts`](lib/cloudinary/vision.ts) `captioning()` | `POST /v2/analysis/{cloud}/analyze/captioning` with `{ "source": { "uri": … } }` |
| 3 | **Quality analysis** | [`lib/server/products.ts`](lib/server/products.ts) | `uploader.explicit(id, { quality_analysis: true })` → `focus` |
| 4 | **AI Vision General**: product JSON, Scene DNA, fidelity verdict | [`lib/server/products.ts`](lib/server/products.ts), [`lib/scene-prompts.ts`](lib/scene-prompts.ts), [`lib/server/qa.ts`](lib/server/qa.ts) | `POST /v2/analysis/{cloud}/analyze/ai_vision_general` with `{ source, prompts: [ … "Return ONLY a JSON object" … ] }`, validated with zod |
| 5 | **AI Vision Tagging**: the QA gate | [`lib/server/qa.ts`](lib/server/qa.ts) | `ai_vision_tagging` with `tag_definitions` such as `product-floating`, `product-redesigned`, `extra-product` |
| 6 | **Image Generation**, `text_to_image`: the scene library | [`scripts/seed-scenes.mts`](scripts/seed-scenes.mts), [`lib/cloudinary/generate.ts`](lib/cloudinary/generate.ts) | `model: { id: "gpt-image-2.5-flare" }` (final) or `{ id: "flux-2-flash" }` (draft), `image_size: { aspect_ratio: "3:4", resolution: "1K" }`, `async: true`, then poll `GET /v2/generate/{cloud}/tasks/{id}` |
| 7 | **Image Generation**, `image_to_image`: Creative mode | [`lib/server/creative.ts`](lib/server/creative.ts) | `reference_images: [{ source_type: "url", url: <versioned cut-out URL> }]`, `model: { id: "nano-banana-2-edit" }`, explicit `seed`, `target: { target_type: "managed_asset" }` |
| 8 | **Background removal**, run once | [`lib/server/products.ts`](lib/server/products.ts) `CUTOUT_CHAIN` | `e_background_removal/e_trim/f_png`, then saved as `snap2shelf/products/<sku>/cutout` |
| 9 | **Layers** with pixel placement | [`lib/transform/composite.ts`](lib/transform/composite.ts) | `l_snap2shelf:products:<sku>:cutout/c_scale,w_583,h_312/…/fl_layer_apply,g_north_west,x_249,y_566` |
| 10 | **Shadows and light-match** built from the product's own silhouette | [`lib/transform/composite.ts`](lib/transform/composite.ts) | `co_rgb:3a2414,e_colorize:100/e_distort:…/c_mpad,…,b_transparent/e_blur:309/e_gradient_fade:40,y_0.7/o_45/e_multiply,fl_layer_apply,fl_no_overflow`, and `e_tint:20:ffa04a`, `e_screen` |
| 11 | **Generative fill** for new aspect ratios | [`lib/transform/channels.ts`](lib/transform/channels.ts) | `ar_9:16,b_gen_fill,c_pad,w_1080` · `ar_16:9,b_gen_fill,c_pad,w_1920` |
| 12 | **Generative recolor** of one part | [`lib/transform/channels.ts`](lib/transform/channels.ts) | `e_gen_recolor:prompt_suede%20panels;to-color_1e3a8a` (the part comes from AI Vision) |
| 13 | **Text overlays** with Google Fonts, including Devanagari | [`lib/transform/channels.ts`](lib/transform/channels.ts) | `l_text:Noto%20Sans%20Devanagari@google_84_700:<UTF-8, with , / % double-encoded>` |
| 14 | **Video from stills**: the Kit Reel | [`lib/transform/reel.ts`](lib/transform/reel.ts) | `e_zoompan:du_3;fps_25;from_(zoom_1.0);to_(zoom_1.15)`, `fl_splice,l_<image>/…/e_fade:400/fl_layer_apply`, `vc_h264,q_auto`, `.mp4` |
| 15 | **Named transformations** | [`lib/transform/named.ts`](lib/transform/named.ts), created by `npm run setup:cloudinary` | `t_s2s_story/f_auto,q_auto`, `t_s2s_marketplace/f_jpg,q_auto:best` (delivery options stay outside the name) |
| 16 | **Tags + contextual metadata** as the database | [`lib/types.ts`](lib/types.ts), [`lib/scenes.ts`](lib/scenes.ts), [`lib/server/cld.ts`](lib/server/cld.ts) | tags `s2s-sku-<sku>`, `s2s-pack-<sku>`, `s2s-scene`; context `dna_ax=0.500`, `qa_status=approved`, `pack_hi=…` |
| 17 | **Client-side resource list** | [`lib/scenes.ts`](lib/scenes.ts), [`app/api/scenes/route.ts`](app/api/scenes/route.ts) | `https://res.cloudinary.com/<cloud>/image/list/s2s-scene.json` (no Admin API call) |
| 18 | **Upload by URL** to save derived images as assets | [`lib/server/pack.ts`](lib/server/pack.ts), [`lib/cloudinary/copy.ts`](lib/cloudinary/copy.ts) | `uploader.upload(<delivery URL>, { public_id, tags, context })` |
| 19 | **Archive** | [`lib/server/pack.ts`](lib/server/pack.ts) `zipUrl()` | `utils.download_zip_url({ tags: ["s2s-pack-<sku>"], flatten_folders: true, expires_at: now + 3600 })` |
| 20 | **Automatic format and quality** everywhere | every URL builder in [`lib/transform/`](lib/transform/) | `f_auto,q_auto`; `f_jpg` where a scraper or AI fetches the image |
| 21 | **Admin usage API** for the quota-aware key pool | [`lib/cloudinary/pool.ts`](lib/cloudinary/pool.ts) | `GET /v1_1/{cloud}/usage` → `image_generation`, `ai_vision`, `object_detection` |
| 22 | **Dynamic OG image** for shared shelves | [`lib/transform/og.ts`](lib/transform/og.ts) | four hero layers with `r_18` over `e_blur:1200/e_brightness:-35`, shop name as `l_text`, `f_jpg` for link scrapers |

<details>
<summary><b>The whole Exact-mode hero is one URL. Here it is, layer by layer.</b></summary>

This is the URL that rendered the hero tile above (from `compositeUrl()` in [`lib/transform/composite.ts`](lib/transform/composite.ts)), split into its layers. In the app, the **X-ray** panel shows the same split with colours and plain-language labels ([`lib/transform/xray.ts`](lib/transform/xray.ts)).

```text
https://res.cloudinary.com/nyxyma1i/image/upload/
  c_fill,w_1080,h_1350                                          ← scene plate at the canonical 4:5 size

  l_snap2shelf:dev:sneaker_decent:cutout/c_scale,w_583,h_312    ← cast shadow: the product's own silhouette…
    /co_rgb:3a2414,e_colorize:100                               ←   …filled with a warm shadow colour
    /e_distort:292:0:875:0:583:52:0:52                          ←   …projected onto the table, away from the light
    /c_crop,g_north_west,x_0,y_0,w_875,h_52
    /c_mpad,w_1055,h_232,b_transparent/e_blur:309               ←   …padded so the blur isn't clipped, then softened
    /e_gradient_fade:40,y_0.7/o_45                              ←   …fading with distance
    /e_multiply,fl_layer_apply,fl_no_overflow,g_north_west,x_159,y_736

  l_…cutout/c_crop,g_south,w_976,h_63/c_scale,w_618,h_58/…/e_blur:400/o_50/e_multiply,…   ← soft ambient pool
  l_…cutout/c_crop,g_south,w_976,h_63/c_scale,w_560,h_24/…/e_blur:200/o_90/e_multiply,…   ← tight contact line

  l_…cutout/c_scale,w_583,h_312/e_tint:20:ffa04a/e_brightness:-9/fl_layer_apply,g_north_west,x_249,y_566
                                                                ← the real product, placed by Scene DNA
  l_…cutout/…/co_rgb:ffb45a,e_colorize:100/e_gradient_fade:30,x_-0.9/o_26/e_screen,…     ← warm key light on the lit side
  l_…cutout/…/co_rgb:3a2414,e_colorize:100/e_gradient_fade:25,x_0.85/o_30/e_multiply,…   ← gentle falloff on the far side

  f_jpg,q_90                                                    ← f_auto,q_auto in the browser; JPEG when saved
  snap2shelf/scenes/diwali/final-59f4388a                       ← the shared scene plate
```

Rules that keep it cheap and correct:

- **Integers only.** Every x, y, w and h is an integer computed from quantised slider values (scale in steps of 0.02, offsets in steps of 10 px). Cloudinary rejects mixed int/float placement, and the same slider position always produces the same URL, so it is billed once.
- **Effects are clipped to their layer box.** A blur or shadow inside `l_…/fl_layer_apply` can't spill outside the layer, so every blurred layer is padded with transparency first. `c_mpad` pads without ever upscaling; `c_pad` would.
- **`fl_no_overflow`** on every layer that could reach past the plate keeps the canvas exactly 1080×1350.
- **Contact shadows use only the product's footprint**: the bottom 12% of the cut-out (`c_crop,g_south`), squashed into a soft pool and a tight line.
- **The shadow is never pure black.** It is multiplied onto the surface in a colour picked by the scene's temperature (`3a2414` warm, `262626` neutral, `1e2533` cool).

**Why not `e_dropshadow`?** Our first version used it. It works inside a layer but is clipped to the layer box (padding with `c_mpad` fixed that), and it reads as a drop shadow behind a sticker rather than a shadow on the table. Same product, same scene, v0 then v1:

<table><tr>
<td align="center"><img src="https://res.cloudinary.com/nyxyma1i/image/upload/c_fill,w_1080,h_1350/l_snap2shelf:dev:sneaker_messy:cutout/c_scale,w_437,h_27/co_black,e_colorize:100/e_blur:150/o_70/fl_layer_apply,g_north_west,x_322,y_958/l_snap2shelf:dev:sneaker_messy:cutout/c_scale,w_497/c_mpad,w_675,h_368,g_north,b_rgb:00000000/e_dropshadow:azimuth_90;elevation_30;spread_45/fl_layer_apply,g_north_west,x_203,y_689/c_scale,w_540/f_jpg,q_85/snap2shelf/scenes/jute/final-eb20e69e" width="260" alt="Version 0: the sneaker on a jute mat with a flat, dark bar of shadow under it; it looks pasted on"><br><sub>v0: <code>e_dropshadow</code> + a black bar</sub></td>
<td align="center"><img src="https://res.cloudinary.com/nyxyma1i/image/upload/c_fill,w_1080,h_1350/l_snap2shelf:dev:sneaker_messy:cutout/c_scale,w_583,h_332/co_rgb:3a2414,e_colorize:100/e_distort:0:0:583:0:893:52:310:52/c_crop,g_north_west,x_0,y_0,w_893,h_52/c_mpad,w_1073,h_232,b_transparent/e_blur:329/e_gradient_fade:40,y_0.7/o_45/e_multiply,fl_layer_apply,fl_no_overflow,g_north_west,x_-151,y_830/l_snap2shelf:dev:sneaker_messy:cutout/c_crop,g_south,w_870,h_59/c_scale,w_618,h_58/co_rgb:3a2414,e_colorize:100/c_mpad,w_758,h_198,b_transparent/e_blur:400/o_50/e_multiply,fl_layer_apply,fl_no_overflow,g_north_west,x_162,y_860/l_snap2shelf:dev:sneaker_messy:cutout/c_crop,g_south,w_870,h_59/c_scale,w_560,h_24/co_rgb:3a2414,e_colorize:100/c_mpad,w_656,h_120,b_transparent/e_blur:200/o_90/e_multiply,fl_layer_apply,fl_no_overflow,g_north_west,x_213,y_909/l_snap2shelf:dev:sneaker_messy:cutout/c_scale,w_583,h_332/e_tint:17:ffa04a/e_brightness:-8/fl_layer_apply,g_north_west,x_249,y_640/l_snap2shelf:dev:sneaker_messy:cutout/c_scale,w_583,h_332/co_rgb:ffb45a,e_colorize:100/e_gradient_fade:30,x_0.9/o_23/e_screen,fl_layer_apply,g_north_west,x_249,y_640/l_snap2shelf:dev:sneaker_messy:cutout/c_scale,w_583,h_332/co_rgb:3a2414,e_colorize:100/e_gradient_fade:25,x_-0.85/o_30/e_multiply,fl_layer_apply,g_north_west,x_249,y_640/c_scale,w_540/f_jpg,q_85/snap2shelf/scenes/jute/final-eb20e69e" width="260" alt="Version 1: the same sneaker, warmed to match the afternoon light, with a soft projected shadow on the jute mat"><br><sub>v1: projected, tinted shadow + light-match</sub></td>
</tr></table>

</details>

<details>
<summary><b>Channel Pack recipes, and the lessons behind them</b></summary>

| Output | Transformation | Notes |
|---|---|---|
| Feed 4:5 | `f_auto,q_auto` on the saved hero | 1080×1350, the plate size |
| Story 9:16 | `ar_9:16,b_gen_fill,c_pad,w_1080` | 6.4 s on first render in our spike, 50 transformations |
| Banner 16:9 | `ar_16:9,b_gen_fill,c_pad,w_1920` | 7.2 s on first render, 50 transformations |
| Marketplace | `c_fit,w_1700,h_1700/c_mpad,w_2000,h_2000,b_white/f_jpg,q_auto:best` on the **cut-out** | `c_mpad`, not `c_pad`: `c_pad` scaled the 1700 px product back up to fill the 2000 px square. With `c_mpad` the product's long side measured 1,697–1,699 px, about 85% |
| WhatsApp tile | `c_crop,g_north_west,x_…,y_…,w_…,h_…/c_scale,w_600,h_600/f_auto,q_auto:eco` | deterministic crop centred on the product box; `c_fill,g_auto` as a fallback |
| Colour variants | `e_gen_recolor:prompt_<part>;to-color_<hex>`, up to 4 | 5.9 s, 50 transformations each |
| Festive offer | the hero itself, blacked out, rounded and 72% opaque as a card, then two `l_text` lines | the card goes in Scene DNA's `text_zone`, constrained so it never covers the product |
| Kit Reel | `e_zoompan` per clip, `fl_splice` to join, `e_fade:400` fade-ups | measured 12.0 s, 720×1280 H.264 for 4 clips × 3 s |

Lessons we paid for:

- **`b_gen_fill` and `e_gen_recolor` need a non-transparent source.** They run on the saved hero, never on the cut-out.
- **Recolor a part, not the whole product.** `e_gen_recolor:prompt_sneaker;to-color_2563eb` flooded the entire shoe with flat blue ([see it](https://res.cloudinary.com/nyxyma1i/image/upload/e_gen_recolor:prompt_sneaker;to-color_2563eb/c_limit,w_1080/f_jpg,q_80/snap2shelf/spikes/heroes/shoe_diwali)). AI Vision now names a recolourable part (`"recolorable_part": "suede panels"`), and only that part changes ([see it](https://res.cloudinary.com/nyxyma1i/image/upload/e_gen_recolor:prompt_suede%20panels;to-color_1e3a8a/f_jpg,q_85/snap2shelf/dev/heroes/sneaker-diwali)).
- **Devanagari needs careful encoding.** Text is UTF-8 percent-encoded once, and literal `,` `/` `%` are encoded twice (`%252C`, `%252F`, `%2525`). Google fonts load by name (`Noto%20Sans%20Devanagari@google_84_700`), with no font upload, and conjuncts shape correctly.
- **`fl_splice` transitions are silently ignored on the image path.** `fl_splice:transition_(name_fade;du_0.6)` is accepted when you build a video from images with `image/upload/…/<id>.mp4`, but the clips hard-cut. Each clip after the first fades up from black with `e_fade:400` instead (a negative `e_fade` blacked the clip out early). `e_zoompan` also picks its own output size, and `fl_splice` refuses clips of different sizes, so every clip is scaled back to 720×1280.
- **Layers must be stored assets.** A reel clip or an OG tile can't reference a derived URL, so pack formats are uploaded back as assets (by URL) before the reel uses them.

</details>

---

## Architecture

<p align="center"><img src="https://res.cloudinary.com/nyxyma1i/image/upload/f_png,w_1600/snap2shelf/docs/architecture" width="880" alt="Architecture diagram. Seller phone and laptop upload photos directly to Cloudinary's Upload API with signatures from Next.js route handlers on Vercel. The route handlers call Cloudinary's Admin, Upload, Analyze and Image Generation APIs; AI calls go through a key pool that can also use two organiser-approved pool environments, whose results are copied into the main environment. Every image, video and zip is delivered back to browsers as a Cloudinary URL."></p>

<sub>The diagram is an SVG ([`docs/architecture.svg`](docs/architecture.svg)) stored in Cloudinary and rasterised on delivery with `f_png,w_1600`. `node --import tsx scripts/docs/upload-diagram.mts` re-uploads it.</sub>

**Where things live.** Every asset sits in one Cloudinary product environment, under predictable public IDs, and its facts live in tags and context, so the client-side list JSON and delivery URLs are most of the "API":

```text
snap2shelf/products/<sku>/raw              original upload             tags: s2s, s2s-raw, s2s-sku-<sku>
snap2shelf/products/<sku>/cutout           trimmed transparent PNG     tags: s2s, s2s-cutout, s2s-sku-<sku>
snap2shelf/products/<sku>/hero-<scene>-<h> approved hero               tags: s2s, s2s-hero, s2s-sku-<sku>
snap2shelf/products/<sku>/creative-<model>-<seed>                      tags: s2s, s2s-creative, s2s-sku-<sku>
snap2shelf/products/<sku>/pack/<format>    materialised channel asset  tags: s2s, s2s-pack, s2s-pack-<sku>
snap2shelf/scenes/<theme>/<tier>-<hash>    1080×1350 scene plate       tags: s2s, s2s-scene, s2s-theme-<theme>, s2s-view-<view>
```

**A request's life, for one product:**

1. The browser asks `POST /api/sign-upload` to sign an upload of `snap2shelf/products/<sku>/raw` and uploads the photo **directly** to Cloudinary. The phone does the same from `/capture`, and the laptop polls until the upload lands. The cheapest reliable check we measured is a `HEAD` on the delivery URL with a fresh version component (`/image/upload/v<n>/<public_id>`): it answered 200 on the first poll, 0.8 s after the upload, because no CDN layer can answer it with a cached 404 ([`lib/capture.ts`](lib/capture.ts)).
2. `POST /api/products/<sku>/analyze` runs captioning, AI Vision and quality analysis in parallel and caches the answers in the raw asset's context, so they never run twice.
3. `POST /api/products/<sku>/cutout` derives `e_background_removal/e_trim/f_png` and saves it. It answers `202` with `retryAfterMs` while Cloudinary is still working (`423`), so no request runs longer than about 10 seconds.
4. The studio builds Exact-mode composite URLs **in the browser** from the cut-out, the scene and Scene DNA. Moving a slider is just a new URL. `POST /api/qa` checks the chosen one.
5. `POST /api/pack` saves the hero by URL, materialises each channel format as a tagged asset, and `GET /api/pack/<sku>` returns a signed zip link once nothing is pending.

---

## Exact, Creative and Blend

| | **Exact** (default) | **Creative** | **Blend** |
|---|---|---|---|
| What the product is | Your real pixels, layered by URL | Redrawn by an image model from your cut-out | <!-- TODO(final): describe if it ships (GenerationMode "blend" exists in lib/types.ts; no implementation yet) --> *in progress* |
| Scene | A shared plate from the scene library | Generated for this take | |
| Generation credits per image | **0** (the plate was generated once, for everyone) | 9 with `nano-banana-2-edit`, 1 with `flux-2-flash-edit` | |
| Model choice | none | explicit picker: **Faithful** `nano-banana-2-edit` or **Fast draft** `flux-2-flash-edit`, plus a seed | |
| QA | "Does it look pasted?" tags on the composite | Reference-vs-candidate **fidelity sheet**, then tags + a verdict | |
| Best for | Marketplace-safe listings, anything with a logo | Lifestyle shots where a small redraw is acceptable | |

Creative requests wrap the seller's scene description in fixed fidelity instructions ([`lib/server/creative.ts`](lib/server/creative.ts)):

```text
Professional e-commerce lifestyle photograph of the EXACT product shown in reference image [1].
Scene: <seller's description, cleaned, max 300 chars>.
The product must stay IDENTICAL to [1]: same shape, proportions, colours, materials, finish, logos, text and every detail.
Do not redesign, restyle, recolour, add or remove any part of the product, and show exactly one product, whole and in focus. …
```

The reference is a **versioned** cut-out URL (`/v<version>/snap2shelf/products/<sku>/cutout`), so the reference can't change under a running job. Jobs run asynchronously; the browser polls `GET /api/jobs/<job>` about every 2 seconds.

---

## Scene DNA

A scene plate is only useful if we know where its table is and where its light comes from. When a plate is added to the library, AI Vision reads it once and returns its **Scene DNA**. This is the real DNA of the Diwali plate behind the hero tiles:

<table><tr>
<td width="40%"><img src="https://res.cloudinary.com/nyxyma1i/image/upload/c_limit,w_540/f_jpg,q_80/snap2shelf/scenes/diwali/final-59f4388a" width="260" alt="An empty teak table in the foreground with brass diyas and marigold garlands softly out of focus behind"></td>
<td>

```json
{
  "anchor_x": 0.5,
  "anchor_y": 0.65,
  "surface_width": 1,
  "light_azimuth": 270,
  "light_elevation": 20,
  "temperature": "warm",
  "glossy": false,
  "text_zone": "none"
}
```

Stored flat in the plate's context, so any client can read it from `image/list/s2s-scene.json`:
`dna_ax=0.500|dna_ay=0.650|dna_sw=1.000|dna_az=270|dna_el=20|dna_temp=warm|dna_gloss=0|dna_text=none`

</td>
</tr></table>

How each field drives the URL ([`lib/transform/composite.ts`](lib/transform/composite.ts), [`lib/transform/channels.ts`](lib/transform/channels.ts)):

| DNA field | Drives | For this plate |
|---|---|---|
| `anchor_x`, `anchor_y` | where the product's base touches the surface → `g_north_west,x_…,y_…` | base at 0.65 × 1350 = y 878; a 583 px-wide sneaker is centred at x 249 |
| `light_azimuth` | the direction the cast shadow falls (`e_distort` corner points) and which side gets the light wash | light from the left (270°), so the shadow falls to the right and the wash comes from the left |
| `light_elevation` | shadow length (low sun = long shadow) and how strongly warm light is pulled in | 20° is low: a long shadow and `e_tint:20:ffa04a/e_brightness:-9` |
| `temperature` | shadow colour and tint | warm → shadow `3a2414`, key light `ffb45a` |
| `glossy` | whether a reflection layer (`a_vflip`, `e_gradient_fade`, `e_blur`) is added | matte teak: no reflection |
| `text_zone` | which band the festive offer card goes in; the product box is the hard constraint | `none` → the roomier band above or below the product |
| `surface_width` | how wide the clear surface is | the whole width |

The prompt that produces it is in [`lib/scene-prompts.ts`](lib/scene-prompts.ts) (`sceneDnaPrompt`). It asks for "ONLY a JSON object" with exactly these keys and describes each one ("0=top, 90=right, 180=bottom, 270=left"); the answer is parsed out of any prose or code fences and validated with zod. In our spike, AI Vision returned valid Scene DNA JSON 2 out of 2 times at about 690 tokens per call.

The scene library itself is 8 themes (Diwali glow, Marble studio, Pastel minimal, Rustic jute, Kitchen counter, Outdoor café, Festive flat-lay, Linen flat-lay) in two fixed camera recipes: eye level for standing products, top-down for garments. Each theme has a draft and a final plate, generated once, normalised to 1080×1350 with an incoming `c_fill`, and checked by AI Vision (`contains-product`, `contains-text`, `contains-person` → the plate is re-tagged `s2s-scene-rejected`).

---

## The QA gate

AI Vision decides whether an image may go into the kit. Tag names must be lower-case letters, digits and hyphens (`product_visible` returns HTTP 400 `MA_00003`), and tagging returns only the tags that matched, with no confidence value. So the rule is written in tags.

**Exact mode** ([`lib/server/qa.ts`](lib/server/qa.ts) `EXACT_TAGS`) asks "does this composite look pasted?"

| Tag | Approve when |
|---|---|
| `product-visible` | **must** match |
| `product-floating`, `scale-implausible`, `compositing-artifact`, `garbled-text`, `unsafe` | **none** may match |

`compositing-artifact` ("a dark or light rectangle… a shadow cut off by a straight line") exists because our v0 shadows produced exactly that.

**Creative mode** compares the generated image with the seller's cut-out. One transformation URL puts both on one sheet, the reference on the left and the candidate on the right:

```text
c_fill,w_512,h_683,g_auto/c_pad,w_1024,h_683,g_east,b_white/l_snap2shelf:products:<sku>:cutout/c_fit,w_480,h_640/fl_layer_apply,g_west,x_16/f_jpg,q_85/<candidate>
```

AI Vision then runs tagging (`same-product`, `product-redesigned`, `extra-product`, `garbled-text`, `unsafe`) and a JSON verdict (`same_product`, `fidelity_score`, `differences`) on that sheet, in parallel, for about 1,000 tokens. **It is rejected if any reject tag matches or the verdict says `same_product: false`, and it is never approved unless the tag or the verdict confirms it is the same product.** The numeric score is shown but not used: it is not calibrated (it gave 85 to the image below that it rejected).

**The real catch.** Same cut-out, same prompt, seed 7, two models:

<table>
<tr>
<td align="center" width="50%"><a href="https://res.cloudinary.com/nyxyma1i/image/upload/c_fill,w_512,h_683,g_auto/c_pad,w_1024,h_683,g_east,b_white/l_snap2shelf:spikes:cutouts:samples_shoe/c_fit,w_480,h_640/fl_layer_apply,g_west,x_16/f_jpg,q_85/snap2shelf/spikes/i2i_main/flux-2-flash-edit"><img src="https://res.cloudinary.com/nyxyma1i/image/upload/c_fill,w_512,h_683,g_auto/c_pad,w_1024,h_683,g_east,b_white/l_snap2shelf:spikes:cutouts:samples_shoe/c_fit,w_480,h_640/fl_layer_apply,g_west,x_16/f_jpg,q_85/snap2shelf/spikes/i2i_main/flux-2-flash-edit" width="400" alt="Fidelity sheet: the reference sneaker on the left; on the right, a generated sneaker in a courtyard with an invented logo badge and a ghost second shoe behind it"></a></td>
<td align="center" width="50%"><a href="https://res.cloudinary.com/nyxyma1i/image/upload/c_fill,w_512,h_683,g_auto/c_pad,w_1024,h_683,g_east,b_white/l_snap2shelf:spikes:cutouts:samples_shoe/c_fit,w_480,h_640/fl_layer_apply,g_west,x_16/f_jpg,q_85/snap2shelf/spikes/i2i_main/nano-banana-2-edit"><img src="https://res.cloudinary.com/nyxyma1i/image/upload/c_fill,w_512,h_683,g_auto/c_pad,w_1024,h_683,g_east,b_white/l_snap2shelf:spikes:cutouts:samples_shoe/c_fit,w_480,h_640/fl_layer_apply,g_west,x_16/f_jpg,q_85/snap2shelf/spikes/i2i_main/nano-banana-2-edit" width="400" alt="Fidelity sheet: the reference sneaker on the left; on the right, the same sneaker, faithfully reproduced, on a sandstone ledge"></a></td>
</tr>
<tr>
<td><b><code>flux-2-flash-edit</code> (1 credit): REJECTED</b><br>matched <code>product-redesigned</code>, <code>extra-product</code>, <code>garbled-text</code><br>verdict: <code>same_product: false</code>, "added side logo badge on AI version", "tongue logo color and design mismatch". It also added a ghost second shoe.</td>
<td><b><code>nano-banana-2-edit</code> (9 credits): APPROVED</b><br>matched <code>same-product</code><br>verdict: <code>same_product: true</code>; the only difference it listed was "lighting and background context".</td>
</tr>
</table>

That is why Creative mode defaults to `nano-banana-2-edit` and labels the cheap model "Fast draft". Every verdict is written to the asset's context (`qa_status`, `qa_matched`, `qa_reasons`), so a result is never checked twice.

---

## Cost engineering

Everything was measured on Cloudinary's Free plan. The spike scripts are in [`scripts/spikes/`](scripts/spikes/) and the measured numbers in [`SPIKES.md`](SPIKES.md).

**Free allowance per product environment:** 50 Image Generation credits, 100,000 AI Vision tokens and 500 AI Content Analysis detections a month, plus 25 transformation credits. `limit: 50` is credits, not images, and the cost per image depends on the model:

| Model (pinned by id) | Used for | Credits per image | Latency (first measured) |
|---|---|---|---|
| `flux-2-flash` | draft scene plates | **1** | 8.7 s |
| `gpt-image-2.5-flare` | final scene plates | **4–5** | 18.8 s |
| `nano-banana-2` | not requested any more; `mode: "auto"` picked it for some library plates | **9–11** | |
| `flux-2-flash-edit` | Creative "Fast draft" | **1** | 7.6 s |
| `nano-banana-2-edit` | Creative "Faithful" (default) | **9** | 16.6 s |

| AI Vision call | Tokens |
|---|---|
| Scene DNA (`ai_vision_general`) | about 690 |
| One tagging pass (`ai_vision_tagging`) | about 535 |
| One fidelity verdict (tags + JSON on the sheet) | about 1,000 |

**The `mode: "auto"` lesson.** Auto model selection is not cost-stable. While seeding the scene library, `preference: "economy_fast"` picked `nano-banana-2` at 9–11 credits for several "1-credit" drafts, and `quality` once picked it instead of `gpt-image-2.5-flare`. The 16 plates cost **72 credits against 48 planned**. Every cost-sensitive call now pins a model id.

What keeps a kit cheap:

| Technique | Effect | Where |
|---|---|---|
| **Exact mode by default** | 0 generation credits per product; the only AI costs are analysis and QA | [`lib/transform/composite.ts`](lib/transform/composite.ts) |
| **Scene reuse by prompt hash** | plates are `snap2shelf/scenes/<theme>/<tier>-<sha1(prompt, tier, seed)>`; the seeder skips any id that exists, so re-running costs 0 credits, and every product reuses the same 16 plates | [`scripts/seed-scenes.mts`](scripts/seed-scenes.mts) |
| **Cut out once** | `e_background_removal` is 75 transformations per use; we run it once per product and save the result, and every composite, the marketplace image and every Creative reference layers that saved asset | [`lib/server/products.ts`](lib/server/products.ts) |
| **Derivatives are billed once** | quantised sliders mean nearby positions share a URL; pack formats (`b_gen_fill` and `e_gen_recolor` are 50 transformations each) are rendered once and saved as tagged assets | [`lib/transform/composite.ts`](lib/transform/composite.ts), [`lib/server/pack.ts`](lib/server/pack.ts) |
| **Analysis is cached in context** | captioning, product JSON, QA verdicts and Scene DNA are stored on the asset and never recomputed | [`lib/server/products.ts`](lib/server/products.ts), [`lib/server/qa.ts`](lib/server/qa.ts) |
| **Named transformations** | `t_s2s_marketplace`, `t_s2s_story`, `t_s2s_banner`, `t_s2s_whatsapp`, `t_s2s_feed` share the verified chains; `channelAssets({ named: true })` switches URLs to them <!-- TODO(final): confirm whether the pack route uses named: true --> | [`lib/transform/named.ts`](lib/transform/named.ts) |
| **`f_auto,q_auto` on delivery** | our spike hero master is 268,847 bytes; with `f_auto,q_auto` a WebP-capable browser gets 87,598 bytes (67% smaller) and a JPEG-only client 118,482 bytes (measured 30 Sep 2026) | every URL builder |

<!-- TODO(final): add the measured cost of one complete kit from the in-app receipt (generation credits, AI Vision tokens, transformations, seconds photo → kit). -->

The spikes themselves used 16 generation credits, about 7,100 AI Vision tokens, 1 detection and 0.30 transformation credits.

### The key pool (disclosed, approved by the organisers)

> [!NOTE]
> Image generation, AI Vision and captioning calls rotate across **three Cloudinary product environments**: our main one plus two extra free environments. **The hackathon organisers approved this.** We disclose it here because it is how a free-plan demo survives a day of judges pressing "generate".

How it works ([`lib/cloudinary/pool.ts`](lib/cloudinary/pool.ts)):

- Each call goes to the environment with the **most quota left** for that capability (`image_generation`, `ai_vision`, `object_detection` for captioning), ties going to main.
- Quota is known from two sources: the Admin API `usage` endpoint (refreshed at most every 10 minutes) and the `limits` block that every generate and analyze response carries (real time). The lower estimate wins.
- An environment is skipped when it would drop below a **floor** (2 generation credits, 2,000 AI Vision tokens, 5 detections), and **benched for an hour** when it answers with a quota or rate-limit error; the call moves on to the next one.
- Every generated image is **copied into the main environment** (upload by URL), where all storage, layering, search and delivery happen.

What never leaves the server: every API key and secret, and the names of the pool environments. `/api/usage` returns pool **totals** only; a Creative job handle is an AES-256-GCM sealed token, so the browser can't read which environment runs it; and [`scripts/e2e-http.mts`](scripts/e2e-http.mts) scans every API response for pool cloud names, pool labels, secrets, the access code and stack traces, and fails if any appears.

---

## How judges can test

| You want to | Do this | Needs |
|---|---|---|
| See the whole flow | **Try a sample product (no signup)** on the home page | nothing |
| Use your own photo | **Upload a photo** in the studio, or **Snap with your phone** and scan the QR code | nothing (Exact mode, QA and Pack are open, with a per-session cap) |
| Generate live with an image model | open **Creative**, enter the access code, pick **Faithful** or **Fast draft** | the **access code from our submission form** |
| Read how an image was made | press the code button (`</>`) under any kit image to open its X-ray | nothing |

Guard rails you may notice: each unlocked session gets **4 live generations**; open AI operations (analyze, cut-out, QA, pack) are capped at **60 per session**; and if the pool's usable generation credits fall below **12**, live generation pauses and the app shows saved examples instead of failing. All three are environment variables (`LIVE_GEN_CAP`, `OPEN_OP_CAP`, `LIVE_GEN_MIN`).

<!-- TODO(final): mention the /present director's cut and /shelf/<shop> here once merged. -->

---

## Run it locally

You need Node.js 20 or newer and a Cloudinary account (the Free plan is enough).

```bash
git clone https://github.com/GODOSTROYER/snap2shelf.git
cd snap2shelf
npm install
cp .env.example .env.local      # fill in your cloud name, API key and secret (see below)
npm run setup:cloudinary        # signed upload preset s2s_ingest + named transformations t_s2s_*
node --conditions=react-server --import tsx scripts/seed-scenes.mts --tiers draft
                                # your own scene library: 8 draft plates, pinned to flux-2-flash (1 credit each)
npm run dev                     # http://localhost:3000
```

In your Cloudinary security settings, make sure **Resource list** is not a restricted delivery type. The scene library is read from `image/list/s2s-scene.json`, and it stays empty if that list is blocked.

<details>
<summary><b>Environment variables</b></summary>

| Variable | Required | What it is |
|---|---|---|
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_CLOUD_NAME` | yes | your cloud name |
| `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | yes | server-only; the secret also derives the keys for the session cookie and job tokens |
| `NEXT_PUBLIC_CLOUDINARY_API_KEY` | yes, for the Upload Widget | the API key (public by design for signed widget uploads; never the secret) <!-- TODO(final): add to .env.example --> |
| `CLOUDINARY_URL` | optional | the same credentials in URL form, for the SDK |
| `CLOUDINARY_POOL_<n>_CLOUD_NAME`, `_API_KEY`, `_API_SECRET` | optional | extra environments for the key pool (generation, AI Vision and captioning only) |
| `DEMO_ACCESS_CODE` | for live generation | the code that unlocks Creative mode |
| `NEXT_PUBLIC_SITE_URL` | yes | e.g. `http://localhost:3000`; used for QR codes and links |
| `LIVE_GEN_CAP`, `LIVE_GEN_MIN`, `OPEN_OP_CAP` | optional | defaults 4, 12 and 60 (see [How judges can test](#how-judges-can-test)) |

</details>

<details>
<summary><b>Scripts</b></summary>

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint`, `npm run typecheck` | ESLint, `tsc --noEmit` |
| `npm run secret-scan` | fails if any private value from `.env.local` appears in a tracked file, the staged diff or git history; prints variable **names** only |
| `npm run setup:cloudinary` | idempotent: upload preset `s2s_ingest`, named transformations from `lib/transform/named.ts` |
| `npm run spikes` | re-runs the Day-0 spikes (spends a little quota) |
| `node scripts/spikes/00-usage.mjs` | reads Admin API usage for every configured environment (free, read-only) |
| `node --conditions=react-server --import tsx --test tests/*.test.mts` | 39 unit tests: key pool, session and signing, SSRF guard, QA rules, URL builders |
| `node --conditions=react-server --import tsx scripts/e2e-pipeline.mts` | live end-to-end run of the pipeline library (upload → analyze → cut-out → composite → QA → pack → zip → one Creative job) |
| `node --conditions=react-server --import tsx scripts/e2e-http.mts` | every route over HTTP against `next dev`, plus negative cases and the pool-name leak scan |
| `node scripts/vercel-env-sync.mjs` | pushes `.env.local` to the linked Vercel project through stdin (values never printed) |
| `npm run seed:showcase` | <!-- TODO(final): the showcase workstream owns scripts/seed-showcase.mjs; describe it once merged --> seeds the showcase kits |

</details>

---

## How we built it with AI

**Starting point: the Cloudinary Next.js AI Starter Kit.** We scaffolded with `npx create-cloudinary-next --headless`, which gave us a Next.js 16 template with Cloudinary wiring, Claude Code configuration and the Cloudinary MCP servers. We hit two bugs on Windows and reported both: <!-- TODO(final): link the two GitHub issues -->

1. The CLI launches `npx` with `spawnSync` and no shell, which fails on Windows with `spawnSync npx ENOENT` (it needs `shell: true` on `win32`).
2. Its Skills Pack installer looked for skills directly under `skills/<name>`, but the pack keeps them in `skills/frameworks/…` and `skills/platform/…` (see the `skillPath` values in [`skills-lock.json`](skills-lock.json)). We installed the pack with `npx skills add cloudinary-devs/skills` instead.

**The Cloudinary Skills Pack** ([cloudinary-devs/skills](https://github.com/cloudinary-devs/skills)) is installed in [`.claude/skills/`](.claude/skills/): `cloudinary-next`, `cloudinary-react`, `cloudinary-transformations` and `cloudinary-docs`. They gave the coding agents Cloudinary's own guidance on signed uploads, `CldUploadWidget` and `CldImage`, transformation syntax and debugging, named transformations and transformation costs (the 75- and 50-transformation figures above come from its cost reference), and a way to look anything else up in the current docs through `llms.txt`.

**Cloudinary MCP servers** are configured in [`.mcp.json`](.mcp.json): `cloudinary-asset-mgmt` and `cloudinary-env-config`. <!-- TODO(final): say what they were used for, if anything specific. -->

**Claude Code (Claude Opus 5.5) as the lead engineer of a small parallel team.** One lead session wrote the contracts first ([`lib/types.ts`](lib/types.ts), [`lib/api-contract.ts`](lib/api-contract.ts)) and ran Day-0 spikes against the live APIs so every later decision was based on measured numbers ([`SPIKES.md`](SPIKES.md)). It then briefed sub-agents, each in its own git worktree and branch, working in parallel: the pipeline and API routes, the transformations, the UI, the shop shelf, the presentation route, the showcase and these docs. The lead reviewed and merged each branch. Commits are co-authored by Claude, and `npm run secret-scan` runs before every commit.

**Models inside the app:** `flux-2-flash` and `gpt-image-2.5-flare` (scene plates), `nano-banana-2-edit` and `flux-2-flash-edit` (Creative mode), Cloudinary AI Vision (product JSON, Scene DNA, QA), Cloudinary captioning (alt text), plus Cloudinary's generative fill and generative recolor inside transformations.

---

## Security

- **Signed uploads with an allowlist.** `/api/sign-upload` signs only `timestamp`, `source`, `upload_preset` (must be `s2s_ingest`), `public_id` (must match `^snap2shelf/products/[a-z0-9]{8}/raw$`), known tags and two context keys, with a 10-minute clock-skew limit. The preset itself is signed, never overwrites, caps images at 2400 px and accepts image formats only. ([`lib/server/upload-sign.ts`](lib/server/upload-sign.ts))
- **Server-only secrets.** Credentials are read only in `server-only` modules and passed per call; no SDK is configured globally in the app, and error responses never include upstream details.
- **SSRF and cost-abuse guard.** Any image URL a client sends (QA, pack) must be an `https://res.cloudinary.com/<our cloud>/image/upload/…` URL for one of our own public ID prefixes, with no query, no userinfo and no `..`, and it may not contain remote-fetch layers (`l_fetch:`), generative effects (`e_gen_*`, `b_gen_fill`), background removal or `fl_attachment`. ([`lib/server/guard.ts`](lib/server/guard.ts))
- **Sealed job tokens.** A Creative job handle is AES-256-GCM encrypted and authenticated, and expires after 2 hours. ([`lib/server/job-token.ts`](lib/server/job-token.ts))
- **Access code, caps and a quota floor.** Live generation needs the access code (constant-time comparison, with a delay on wrong guesses), an HMAC-signed httpOnly session cookie counts generations and open operations, and the pool floor switches the app to the showcase before quota runs out. ([`lib/server/session.ts`](lib/server/session.ts), [`app/api/access/route.ts`](app/api/access/route.ts))
- **Secret scan before every push.** [`scripts/secret-scan.mjs`](scripts/secret-scan.mjs) checks every private value from `.env.local` against tracked files, the staged diff and the full git history, plus generic credential patterns.

---

## Limitations and roadmap

- **Visual Search isn't available on the Free plan** (the docs list it as Enterprise-only, and nothing is indexed), so scene reuse uses prompt-hash public IDs and theme tags instead of "find a similar scene".
- **Quality analysis returns only `focus` on the Free plan**, so the Fix step can't grade exposure or noise yet. <!-- TODO(final): update if auto-retouch ships. -->
- **Captioning via `explicit(..., { detection: "captioning" })` returned no caption for an existing asset**; we call the Analyze API endpoint instead.
- **Light-match nudges the product's colours slightly** (a gentle `e_tint` toward the scene's light). It is a toggle, and the marketplace image always uses the untouched cut-out.
- **Pool state is per server instance** on serverless, and the Admin `usage` numbers are recomputed only about once a day; the real-time `limits` block in each response covers the gap, and the worst case is one quota error that benches an environment.
- **Blend mode** is typed but not shipped. <!-- TODO(final) -->
- **Next:** `notification_url` webhooks instead of polling for generation jobs; structured metadata instead of free-form context; per-channel compliance checks (for example, a marketplace-specific white-background test); more Indian languages through Noto fonts.

---

## License

[MIT](LICENSE). Portions of the template are © Cloudinary Developers (create-cloudinary-next).

## Acknowledgements

- **HackIndia** for running Pixels to Products, and for approving the disclosed key pool.
- **Cloudinary** for the platform, the Next.js AI Starter Kit, the Skills Pack and the MCP servers, and the DevRel team for judging.
- Google Fonts' **Noto Sans** and **Noto Sans Devanagari**, which Cloudinary renders straight from a URL.
