# Cloudinary hackathon survey — draft answers

Survey: **https://cld.media/hackathon-survey** (a Google Form). The questions below are copied from the live form (checked 30 Sep 2026), in order. Short-answer fields are one line; paragraph fields can be longer.

Fill the placeholders, paste, submit, and screenshot the confirmation for `docs/SUBMISSION_CHECKLIST.md`.

---

### Hackathon Name *(required, choice)*
**Hack India 2026**

### Team name *(required)*
`<TEAM_NAME — solo entry; e.g. "Snap2Shelf", confirm what the HackIndia registration uses>`

### Contact email *(required)*
`<CONTACT_EMAIL — the owner's email>`

### Brief project description *(required, one line)*
> Snap2Shelf turns one phone photo of a product into a full, listing-ready shelf (hero, story, banner, marketplace-white, WhatsApp tile, colour variants, Hindi/English offer, video reel, zip and a shareable shop page), staging the real product on AI-generated scenes and using Cloudinary AI Vision to reject any AI output that changes the product.

### Project URL *(required)*
**https://snap2shelf.vercel.app**

### GitHub URL *(required)*
**https://github.com/GODOSTROYER/snap2shelf**

### What were your project's media needs and how did you use Cloudinary? *(required, paragraph)*

> Small sellers need many images per product (marketplace main image on pure white, feed, story, banner, catalogue tile, colour variants, festive offers, a short video) from one phone photo, and they need the product in every image to be exactly the product they ship. Cloudinary is our entire backend; there is no database and no image server of our own.
>
> - **Ingest:** signed uploads through the Upload Widget and a signed upload preset (incoming `c_limit` to 2400 px), from the laptop or from a phone via a QR code.
> - **Understand:** AI Content Analysis captioning for alt text, `quality_analysis` for focus, and AI Vision General returning strict JSON: what the product is, which part can be recoloured, and whether it stands or lies flat.
> - **Cut out once:** `e_background_removal/e_trim/f_png`, saved as its own asset and reused everywhere.
> - **Scenes:** Image Generation `text_to_image` built a shared library of 16 scene plates once (models pinned by id). AI Vision read each plate's "Scene DNA": surface anchor, light direction and elevation, colour temperature, glossiness and a safe text zone.
> - **Exact mode:** the hero is one transformation URL: the real cut-out as a layer placed from Scene DNA, a cast shadow projected from the product's own silhouette with `e_distort`, contact shadows, a reflection on glossy surfaces, and light-match with `e_tint`, `e_screen` and `e_multiply`, with `fl_no_overflow` and `c_mpad` padding.
> - **Creative mode:** Image Generation `image_to_image` with the cut-out as the reference and an explicit model picker plus seed.
> - **QA:** AI Vision Tagging and General on a reference-vs-candidate "fidelity sheet" (one transformation URL) reject AI takes that redesign the product.
> - **Channel Pack:** `b_gen_fill` for 9:16 and 16:9, `c_mpad` for a 2000 px marketplace-white image, `e_gen_recolor` on a named part, `l_text` with Google Noto fonts for Hindi + English offers, named transformations, upload-by-URL to save each format, `download_zip_url` by tag, and a Kit Reel from stills with `e_zoompan` + `fl_splice`.
> - **Data and delivery:** tags and contextual metadata are the database; the scene library is read from the client-side list JSON; everything is delivered with `f_auto,q_auto` (our hero went from 268,847 to 87,598 bytes as WebP); a dynamic OG image makes shared shelves unfurl in WhatsApp.
> - **Quota:** the Admin `usage` API and each response's `limits` block drive a disclosed, organiser-approved key pool that balances AI calls across three Cloudinary environments and copies every result back into the main one.

### Please rate Cloudinary *(required, 1–5)*
`<RATING — owner's call>` Suggested: **5**. Why: one platform covered storage, AI analysis, generation, a URL-based rendering engine that was expressive enough for projected shadows and light-matching, video, a zip archive, metadata-as-database and CDN delivery, all on the Free plan. The rough edges we hit (listed under "Product feedback" below) were all workable once measured.

### Which of the below did you use? *(required, checkboxes)*
- [x] **Next.js Starter Kit** (`npx create-cloudinary-next --headless`)
- [x] **Skills Pack** (`npx skills add cloudinary-devs/skills`: `cloudinary-next`, `cloudinary-react`, `cloudinary-transformations`, `cloudinary-docs`)
- [ ] React AI Starter Kit
- [ ] AI Power Start Prompt <!-- TODO(final): tick only if the owner actually used it -->

### If you used a starter kit, please rate it *(1–5)*
`<RATING — owner's call>` Suggested: **3**. The template itself was a good start (Next.js 16, Cloudinary wiring, Claude Code and MCP configuration), but on Windows it failed twice before it worked; see "Product feedback".

### If you used it, please rate the Skills Pack *(1–5)*
`<RATING — owner's call>` Suggested: **5**. It visibly shaped the code (examples below) and kept the agents from guessing at transformation syntax.

### If you used prompt engineering to build, what prompts did you try? What worked and what didn't? If you had the Skills Pack installed, did you note whether/how often the LLM made use of it? *(required, paragraph)*

> **Building (Claude Code, Claude Opus 5.5):** one lead session wrote the shared contracts (types and the HTTP API) first, then ran "Day-0 spikes": small scripts that call every Cloudinary API we planned to use and log the real cost, latency and response shape. Every later brief to a sub-agent said "numbers must come from the spikes, never guess". The sub-agents worked in parallel git worktrees (pipeline, transformations, UI, shelf, presentation, showcase, docs). What worked: contracts first, measured facts in one file (SPIKES.md), and asking agents to verify every URL live (HTTP status, dimensions, frame grabs for video). What didn't: letting a model pick defaults (see `mode: "auto"` below).
>
> **Skills Pack:** installed in `.claude/skills`. We saw it used, for example: our named transformations keep `f_auto/q_auto` outside the `t_` name exactly as the `cloudinary-transformations` named-transformations reference shows; the cost figures in our scripts (75 transformations for background removal, 50 for `b_gen_fill` and `e_gen_recolor`) match its cost reference; and our signed-upload route is the `cloudinary-next` skill's `{ paramsToSign } → api_sign_request` pattern, extended with an allowlist. `<OWNER: add how often you noticed it being loaded, if you tracked it>`
>
> **Prompts inside the product:**
> - Scene plates: two fixed camera recipes (eye level about 15° above the surface with a clear foreground; or top-down with the central 60% empty) plus an explicit negative list ("No products, no packaging, no people, no hands, no text, no logos"). An AI Vision tagging pass (`contains-product`, `contains-text`, `contains-person`) rejects plates that ignore it.
> - Scene DNA and product JSON: "Return ONLY a JSON object" with every key, unit and convention spelled out ("degrees clockwise from the top: 0=top, 90=right…"), enums for categorical fields, then parse out of prose or code fences and validate with zod, with a safe fallback. Scene DNA came back valid 2/2 times in the spike.
> - Image-to-image: the seller's scene text is wrapped in fixed fidelity instructions ("the EXACT product shown in reference image [1] … do not redesign, restyle, recolour, add or remove any part"). What didn't work: prompting alone. `flux-2-flash-edit` still invented a logo badge and a ghost second shoe; `nano-banana-2-edit` kept the product. Model choice mattered more than wording, so we built a QA gate instead of trusting the prompt.
> - QA tag descriptions work best as visible evidence, not judgements: "a dark or light rectangle… with a straight hard edge" catches a clipped shadow; "looks fake" doesn't. For the side-by-side sheet, every description names the halves ("the product on the RIGHT half… the reference on the LEFT").
> - Recolor: prompting the whole object (`prompt_sneaker`) flooded the shoe with flat colour; prompting a part named by AI Vision (`prompt_suede panels`) kept the shading.
> - AI Vision's numeric fidelity score isn't calibrated (it scored a rejected image 85), so decisions use the tags and a boolean.

### Please send us a publicly-available link to a recording walking through your project
`<VIDEO_URL>` <!-- TODO(final): same link as the README's Demo video -->

### Please tell us what AI model(s) you used to build your solution
> Built with **Claude Opus 5.5** in **Claude Code** (lead plus parallel sub-agents). Inside the app, all through Cloudinary: Image Generation **flux-2-flash** and **gpt-image-2.5-flare** (scene plates; **nano-banana-2** was also picked by `mode: "auto"` for some plates), **nano-banana-2-edit** and **flux-2-flash-edit** (Creative mode), **Cloudinary AI Vision** (General + Tagging), **Cloudinary captioning** (AI Content Analysis), plus generative fill and generative recolor transformations.

### Are you interested in us following up via a conversation in the future? *(required)*
`<Yes / No — owner's call>` Suggested: **Yes**. The feedback below is more useful as a conversation.

---

## Product feedback (paste into the follow-up conversation; a condensed version fits the prompt-engineering answer)

The form has no dedicated feedback field. These are concrete, reproducible notes from building Snap2Shelf, each measured on the Free plan in September 2026.

**create-cloudinary-next**
1. On Windows, the CLI calls `spawnSync("npx", …)` without a shell and fails with `spawnSync npx ENOENT`. It needs `shell: true` on `win32` (or `npx.cmd`). <!-- TODO(final): link the GitHub issue -->
2. The Skills Pack install step looks for skills directly under `skills/<name>`, but `cloudinary-devs/skills` keeps them in `skills/frameworks/…` and `skills/platform/…`, so nothing was installed. Workaround: `npx skills add cloudinary-devs/skills`. <!-- TODO(final): link the GitHub issue -->

**AI Vision and Analyze**
3. `ai_vision_tagging` tag names must be lower-case letters, digits and hyphens: `product_visible` returns HTTP 400 `MA_00003`. We didn't find the rule in the docs, and the error message could name it.
4. Tagging returns only matched tags, with no confidence, and the General model's numeric scores aren't calibrated. A line in the docs would save people from building thresholds on them.
5. `explicit` with `detection: "captioning"` returned no caption for an existing asset; `POST /v2/analysis/{cloud}/analyze/captioning` worked. It would help if the docs said which path is supported for existing assets.
6. `quality_analysis` returns only `focus` on the Free plan; saying so in the docs would help.

**Image Generation**
7. `model: { mode: "auto" }` is not cost-stable: `preference: "economy_fast"` picked `nano-banana-2` (9–11 credits) for several drafts we budgeted at 1 credit, and `quality` once picked it over `gpt-image-2.5-flare` (4–5). Our 16 plates cost 72 credits against 48 planned. Showing the expected credit range per preference, or a max-credits parameter, would fix it.
8. `aspect_ratio` accepts only `1:1, 16:9, 9:16, 4:3, 3:4` (no 4:5, the most common feed ratio), and some models ignore it (`gpt-image-2.5-flare` returned 1024×1536 for 3:4).
9. The response `limits` block appears in different shapes (`limits.addons_quota[]`, `limits.items[]`, legacy `limits.usage`, and under `data.limits` for task polls). One documented shape would simplify quota tracking.
10. The Admin `usage` API reports `image_generation`, `ai_vision` and `object_detection` entries with `usage` and `limit`, which is exactly what a quota-aware app needs, but we couldn't find them documented.

**Transformations**
11. `e_dropshadow` inside a layer is clipped to the layer's box. Padding with transparency first (`c_mpad`, which never upscales, not `c_pad`) fixes it; an example in the docs would help.
12. `c_fit,w_1700,h_1700/c_pad,w_2000,h_2000,b_white` scales the product back up to fill 2000 px; `c_mpad` keeps it at 1700 (85%). Worth a note in the padding docs, since "product at 85% on white" is a very common marketplace requirement.
13. Building video from images (`image/upload/…/<id>.mp4` with `e_zoompan` + `fl_splice`): `fl_splice:transition_(name_fade;du_…)` is accepted but silently ignored (hard cuts); `e_zoompan` chooses its own output size (we saw 540×960 and 640×1138), and `fl_splice` then refuses clips of different sizes ("Concatenated videos sizes don't match") until each clip is scaled; a negative `e_fade` blacks a zoompan clip out early. Layers must be stored assets, not derived URLs.
14. `b_gen_fill` and `e_gen_recolor` need a non-transparent source, and a whole-object recolor prompt floods the object flat. Both could be called out in the generative AI docs.

**Delivery and listing**
15. The client-side list JSON (`/image/list/<tag>.json`) is cached (about 60 s) and ignores query strings, and a delivery URL's 404 is cached too. For "has this upload landed?" polling, a delivery URL with a fresh version component (`/image/upload/v<n>/<public_id>`) answered 200 within 0.8 s of the upload; the list took about 24 s and a query-string cache-buster about 3.7 s. Documenting the version trick for polling would help.
16. `GET /resources/visual_search?text=…` on a Free environment returns 200 with an empty list rather than an error explaining that Visual Search needs an Enterprise plan.
