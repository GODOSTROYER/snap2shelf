# Demo video script — Snap2Shelf

**Target length:** 3:00 (hard limits 2:45–3:15). **Format:** 1920×1080, 30 fps, voice-over recorded separately, captions burned in.
**Rule:** no title card first. The first frame is a hand, a phone and a product.

Routes used: `/` (landing), `/studio` (with the QR dialog), `/capture` (phone), `/studio?sample=shmessy1` (the recorded QA catch), `/shelf/demo-studio` (storefront), `/present` (director's cut), `/video/title` and `/video/outro` (cards).

`/present` chapters and their autoplay lengths, checked against `lib/present/chapters.ts` on 30 Sep (last changed in commit `c9448a7`). Other work on `/present` may still change them before recording: re-check the `seconds` values in that file, or press `N` for the presenter notes, which show each chapter's length, on the final build.

| `?c=` | Chapter | Autoplay |
|---|---|---|
| 1 | One photo | 6 s |
| 2 | The pipeline | 8 s |
| 3 | Cut out once | 9 s |
| 4 | Scene DNA | 12 s |
| 5 | Every stage | 9 s |
| 6 | QA gate | 11 s |
| 7 | Channel pack | 10 s |
| 8 | Kit reel | the reel's length + 1 s, kept between 8 and 13 s: 10 s for the featured sample's 9-second reel |
| 9 | It's a URL | 12 s |
| 10 | What it cost | 9 s |
| 11 | The shelf | 9 s |
| 12 | Snap2Shelf | 8 s |

A full `?auto=1&clean=1` run is about **1:53**. A chapter whose data is missing is skipped (QA gate, Every stage, Channel pack, Kit reel), which renumbers the ones after it. Keys: → or Space next, ← back, P autoplay, R restart; `?c=<n>` starts at chapter n (counted from 1), `?clean=1` hides the controls.

A silent loop of about 20 seconds (the studio replay, the X-ray and the shop) is already rendered for B-roll or the social posts: `docs/media/demo-social.mp4` (1280×720) and `docs/media/demo.gif`, regenerated with `npm run media:gif`.

Every number spoken or captioned below comes from `lib/claims.ts`, `SPIKES.md` or `data/showcase.json` (see "Facts the voice-over relies on"). Don't add a number that isn't in that table.

## Before you record (pre-warm, 15 minutes)

1. **Check quota.** Open `https://snap2shelf.vercel.app/api/usage`. You need `"livePipeline": true` (live kit building is on), `"liveGeneration": true` if you will generate live, and `transformations.usedCredits` comfortably below `floorCredits` (21). A live kit derives roughly 300 transformations, about 0.3 credits. If `livePipeline` is false, the live beats will show the saved samples instead: record the sample replay for those beats.
2. **Pre-warm the routes you will film**, in the recording browser, so nothing decodes on camera:
   - `/studio?sample=shmessy1`: let the replay run to the end once (it makes no API calls, but it warms the images).
   - `/present?c=1`: step through every chapter once; the deck preloads each chapter's images.
   - `/shelf/demo-studio`, and paste its link into a WhatsApp chat to yourself once, so WhatsApp has fetched the link preview before you film it.
   - `/video/title` and `/video/outro`.
3. **Rehearse the live capture once** with the product you will film. A new photo is a new product, so its derivatives can't be pre-warmed: a first `b_gen_fill` takes 6–7 s. Cut dead time in the edit if you need to, but never caption a speed faster than the measured **36 s photo → ZIP**.
4. Screen: **1920×1080**, browser zoom **125%**, a clean Chrome profile or incognito window with no extensions, bookmarks bar hidden, notifications off (Windows Focus / macOS Do Not Disturb), and the phone on Do Not Disturb.
5. **Never show** `.env.local`, a terminal, DevTools, the Vercel or Cloudinary dashboards with keys, or the access code. Type the access code off-camera, or cut around it.
6. Phone: mirror it (scrcpy / QuickTime) or film it with a second camera from above. Clean the lens. Use a real product on a real table (a steel bottle or a sneaker reads best).
7. Record the voice-over separately after the screen take, then cut picture to voice.

## Shot list

| Time | Shot (what is on screen) | Click path / action | Voice-over | On-screen caption |
|---|---|---|---|---|
| **0:00–0:10** | **Cold open: the QR capture.** Over-the-shoulder: the laptop shows the QR dialog; a hand points the phone at it and photographs a steel bottle on a kitchen table. | Laptop: `/` → **Snap with your phone** (QR dialog opens). Phone: scan → `/capture` → **Open camera** → take the photo. | "This is a water bottle on my kitchen table. One photo, from my phone." | One phone photo. |
| **0:10–0:24** | Laptop: the photo lands on its own and the pipeline rail lights up step by step. Optional: type the brief into the brief bar while the rail runs. | No click: the studio opens with the photo. Let **Fix → Cut out → Stage → Light-match → QA → Pack** run. Optional brief: *Diwali sale, 20% off, Hindi and English, for Instagram and WhatsApp*. | "Snap2Shelf reads it, touches up the photo if it needs it, cuts the product out once, and stages it on a festive scene. That's my real bottle, not an AI redraw." | Fix → Cut out → Stage → Light-match → QA → Pack |
| **0:24–0:40** | **The kit deals out**, card by card, each in its frame: feed post, story, marketplace listing, WhatsApp tile, web banner, colour variants, Hindi + English offer. | Scroll to **Your shelf: N assets** as the cards deal in (the sample bottle has 10). | "Then it deals out the whole shelf: a story, a banner, a marketplace-white main image, a WhatsApp tile, colour variants and a Diwali offer in Hindi and English. Photo to zip took thirty-six seconds when we measured it on the live site." | 36 s photo → ZIP, measured on the live site |
| **0:40–0:48** | The Kit Reel plays in its 9:16 frame. | Play the reel card. | "Even the video reel is one URL." | A video reel, made by one URL. |
| **0:48–0:58** | **Readiness Score** under the kit: the gauge fills, the checklist shows pure white background and fill measured on pixels. | Scroll to the Readiness panel. | "It checks the listing like a marketplace would, on the actual pixels: pure white background, the product filling the frame, sharp enough to zoom." | Readiness Score, measured on pixels |
| **0:58–1:08** | Phone: `/shelf/demo-studio`, **Share on WhatsApp**; in the chat the link preview (a collage of four products and the shop name) unfurls; tap it and the shelf opens. | Phone browser: `snap2shelf.vercel.app/shelf/demo-studio` → **Share on WhatsApp** → send to yourself. | "And every product lands on a shop shelf I can share straight to WhatsApp, with its own preview image." | Share the shelf, not a folder of files. |
| **1:08–1:14** | `/video/title` card. | Cut to the card. | "I'm `<YOUR_NAME>`. This is Snap2Shelf, for Track 2: Generative Content Workflows." | **Snap2Shelf** · One photo. A whole shelf. |
| **1:14–1:30** | **The QA catch, part 1 (real replay).** `/studio?sample=shmessy1`: the rail's QA step reads "QA caught it: The product looks like it is floating or pasted on. Fixing it automatically…", then "Auto-fixed: set it 20 px lower, onto the surface. Approved". | Start the sample; frame the rail and the stage. | "Every image goes through a QA gate. Here Cloudinary AI Vision caught a bottle that looked like it was floating, and the studio set it down and checked again." | AI Vision: `product-floating` → auto-fixed → approved |
| **1:30–1:44** | **The QA catch, part 2 (the flux rejection).** `/present` → **QA gate**: the Fast draft take next to the reference with the red REJECTED badge and its marks; the Faithful take with a green APPROVED. | `/present?c=6`. Let the marks animate. | "In Creative mode an image model reshoots the product, so the gate compares every take with the original. The fast model invented a logo badge and added a ghost second shoe: rejected. The faithful model kept the product, so it passes." | `flux-2-flash-edit`: `product-redesigned` · `extra-product` → REJECTED |
| **1:44–2:02** | **The X-ray reveal.** `/present` → **It's a URL** (or the studio's **See the URL** button on the stage): the full URL, colour-coded, each segment highlighting with its plain-language label. | `/present?c=9`, or the stage's **See the URL**. | "Everything you've seen is a Cloudinary URL. No image files, no GPU server. The scene, then my product as a layer, then a shadow projected from the product's own silhouette, then a warm light-match. Move a slider and it's just a new URL." | No image files. Just URLs. |
| **2:02–2:20** | **Scene DNA.** `/present` → **Scene DNA**: the plate with the anchor, the light arrow and the text zone drawn on; the product drops onto the anchor and its shadow swings to match. Then **Every stage**: the same cut-out on other scenes. | `/present?c=4`, then → to **Every stage**. | "How does it know where the table is and where the light comes from? When a scene joins the library, AI Vision reads it once. We call that Scene DNA. The same real cut-out then goes onto any scene." | Scene DNA: surface, light, text zone |
| **2:20–2:36** | **The cost beat.** `/present` → **What it cost**, or the kit's cost receipt: new generation credits 0, credits saved by reuse, AI Vision tokens, original versus delivered size. | `/present?c=10`. | "And it's cheap. Zero new generation credits: the scene is reused from the library. A basic studio shoot for one product would be around two and a half thousand rupees, by our estimate. Early on, 'auto' model selection cost us 72 credits where we'd planned 48, so every model is now pinned." | 0 new generation credits · the scene is reused from the library |
| **2:36–2:52** | Architecture diagram (from the README), then a quick pan over the repo: `SPIKES.md`, `lib/claims.ts`, `.claude/skills`. | Browser tab with the README's architecture image; then GitHub. | "Cloudinary is the whole backend: uploads, AI Vision, image generation, transformations, video, tags as the database, and delivery. AI calls are balanced across three Cloudinary environments, which the organisers approved, and it's disclosed in the README. I built it with Claude Code running parallel agents, using Cloudinary's Starter Kit and Skills Pack." | Cloudinary is the whole backend. |
| **2:52–3:02** | `/video/outro` card: live URL, repo, "Try it: no signup". | Cut to the card; hold 4 s. | "Try it yourself, no signup: snap2shelf.vercel.app." | snap2shelf.vercel.app · github.com/GODOSTROYER/snap2shelf |

Running time: about **3:02**. If it runs long, trim the architecture beat (2:36) first, then the reel (0:40), then the Readiness beat (0:48).

The chapter numbers in the click paths (`?c=6` and so on) assume the 12 chapters listed at the top, counted from 1; if the final build changes them, open the chapter rail and click the title instead.

## Voice-over, clean read

> This is a water bottle on my kitchen table. One photo, from my phone.
>
> Snap2Shelf reads it, touches up the photo if it needs it, cuts the product out once, and stages it on a festive scene. That's my real bottle, not an AI redraw.
>
> Then it deals out the whole shelf: a story, a banner, a marketplace-white main image, a WhatsApp tile, colour variants and a Diwali offer in Hindi and English. Photo to zip took thirty-six seconds when we measured it on the live site. Even the video reel is one URL.
>
> It checks the listing like a marketplace would, on the actual pixels: pure white background, the product filling the frame, sharp enough to zoom. And every product lands on a shop shelf I can share straight to WhatsApp, with its own preview image.
>
> I'm `<YOUR_NAME>`. This is Snap2Shelf, for Track 2: Generative Content Workflows.
>
> Every image goes through a QA gate. Here Cloudinary AI Vision caught a bottle that looked like it was floating, and the studio set it down and checked again. In Creative mode an image model reshoots the product, so the gate compares every take with the original. The fast model invented a logo badge and added a ghost second shoe: rejected. The faithful model kept the product, so it passes.
>
> Everything you've seen is a Cloudinary URL. No image files, no GPU server. The scene, then my product as a layer, then a shadow projected from the product's own silhouette, then a warm light-match. Move a slider and it's just a new URL.
>
> How does it know where the table is and where the light comes from? When a scene joins the library, AI Vision reads it once. We call that Scene DNA. The same real cut-out then goes onto any scene.
>
> And it's cheap. Zero new generation credits: the scene is reused from the library. A basic studio shoot for one product would be around two and a half thousand rupees, by our estimate. Early on, "auto" model selection cost us 72 credits where we'd planned 48, so every model is now pinned.
>
> Cloudinary is the whole backend: uploads, AI Vision, image generation, transformations, video, tags as the database, and delivery. AI calls are balanced across three Cloudinary environments, which the organisers approved, and it's disclosed in the README. I built it with Claude Code running parallel agents, using Cloudinary's Starter Kit and Skills Pack.
>
> Try it yourself, no signup: snap2shelf.vercel.app.

About 430 words, which reads in roughly 2:55 at a relaxed pace.

## Facts the voice-over relies on (all from the repo)

| Claim | Source |
|---|---|
| 36 s photo → ZIP, measured on the live site (30 Sep 2026, desktop, a sample photo, file selected → ZIP link) | `lib/claims.ts` `MEASURED_PHOTO_TO_ZIP_S`, `PHOTO_TO_KIT_MEASURED_COPY` |
| "Zero new generation credits: the scene is reused from the library" | `lib/claims.ts` `CREDITS_SAVED_COPY` |
| About ₹2,500 for a basic studio shoot of one product, an estimate (say "by our estimate") | `lib/claims.ts` `PHOTOSHOOT_INR_ESTIMATE`, `PHOTOSHOOT_NOTE` |
| Sample QA catch: check 1 matched `product-floating` (+ `compositing-artifact`), the approved check is 20 px lower | `data/showcase.json` (`shmessy1` attempts); the replay's wording is built by `lib/showcase.ts` |
| Fast draft (`flux-2-flash-edit`) invented a logo badge and a ghost second shoe; AI Vision matched `product-redesigned`, `extra-product`, `garbled-text`; `nano-banana-2-edit` matched `same-product` | `SPIKES.md` §2 and §3b; `/present` QA chapter (`lib/present/data.ts` `QA_EVIDENCE`) |
| Credits: `flux-2-flash-edit` 1, `nano-banana-2-edit` 9, draft scene 1, final scene 4–5 | `lib/claims.ts` `CREDITS`, `SPIKES.md` |
| Scene library cost 72 credits against 48 planned under `mode: "auto"` | `SPIKES.md` §1 |
| Readiness checks: white background and fill measured on pixels | `lib/readiness.ts`, `lib/shelf/measure.ts` |
| Cast shadow projected from the product's own silhouette with `e_distort`; light-match with `e_tint`, `e_screen`, `e_multiply` | `lib/transform/composite.ts` |
| The sample bottle's kit: 10 assets (9 formats + the reel) | `data/showcase.json` (`shmessy1`) |
| Three environments in the key pool, organiser-approved and disclosed | `SPIKES.md` "Key pool", `README.md` |

If you show a sample kit on screen for more than a moment, the studio already labels its input as a sample photo; don't call a sample "my product" in the voice-over. The live capture at the start is your own real product.

## Export checklist

- [ ] 1080p, H.264, under the platform's size limit; captions burned in and also uploaded as an `.srt`.
- [ ] Watch it once with the sound off: does every beat still make sense from the captions?
- [ ] No keys, no `.env.local`, no access code, no pool environment names anywhere in frame.
- [ ] Upload (YouTube unlisted or Loom), then paste the link into `README.md` (replace the "Video: coming Sat 3 Oct" line and its `TODO(video)` comment), `docs/SUBMISSION_CHECKLIST.md`, `docs/SURVEY_ANSWERS.md` and both social posts.
