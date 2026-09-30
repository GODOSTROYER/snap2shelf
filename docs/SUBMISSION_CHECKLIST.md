# Submission checklist

**Deadlines (IST):** feature freeze **Fri 2 Oct, 20:00** · submission **Sat 3 Oct, 20:00** · tag pushed before **Sun 4 Oct, 00:15**.

Work top to bottom. Nothing in this file is secret, and nothing secret may be added to it.

## Where things stand (Wed 30 Sep)

| Item | State |
|---|---|
| Live site | **Live:** https://snap2shelf.vercel.app (sample replay, kits, `/present`, `/shelf/demo-studio`) |
| Repository | **Public:** https://github.com/GODOSTROYER/snap2shelf, MIT `LICENSE` at the root |
| README | **Final pass done:** demo GIF at the top, a `## How it's built` section (anchor `#how-its-built`) with the architecture diagram and the key Cloudinary techniques, every number checked against `lib/claims.ts`, `SPIKES.md`, `data/showcase.json` and the code. One open slot: the video link. |
| Demo GIF and social clip | **Rendered** from the live site: `docs/media/demo.gif` (800 px, 12 fps, loops, under 6 MB), `docs/media/demo-social.mp4` (1280×720 H.264, silent, about 20 s), `docs/media/poster.png`. Re-render after the final deploy: `npm run media:gif`. |
| Demo video | **Picture-locked and rendered (3:08, 1080p), voice-over pending.** Outside the repo in `Z:\Projects\Cloudinary\video\`: `snap2shelf-walkthrough-picture.mp4` (for your voice-over), `snap2shelf-walkthrough-captioned.mp4` (works as-is, no voice needed), `VO_CUE_SHEET.md` (timecode → line to read) and `snap2shelf-walkthrough-captions.srt`. Re-render with `npm run media:video` (`--render-only` re-cuts without recording). Script: `docs/VIDEO_SCRIPT.md`. |
| Social posts | **Drafted, not posted:** `docs/SOCIAL_POSTS.md` (attach the MP4). |
| Cloudinary survey | **Drafted, not submitted:** `docs/SURVEY_ANSWERS.md`. |
| create-cloudinary-next bug reports | **Drafted, not filed:** `docs/UPSTREAM_ISSUES.md`. |
| Submission form | **Pending:** section 1 below. |

---

## 1. Submission form: what to paste

<!-- TODO(final): open the HackIndia submission form, compare its fields with this table, and add or rename rows to match it exactly. -->

| Field | Value to paste |
|---|---|
| Project name | **Snap2Shelf** |
| Tagline / one-liner | One photo. A whole shelf. AI builds the stage — your product stays real. |
| Track | **Track 2 — Generative Content Workflows** |
| Team | **Solo** · `<YOUR_NAME>` |
| Short description | Snap2Shelf turns one phone photo and a one-line brief into a full, listing-ready shelf (hero, story, banner, marketplace-white image with a Readiness Score, WhatsApp tile, colour variants, Hindi/English offer, video reel, zip and a shareable shop page), staging the real product on AI-generated scenes and using Cloudinary AI Vision to reject any AI output that changes the product. |
| Repository URL | **https://github.com/GODOSTROYER/snap2shelf** |
| Live demo URL | **https://snap2shelf.vercel.app** |
| Demo video URL | `<VIDEO_URL>` <!-- TODO(final) --> |
| LinkedIn post URL | `<LINKEDIN_POST_URL>` <!-- TODO(final): after posting docs/SOCIAL_POSTS.md --> |
| X post URL | `<X_POST_URL>` <!-- TODO(final) --> |
| Cloudinary survey | Done: yes, on `<DATE>`; confirmation screenshot saved as `<FILE>` <!-- TODO(final) --> |
| Access code for judges | **Paste the value of `DEMO_ACCESS_CODE` from `.env.local` directly into the form. Never commit it, never put it in the README, a post or the video.** |
| How to test (if asked) | No setup. Watch a recorded run with a real QA catch: https://snap2shelf.vercel.app/studio?sample=shmessy1 (no API calls). Press the `</>` button under any kit image to see the Cloudinary URL that made it. Storefront: https://snap2shelf.vercel.app/shelf/demo-studio. Director's cut: https://snap2shelf.vercel.app/present. To use your own photo, press **Snap with your phone** and scan the QR code, or upload in the studio. Live Creative-mode generation and new scenes need the access code above (4 generations per session). The sample products start from AI-generated test photos. |
| Tech used (if asked) | Cloudinary (Upload Widget + signed preset, AI Vision General and Tagging, AI Content Analysis captioning, Image Generation, background removal, AI retouch effects (`e_improve`, `e_enhance`, `e_gen_restore`, `e_gen_remove`, `e_upscale`), layers, generative fill, generative recolor, Google-font text overlays, video from stills, `f_bmp` pixel sampling, tags + context, raw JSON assets, client-side list, archive, f_auto/q_auto, Admin usage API), Next.js 16 on Vercel, Cloudinary Next.js Starter Kit + Skills Pack, Claude Code (Claude Opus 5.5) |
| Key pool disclosure (if there is a notes field) | AI calls rotate across three Cloudinary product environments with the organisers' approval; disclosed in the README under "The key pool". |

## 2. Pre-flight (do all of it, in order)

### Code and repo
- [ ] Feature freeze respected: only fixes after Fri 2 Oct 20:00.
- [ ] `npm run lint`, `npm run typecheck` and `npm run build` pass.
- [ ] `npm test` passes with 0 failures. The README's "Scripts" table says "over 130 unit tests" so it doesn't go stale as tests land; only change it if that stops being true.
- [ ] `npm run secret-scan` prints **clean** (it checks tracked files, the staged diff and the whole git history).
- [ ] `grep -rn "TODO" README.md` shows only the video slot (`TODO(video)`), and `grep -rn "TODO(final)" docs/` only the owner slots in section 3 (all are HTML comments, invisible on github.com). Fill the README video slot before submitting.
- [ ] README renders on github.com in **both** light and dark themes: every image loads, every table renders.
- [ ] Architecture diagram: after the docs branch is merged, re-upload it so the hosted PNG matches `docs/architecture.svg` (`node --import tsx scripts/docs/upload-diagram.mts`; it overwrites `snap2shelf/docs/architecture` on the main cloud). Then open `https://res.cloudinary.com/nyxyma1i/image/upload/f_png,w_1600/snap2shelf/docs/architecture` and check it shows the new route list.
- [ ] Every number on the site, in `/present` and in the README matches `lib/claims.ts` (35–58 s photo → ZIP in timed live runs; ₹2,500 labelled as an estimate; credits per model).
- [ ] Repository is **public**, `LICENSE` (MIT) is at the root, and the default branch contains the final merge.

### Quota and credit check (the morning of submission, and again before judging)
- [ ] Open `https://snap2shelf.vercel.app/api/usage` and read it:
  - `livePipeline: true`. When main's transformation credits reach `floorCredits` (24 of 25 with the pool offload on in production, 21 without), live kit building pauses and the site shows the saved samples. On 30 Sep at about 14:00 IST it read `usedCredits: 18.52`. A live kit derives roughly 300 transformations, about 0.3 credits, so plan the remaining live runs (rehearsals, the video, judges) against that margin.
  - `liveGeneration: true` and `generation.usable` comfortably above `LIVE_GEN_MIN` (12) plus what judges will spend (up to 4 per unlocked session).
  - `stale: false`. If it is `true`, the Admin API is rate limited right now; wait for the next hour and re-check.
- [ ] Run `node scripts/spikes/00-usage.mjs` for the per-environment numbers. **It prints environment names, so don't run it on a screen recording or screen share.**

### Pre-warm (15 minutes before recording, and again before judging starts)
- [ ] `/studio?sample=shmessy1`: let the replay run to the end once.
- [ ] `/kit/shbottle` and the other sample kit pages: open each once.
- [ ] `/present`: step through every chapter once (the deck preloads each chapter's images).
- [ ] `/shelf/demo-studio`: open it, and paste its link into a WhatsApp chat once so the link preview is fetched and cached.
- [ ] `/video/title` and `/video/outro`: open once.

### Live app
- [ ] **Incognito test** on a laptop: landing → **Try a sample product (no signup)** → the pipeline completes → **Your shelf** → the `</>` X-ray works → Readiness Score and cost receipt show → **Download all (.zip)** downloads → **Copy kit link** opens in a second incognito window.
- [ ] **Phone test on mobile data** (not office Wi-Fi): **Snap with your phone** → scan → **Open camera** → photo → the laptop picks it up → the kit builds, and the brief bar applies a brief.
- [ ] Access code: in a fresh incognito window, Creative mode unlocks with the code and one **Fast draft** take completes (1 credit).
- [ ] `/shelf/demo-studio` link pasted into WhatsApp unfurls with the collage preview; **Share on WhatsApp** opens WhatsApp with the message.
- [ ] `/present`, `/video/title` and `/video/outro` load, and `/present` autoplays with `?auto=1`.

### Content
- [ ] After the final deploy, re-render the demo media from production: `npm run media:gif` (needs Python with `playwright` and `pillow`, and ffmpeg on PATH; about 2 minutes). It prints each file's size and length and fails if the GIF would exceed 6 MB or the clip 30 s. Look at `docs/media/poster.png` and the GIF once, then commit the three files.
- [ ] Demo video uploaded (2:45–3:15), public or unlisted, plays while logged out, captions on. Script: `docs/VIDEO_SCRIPT.md`.
- [ ] LinkedIn post live, with Jen Looper, Cloudinary and HackIndia tagged as real mentions. Draft: `docs/SOCIAL_POSTS.md`.
- [ ] X post live, tagging @jenlooper, @cloudinary and HackIndia's handle.
- [ ] HackIndia handle confirmed on hackindia.org or the WhatsApp group (not guessed).
- [ ] Cloudinary survey submitted (https://cld.media/hackathon-survey). Draft: `docs/SURVEY_ANSWERS.md`. Screenshot of the confirmation page saved.

### Submit
- [ ] Submission form filled from the table above, access code pasted from `.env.local`, submitted **before Sat 3 Oct, 20:00 IST**.
- [ ] **Screenshot of the form confirmation** saved (and the confirmation email, if one arrives).
- [ ] Tag the submitted commit and push the tag **before Sun 4 Oct, 00:15 IST**:

  ```bash
  git tag v1.0-submission
  git push --tags
  ```

- [ ] After tagging: no force-pushes to the default branch; the judged version is the tag.

## 3. Owner-only slots still open

| Where | What |
|---|---|
| `README.md` "Video" (under the tip box) | replace the visible "Video: coming Sat 3 Oct." line and its `<!-- TODO(video): add YouTube link -->` comment with the link |
| `docs/UPSTREAM_ISSUES.md` | fill in the two version lines, file both reports, then link them from `README.md` ("How we built it with AI") and `docs/SURVEY_ANSWERS.md` |
| `docs/SOCIAL_POSTS.md` | `<VIDEO_URL>`, `<HACKINDIA_OFFICIAL_HANDLE>` (the `<GIF>` attachment is ready: `docs/media/demo-social.mp4`) |
| `docs/SURVEY_ANSWERS.md` | team name, contact email, ratings, "AI Power Start Prompt" tick, Skills Pack usage note, video link, follow-up answer, the two issue links (once filed) |
| `docs/VIDEO_SCRIPT.md` | `<YOUR_NAME>` in the title-card line |
| this file | form field names, video / post URLs, survey date and screenshot |

## 4. After submission

- [ ] **Re-sign the sample ZIP links before they expire on 29 Dec 2026** (the five sample kits' `zipUrl`s in `data/showcase.json` are signed for 90 days from 30 Sep). Run `npm run seed:showcase -- --refresh`, commit the new `data/showcase.json` and redeploy. With unchanged composites it only re-zips and re-signs; if `lib/transform` changed since the seed, it also re-stages the kits (about 680 AI Vision tokens per QA attempt plus new `b_gen_fill` and `e_gen_recolor` derivatives).
- [ ] Live kits' ZIP links are signed for 1 hour by design; nothing to do.
