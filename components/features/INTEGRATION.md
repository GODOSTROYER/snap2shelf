# Studio features: where they go

Four self-contained client components for the pipeline v2 routes, plus a typed client.
Each one handles its own loading, empty, busy, error and locked states, respects
reduced motion, and works at 375 px. Try them live at `/lab` (noindex).

```
capture → analyze → RetouchCard → cutout → BriefBar → scenes (+ SceneGenerator) → stage + QA → pack → CostReceipt
```

All four accept an optional `client` (default `featuresClient` from `lib/client/features.ts`),
so a story or test can swap any single call for a mock.

## 1. `RetouchCard`: after analyze, before the cutout

```tsx
import { RetouchCard } from "@/components/features/retouch-card";

<RetouchCard
  sku={sku}
  autoStart               // default true: starts on mount
  onDone={(fixes, res) => …} // fixes: RetouchFix[] ([] = the photo needed nothing)
  onError={(message) => …}   // gave up (busy after 3 retries, or failed): cut out the raw photo
/>
```

- Put it in the side panel (or under the stage) once `analyze` has answered. The cutout
  route already starts from `snap2shelf/products/<sku>/retouched` when it exists, so the
  only rule is: call `cutout` after `onDone` (or `onError`).
- Pattern for `start()` in `studio.tsx`: after `analyze`, render the card and await a
  promise that `onDone` / `onError` resolves, then run `cutout` as today. The rail's
  "Fix" step can stay active until then (notes: "Touching up the photo").
- Skip it for showcase samples (`getSample(sku)`): they have no raw upload to retouch.
- Cost: the first call on a new photo spends AI Vision tokens once; every later call
  (and every revisit) answers from the stored plan with 0 tokens.

## 2. `BriefBar`: before staging

```tsx
import { BriefBar } from "@/components/features/brief-bar";

<BriefBar
  sku={sku}
  disabled={!product?.understanding}      // until analyze is done
  onResult={(res) => setBrief(res)}        // every parse (keep res.scenePrompt for SceneGenerator)
  onApply={(kit, res) => {
    setSettings({ offer: { hindi: kit.offer.hindi ?? "", english: kit.offer.english ?? "" }, swatches: kit.swatches });
    const s = scenes?.find((x) => x.theme === kit.theme);  // theme → scene selection
    if (s) { setSceneId(s.publicId); setControls(defaultControls(placement, s.dna)); }
  }}
/>
```

- Best spot: top of the Exact panel (above "Scene"), or above the Exact/Creative tabs.
- `kit.offer` → `PackRequest.offer`; `kit.swatches` → `PackRequest.recolor` (≤ 4 hex,
  no `#`); `kit.channels` → which shelves to show first; `kit.theme` → scene choice.
- "AI Vision" badges mark fields that came from AI (`res.sources[field] === "ai"`).
- Hindi renders in Noto Sans Devanagari (loaded by `components/features/fonts.ts`, not
  preloaded), the same family the pack's text overlay uses.
- The last 3 briefs per product are cached server-side (0 tokens).

## 3. `SceneGenerator`: inside the scene picker

```tsx
import { SceneGenerator } from "@/components/features/scene-generator";

<SceneGenerator
  sku={sku}                                        // records credits spent / saved for the cost meter
  theme={brief?.kit.theme ?? product.understanding?.suggested_themes[0]}
  prompt={brief?.scenePrompt}                      // prefills "Describe a new backdrop"
  view={VIEW_FOR_PLACEMENT[placement]}
  selectedId={sceneId}
  onSelect={(scene, choice) => {
    setScenes((l) => (l?.some((x) => x.publicId === scene.publicId) ? l : [...(l ?? []), scene]));
    setSceneId(scene.publicId);
    setControls(defaultControls(placement, scene.dna));
    // choice = { reused, credits, creditsSaved }
  }}
/>
```

- Put it under `ScenePicker` in `CompositePanel`'s "Scene" section (a "Need a different
  backdrop?" disclosure works well; it's ~28rem wide by design).
- Library matches (`GET /api/scenes/match`) are free and public. "Generate a new scene"
  always asks for `tier: "draft"`; the server reuses a matching plate first
  (`Reused · 0 credits · saved N credits`), else it needs the access code: a 403 opens the
  built-in access dialog and retries after unlock. 409 (scene QA rejected), 429
  (session cap) and 503 (quota low) each show their own message and point back to the
  library.
- Job polling awaits each `GET /api/scene-jobs/:job`, 2 s apart, with the darkroom
  "developing print" reveal when the plate lands.

## 4. `CostReceipt`: on the kit view

```tsx
import { CostReceipt } from "@/components/features/cost-receipt";

<CostReceipt sku={kit.sku} scene={kit.scene?.publicId} refreshKey={kit.createdAt} />
```

- Under the shelves in `studio.tsx` (next to or instead of `<Receipt>`), and on
  `/kit/[sku]`. It is ~26rem wide and centres itself.
- One `GET /api/cost/:sku` per mount / `refreshKey` change (one Admin API listing), so
  don't remount it on every render. While Cloudinary is busy (420 / 502 / 503) it shows a
  calm "busy" note and retries after 4, 8 and 16 s, then offers a button.
- The photoshoot figure reuses `PHOTOSHOOT_INR` from `components/kit/receipt.tsx`
  (₹2,500) and is labelled as an estimate on the receipt; override with `photoshootInr`.

## The client: `lib/client/features.ts`

`featuresClient.brief / retouch / matchScenes / generateScene / sceneJob / cost / access`,
plus `retouchUntilDone`, `sceneJobUntilDone`, `withBusyRetry`, `isBusy`, `featureMessage`
and display helpers (`themeLabel`, `channelMeta`, `fixMeta`, `formatBytes`, `formatLabel`).
Responses are normalised (missing optional fields become empty arrays / zeros), and every
failure is an `ApiFailure` with a human message; there is no silent mock fallback.
