<div align="center">

# Snap2Shelf

**One photo. A whole shelf. AI builds the stage — your product stays real.**

<a href="https://snap2shelf.vercel.app/studio?sample=shmessy1"><img src="docs/media/demo.gif" width="800" alt="Screen recording of the live site, looping. In the studio, a sample photo of a steel water bottle on a cluttered kitchen counter (an AI-generated test image, not a real seller's photo) goes through the pipeline rail: the bottle is cut out and placed on a marble scene, Scene DNA marks the surface and the light, and the AI Vision QA gate flags the bottle as floating; the studio sets it lower, checks again and approves it. The kit's formats deal onto a shelf, the X-ray panel shows the single colour-coded Cloudinary URL that renders the hero, and the Demo Studio shop page shows four sample products on one Diwali scene."></a>

<sub>Recorded from the live site with <code>npm run media:gif</code>: the studio's sample replay (no API calls), the X-ray, and the demo shop. The input photo is an AI-generated test image. Also as an <a href="docs/media/demo-social.mp4">MP4</a>.</sub>

[**Live demo**](https://snap2shelf.vercel.app) · [**Demo storefront**](https://snap2shelf.vercel.app/shelf/demo-studio) · [**Director's cut**](https://snap2shelf.vercel.app/present) · [Video](#demo-video) · [How it's built](#how-its-built)

[![Live](https://img.shields.io/badge/live-snap2shelf.vercel.app-f5a524?style=flat-square)](https://snap2shelf.vercel.app) ![Track 2](https://img.shields.io/badge/Track%202-Generative%20Content%20Workflows-2b2118?style=flat-square) [![Built on Cloudinary](https://img.shields.io/badge/built%20on-Cloudinary-3448c5?style=flat-square)](https://cloudinary.com/documentation) [![Next.js 16](https://img.shields.io/badge/Next.js-16-111111?style=flat-square)](https://nextjs.org) [![MIT](https://img.shields.io/badge/license-MIT-4b5563?style=flat-square)](LICENSE)

Entry for **Pixels to Products — Cloudinary AI Hackathon 2026** (HackIndia) · **Track 2 — Generative Content Workflows**

</div>

> [!TIP]
> **Try it in a minute: no signup, nothing to install**
> 1. **Watch a real run:** open **[a sample kit in the studio](https://snap2shelf.vercel.app/studio?sample=shmessy1)**. The pipeline lights up (**Fix → Cut out → Stage → Light-match → QA → Pack**), the QA gate catches a floating placement and fixes it, and the kit deals out. It is a replay of a recorded live run, so it makes no API calls.
> 2. **X-ray any image:** press **See the URL** on the stage, or the code button (**`</>`**) under any asset on the shelf, to see the one Cloudinary URL that made it, colour-coded and explained.
> 3. **Open the storefront:** **[/shelf/demo-studio](https://snap2shelf.vercel.app/shelf/demo-studio)** is a shop page built by Collection mode. Press **Share on WhatsApp**; the link preview is a 1200×630 collage made by one transformation URL.
> 4. **Watch the director's cut:** **[/present](https://snap2shelf.vercel.app/present)** tells the whole story chapter by chapter (→ or Space for the next one, P for autoplay).
> 5. **Use your own product:** **Upload a photo** in the studio, or press **Snap with your phone** and scan the QR code. On the live site we measured **36 s photo → ZIP** (30 Sep 2026). Live AI generation (Creative mode and new scenes) needs the access code in our submission form; everything else is open.

<a id="demo-video"></a>
**Video: coming Sat 3 Oct.** <!-- TODO(video): add YouTube link --> The three-minute walkthrough follows the [director's cut](https://snap2shelf.vercel.app/present), which you can already play chapter by chapter.

> [!NOTE]
> **About the sample photos.** Every sample product in this README, in the studio's samples and on `/shelf/demo-studio` starts from an **AI-generated test photo**, not a real seller's photo. The samples show what the pipeline does: in every Exact-mode kit, the product pixels are the input photo's own pixels, cut out and layered, never redrawn. Only the stage is AI-generated. Upload your own photo to see your product.

---

## Contents

[The problem](#the-problem) · [What it does](#what-it-does) · [How it's built](#how-its-built) ([feature map](#cloudinary-feature-map), [architecture](#architecture)) · [Exact and Creative](#exact-and-creative) · [Brief bar](#brief-bar-and-festival-presets) · [Scene DNA](#scene-dna) · [The QA gate](#the-qa-gate) · [Readiness Score](#readiness-score) · [Cost engineering](#cost-engineering) · [Built for a free plan](#built-for-a-free-plan) · [How judges can test](#how-judges-can-test) · [Run it locally](#run-it-locally) · [How we built it with AI](#how-we-built-it-with-ai) · [Security](#security) · [Limitations and roadmap](#limitations-and-roadmap)

## The problem

Small sellers in India list on marketplaces, Instagram and WhatsApp catalogues, often from a phone photo taken on the kitchen table.

- **A proper shoot is expensive and slow.** We estimate a basic studio shoot at about **₹2,500 per product** (our estimate, not a quote), and it takes days. That doesn't work for a seller adding stock every week.
- **Generic AI image tools change the product.** Ask a model to "put my shoe on a festive table" and it quietly redraws the logo, the colours or the shape. A listing that doesn't match the item that arrives is a returns problem, not a marketing win.
- **Every channel wants a different image.** Marketplaces reject main images that aren't on a pure white background; Stories need 9:16, banners 16:9, catalogues a light square tile. Doing each one by hand is where the evening goes.

## What it does

A seller uploads one photo (or snaps it with their phone through a QR code) and can type a one-line brief such as *"Diwali sale, 20% off, Hindi and English, for Instagram and WhatsApp"*. Snap2Shelf runs six steps, and each one lights up in the UI as the real Cloudinary call finishes:

| Step | What happens | Cloudinary does the work with |
|---|---|---|
| **1. Fix** | Reads the photo: an alt-text caption, a focus score, and a structured description of the product (name, colour, material, the part a colour variant should change, and whether it stands, lies flat or hangs). Then **auto-retouch** fixes only what a signal asks for: a dim photo gets `e_improve` (a 16×16 brightness probe measures it), a blown-out one `e_enhance`, blur or JPEG damage `e_gen_restore`, a hand or price tag `e_gen_remove`, and a photo under 1,000 px `e_upscale`. The cut-out starts from the retouched copy. | Captioning, `quality_analysis`, AI Vision General and Tagging, AI effects |
| **2. Cut out** | Removes the background **once** and saves the trimmed cut-out as its own asset. Every later image reuses it. | `e_background_removal/e_trim/f_png`, Upload API |
| **3. Stage** | Places the **real** cut-out on a scene plate exactly where the scene's surface is (Exact mode). Plates come from a shared, pre-generated library, or from **Generate a new scene**, which reuses an identical earlier request for 0 credits. Creative mode instead asks an image model to reshoot the scene around the product. | Layers, Image Generation `text_to_image` and `image_to_image` |
| **4. Light-match** | Casts a shadow away from the scene's light, adds contact shadows where the product touches the surface, a reflection on glossy surfaces, and a subtle warm or cool light-match. | `e_distort`, `e_blur`, `e_multiply`, `e_screen`, `e_tint` |
| **5. QA** | AI Vision checks the result. If an Exact composite looks pasted, the studio fixes the placement and checks again. In Creative mode it compares the product with the original, side by side, and rejects anything that changed. | AI Vision Tagging + General |
| **6. Pack** | Turns the approved hero into every format a seller needs: a zip, a video reel, and a Readiness Score for the marketplace image. | `b_gen_fill`, `e_gen_recolor`, `l_text`, `e_zoompan` + `fl_splice`, `download_zip_url`, `f_bmp` pixel sampling |

Around the pipeline:

- **Brief bar.** One line of intent becomes kit settings: a scene theme, Hindi and English offer lines, which channels to show first, and colour swatches. Rules read what the seller spelled out; AI Vision General proposes the rest. Eight festival presets (Diwali, Christmas, Eid, Onam, Durga Puja, Pongal, New Year, Black Friday) live in [`lib/festivals.ts`](lib/festivals.ts). [More](#brief-bar-and-festival-presets)
- **Readiness Score.** A 0–100 marketplace and social check of the kit, measured on pixels (is the background really pure white? does the product fill about 85% of the frame?), with one-click fixes. [More](#readiness-score)
- **Cost receipt.** Every kit carries its own ledger: generation credits spent, credits saved by reusing a scene, AI Vision tokens, a transformation estimate, and original versus delivered bytes. It prints. [More](#cost-engineering)
- **Collection mode and the shop shelf.** Two to six products staged on the same scene with the same light, shadow line and visual weight, published as a storefront at `/shelf/<shop>` with a WhatsApp share button and a dynamic link-preview collage. See **[/shelf/demo-studio](https://snap2shelf.vercel.app/shelf/demo-studio)**.
- **Director's cut.** [`/present`](https://snap2shelf.vercel.app/present) walks through one real kit chapter by chapter, plus [`/video/title`](https://snap2shelf.vercel.app/video/title) and [`/video/outro`](https://snap2shelf.vercel.app/video/outro) cards for recording.

### One photo, one shelf

**Before and after: the sample the studio opens.** A cluttered kitchen-counter photo of a steel bottle (an AI-generated test image), and the approved hero from the same run. The bottle's pixels are the photo's pixels.

<table><tr>
<td align="center" width="50%"><img src="https://res.cloudinary.com/nyxyma1i/image/upload/c_fill,w_1080,h_1350,g_auto/f_auto,q_auto/snap2shelf/products/shmessy1/raw" width="260" alt="Input: a steel water bottle on a speckled granite kitchen counter, with a mug, a tea towel, paper towels, a plant and a fruit bowl around it. An AI-generated test photo."><br><sub><b>Input</b> · sample test photo (AI-generated)</sub></td>
<td align="center" width="50%"><img src="https://res.cloudinary.com/nyxyma1i/image/upload/f_auto,q_auto/snap2shelf/products/shmessy1/hero-marble-ca4c3ac1-a020d3e2" width="260" alt="Output: the same bottle, cut out and standing on a white marble tabletop in soft daylight, with a leaf shadow on the wall behind and a faint reflection below."><br><sub><b>Hero</b> · Marble studio scene · Readiness 100</sub></td>
</tr></table>

**Every format from one hero.** Every tile below is a Cloudinary delivery URL; click one to open the exact URL that renders it. These tiles use our development kit of the sample sneaker (the same AI-generated test photo as the `shsneakr` sample), because their URLs spell out each transformation.

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
a **Readiness Score** for the marketplace image ·
a **cost receipt** ·
and a **shop shelf**: see **[/shelf/demo-studio](https://snap2shelf.vercel.app/shelf/demo-studio)**, whose WhatsApp link preview is this <a href="https://res.cloudinary.com/nyxyma1i/image/upload/c_fill,w_1200,h_630,g_auto/e_blur:1500/e_brightness:-70/co_rgb:f5a524,l_text:Inter@google_22_700_letter_spacing_6:SNAP2SHELF%20%C2%B7%20SHOP/fl_layer_apply,g_north_west,x_72,y_104/co_rgb:f4efe7,c_fit,w_500,l_text:Fraunces@google_80_600_line_spacing_-6:Demo%20Studio/fl_layer_apply,g_north_west,x_72,y_146/co_rgb:a89f92,c_fit,w_480,l_text:Inter@google_26_500_line_spacing_6:The%20Diwali%20edit%20%C2%B7%20real%20products%252C%20one%20festive%20stage/fl_layer_apply,g_north_west,x_74,y_258/l_snap2shelf:products:s2candle:hero-diwali-final-59f4388a-d4d9dc2f/c_scale,w_252,h_58/co_rgb:f5a524,e_colorize:100/co_rgb:0e0c0a,l_text:Inter@google_24_700:Open%20the%20shelf%20%20%E2%86%92/fl_layer_apply,g_center/r_29/fl_layer_apply,g_south_west,x_72,y_64/l_snap2shelf:products:s2candle:hero-diwali-final-59f4388a-d4d9dc2f/c_crop,w_627,h_784,x_227,y_272/c_fill,w_200,h_250,g_auto/bo_5px_solid_rgb:f4efe7/r_20/a_-3/co_black,e_shadow:60,x_8,y_14/fl_layer_apply,g_center,x_190,y_-125/l_snap2shelf:products:s2trlmix:hero-diwali-final-59f4388a-8b8e8e32/c_crop,w_662,h_827,x_209,y_239/c_fill,w_200,h_250,g_auto/bo_5px_solid_rgb:f4efe7/r_20/a_3/co_black,e_shadow:60,x_8,y_14/fl_layer_apply,g_center,x_420,y_-150/l_snap2shelf:products:9uo8w8pc:hero-diwali-final-59f4388a-61fd138b/c_crop,w_905,h_1131,x_88,y_4/c_fill,w_200,h_250,g_auto/bo_5px_solid_rgb:f4efe7/r_20/a_2/co_black,e_shadow:60,x_8,y_14/fl_layer_apply,g_center,x_190,y_140/l_snap2shelf:products:zi86lf6a:hero-diwali-final-59f4388a-b65fa150/c_crop,w_840,h_1050,x_120,y_210/c_fill,w_200,h_250,g_auto/bo_5px_solid_rgb:f4efe7/r_20/a_-2/co_black,e_shadow:60,x_8,y_14/fl_layer_apply,g_center,x_420,y_115/f_jpg,q_auto/snap2shelf/products/s2candle/hero-diwali-final-59f4388a-d4d9dc2f">1200×630 collage, one transformation URL</a>.

Finished sample kits you can open: [steel bottle, cluttered-counter photo](https://snap2shelf.vercel.app/kit/shmessy1) · [steel water bottle](https://snap2shelf.vercel.app/kit/shbottle) · [grey suede sneaker](https://snap2shelf.vercel.app/kit/shsneakr) · [trail mix pouch](https://snap2shelf.vercel.app/kit/shtrail1) · [chikankari kurta](https://snap2shelf.vercel.app/kit/shkurta1). All five start from AI-generated test photos.

---

## How it's built

<p align="center"><img src="https://res.cloudinary.com/nyxyma1i/image/upload/f_png,w_1600/v1790759006/snap2shelf/docs/architecture" width="880" alt="Architecture diagram. Seller phone and laptop upload photos directly to Cloudinary's Upload API with signatures from Next.js route handlers on Vercel. The route handlers call Cloudinary's Upload, Analyze and Image Generation APIs; AI calls go through a key pool that can also use two organiser-approved pool environments, whose results are copied into the main environment. Every image, video and zip is delivered back to browsers as a Cloudinary URL."></p>

<sub>The diagram is an SVG ([`docs/architecture.svg`](docs/architecture.svg)) stored in Cloudinary and rasterised on delivery with `f_png,w_1600`. `node --import tsx scripts/docs/upload-diagram.mts` re-uploads it.</sub>

Cloudinary is the entire backend: storage, image processing, AI, video, search-by-tag, state and delivery. There is no database and no image server of our own; Next.js on Vercel signs uploads, calls Cloudinary's APIs, keeps a signed session cookie and serves the UI.

**The Cloudinary techniques the product stands on:**

1. **The product is a layer, never a redraw.** Background removal runs once (`e_background_removal/e_trim/f_png`) and the cut-out is saved as its own asset. An Exact-mode hero is then one transformation URL: a pre-generated scene plate, the cut-out as an `l_` layer at integer pixel coordinates, a cast shadow projected from the product's own silhouette with `e_distort`, contact shadows from its footprint, and a light-match with `e_tint`, `e_screen` and `e_multiply`. It spends 0 generation credits. [See the URL, layer by layer.](#cloudinary-feature-map)
2. **Scene DNA.** AI Vision General reads each scene plate once and returns where the surface is, where the light comes from, how warm it is, whether it is glossy and where text fits. It is stored in the plate's context, and it drives the placement, the shadow direction and the offer card. [More](#scene-dna)
3. **AI Vision as a QA gate.** Tagging with hyphenated tags (`product-floating`, `compositing-artifact`, `product-redesigned`) decides whether an image may enter the kit. Exact composites that look pasted get one automatic fix; Creative takes are compared with the cut-out on a side-by-side sheet made by one URL. [More](#the-qa-gate)
4. **Generative transformations for every channel.** `b_gen_fill` extends the hero to 9:16 and 16:9, `e_gen_recolor` recolours one named part, `l_text` with Google's Noto fonts writes the Hindi and English offer, `e_zoompan` + `fl_splice` turn stills into a reel, `f_bmp` pixel sampling scores marketplace readiness, and `download_zip_url` packs the lot.
5. **Cloudinary as the database.** Tags, context and one small raw `facts.json` per product hold every fact, read by version from the CDN, so the photo → ZIP pipeline makes 0 Admin API calls. The scene library is a client-side list (`image/list/s2s-scene.json`). [More](#built-for-a-free-plan)
6. **Cost control.** Pinned model ids, prompt-hash public IDs so an identical scene request is a lookup, derivatives rendered once and saved, `f_auto,q_auto` on delivery, a transformation-credit floor, and a disclosed, organiser-approved key pool for AI calls. [More](#cost-engineering)

### Cloudinary feature map

Every row below does real work in the product, except row 18, which is set up but deliberately not used in delivered URLs (see the row).

| # | Capability | Exactly what we send | Code |
|---|---|---|---|
| 1 | **Signed uploads** (Upload Widget + signed preset) | `CldUploadWidget` with `signatureEndpoint="/api/sign-upload"`; preset `s2s_ingest`: signed, `overwrite: false`, incoming `c_limit,w_2400,h_2400`, image formats only | [upload-sign.ts](lib/server/upload-sign.ts) · [setup-cloudinary.mjs](scripts/setup-cloudinary.mjs) |
| 2 | **Captioning** (AI Content Analysis) for alt text | `POST /v2/analysis/{cloud}/analyze/captioning` | [vision.ts](lib/cloudinary/vision.ts) |
| 3 | **Quality analysis** | `explicit(id, { quality_analysis: true })` → `focus` | [products.ts](lib/server/products.ts) |
| 4 | **AI Vision General**: product JSON, Scene DNA, fidelity verdict, brief | `…/analyze/ai_vision_general` with a "Return ONLY a JSON object" prompt, validated with zod | [products.ts](lib/server/products.ts) · [scene-prompts.ts](lib/scene-prompts.ts) · [qa.ts](lib/server/qa.ts) · [brief.ts](lib/server/brief.ts) |
| 5 | **AI Vision Tagging**: QA gate, scene QA, retouch signals, readiness | `…/analyze/ai_vision_tagging` with `tag_definitions` such as `product-floating`, `product-redesigned`, `contains-text`, `too-dark`, `hand-in-frame` | [qa.ts](lib/server/qa.ts) · [scenes.ts](lib/server/scenes.ts) · [retouch-plan.ts](lib/server/retouch-plan.ts) · [measure.ts](lib/shelf/measure.ts) |
| 6 | **Image Generation** `text_to_image`: the scene library and new scenes on demand | `model: { id: "gpt-image-2.5-flare" }` (final) or `"flux-2-flash"` (draft), `aspect_ratio: "3:4"`, `async: true`, then poll `/tasks/{id}` | [scenes.ts](lib/server/scenes.ts) · [scene-jobs.ts](lib/server/scene-jobs.ts) · [generate.ts](lib/cloudinary/generate.ts) |
| 7 | **Image Generation** `image_to_image`: Creative mode | `reference_images: [{ source_type: "url", url: … }]` (the versioned cut-out), `model: { id: "nano-banana-2-edit" }`, `seed` | [creative.ts](lib/server/creative.ts) |
| 8 | **Background removal**, once per product | `e_background_removal/e_trim/f_png`, saved as `…/<sku>/cutout` | [products.ts](lib/server/products.ts) |
| 9 | **AI retouch effects**, only when a signal asks | `e_gen_remove:prompt_(hand;price%20tag)` · `e_gen_restore` · `e_improve` · `e_enhance` · `e_upscale`, then `c_limit,w_2000,h_2000/f_jpg,q_95`, saved as `…/<sku>/retouched` | [retouch-plan.ts](lib/server/retouch-plan.ts) · [retouch.ts](lib/server/retouch.ts) |
| 10 | **Layers** with pixel placement | `l_<cutout>/c_scale,w_583,h_312` … `fl_layer_apply,g_north_west,x_249,y_566` | [composite.ts](lib/transform/composite.ts) |
| 11 | **Shadows and light-match** from the product's own silhouette | `e_distort:…` `c_mpad,…,b_transparent` `e_blur:309` `e_gradient_fade` `e_multiply` `fl_no_overflow` `e_tint:20:ffa04a` `e_screen` | [composite.ts](lib/transform/composite.ts) |
| 12 | **Generative fill** | `ar_9:16,b_gen_fill,c_pad,w_1080` · `ar_16:9,b_gen_fill,c_pad,w_1920` | [channels.ts](lib/transform/channels.ts) |
| 13 | **Generative recolor** of one part | `e_gen_recolor:prompt_suede%20panels;to-color_1e3a8a` | [channels.ts](lib/transform/channels.ts) |
| 14 | **Text overlays** with Google Fonts, Devanagari included | `l_text:Noto%20Sans%20Devanagari@google_84_700:<text>` | [channels.ts](lib/transform/channels.ts) |
| 15 | **Video from stills**: the Kit Reel | `e_zoompan:du_3;fps_25;from_(zoom_1.0);to_(zoom_1.15)` `fl_splice,l_<image>` `e_fade:400` `vc_h264` `.mp4` | [reel.ts](lib/transform/reel.ts) |
| 16 | **Pixel sampling** with `f_bmp` | `c_scale,w_16,h_16/f_bmp` brightness probe for retouch; `c_scale,w_96,h_96/f_bmp` of the marketplace image for the Readiness Score (decoded on the server) | [retouch.ts](lib/server/retouch.ts) · [readiness.ts](lib/readiness.ts) · [measure.ts](lib/shelf/measure.ts) |
| 17 | **One-click readiness fixes** | re-pad `c_fit,w_1700,h_1700/c_mpad,w_2000,h_2000,b_white/f_jpg,q_auto:best`; sharpen `e_sharpen:80/…` | [readiness.ts](lib/readiness.ts) · [readiness route](app/api/readiness/%5Bsku%5D/route.ts) |
| 18 | **Named transformations** (created and available, not used in delivered URLs) | `npm run setup:cloudinary` creates `t_s2s_marketplace`, `t_s2s_story`, `t_s2s_banner`, `t_s2s_whatsapp` and `t_s2s_feed` from the same chains, and `channelAssets({ named: true })` can emit `t_s2s_story/f_auto,q_auto`. The pack keeps the explicit chains so every step stays visible in X-ray. | [named.ts](lib/transform/named.ts) · [channels.ts](lib/transform/channels.ts) |
| 19 | **Tags + contextual metadata** as the database | tags `s2s-sku-<sku>`, `s2s-pack-<sku>`, `s2s-shop-<shop>`; context `dna_ax=0.500`, `qa_status=approved` | [types.ts](lib/types.ts) · [scenes.ts](lib/scenes.ts) · [cld.ts](lib/server/cld.ts) · [shelf/types.ts](lib/shelf/types.ts) |
| 20 | **Raw JSON assets as state** | `snap2shelf/products/<sku>/facts.json` written with the Upload API, read with `explicit` (for the version) plus a GET of `/raw/upload/v<version>/…/facts.json` | [facts.ts](lib/server/facts.ts) · [shared-usage.ts](lib/cloudinary/shared-usage.ts) |
| 21 | **Client-side resource list** | `res.cloudinary.com/<cloud>/image/list/s2s-scene.json` | [scenes.ts](lib/scenes.ts) · [scenes route](app/api/scenes/route.ts) |
| 22 | **Upload by URL**: save derived images as assets | `uploader.upload(<delivery URL>, { public_id, tags, context })` | [pack.ts](lib/server/pack.ts) · [copy.ts](lib/cloudinary/copy.ts) |
| 23 | **Archive** | `download_zip_url({ tags: ["s2s-pack-<sku>"], flatten_folders: true })` | [pack.ts](lib/server/pack.ts) |
| 24 | **Automatic format and quality** | `f_auto,q_auto` everywhere; `f_jpg` when a scraper or AI fetches the image | [lib/transform/](lib/transform/) |
| 25 | **Admin usage API** for the key pool and the credit floor | `GET /v1_1/{cloud}/usage` → `image_generation`, `ai_vision`, `object_detection`, `credits` | [pool.ts](lib/cloudinary/pool.ts) · [budget.ts](lib/server/budget.ts) |
| 26 | **Dynamic OG collage** for shared shelves | blurred first hero as the backdrop, up to four heroes cropped to the product with `bo_5px_solid`, `r_20`, `a_-3` and `e_shadow:60`, shop name in `l_text:Fraunces@google_80_600`, `f_jpg` | [shelf/og.ts](lib/shelf/og.ts) |

<details>
<summary><b>The whole Exact-mode hero is one URL. Here it is, layer by layer.</b></summary>

This is the URL that rendered the hero tile above, as `compositeUrl()` in [`lib/transform/composite.ts`](lib/transform/composite.ts) built it, split into its layers. In the app, the **X-ray** panel shows the same split with colours and plain-language labels ([`lib/transform/xray.ts`](lib/transform/xray.ts)).

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

### Architecture

**Where things live.** Every asset sits in one Cloudinary product environment, under predictable public IDs. Facts live in tags, context and one small JSON file per product, so the client-side list JSON and delivery URLs are most of the "API". Every asset also carries the tag `s2s`.

```text
snap2shelf/products/<sku>/raw                  original upload          s2s-raw, s2s-sku-<sku>
snap2shelf/products/<sku>/facts.json           pipeline state (raw)     written only by the server
snap2shelf/products/<sku>/retouched            auto-retouched photo     only when a fix was needed
snap2shelf/products/<sku>/cutout               trimmed transparent PNG  s2s-cutout, s2s-sku-<sku>
snap2shelf/products/<sku>/hero-<scene>-<hash>  approved hero            s2s-hero, s2s-sku-<sku>, s2s-shop-<shop>
snap2shelf/products/<sku>/creative-<m>-<seed>  Creative take            s2s-creative, s2s-sku-<sku>
snap2shelf/products/<sku>/pack/<format>        channel asset            s2s-pack, s2s-pack-<sku>
snap2shelf/scenes/<theme>/<tier>-<hash>        1080×1350 scene plate    s2s-scene, s2s-theme-<theme>
snap2shelf/state/usage-main.json               shared usage reading     one per deployment
```

**A request's life, for one product:**

1. The browser asks `POST /api/sign-upload` to sign an upload of `snap2shelf/products/<sku>/raw` and uploads the photo **directly** to Cloudinary. The phone does the same from `/capture`, and the laptop polls until the upload lands. The cheapest reliable check we measured is a `HEAD` on the delivery URL with a fresh version component (`/image/upload/v<n>/<public_id>`): it answered 200 on the first poll, 0.8 s after the upload, because no CDN layer can answer it with a cached 404 ([`lib/capture.ts`](lib/capture.ts)).
2. `POST /api/products/<sku>/analyze` runs captioning, AI Vision and quality analysis in parallel and stores the answers, so they never run twice.
3. `POST /api/products/<sku>/retouch` tags the photo for problems and measures its brightness, then derives and saves a retouched copy only if something needs fixing. It answers `202` with `retryAfterMs` while Cloudinary is still deriving.
4. `POST /api/products/<sku>/cutout` derives `e_background_removal/e_trim/f_png` from the retouched copy (or the raw) and saves it. It also answers `202` while Cloudinary is still working (`423`), so no request runs longer than about 10 seconds.
5. `POST /api/brief` (optional) turns the seller's line into a theme, offer lines, channels and swatches.
6. The studio builds Exact-mode composite URLs **in the browser** from the cut-out, the scene and Scene DNA. Moving a slider is just a new URL. `POST /api/qa` checks the chosen one.
7. `POST /api/pack` saves the hero by URL and materialises each channel format as a tagged asset; `GET /api/pack/<sku>` returns a signed zip link once nothing is pending. `GET /api/readiness/<sku>` and `GET /api/cost/<sku>` score and cost the finished kit.

Every step reads and writes the product's `facts.json` through the Upload API and the CDN, so the whole photo → ZIP pipeline makes **0 Admin API calls** ([Built for a free plan](#built-for-a-free-plan)).

<details>
<summary><b>Every API route</b></summary>

| Route | What it does | Gated |
|---|---|---|
| `POST /api/sign-upload` | signs a Upload Widget or phone upload against an allowlist | no |
| `GET /api/capture/:sku` | has the phone's photo landed? | no |
| `POST /api/products/:sku/analyze` | captioning + `quality_analysis` + AI Vision product JSON | session cap |
| `POST /api/products/:sku/retouch` | plan and apply auto-retouch (202 while deriving) | session cap |
| `POST /api/products/:sku/cutout` | background removal once, trimmed, saved (202 while deriving) | session cap |
| `POST /api/brief` | one-line brief → theme, offer lines, channels, swatches (last 3 briefs cached) | session cap |
| `GET /api/scenes` · `GET /api/scenes/match` | the scene library from the client-side list; ranked matches for a theme or description | no |
| `POST /api/scenes/generate` → `GET /api/scene-jobs/:job` | reuse a matching plate for 0 credits, else generate a new one (pinned model) with Scene DNA and scene QA | access code for new plates |
| `POST /api/generate` → `GET /api/jobs/:job` | Creative take with `image_to_image`, then fidelity QA | access code |
| `POST /api/qa` | Exact "does it look pasted?" check, or a Creative re-check | session cap |
| `POST /api/pack` → `GET /api/pack/:sku` | save the hero, materialise every format, signed zip | session cap |
| `GET /api/readiness/:sku` · `POST` | Readiness Score; `POST { fixes: ["repad" \| "sharpen"] }` applies a one-click fix | session cap |
| `GET /api/cost/:sku` | the kit's cost ledger | no |
| `POST /api/collection` | stage 2–6 products on one scene with the same light and visual weight | session cap |
| `POST /api/shelf` · `GET /api/shelf/:shop` | publish up to 12 heroes as a storefront; read it back | session cap / no |
| `POST /api/access` · `GET /api/usage` | unlock live generation; pool totals, this session's allowance and the credit floor | no |

</details>

---

## Exact and Creative

| | **Exact** (default) | **Creative** |
|---|---|---|
| What the product is | Your real pixels, layered by URL | Redrawn by an image model from your cut-out |
| Scene | A plate from the scene library, or a new one from **Generate a new scene** | Generated for this take |
| Generation credits per image | **0** (the plate was generated once and is reused) | 9 with `nano-banana-2-edit`, 1 with `flux-2-flash-edit` |
| Model choice | none | explicit picker: **Faithful** `nano-banana-2-edit` or **Fast draft** `flux-2-flash-edit`, plus a seed |
| QA | "Does it look pasted?" tags on the composite, with one automatic fix | Reference-vs-candidate **fidelity sheet**, then tags + a verdict |
| Best for | Marketplace-safe listings, anything with a logo | Lifestyle shots where a small redraw is acceptable |

Creative requests wrap the seller's scene description in fixed fidelity instructions ([`lib/server/creative.ts`](lib/server/creative.ts)):

```text
Professional e-commerce lifestyle photograph of the EXACT product shown in reference image [1].
Scene: <seller's description, cleaned, max 300 chars>.
The product must stay IDENTICAL to [1]: same shape, proportions, colours, materials, finish, logos, text and every detail.
Do not redesign, restyle, recolour, add or remove any part of the product, and show exactly one product, whole and in focus. …
```

The reference is a **versioned** cut-out URL (`/v<version>/snap2shelf/products/<sku>/cutout`), so the reference can't change under a running job. Jobs run asynchronously; the browser polls `GET /api/jobs/<job>` about every 2 seconds.

**New scenes on demand.** When no library plate fits, **Generate a new scene** asks for a draft plate (`flux-2-flash`, 1 credit). The plate's public ID is a hash of prompt, tier and seed (`snap2shelf/scenes/<theme>/draft-<hash8>`), so an identical request is a lookup, not a generation: it comes back at once as "Reused · 0 credits · saved N credits". A new plate gets its Scene DNA and a scene QA pass (`contains-product`, `contains-text`, `contains-person`) before it joins the library; a plate that fails QA is kept out and the route answers 409 ([`lib/server/scenes.ts`](lib/server/scenes.ts), [`lib/server/scene-jobs.ts`](lib/server/scene-jobs.ts)).

---

## Brief bar and festival presets

The brief bar sits at the top of the studio's staging panel once your photo has been read (the samples show a preview of it). It takes one line and returns kit settings ([`lib/server/brief.ts`](lib/server/brief.ts)):

1. **Rules read what the seller spelled out**: festival, discount (`20%`, `₹200 off`, buy 1 get 1, free delivery), languages, channels (Instagram → feed + story, WhatsApp → catalogue tile, Amazon or Flipkart → marketplace), colours and tone words. They are deterministic, so the offer lines are always spelled correctly.
2. **AI Vision General looks at the product photo together with the brief** and proposes the rest: theme, palette, tone, an offer line when no rule applies, and a backdrop description for **Generate a new scene**. Every AI field is validated on its own, and the UI marks which fields came from AI.

For *"Diwali sale, 20% off, Hindi and English, for Instagram and WhatsApp"* the rules alone give the Diwali preset, the channels `feed`, `story` and `whatsapp`, and these offer lines, which the pack renders with Google's Noto fonts:

```text
दिवाली सेल · 20% छूट
Diwali Sale · 20% off
```

The eight presets in [`lib/festivals.ts`](lib/festivals.ts) each carry a scene theme (eye level and flat-lay), a palette, fixed Hindi and English sale lines, default offer languages and a backdrop prompt. The last three briefs per product are cached, so repeating one costs 0 tokens.

---

## Scene DNA

A scene plate is only useful if we know where its table is and where its light comes from. When a plate is added to the library, AI Vision reads it once and returns its **Scene DNA**. This is the real DNA of the Diwali plate behind the sneaker tiles:

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

The prompt that produces it is in [`lib/scene-prompts.ts`](lib/scene-prompts.ts) (`sceneDnaPrompt`). It asks for "ONLY a JSON object" with exactly these keys and describes each one ("0=top, 90=right, 180=bottom, 270=left"); the answer is parsed out of any prose or code fences and validated with zod. In our spike, AI Vision returned valid Scene DNA JSON 2 out of 2 times at about 690 tokens per call. The studio's **Scene DNA** toggle draws the anchor, light direction and text zone over the plate.

The scene library itself is 8 themes (Diwali glow, Marble studio, Pastel minimal, Rustic jute, Kitchen counter, Outdoor café, Festive flat-lay, Linen flat-lay) in two fixed camera recipes ([`lib/scene-prompts.ts`](lib/scene-prompts.ts)): eye level for standing products (6 themes), top-down for garments (2). The seeder generated a draft and a final plate per theme once (16 plates; see [the `mode: "auto"` lesson](#cost-engineering)), normalised each to 1080×1350 with an incoming `c_fill`, and checked it with AI Vision (`contains-product`, `contains-text`, `contains-person` → the plate is re-tagged `s2s-scene-rejected`). The samples and the director's cut stage on the **8 approved final plates**, one per theme, snapshotted in [`lib/showcase.ts`](lib/showcase.ts) (`SCENE_LIBRARY`); **Generate a new scene** adds plates on demand.

---

## The QA gate

AI Vision decides whether an image may go into the kit. Tag names must be lower-case letters, digits and hyphens (`product_visible` returns HTTP 400 `MA_00003`), and tagging returns only the tags that matched, with no confidence value. So the rule is written in tags.

**Exact mode** ([`lib/server/qa.ts`](lib/server/qa.ts) `EXACT_TAGS`) asks "does this composite look pasted?"

| Tag | Approve when |
|---|---|
| `product-visible` | **must** match |
| `product-floating`, `scale-implausible`, `compositing-artifact`, `garbled-text`, `unsafe` | **none** may match |

`compositing-artifact` ("a dark or light rectangle… a shadow cut off by a straight line") exists because our v0 shadows produced exactly that.

**When Exact QA rejects, the studio fixes it once, automatically, and checks again** ([`components/studio/studio.tsx`](components/studio/studio.tsx) `planFix`): `product-floating` sets the product down onto the surface and turns on the contact shadow, `scale-implausible` nudges the scale, and `compositing-artifact` moves to another scene or turns the cast shadow off. The rail then shows "Auto-fixed: …".

**A real catch, from the sample the studio opens.** The seeded run of the cluttered-counter bottle (`shmessy1`, [`data/showcase.json`](data/showcase.json)) was checked three times:

| Check | Placement | AI Vision matched | Verdict |
|---|---|---|---|
| 1 | Scene DNA default | `product-visible`, `product-floating`, `compositing-artifact` | rejected |
| 2 | contact shadow off, 10 px lower | `product-visible`, `product-floating` | rejected |
| 3 | contact shadow on, 20 px lower | `product-visible` | **approved** |

The [sample replay](https://snap2shelf.vercel.app/studio?sample=shmessy1) retells that run from stored results: the first verdict, the fix, and the approval.

<table><tr>
<td align="center" width="50%"><img src="https://res.cloudinary.com/nyxyma1i/image/upload/c_fill,w_1080,h_1350/l_snap2shelf:products:shmessy1:cutout/c_scale,w_174,h_649/co_rgb:262626,e_colorize:100/e_distort:390:138:564:138:174:0:0:0/c_crop,g_north_west,x_0,y_0,w_564,h_138/c_mpad,w_700,h_274,b_transparent/e_blur:584/e_gradient_fade:40,y_-0.7/o_45/e_multiply,fl_layer_apply,fl_no_overflow,g_north_west,x_385,y_945/l_snap2shelf:products:shmessy1:cutout/c_scale,w_174,h_649/a_vflip/e_gradient_fade:50,y_-0.75/c_mpad,w_198,h_673,b_transparent/e_blur:120/o_26/fl_layer_apply,fl_no_overflow,g_north_west,x_441,y_975/l_snap2shelf:products:shmessy1:cutout/c_crop,g_south,w_317,h_142/c_scale,w_184,h_57/co_rgb:262626,e_colorize:100/c_mpad,w_320,h_193,b_transparent/e_blur:400/o_30/e_multiply,fl_layer_apply,fl_no_overflow,g_north_west,x_380,y_904/l_snap2shelf:products:shmessy1:cutout/c_crop,g_south,w_317,h_142/c_scale,w_167,h_23/co_rgb:262626,e_colorize:100/c_mpad,w_259,h_115,b_transparent/e_blur:200/o_90/e_multiply,fl_layer_apply,fl_no_overflow,g_north_west,x_411,y_953/l_snap2shelf:products:shmessy1:cutout/c_scale,w_174,h_649/e_brightness:-3/fl_layer_apply,g_north_west,x_453,y_364/l_snap2shelf:products:shmessy1:cutout/c_scale,w_174,h_649/co_rgb:262626,e_colorize:100/e_gradient_fade:25,x_0.85/o_30/e_multiply,fl_layer_apply,g_north_west,x_453,y_364/f_auto,q_auto/snap2shelf/scenes/marble/final-ca4c3ac1" width="240" alt="Check 1, rejected: the steel bottle on the marble surface in the default position, which AI Vision tagged as floating, with a compositing artifact"><br><sub>Check 1: rejected (<code>product-floating</code>, <code>compositing-artifact</code>)</sub></td>
<td align="center" width="50%"><img src="https://res.cloudinary.com/nyxyma1i/image/upload/f_auto,q_auto/snap2shelf/products/shmessy1/hero-marble-ca4c3ac1-a020d3e2" width="240" alt="Check 3, approved: the same bottle set 20 px lower onto the marble, with its contact shadow and reflection"><br><sub>Check 3: approved, 20 px lower (the saved hero)</sub></td>
</tr></table>

**Creative mode** compares the generated image with the seller's cut-out. One transformation URL puts both on one sheet, the reference on the left and the candidate on the right:

```text
c_fill,w_512,h_683,g_auto/c_pad,w_1024,h_683,g_east,b_white/l_snap2shelf:products:<sku>:cutout/c_fit,w_480,h_640/fl_layer_apply,g_west,x_16/f_jpg,q_85/<candidate>
```

AI Vision then runs tagging (`same-product`, `product-redesigned`, `extra-product`, `garbled-text`, `unsafe`) and a JSON verdict (`same_product`, `fidelity_score`, `differences`) on that sheet, in parallel, for about 1,000 tokens. **It is rejected if any reject tag matches or the verdict says `same_product: false`, and it is never approved unless the tag or the verdict confirms it is the same product.** The numeric score is shown but not used: it is not calibrated (it gave 85 to the image below that it rejected).

**The Creative catch.** Same cut-out (Cloudinary's `samples/shoe` demo image), same prompt, seed 7, two models:

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

The same thing happened on the sample sneaker: its `flux-2-flash-edit` take was rejected (`product-redesigned`: "added logo on side panel") and its `nano-banana-2-edit` take approved. That is why Creative mode defaults to `nano-banana-2-edit` and labels the cheap model "Fast draft". Every verdict is stored with the asset (`qa_status`, `qa_matched`, `qa_reasons`), so a result is never checked twice.

---

## Readiness Score

After the pack, the kit gets a 0–100 score for "can I list this today?" ([`lib/readiness.ts`](lib/readiness.ts), [`lib/shelf/measure.ts`](lib/shelf/measure.ts)). The server measures; it doesn't assume.

| Check | Points | How it is measured |
|---|---|---|
| Pure white background | 25 | the border pixels of a 96×96 `f_bmp` of the marketplace image must be `#ffffff` |
| Product fills ~85% of the frame | 15 | the product box found in the same pixels; 80–90% passes |
| Resolution for zoom | 20 | at least 1,000 px of product; the 2,000 px canvas is the target |
| No text, watermark or props | 15 | one AI Vision tagging call, stored so it runs once |
| Sharp focus | 15 | the `quality_analysis` focus stored at analyze time |
| Clear of social text zones | 10 | the product box on the hero against story UI bands and the offer card |

A pass earns full points, a warning half; an unknown check is left out and the score rescaled. Every failing check carries a fix: **one-click** server fixes that re-materialise the marketplace image (re-pad on pure white, or `e_sharpen:80`), a re-stage or re-pack suggestion (move the product up, move the offer text), or a retake tip. The score also runs on the original photo, so the kit shows before → after. For the five samples (lib/client/sample-readiness.json, measured 30 Sep 2026):

| Sample | Phone photo | Kit |
|---|---|---|
| Steel bottle, cluttered-counter photo | 53 | **100** |
| Steel water bottle | 44 | **93** |
| Chikankari kurta | 44 | **95** |
| Trail mix pouch | 35 | **93** |
| Grey suede sneaker | 53 | **90** |

---

## Cost engineering

Everything was measured on Cloudinary's Free plan. The spike scripts are in [`scripts/spikes/`](scripts/spikes/) and the measured numbers in [`SPIKES.md`](SPIKES.md).

**Free allowance per product environment:** 50 Image Generation credits, 100,000 AI Vision tokens and 500 AI Content Analysis detections a month, plus 25 transformation credits. `limit: 50` is credits, not images, and the cost per image depends on the model:

| Model (pinned by id) | Used for | Credits per image | Latency (first measured) |
|---|---|---|---|
| `flux-2-flash` | draft scene plates, **Generate a new scene** | **1** | 8.7 s |
| `gpt-image-2.5-flare` | final scene plates | **4–5** | 18.8 s |
| `nano-banana-2` | not requested any more; `mode: "auto"` picked it for some library plates | **9–11** | |
| `flux-2-flash-edit` | Creative "Fast draft" | **1** | 7.6 s |
| `nano-banana-2-edit` | Creative "Faithful" (default) | **9** | 16.6 s |

| AI Vision call | Tokens |
|---|---|
| Scene DNA (`ai_vision_general`) | about 690 |
| One tagging pass (`ai_vision_tagging`) | about 535 |
| Auto-retouch check (tagging on the photo) | about 730 |
| One fidelity verdict (tags + JSON on the sheet) | about 1,000 |

**The `mode: "auto"` lesson.** Auto model selection is not cost-stable. While seeding the scene library, `preference: "economy_fast"` picked `nano-banana-2` at 9–11 credits for several "1-credit" drafts, and `quality` once picked it instead of `gpt-image-2.5-flare`. The 16 plates cost **72 credits against 48 planned**. Every cost-sensitive call now pins a model id.

**Credits saved by reuse.** An Exact kit spends **0 new generation credits: its scene is reused from the library.** The ledger counts what that plate cost to generate once as "saved by reuse", and **Generate a new scene** does the same when a request hashes to a plate that already exists.

**What one kit costs.** Each kit's ledger (`GET /api/cost/<sku>`, shown as the receipt) is read back from Cloudinary: credits, tokens and step timings recorded as the pipeline ran, plus one `HEAD` of the delivered hero for its real size. The five sample kits, from [`data/showcase.json`](data/showcase.json):

| Sample kit | Scene | New generation credits | Saved by reuse | AI Vision tokens | Transformations (estimate) | Photo → delivered hero |
|---|---|---|---|---|---|---|
| Steel bottle, cluttered-counter photo | Marble studio | **0** | 5 | 2,692 (three QA checks) | 348 | 2.25 MB → 42 KB |
| Steel water bottle | Outdoor café | **0** | 4 | 1,354 | 293 | 1.78 MB → 106 KB |
| Grey suede sneaker | Diwali glow | **0** | 4 | 1,350 | 191 | 1.95 MB → 104 KB |
| Trail mix pouch | Rustic jute | **0** | 9 | 1,310 | 191 | 1.81 MB → 117 KB |
| Chikankari kurta | Festive flat-lay | **0** | 4 | 1,369 | 293 | 2.91 MB → 218 KB |

Together: 0 credits spent on scenes and 26 credits saved by reuse (the jute plate is the one `mode: "auto"` made with `nano-banana-2`, hence 9). The three Creative takes in the showcase cost 18 credits between them. The receipt puts the kit next to our estimate of ₹2,500 for a basic studio shoot of one product, labelled as an estimate. Photo to ZIP took **36 s** when we measured it on the live site (30 Sep 2026, a sample photo uploaded from a desktop browser, from file selected to the ZIP link).

What keeps a kit cheap:

| Technique | Effect | Where |
|---|---|---|
| **Exact mode by default** | 0 generation credits per product; the only AI costs are analysis and QA | [`lib/transform/composite.ts`](lib/transform/composite.ts) |
| **Scene reuse by prompt hash** | plates are `snap2shelf/scenes/<theme>/<tier>-<sha1(prompt, tier, seed)>`; the seeder and **Generate a new scene** skip any id that exists, so a repeat costs 0 credits | [`lib/server/scenes.ts`](lib/server/scenes.ts), [`lib/server/scene-jobs.ts`](lib/server/scene-jobs.ts) |
| **Cut out once** | `e_background_removal` is 75 transformations per use; we run it once per product and save the result, and every composite, the marketplace image and every Creative reference layers that saved asset | [`lib/server/products.ts`](lib/server/products.ts) |
| **Retouch only on a signal** | a dim photo gets `e_improve` (no extra count on the derivation) rather than `e_enhance` (100); `e_gen_restore` (100), `e_gen_remove` (50) and `e_upscale` (10 or 100) run only when a tag or a measurement asks for them. The plan is stored, so it is never recomputed | [`lib/server/retouch-plan.ts`](lib/server/retouch-plan.ts) |
| **Derivatives are billed once** | quantised sliders mean nearby positions share a URL; pack formats (`b_gen_fill` and `e_gen_recolor` are 50 transformations each) are rendered once and saved as tagged assets | [`lib/transform/composite.ts`](lib/transform/composite.ts), [`lib/server/pack.ts`](lib/server/pack.ts) |
| **Analysis is cached** | captioning, product JSON, retouch plans, briefs (last 3), QA verdicts and Scene DNA are stored and never recomputed | [`lib/server/products.ts`](lib/server/products.ts), [`lib/server/qa.ts`](lib/server/qa.ts), [`lib/server/brief.ts`](lib/server/brief.ts) |
| **Samples replay for free** | the studio's sample products replay a recorded live run from stored assets, with no API call | [`lib/showcase.ts`](lib/showcase.ts), [`lib/client/api.ts`](lib/client/api.ts) |
| **`f_auto,q_auto` on delivery** | our spike hero master is 268,847 bytes; with `f_auto,q_auto` a WebP-capable browser gets 87,598 bytes (67% smaller) and a JPEG-only client 118,482 bytes (measured 30 Sep 2026) | every URL builder |

The spikes themselves used 16 generation credits, about 7,100 AI Vision tokens, 1 detection and 0.30 transformation credits.

### The key pool (disclosed, approved by the organisers)

> [!NOTE]
> Image generation, AI Vision and captioning calls rotate across **three Cloudinary product environments**: our main one plus two extra free environments. **The hackathon organisers approved this.** We disclose it here because it is how a free-plan demo survives a day of judges pressing "generate".

How it works ([`lib/cloudinary/pool.ts`](lib/cloudinary/pool.ts)):

- Each call goes to the environment with the **most quota left** for that capability (`image_generation`, `ai_vision`, `object_detection` for captioning), ties going to main.
- Quota is known from two sources: the Admin API `usage` endpoint (refreshed at most every 10 minutes) and the `limits` block that every generate and analyze response carries (real time). The lower estimate wins.
- An environment is skipped when it would drop below a **floor** (2 generation credits, 2,000 AI Vision tokens, 5 detections), and **benched for an hour** when it answers with a quota or rate-limit error; the call moves on to the next one.
- Every generated image is **copied into the main environment** (upload by URL), where all storage, layering, search and delivery happen.

What never leaves the server: every API key and secret, and the names of the pool environments. `/api/usage` returns pool **totals** only; a job handle is an AES-256-GCM sealed token, so the browser can't read which environment runs it; and [`scripts/e2e-http.mts`](scripts/e2e-http.mts) scans every API response for pool cloud names, pool labels, secrets, the access code and stack traces, and fails if any appears.

---

## Built for a free plan

A live demo on a Free plan fails in boring ways: an hourly API limit, a monthly credit cap, an upstream hiccup. What we did about each:

- **0 Admin API calls per kit.** The Free plan allows 500 Admin API calls an hour, and our first pipeline spent about 20 per kit reading context and listing folders. Each product's state now lives in `snap2shelf/products/<sku>/facts.json`, a tiny raw asset written with the Upload API and read by version from the CDN (a new version is a new cache key, so the read is always fresh). It kept working during a real Admin rate limit on 30 Sep ([`lib/server/facts.ts`](lib/server/facts.ts)).
- **A circuit breaker on the Admin API.** After one HTTP 420 or 429, the process stops calling that account's Admin API until the reset time Cloudinary names, and it stops early when only `ADMIN_API_RESERVE` (default 5) calls are left in the hour. Routes answer "busy, retry in N s", never a 500, and the UI shows a calm busy state ([`lib/cloudinary/admin.ts`](lib/cloudinary/admin.ts)).
- **One shared usage reading.** Main's Admin `usage` result is shared by every server instance through `snap2shelf/state/usage-main.json`, so the call happens about once every 15 minutes for the whole deployment ([`lib/cloudinary/shared-usage.ts`](lib/cloudinary/shared-usage.ts)).
- **A transformation-credit floor.** A live kit derives roughly 300 transformations. When main has used `LIVE_TX_MAX_USED` credits (default 21 of 25), every route that would create new derivatives answers `quota_low` and the UI shows the saved samples instead, so the showcase keeps the credits it needs for delivery ([`lib/server/budget.ts`](lib/server/budget.ts)).
- **Samples that cost nothing.** The five studio samples replay recorded runs from stored assets with zero API calls, so the first thing a judge clicks never touches quota.
- **Secrets can't reach a log.** Cloudinary Node SDK rejections can carry the request options, API secret included. Every SDK call goes through a wrapper that re-throws a new error built from a scrubbed message and the HTTP code only ([`lib/cloudinary/safe.ts`](lib/cloudinary/safe.ts)).

---

## How judges can test

| You want to | Do this | Needs |
|---|---|---|
| See the whole flow, including a QA catch | open the **[sample replay](https://snap2shelf.vercel.app/studio?sample=shmessy1)** (the home page's **Try a sample product (no signup)** also starts a sample) | nothing (no API calls) |
| Read how an image was made | press the code button (`</>`) under any kit image to open its X-ray | nothing |
| See a finished kit with its Readiness Score and receipt | [/kit/shbottle](https://snap2shelf.vercel.app/kit/shbottle) | nothing |
| See a storefront and its WhatsApp preview | [/shelf/demo-studio](https://snap2shelf.vercel.app/shelf/demo-studio), then **Share on WhatsApp** | nothing |
| Watch the story, chapter by chapter | [/present](https://snap2shelf.vercel.app/present) (→ or Space next, P autoplay; `?auto=1&clean=1` for a clean autoplay) | nothing |
| Use your own photo | **Upload a photo** in the studio, or **Snap with your phone** and scan the QR code; try the brief bar | nothing (Exact mode, retouch, QA, pack and readiness are open, with a per-session cap) |
| Generate live with an image model | open **Creative**, enter the access code, pick **Faithful** or **Fast draft**; or **Generate a new scene** | the **access code from our submission form** |

Guard rails you may notice: each unlocked session gets **4 live generations**; open AI operations (analyze, retouch, brief, cut-out, QA, pack, readiness) are capped at **60 per session**; if the pool's usable generation credits fall below **12**, live generation pauses; and if main's transformation credits reach the floor (**21 of 25**), live kit building pauses. In every case the app shows the saved samples instead of failing. All four are environment variables (`LIVE_GEN_CAP`, `OPEN_OP_CAP`, `LIVE_GEN_MIN`, `LIVE_TX_MAX_USED`).

---

## Run it locally

You need Node.js 20 or newer and a Cloudinary account (the Free plan is enough).

```bash
git clone https://github.com/GODOSTROYER/snap2shelf.git
cd snap2shelf
npm install
cp .env.example .env.local      # fill in your cloud name, API key and secret (see below)
npm run setup:cloudinary        # signed upload preset s2s_ingest + named transformations t_s2s_*
npm run seed:scenes -- --tiers draft
                                # your own scene library: 8 draft plates, pinned to flux-2-flash (1 credit each)
npm run dev                     # http://localhost:3000
```

In your Cloudinary security settings, make sure **Resource list** is not a restricted delivery type. The scene library is read from `image/list/s2s-scene.json`, and it stays empty if that list is blocked. The sample kits are stored on our demo cloud, so with your own cloud name start from your own photo.

<details>
<summary><b>Environment variables</b></summary>

| Variable | Required | What it is |
|---|---|---|
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_CLOUD_NAME` | yes | your cloud name |
| `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | yes | server-only; the secret also derives the keys for the session cookie and job tokens |
| `NEXT_PUBLIC_CLOUDINARY_API_KEY` | yes, for the Upload Widget | the API key (public by design for signed widget uploads; never the secret) |
| `CLOUDINARY_URL` | optional | the same credentials in URL form, for the SDK |
| `CLOUDINARY_POOL_<n>_CLOUD_NAME`, `_API_KEY`, `_API_SECRET` | optional | extra environments for the key pool (generation, AI Vision and captioning only) |
| `DEMO_ACCESS_CODE` | for live generation | the code that unlocks Creative mode and new scenes |
| `NEXT_PUBLIC_SITE_URL` | yes | e.g. `http://localhost:3000`; used for QR codes and links |
| `LIVE_GEN_CAP`, `LIVE_GEN_MIN`, `OPEN_OP_CAP` | optional | defaults 4, 12 and 60 (see [How judges can test](#how-judges-can-test)) |
| `LIVE_TX_MAX_USED` | optional | main's transformation-credit floor, default 21 of 25; `0` turns the live pipeline off |
| `ADMIN_API_RESERVE` | optional | stop calling the Admin API when this many calls are left in the hour (default 5) |
| `S2S_DEBUG_ADMIN` | optional | `1` sends `x-s2s-admin-calls` debug headers in production too |

</details>

<details>
<summary><b>Scripts</b></summary>

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint`, `npm run typecheck` | ESLint, `tsc --noEmit` |
| `npm test` | 137 unit tests (Node's test runner): key pool, session and signing, sample and showcase write protection, SSRF guard, QA rules, URL builders, retouch plans, briefs, cost ledger, facts, the Admin API circuit breaker and the credit floor against a fake Cloudinary, SDK error scrubbing, shelf slugs, OG URLs, BMP decoding, readiness scoring, showcase data |
| `npm run secret-scan` | fails if any private value from `.env.local` appears in a tracked file, the staged diff or git history; prints variable **names** only |
| `npm run setup:cloudinary` | idempotent: upload preset `s2s_ingest`, named transformations from `lib/transform/named.ts` |
| `npm run seed:scenes` | the scene library (idempotent: prompt-hash ids are never regenerated) |
| `npm run seed:showcase` | builds the five sample kits from the sample photos with the same library functions the routes use, and writes `data/showcase.json` (pack, reel, signed ZIP, timings and every QA attempt) |
| `node --conditions=react-server --import tsx scripts/seed-shelf.mts` | Collection mode on one scene, then publishes `/shelf/demo-studio` |
| `npm run media:gif` | records the README's demo loop from the live site: `docs/media/demo.gif`, `demo-social.mp4` and `poster.png` ([`scripts/media/capture.py`](scripts/media/capture.py); Python Playwright + Pillow + ffmpeg; `--base http://localhost:3000` records a local build). It loads pre-rendered pages only, so it makes no generation, AI Vision or Admin API calls |
| `npm run spikes` | re-runs the Day-0 spikes (spends a little quota) |
| `node scripts/spikes/00-usage.mjs` | reads Admin API usage for every configured environment (free, read-only) |
| `node --conditions=react-server --import tsx scripts/e2e-pipeline.mts` | live end-to-end run of the pipeline library (upload → analyze → cut-out → composite → QA → pack → zip → one Creative job) |
| `node --conditions=react-server --import tsx scripts/e2e-http.mts` | every route over HTTP against `next dev`, plus negative cases and the pool-name leak scan |
| `node --conditions=react-server --import tsx scripts/e2e-v2.mts` | brief, scene match and reuse, one new draft scene, auto-retouch on clean, messy and degraded photos, the cost ledger, over HTTP |
| `node scripts/vercel-env-sync.mjs` | pushes `.env.local` to the linked Vercel project through stdin (values never printed) |

</details>

---

## How we built it with AI

**Starting point: the Cloudinary Next.js AI Starter Kit.** We scaffolded with `npx create-cloudinary-next --headless`, which gave us a Next.js 16 template with Cloudinary wiring, Claude Code configuration and the Cloudinary MCP servers. We hit two bugs on Windows; both reports are drafted, with steps to reproduce and a suggested fix, in [`docs/UPSTREAM_ISSUES.md`](docs/UPSTREAM_ISSUES.md) and have not been filed yet:

1. **`spawnSync npx ENOENT` on Windows.** The CLI launches `npx` with `spawnSync` and no shell, and Windows can't resolve `npx` without one (it needs `shell: true` on `win32`).
2. **The skills-path lookup skips subfolders.** Its Skills Pack installer looks for skills directly under `skills/<name>`, but the pack keeps them in `skills/frameworks/…` and `skills/platform/…` (see the `skillPath` values in [`skills-lock.json`](skills-lock.json)), so nothing was installed. We installed the pack with `npx skills add cloudinary-devs/skills` instead.

**The Cloudinary Skills Pack** ([cloudinary-devs/skills](https://github.com/cloudinary-devs/skills)) is installed in [`.claude/skills/`](.claude/skills/): `cloudinary-next`, `cloudinary-react`, `cloudinary-transformations` and `cloudinary-docs`. They gave the coding agents Cloudinary's own guidance on signed uploads, `CldUploadWidget` and `CldImage`, transformation syntax and debugging, named transformations and transformation costs (the 75- and 50-transformation figures above come from its cost reference), and a way to look anything else up in the current docs through `llms.txt`.

**Cloudinary MCP servers** (`cloudinary-asset-mgmt` and `cloudinary-env-config`) came configured in [`.mcp.json`](.mcp.json) with the starter kit.

**Claude Code (Claude Opus 5.5) as the lead engineer of a small parallel team.** One lead session wrote the contracts first ([`lib/types.ts`](lib/types.ts), [`lib/api-contract.ts`](lib/api-contract.ts)) and ran Day-0 spikes against the live APIs so every later decision was based on measured numbers ([`SPIKES.md`](SPIKES.md)). It then briefed sub-agents, each in its own git worktree and branch, working in parallel: the pipeline and API routes, the transformations, the UI, the shop shelf and Readiness Score, the director's cut, the showcase, the second pipeline wave (auto-retouch, brief bar, scenes on demand, cost ledger), backend hardening, and these docs. The lead reviewed and merged each branch. The headline numbers and disclosures live in one file, [`lib/claims.ts`](lib/claims.ts), and every figure in this README comes from it, [`SPIKES.md`](SPIKES.md), [`data/showcase.json`](data/showcase.json), the tests or the code. Commits are co-authored by Claude, and `npm run secret-scan` runs before every commit.

**Models inside the app:** `flux-2-flash` and `gpt-image-2.5-flare` (scene plates), `nano-banana-2-edit` and `flux-2-flash-edit` (Creative mode), Cloudinary AI Vision (product JSON, Scene DNA, briefs, retouch signals, QA, readiness), Cloudinary captioning (alt text), plus Cloudinary's generative fill, recolor, remove and restore, and AI enhance, improve and upscale inside transformations.

---

## Security

- **Signed uploads with an allowlist.** `/api/sign-upload` signs only `timestamp`, `source`, `upload_preset` (must be `s2s_ingest`), `public_id` (must match `^snap2shelf/products/[a-z0-9]{8}/raw$`), known tags and two context keys, with a 10-minute clock-skew limit. The preset itself is signed, never overwrites, caps images at 2400 px and accepts image formats only. ([`lib/server/upload-sign.ts`](lib/server/upload-sign.ts))
- **Server-only secrets, sanitised errors.** Credentials are read only in `server-only` modules and passed per call; no SDK is configured globally in the app. Every Cloudinary SDK rejection is rebuilt from a scrubbed message and the HTTP code, so the API secret can't reach a log, and error responses never include upstream details. ([`lib/cloudinary/safe.ts`](lib/cloudinary/safe.ts))
- **SSRF and cost-abuse guard.** Any image URL a client sends (QA, pack) must be an `https://res.cloudinary.com/<our cloud>/image/upload/…` URL for one of our own public ID prefixes, with no query, no userinfo and no `..`, and it may not contain remote-fetch layers (`l_fetch:`), generative effects (`e_gen_*`, `b_gen_fill`), background removal or `fl_attachment`. ([`lib/server/guard.ts`](lib/server/guard.ts))
- **Sealed, session-bound job tokens.** Creative and scene job handles are AES-256-GCM encrypted and authenticated with separate derived keys, expire after 2 hours, and only work for the session that started them (anyone else gets the same 404 as an unknown token). ([`lib/server/job-token.ts`](lib/server/job-token.ts), [`lib/server/scene-job-token.ts`](lib/server/scene-job-token.ts))
- **Access code, caps and floors.** Live generation needs the access code (constant-time comparison, with a delay on wrong guesses), an HMAC-signed httpOnly session cookie counts generations and open operations, and the pool floor and the transformation-credit floor switch the app to the samples before quota runs out. ([`lib/server/session.ts`](lib/server/session.ts), [`app/api/access/route.ts`](app/api/access/route.ts), [`lib/server/budget.ts`](lib/server/budget.ts))
- **Secret scan before every commit.** [`scripts/secret-scan.mjs`](scripts/secret-scan.mjs) checks every private value from `.env.local` against tracked files, the staged diff and the full git history, plus generic credential patterns.

---

## Limitations and roadmap

- **The sample photos are AI-generated test images.** They exercise the pipeline honestly (the product pixels in every Exact kit are the input's pixels), but they are not real seller photos.
- **Visual Search isn't available on the Free plan** (the docs list it as Enterprise-only, and nothing is indexed), so scene reuse uses prompt-hash public IDs, theme tags and a keyword ranking (`/api/scenes/match`) instead of "find a similar scene".
- **Quality analysis returns only `focus` on the Free plan.** Exposure comes from our own 16×16 brightness probe instead; noise isn't graded.
- **Captioning via `explicit(..., { detection: "captioning" })` returned no caption for an existing asset**; we call the Analyze API endpoint instead.
- **Light-match nudges the product's colours slightly** (a gentle `e_tint` toward the scene's light). It is a toggle, and the marketplace image always uses the untouched cut-out.
- **Collection mode and publishing a shelf are API routes today.** `/shelf/demo-studio` was built through them by [`scripts/seed-shelf.mts`](scripts/seed-shelf.mts); the studio doesn't have buttons for them yet.
- **Named transformations are created but not used** in delivered URLs, so X-ray can show every step. Switching the pack to `t_s2s_*` is one option (`channelAssets({ named: true })`).
- **Pool and breaker state is per server instance** on serverless. Main's usage reading is shared through `usage-main.json`; for the pool environments, the real-time `limits` block in each response covers the gap, and the worst case is one quota error that benches an environment.
- **Signed ZIP links expire.** A live kit's zip link is signed for 1 hour (ask again for a new one); the sample kits' links are valid until 29 Dec 2026.
- **Next:** Blend mode (a third generation mode, named in `lib/types.ts` but not built); Collection and shelf publishing in the studio UI; `notification_url` webhooks instead of polling for generation jobs; structured metadata instead of free-form context; more Indian languages for offers through Noto fonts (today the overlay carries Hindi and English lines).

---

## License

[MIT](LICENSE). Portions of the template are © Cloudinary Developers (create-cloudinary-next).

## Acknowledgements

- **HackIndia** for running Pixels to Products, and for approving the disclosed key pool.
- **Cloudinary** for the platform, the Next.js AI Starter Kit, the Skills Pack and the MCP servers, and the DevRel team for judging.
- Google Fonts' **Noto Sans** and **Noto Sans Devanagari**, which Cloudinary renders straight from a URL.
