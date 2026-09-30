# Demo video script — Snap2Shelf

**Target length:** 3:00 (hard limits 2:45–3:15). **Format:** 1920×1080, 30 fps, voice-over recorded separately, captions burned in.
**Rule:** no title card first. The first frame is a hand, a phone and a product.

Routes used: `/` (landing), `/studio`, `/capture` (phone), `/present` (director's cut, owned by the present workstream), `/video/title` and `/video/outro` (cards, same workstream), `/shelf/<shop>` (shelf workstream).
<!-- TODO(final): re-check every label marked "(confirm)" against the merged UI the night before recording. -->

## Before you record (warm-up, 15 minutes)

1. **Warm the demo account.** Run the exact product and scene you will film through the whole flow once, 10–30 minutes before recording, so every derivative (cut-out, composite, `b_gen_fill` story and banner, `e_gen_recolor` variants, reel) is already rendered and cached. On camera, nothing should take the 6–7 s a first `b_gen_fill` render takes.
2. Check `https://snap2shelf.vercel.app/api/usage` shows `"liveGeneration": true` if you will generate live. For the QA-rejection beat, use the **saved** Fast draft example (it is part of the showcase) rather than a live generation, so the take is repeatable.
3. Screen: **1920×1080**, browser zoom **125%**, a clean Chrome profile or incognito window with no extensions, bookmarks bar hidden, notifications off (Windows Focus / macOS Do Not Disturb), and the phone on Do Not Disturb.
4. **Never show** `.env.local`, a terminal, DevTools, the Vercel or Cloudinary dashboards with keys, or the access code. Type the access code off-camera, or cut around it.
5. Phone: mirror it (scrcpy / QuickTime) or film it with a second camera from above. Clean the lens. Use a real product on a real table (a steel bottle or a sneaker reads best).
6. Record the voice-over separately after the screen take, then cut picture to voice.

## Shot list

| Time | Shot (what is on screen) | Click path / action | Voice-over | On-screen caption |
|---|---|---|---|---|
| **0:00–0:10** | Cold open. Over-the-shoulder: laptop shows the QR dialog; a hand points the phone at it and photographs a steel bottle on a kitchen table. | Laptop: `/` → **Snap with your phone** (QR dialog opens). Phone: scan → `/capture?sku=…` → **Open camera** → take the photo. | "This is a water bottle on my kitchen table. One photo, from my phone." | One phone photo. |
| **0:10–0:25** | Laptop: the photo lands on its own; the pipeline rail lights up step by step. | No click: the QR dialog closes and `/studio?sku=…` opens. Let **Fix → Cut out → Stage → Light-match → QA → Pack** run. | "Snap2Shelf reads it, cuts the product out once, and stages it on a festive scene. That's my real bottle, not an AI redraw." | Fix → Cut out → Stage → Light-match → QA → Pack |
| **0:25–0:42** | The kit deals out card by card, each in its frame: feed post, story, marketplace listing, WhatsApp tile, web banner, colour variants, Hindi offer. | Scroll to **Your shelf: N assets** as the cards deal in. | "Then it deals out the whole shelf: a story, a banner, a marketplace-white main image, a WhatsApp tile, colour variants and a Diwali offer in Hindi and English." | Every format from one photo. <!-- TODO(final): use the real asset count from "Your shelf: N assets" --> |
| **0:42–0:52** | The Kit Reel plays full-screen in its 9:16 frame. | Click the reel card (confirm). | "Even the video reel." | A 12-second reel, made by one URL. |
| **0:52–1:03** | Phone: WhatsApp chat; paste the shelf link; the link-preview card (four products, shop name) unfurls; tap it and the `/shelf/<shop>` page opens. | Laptop: **Copy kit link** (or the shelf's share button, confirm). Phone: paste into a WhatsApp chat to yourself. | "And a shop shelf I can share straight to WhatsApp, with its own preview image." | Share the shelf, not a folder of files. |
| **1:03–1:10** | `/video/title` card. | Cut to the card. | "I'm `<YOUR_NAME>`. This is Snap2Shelf, for Track 2: Generative Content Workflows." | **Snap2Shelf** · One photo. A whole shelf. |
| **1:10–1:35** | **The QA catch.** `/present` (or the studio's Creative panel): the Fast draft take next to the reference, then the fidelity sheet with the red REJECTED badge and its reasons; then the Faithful take with a green APPROVED. | `/present` → the "QA catch" chapter (confirm). Hover the badge so the reasons show. | "Here's why that matters. We asked a fast image model to reshoot this sneaker. It looks great, and it's wrong: it invented a logo badge and added a ghost second shoe. Cloudinary AI Vision compares every AI take with the original, side by side, and rejects it. The slower model kept the product exactly, so it passes." | AI Vision: `product-redesigned` · `extra-product` → REJECTED |
| **1:35–2:00** | **The X-ray reveal.** Open the hero's X-ray: the full URL, colour-coded, then each segment highlighting with its plain-language label. | Hero card → code button (`</>`) → X-ray sheet. Slowly hover the shadow, layer and light-match segments. | "Everything you've seen is a Cloudinary URL. No image files, no GPU server. This one is the scene, then my product as a layer, then a shadow projected from the product's own silhouette with `e_distort`, then a warm light-match with `e_tint` and `e_screen`. Move a slider and it's just a new URL." | No image files. Just URLs. |
| **2:00–2:20** | **Scene DNA overlay.** `/present` shows the scene plate with the anchor point, a light-direction arrow and the text zone drawn on top, then the product dropping onto the anchor and its shadow swinging to match. | `/present` → the "Scene DNA" chapter (confirm). | "How does it know where the table is and where the light comes from? When a scene is added to the library, AI Vision reads it once. We call that Scene DNA. It decides where the product stands, which way the shadow falls and where the offer text can go." | Scene DNA: anchor (0.50, 0.65) · light 270° at 20° · warm |
| **2:20–2:38** | **The cost beat.** The kit receipt: generation credits, credits saved by scene reuse, AI Vision tokens, seconds from photo to kit. | Studio receipt panel or `/present` "Receipt" chapter (confirm). | "And it's cheap. Exact mode spends zero image-generation credits: the scene was generated once and every product reuses it. Early on, 'auto' model selection cost us 72 credits where we'd planned 48, so every model is now pinned." | This kit: 0 generation credits. <!-- TODO(final): the receipt's real numbers (credits saved, tokens, seconds) --> |
| **2:38–2:55** | Architecture diagram (from the README), then a quick pan over the repo: `SPIKES.md`, `.claude/skills`, the worktree branches. | Browser tab with the README's architecture image; then GitHub. | "Cloudinary is the whole backend: uploads, AI Vision, image generation, transformations, video, tags as the database, and delivery. AI calls are balanced across three Cloudinary environments, which the organisers approved, and it's disclosed in the README. I built it with Claude Code running parallel agents, using Cloudinary's Starter Kit and Skills Pack." | Cloudinary is the whole backend. |
| **2:55–3:05** | `/video/outro` card: live URL, repo, "Try it: no signup". | Cut to the card; hold 4 s. | "Try it yourself, no signup: snap2shelf.vercel.app." | snap2shelf.vercel.app · github.com/GODOSTROYER/snap2shelf |

Running time: about **3:05**. If it runs long, trim the architecture beat (2:38) first, then the reel (0:42).

## Voice-over, clean read

> This is a water bottle on my kitchen table. One photo, from my phone.
>
> Snap2Shelf reads it, cuts the product out once, and stages it on a festive scene. That's my real bottle, not an AI redraw.
>
> Then it deals out the whole shelf: a story, a banner, a marketplace-white main image, a WhatsApp tile, colour variants and a Diwali offer in Hindi and English. Even the video reel. And a shop shelf I can share straight to WhatsApp, with its own preview image.
>
> I'm `<YOUR_NAME>`. This is Snap2Shelf, for Track 2: Generative Content Workflows.
>
> Here's why that matters. We asked a fast image model to reshoot this sneaker. It looks great, and it's wrong: it invented a logo badge and added a ghost second shoe. Cloudinary AI Vision compares every AI take with the original, side by side, and rejects it. The slower model kept the product exactly, so it passes.
>
> Everything you've seen is a Cloudinary URL. No image files, no GPU server. This one is the scene, then my product as a layer, then a shadow projected from the product's own silhouette, then a warm light-match. Move a slider and it's just a new URL.
>
> How does it know where the table is and where the light comes from? When a scene is added to the library, AI Vision reads it once. We call that Scene DNA. It decides where the product stands, which way the shadow falls and where the offer text can go.
>
> And it's cheap. Exact mode spends zero image-generation credits: the scene was generated once and every product reuses it. Early on, "auto" model selection cost us 72 credits where we'd planned 48, so every model is now pinned.
>
> Cloudinary is the whole backend: uploads, AI Vision, image generation, transformations, video, tags as the database, and delivery. AI calls are balanced across three Cloudinary environments, which the organisers approved, and it's disclosed in the README. I built it with Claude Code running parallel agents, using Cloudinary's Starter Kit and Skills Pack.
>
> Try it yourself, no signup: snap2shelf.vercel.app.

About 400 words, which reads in roughly 2:50 at a relaxed pace.

## Facts the voice-over relies on (all from the repo)

| Claim | Source |
|---|---|
| Fast draft (`flux-2-flash-edit`) invented a logo badge and a ghost second shoe; AI Vision matched `product-redesigned`, `extra-product`, `garbled-text`; `nano-banana-2-edit` matched `same-product` | `SPIKES.md` §2 and §3b |
| Cast shadow projected from the product's own silhouette with `e_distort`; light-match with `e_tint`, `e_screen`, `e_multiply` | `lib/transform/composite.ts` |
| Scene DNA values for the Diwali plate: anchor (0.50, 0.65), light 270° at 20°, warm | the plate's context (`snap2shelf/scenes/diwali/final-59f4388a`) |
| Exact mode: 0 generation credits; scene library cost 72 credits against 48 planned under `mode: "auto"` | `SPIKES.md` §1 |
| Kit Reel: 12.0 s, 720×1280 H.264 for 4 clips of 3 s | `lib/transform/reel.ts` commit, measured |
| Three environments in the key pool, organiser-approved and disclosed | `SPIKES.md` "Key pool", `README.md` |

## Export checklist

- [ ] 1080p, H.264, under the platform's size limit; captions burned in and also uploaded as an `.srt`.
- [ ] Watch it once with the sound off: does every beat still make sense from the captions?
- [ ] No keys, no `.env.local`, no access code, no pool environment names anywhere in frame.
- [ ] Upload (YouTube unlisted or Loom), then paste the link into `README.md` (Demo video), `docs/SUBMISSION_CHECKLIST.md` and both social posts.
