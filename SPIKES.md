# Day-0 spikes (Tue 29 Sep 2026, 23:45–00:05 IST)

Every number below was measured live against Cloudinary on the Free plan. Scripts live in `scripts/spikes/`; raw results go to `scripts/spikes/out/usage-log.jsonl` (git-ignored).

## Verdict: GO

All eight planned spikes passed, plus captioning and a fidelity-QA spike that wasn't in the plan. Two planned capabilities are **not available** on the Free plan and have been re-scoped (see "Scope changes").

## Quota (read from the Admin `usage` API and from the `limits.addons_quota` block of each response)

| | Image Generation (credits) | AI Vision (tokens) | AI Content Analysis | Transformation credits |
|---|---|---|---|---|
| Free allowance per environment | **50 / month** | **100,000 / month** | 500 detections / month | 25 credits (≈ 25k tx) |
| Used by the spikes (all environments) | 16 | ≈ 7,100 | 1 | 0.30 |

`limit: 50` is **credits**, not images. The cost per image depends on the model (below).

## 1. `text_to_image` → managed asset (async + poll) ✅

`POST /v2/generate/{cloud}/text_to_image` with `async: true`, then `GET /v2/generate/{cloud}/tasks/{id}` every 2 s. The finished task carries `data.result.assets[]` **and** the `limits.addons_quota` block, so remaining quota is known after every job.

| Request | Model picked | Credits | Latency | Output |
|---|---|---|---|---|
| `model: {mode:"auto", preference:"economy_fast"}`, `aspect_ratio 3:4, 1K` | `flux-2-flash` | **1** | 8.7 s | 768×1024 |
| `model: {mode:"auto", preference:"quality"}`, `aspect_ratio 3:4, 1K` | `gpt-image-2.5-flare` | **5** | 18.8 s | 1024×1536 (model ignored 3:4) |

- Both produced usable empty-tabletop Diwali plates; the `quality` one is clearly more photographic (real depth of field, better light).
- `aspect_ratio` only accepts `1:1, 16:9, 9:16, 4:3, 3:4` (4:5 is rejected), and some models override it. **Every scene is normalised to a canonical 1080×1350 plate** by an incoming `c_fill` transformation when it is copied into the main environment.

## 2. `image_to_image` with the cutout as reference ✅ (fidelity differs sharply by model)

`reference_images: [{source_type: "url", url: <cutout in main>}]`, `aspect_ratio 3:4`.

| Model | Credits | Latency | Product fidelity |
|---|---|---|---|
| `flux-2-flash-edit` | 1 | 7.6 s | ❌ Redesigned the product: invented logo badges, changed colours, added a ghost second shoe |
| `nano-banana-2-edit` | 9 | 16.6 s | ✅ Faithful: colours, panels, tongue, proportions kept |

Creative mode therefore defaults to `nano-banana-2-edit`, and the cheap model is kept as a "draft" option. Its failure is our real QA-rejection case.

## 3. AI Vision General (Scene DNA) + Tagging (QA) ✅

- `ai_vision_general` with a strict JSON prompt returned **valid Scene DNA JSON 2/2 times**, with a consistent anchor (x 0.50, y 0.56 on the raw plate; 0.65 on the canonical 4:5 plate). About **690 tokens** per call, 1.9–3.9 s.
- `ai_vision_tagging`: **tag names must be lower-case letters, digits and hyphens** (`product_visible` → HTTP 400 `MA_00003`). About **535 tokens** per call. There is no confidence value; the response lists only the tags that matched.
- On an empty scene nothing matched; on a product photo only `product-visible` matched. Both correct.

### 3b. Fidelity QA (new): reference-vs-candidate sheet ✅

A single transformation URL puts the reference cutout (left) next to the generated image (right). AI Vision then judges the pair:

```
c_fill,w_512,h_683,g_auto/c_pad,w_1024,h_683,g_east,b_white/l_<cutout>/c_fit,w_480,h_640/fl_layer_apply,g_west,x_16/<candidate>
```

| Candidate | Tags matched | `same_product` | Decision |
|---|---|---|---|
| `flux-2-flash-edit` | `product-redesigned`, `extra-product`, `garbled-text` | false ("added side logo badge", "tongue logo mismatch") | **REJECT** |
| `nano-banana-2-edit` | `same-product` | true (95) | **APPROVE** |

About 1,000 tokens per verdict. Decide on the tags plus `same_product`; the numeric score isn't calibrated (it gave 85 to the rejected image).

## 4. Exact-mode composite as a pure URL ✅

- Nested-folder layers work: `l_snap2shelf:spikes:cutouts:samples_shoe_trim`.
- Cutout, created once: derive `e_background_removal/f_png`, which answered 200 within 4 s. Upload that URL as its own asset, then store an `e_trim` copy so the layer box equals the product box. About 5 s in total.
- `e_dropshadow` **inside a layer works**, but it is clipped to the layer box. Fix: pad with transparency first, **without** scaling (`c_mpad`, not `c_pad`):
  `l_<cutout>/c_scale,w_497/c_mpad,w_657,h_488,g_north,b_rgb:00000000/e_dropshadow:azimuth_315;elevation_50;spread_45/fl_layer_apply,g_north_west,x_212,y_510`
- Contact shadow: the product's own silhouette, squashed, blackened and blurred:
  `l_<cutout>/c_scale,w_440,h_26/co_black,e_colorize:100/e_blur:150/o_70/fl_layer_apply,g_north_west,x_318,y_862`
- Reflection: `a_vflip/e_gradient_fade:60,y_-0.7/o_22` inside a layer renders correctly. It is applied only when Scene DNA says `glossy_surface: true`.
- Placement: `g_north_west` with **integer** x/y computed from Scene DNA (you can't mix ints and floats).
- Render time: 0.7–1.7 s on first request.

## 5. Channel formats ✅

| Output | Transformation | First render |
|---|---|---|
| Story 9:16 | `ar_9:16,b_gen_fill,c_pad,w_1080` (50 tx) | 6.4 s, seamless outpaint |
| Banner 16:9 | `ar_16:9,b_gen_fill,c_pad,w_1920` (50 tx) | 7.2 s |
| Recolor | `e_gen_recolor:prompt_sneaker;to-color_2563eb` (50 tx) | 5.9 s. A whole-object prompt floods the product flat; **prompt a part** (from AI Vision) |
| Hindi offer | `l_text:Noto%20Sans%20Devanagari@google_88_700:<utf8>` (Google font, no upload); literal `%` double-encoded | 0.8 s, conjuncts shaped correctly |
| Marketplace white | `c_fit,w_1700,h_1700/c_pad,w_2000,h_2000,b_white/f_jpg,q_auto:best` | 1.7 s |

`b_gen_fill` and `e_gen_recolor` need a non-transparent source, so they run on the composited hero asset.

## 6. Kit Reel (`e_zoompan` + `fl_splice`) ✅

- 3 images → **9.0 s H.264, 640×1138**, rendered in about 7 s:
  `c_fill,w_720,h_1280/e_zoompan:du_3;maxzoom_1.2;fps_25/fl_splice,l_<img2>/c_fill,w_720,h_1280/e_zoompan:…/fl_layer_apply/…/<hero>.mp4`
- `fl_splice:transition_(name_fade;du_0.6)` plus a Devanagari `l_text` overlay held across clips → 6.0 s, correct.
- No generation credits. Video transformations bill per second of output.

## 7. Client-side tag list ✅

`res.cloudinary.com/<cloud>/image/list/<tag>.json` → 200 on the main environment (Resource list is unrestricted), `Cache-Control: max-age=60`. A just-tagged asset appeared on the first request. There is no URL field, so we build URLs ourselves.

## 8. Visual Search by text ⚠️ not usable

`GET /resources/visual_search?text=…` → 200 with `{"resources":[],"total_count":0}`. The docs list it as Enterprise-only, and nothing is indexed on Free.

## 9. Captioning + quality ✅

- `POST /v2/analysis/{cloud}/analyze/captioning` → 1 of 500 detections: *"A white and tan sneaker with pink accents floats in the foreground against a solid pink background."*
- `detection: "captioning"` via `explicit` returned no caption for an existing asset. Use the Analyze endpoint.
- `quality_analysis: true` → only `focus` (0.64) on Free.

## Archive ✅

A signed `download_zip_url` returned a real ZIP (HTTP 200, `application/zip`, `PK` header). There is no per-asset transformation mapping, so channel formats are saved as tagged assets first.

## Scope changes from the plan

1. **C2 scene reuse can't use Visual Search**. It becomes a prompt-hash `public_id` plus a theme/mood tag match over the scene library (client-side list), which gives the same user-facing "reused, 0 credits" behaviour.
2. **Creative mode** defaults to `nano-banana-2-edit` (9 credits), with `flux-2-flash-edit` (1 credit) as the draft tier. The fidelity-QA sheet catches the draft tier's redesigns.
3. **Scene library**: drafts at 1 credit (`economy_fast`), finals at 5 credits (`quality`), all normalised to a 1080×1350 canonical plate.
4. **Recolor** targets a product part named by AI Vision, not the whole object.
