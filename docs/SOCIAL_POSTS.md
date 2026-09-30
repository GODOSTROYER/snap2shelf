# Social posts — drafts

Placeholders to fill before posting:

| Placeholder | Value |
|---|---|
| `<VIDEO_URL>` | <!-- TODO(final): YouTube/Loom link of the demo video --> |
| `<GIF>` | The demo clip, already in the repo (an attachment, not text). Attach **`docs/media/demo-social.mp4`** (about 20 s, 1280×720 H.264, silent, about 2 MB) natively on both LinkedIn and X; both autoplay MP4 and it is far lighter than the GIF. Use **`docs/media/poster.png`** as the cover/thumbnail if LinkedIn asks for one. **`docs/media/demo.gif`** (800 px, about 5 MB) is the fallback where MP4 isn't accepted. It shows the studio's sample replay (the QA gate catching and fixing a floating bottle), the kit dealing onto the shelf, the X-ray of the hero's URL and the demo shop. Re-render all three with `npm run media:gif` after the final deploy. |
| `<HACKINDIA_OFFICIAL_HANDLE>` | `<HACKINDIA_OFFICIAL_HANDLE — confirm on hackindia.org or the WhatsApp group; do not guess>` (separately for LinkedIn and X) |

Fixed values: live demo **https://snap2shelf.vercel.app** · demo storefront **https://snap2shelf.vercel.app/shelf/demo-studio** · repo **https://github.com/GODOSTROYER/snap2shelf** · Cloudinary: **@cloudinary** (X), **Cloudinary** company page (LinkedIn) · Jen Looper: **@jenlooper** (X), **linkedin.com/in/jenlooper** (LinkedIn).

Posting notes:
- On LinkedIn, type `@Jen Looper`, `@Cloudinary` and `@<HackIndia page>` and pick them from the dropdown so they become real mentions; pasted text does not tag anyone.
- Attach the MP4 (`docs/media/demo-social.mp4`) natively rather than relying on a link preview; in the drafts below, `<GIF>` marks where it goes.
- Never include the access code in a post. It lives only in the submission form.
- Every number below comes from `lib/claims.ts` or `SPIKES.md`. If you edit a post, don't add a number that isn't there (the 36 s is a measurement on the live site; ₹2,500 is our estimate and must be called one if you use it).
- The attached clip shows a sample product, not your own capture. Its first caption says the input is an AI-generated test image; keep that caption, and keep the LinkedIn post's line that the samples start from AI-generated test photos. On X, where there's no room for that line, the caption burned into the clip carries the disclosure.
- After posting, copy both post URLs into `docs/SUBMISSION_CHECKLIST.md`.

---

## LinkedIn

> **Generic AI photo tools have a quiet problem for sellers: they redraw your product.**
>
> Ask one to put your sneaker on a Diwali table and it looks great, until you notice it invented a logo badge and slipped a ghost second shoe into the background. A listing that doesn't match the product that arrives is a returns problem.
>
> For the Pixels to Products Cloudinary AI Hackathon (Track 2: Generative Content Workflows), I built **Snap2Shelf**: one phone photo in, a whole shelf of listing-ready assets out, and the product stays real.
>
> How it works:
> • Snap a product with your phone (scan a QR code on the laptop) and type one line, like "Diwali sale, 20% off, Hindi and English, for Instagram".
> • Cloudinary touches up the photo only if it needs it, cuts the product out once, and layers the real pixels onto an AI-generated scene with a transformation URL. AI Vision has already read each scene's "Scene DNA": where the table is and where the light comes from, so the shadow falls the right way.
> • An AI Vision QA gate checks every image. If a composite looks pasted on, the studio fixes it and checks again; if an AI reshoot changed the product, it is rejected. (That invented logo badge? Rejected.)
> • One approved hero becomes a story and a banner (generative fill), a marketplace-white image with a Readiness Score measured on its pixels, a WhatsApp tile, colour variants, a Hindi + English offer, a video reel, a zip and a shareable shop shelf. On the live site we measured 36 seconds from photo to zip.
>
> Three things I learned building on Cloudinary:
> 1. **A transformation URL can be a whole rendering engine.** The hero is one URL: scene plate, product layer, a shadow projected from the product's own silhouette, contact shadows, light-match. Move a slider and you get a new URL, not a new render job.
> 2. **Pin your model.** "Auto" model selection picked a 9–11-credit model for drafts I'd budgeted at 1 credit. The scene library cost 72 credits instead of 48, so every call now names its model.
> 3. **Tags, context and one tiny JSON file make a surprisingly good database.** There's no DB in this project: every product fact, Scene DNA value and QA verdict lives in Cloudinary, and the photo-to-zip pipeline makes zero Admin API calls.
>
> Built with Cloudinary's Next.js AI Starter Kit and Skills Pack, with Claude Code running parallel agents in separate git worktrees. The README is written as a tutorial, with every transformation in it explained. (The sample products on the site start from AI-generated test photos; upload your own to see yours.)
>
> Demo: `<VIDEO_URL>`
> Try it (no signup): https://snap2shelf.vercel.app
> A shop shelf made with it: https://snap2shelf.vercel.app/shelf/demo-studio
> Code: https://github.com/GODOSTROYER/snap2shelf
>
> Thank you @Cloudinary, @Jen Looper and the Cloudinary DevRel team, and `<HACKINDIA_OFFICIAL_HANDLE>` for running this.
>
> `<GIF>`

Length: about 2,850 characters with the placeholders filled, under LinkedIn's 3,000 limit; re-count after filling them, and drop the "A shop shelf made with it" line first if it runs over. The first two lines are the hook shown above "…see more".

---

## X

### Single post (fits in 280)

> One photo → a whole shelf.
>
> Snap2Shelf stages your real product on AI scenes; @cloudinary AI Vision rejects any AI take that changes it. Photo → zip: 36 s, measured live.
>
> Try it, no signup: https://snap2shelf.vercel.app
> Demo: `<VIDEO_URL>`
>
> cc @jenlooper `<HACKINDIA_OFFICIAL_HANDLE>`
>
> `<GIF>`

Counted with X's rules (each link counts as 23): **276 of 280** with a 15-character HackIndia handle. Re-count after filling the placeholders; if it runs over, drop "cc ".

### Optional thread (reply under the post above)

**2/**
> The catch that made the QA gate worth building: a fast edit model "reshot" this sneaker, invented a logo badge and added a ghost second shoe. AI Vision compared it with the original, side by side, and rejected it: product-redesigned, extra-product.

**3/**
> Every image is a Cloudinary transformation URL: scene plate, the product as a layer, a shadow projected from its own silhouette with e_distort, a warm light-match. Press the </> button on any asset in the app to X-ray the URL that made it.

**4/**
> Then it checks the listing like a marketplace would: a 96×96 BMP of the marketplace image, decoded on the server, proves the background is pure white and the product fills ~85%. Every product lands on a shop shelf you can share on WhatsApp: https://snap2shelf.vercel.app/shelf/demo-studio

**5/**
> Lesson: pin your model. "Auto" picked a 9–11-credit model for drafts budgeted at 1 credit, so the scene library cost 72 credits instead of 48. Also disclosed in the README: AI calls rotate across 3 Cloudinary environments, with the organisers' approval.

**6/**
> Built with the Cloudinary Next.js AI Starter Kit + Skills Pack, and Claude Code running parallel agents in git worktrees. Code and a tutorial-style README: https://github.com/GODOSTROYER/snap2shelf

Each thread post is under 280 characters.
