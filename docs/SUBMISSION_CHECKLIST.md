# Submission checklist

**Deadlines (IST):** feature freeze **Fri 2 Oct, 20:00** · submission **Sat 3 Oct, 20:00** · tag pushed before **Sun 4 Oct, 00:15**.

Work top to bottom. Nothing in this file is secret, and nothing secret may be added to it.

---

## 1. Submission form: what to paste

<!-- TODO(final): open the HackIndia submission form, compare its fields with this table, and add or rename rows to match it exactly. -->

| Field | Value to paste |
|---|---|
| Project name | **Snap2Shelf** |
| Tagline / one-liner | One photo. A whole shelf. AI builds the stage — your product stays real. |
| Track | **Track 2 — Generative Content Workflows** |
| Team | **Solo** · `<YOUR_NAME>` |
| Short description | Snap2Shelf turns one phone photo of a product into a full, listing-ready shelf (hero, story, banner, marketplace-white, WhatsApp tile, colour variants, Hindi/English offer, video reel, zip and a shareable shop page), staging the real product on AI-generated scenes and using Cloudinary AI Vision to reject any AI output that changes the product. |
| Repository URL | **https://github.com/GODOSTROYER/snap2shelf** |
| Live demo URL | **https://snap2shelf.vercel.app** |
| Demo video URL | `<VIDEO_URL>` <!-- TODO(final) --> |
| LinkedIn post URL | `<LINKEDIN_POST_URL>` <!-- TODO(final): after posting docs/SOCIAL_POSTS.md --> |
| X post URL | `<X_POST_URL>` <!-- TODO(final) --> |
| Cloudinary survey | Done: yes, on `<DATE>`; confirmation screenshot saved as `<FILE>` <!-- TODO(final) --> |
| Access code for judges | **Paste the value of `DEMO_ACCESS_CODE` from `.env.local` directly into the form. Never commit it, never put it in the README, a post or the video.** |
| How to test (if asked) | No setup: open the live URL and press **Try a sample product (no signup)**. To use your own photo, press **Snap with your phone** and scan the QR code. Live Creative-mode generation needs the access code above (4 generations per session). Press the `</>` button under any kit image to see the Cloudinary URL that made it. |
| Tech used (if asked) | Cloudinary (Upload Widget + signed preset, AI Vision, AI Content Analysis captioning, Image Generation, background removal, layers, generative fill, generative recolor, Google-font text overlays, video from stills, named transformations, tags + context, client-side list, archive, f_auto/q_auto), Next.js 16 on Vercel, Cloudinary Next.js Starter Kit + Skills Pack, Claude Code (Claude Opus 5.5) |
| Key pool disclosure (if there is a notes field) | AI calls rotate across three Cloudinary product environments with the organisers' approval; disclosed in the README under "The key pool". |

## 2. Pre-flight (do all of it, in order)

### Code and repo
- [ ] Feature freeze respected: only fixes after Fri 2 Oct 20:00.
- [ ] `npm run lint`, `npm run typecheck` and `npm run build` pass.
- [ ] `node --conditions=react-server --import tsx --test tests/*.test.mts` passes (39 tests at the time of writing).
- [ ] `npm run secret-scan` prints **clean** (it checks tracked files, the staged diff and the whole git history).
- [ ] `grep -rn "TODO(final)" README.md docs/` returns nothing that a judge would see as unfinished. Remaining placeholders in `docs/` that are only for us are fine.
- [ ] README: demo video link filled in, hero GIF swapped in (or the still left on purpose), every image renders on github.com in **both** light and dark themes.
- [ ] Repository is **public**, `LICENSE` (MIT) is at the root, and the default branch contains the final merge.

### Live app
- [ ] **Incognito test** on a laptop: landing → **Try a sample product (no signup)** → the pipeline completes → **Your shelf** → the `</>` X-ray works → **Download all (.zip)** downloads → **Copy kit link** opens in a second incognito window.
- [ ] **Phone test on mobile data** (not office Wi-Fi): **Snap with your phone** → scan → **Open camera** → photo → the laptop picks it up → the kit builds.
- [ ] Access code: in a fresh incognito window, Creative mode unlocks with the code and one **Fast draft** take completes (1 credit).
- [ ] `https://snap2shelf.vercel.app/api/usage` shows `"liveGeneration": true` and enough usable credits for judging. If it doesn't, the app falls back to the showcase, which is fine but should be a choice.
- [ ] Shelf link pasted into WhatsApp unfurls with the OG image. <!-- TODO(final): once /shelf/<shop> is merged -->
- [ ] `/present`, `/video/title` and `/video/outro` load. <!-- TODO(final): once the present workstream is merged -->

### Quota
- [ ] Run `node scripts/spikes/00-usage.mjs` and read the remaining Image Generation credits and AI Vision tokens for every environment. **It prints environment names, so don't run it on a screen recording or screen share.**
- [ ] Remaining generation credits comfortably above `LIVE_GEN_MIN` (12 usable) plus what judges will spend (4 per unlocked session).
- [ ] Warm the demo: run the sample kit once so its derivatives are cached before judging starts.

### Content
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
