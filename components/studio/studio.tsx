"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { Download, Link2, RefreshCw, RotateCcw } from "lucide-react";
import { MotionConfig } from "motion/react";
import * as React from "react";
import { KitShelves, type DealRequest } from "@/components/kit/kit-shelves";
import { Receipt } from "@/components/kit/receipt";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tip, TooltipProvider } from "@/components/ui/controls";
import * as api from "@/lib/client/api";
import { useDebounced } from "@/lib/client/hooks";
import { publicUrl, sizedUrl } from "@/lib/client/img";
import { countAssets } from "@/lib/client/kit-view";
import { reelUrl } from "@/lib/client/reel";
import { recolorLabel } from "@/lib/client/swatches";
import { rawInfo, rawPublicId, waitForRaw } from "@/lib/client/upload";
import { atLeast, isAborted, preloadImage, sleep } from "@/lib/client/util";
import { getSample, heroAlt, rawAt, SAMPLES } from "@/lib/showcase";
import { compositeUrl, defaultControls, lqip, quantise } from "@/lib/transform/composite";
import {
  PIPELINE_STEPS,
  SKU_RE,
  VIEW_FOR_PLACEMENT,
  type BuiltUrl,
  type CompositeControls,
  type Kit,
  type KitAsset,
  type PipelineStepId,
  type ProductRecord,
  type QaResult,
  type Scene,
  type SceneDNA,
} from "@/lib/types";
import { CompositePanel, type PackSettings } from "./composite-panel";
import { CreativePanel } from "./creative-panel";
import { PipelineRail, type StepStatus } from "./pipeline-rail";
import { SourcePicker, type SourceReady } from "./source-picker";
import { Stage } from "./stage";

type Status = Record<PipelineStepId, StepStatus>;
const IDLE: Status = { fix: "waiting", cutout: "waiting", stage: "waiting", light: "waiting", qa: "waiting", pack: "waiting" };
const DEFAULT_SETTINGS: PackSettings = { offer: SAMPLES[0].offer, swatches: SAMPLES[0].swatches };
const PACK_POLL_MS = 2000;
const PACK_TIMEOUT_MS = 120_000;

function lightFrom(dna: SceneDNA) {
  const dirs = ["above", "the upper right", "the right", "the lower right", "below", "the lower left", "the left", "the upper left"];
  return `Shadow cast from ${dirs[Math.round((((dna.light_azimuth % 360) + 360) % 360) / 45) % 8]}`;
}

const sigOf = (sceneId: string | null, c: CompositeControls | null, s: PackSettings, hero: KitAsset | null) =>
  JSON.stringify({ sceneId, c: c && quantise(c), s, hero: hero?.url ?? null });

interface Failure {
  step: PipelineStepId;
  message: string;
  from: "fix" | "stage";
}

export function Studio({ initialSample, initialSku }: { initialSample?: string; initialSku?: string }) {
  const [source, setSource] = React.useState<SourceReady | null>(null);
  const [linkError, setLinkError] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<Status>(IDLE);
  const [notes, setNotes] = React.useState<Partial<Record<PipelineStepId, string>>>({});
  const [failure, setFailure] = React.useState<Failure | null>(null);
  const [product, setProduct] = React.useState<ProductRecord | null>(null);
  const [scenes, setScenes] = React.useState<Scene[] | null>(null);
  const [sceneId, setSceneId] = React.useState<string | null>(null);
  const [controls, setControls] = React.useState<CompositeControls | null>(null);
  const [settings, setSettings] = React.useState<PackSettings>(DEFAULT_SETTINGS);
  const [heroOverride, setHeroOverride] = React.useState<KitAsset | null>(null);
  const [qa, setQa] = React.useState<QaResult | null>(null);
  const [kit, setKit] = React.useState<Kit | null>(null);
  const [deal, setDeal] = React.useState<DealRequest | null>(null);
  const [packedSig, setPackedSig] = React.useState<string | null>(null);
  const [demo, setDemo] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [creditsUsed, setCreditsUsed] = React.useState(0);
  const [stageBusy, setStageBusy] = React.useState(false);
  const [tab, setTab] = React.useState("exact");
  const [copied, setCopied] = React.useState(false);

  const abortRef = React.useRef<AbortController | null>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const kitRef = React.useRef<HTMLElement>(null);

  const scene = scenes?.find((s) => s.publicId === sceneId) ?? null;
  const placement = product?.understanding?.placement ?? "standing";
  const liveControls = useDebounced(controls, 250);

  const buildHero = React.useCallback(
    (p: ProductRecord, sc: Scene, c: CompositeControls, opts: { width?: number; format?: string } = {}): BuiltUrl =>
      compositeUrl({ scenePublicId: sc.publicId, dna: sc.dna, cutout: p.cutout!, placement: p.understanding?.placement ?? "standing", controls: c, ...opts }),
    [],
  );

  const preview = product?.cutout && scene && liveControls && status.stage !== "waiting" ? buildHero(product, scene, liveControls) : null;

  // What the stage shows right now.
  const sample = getSample(source?.sku);
  const rawView = source ? (sample ? rawAt(sample.product, 1080) : publicUrl(rawPublicId(source.sku), { w: 1080, h: 1350, crop: "c_pad,b_auto:border" })) : null;
  const rawThumb = source ? (sample ? rawAt(sample.product, 64) : publicUrl(rawPublicId(source.sku), { w: 64, h: 80, crop: "c_pad,b_auto:border" })) : null;
  const cutoutView = product?.cutout ? publicUrl(product.cutout.publicId, { w: 1080, h: 1350, crop: "c_mpad,b_rgb:00000000" }) : null;
  const stageSrc = heroOverride ? sizedUrl(heroOverride, 1080) : (preview?.url ?? cutoutView ?? rawView);
  const stageAlt = heroOverride?.alt ?? (preview && product && scene ? heroAlt(product, scene) : (product?.caption ?? "Your product photo"));
  const scanning = status.fix === "active" ? "Reading your photo" : status.cutout === "active" ? "Cutting out" : null;

  const mark = React.useCallback((id: PipelineStepId, st: StepStatus, note?: string) => {
    setStatus((s) => ({ ...s, [id]: st }));
    if (note !== undefined) setNotes((n) => ({ ...n, [id]: note }));
  }, []);
  const seen = React.useCallback((src: api.DataSource) => {
    if (src === "demo") setDemo(true);
  }, []);

  /** Stage → Light-match → QA → Pack → deal. Shared by the first run and "Update kit". */
  const finish = React.useCallback(
    async (args: { src: SourceReady; product: ProductRecord; scene: Scene; controls: CompositeControls; settings: PackSettings; hero: KitAsset | null; tokens: number; t0: number; signal: AbortSignal }) => {
      const { src, product: p, scene: sc, controls: c, settings: st, hero, signal } = args;
      let step: PipelineStepId = "stage";
      try {
        mark("stage", "active", hero ? "Using your creative take" : `Placing it in the ${sc.title} scene`);
        const full = buildHero(p, sc, c);
        const saveUrl = hero ? hero.url : buildHero(p, sc, c, { format: "f_jpg,q_90" }).url;
        const previewUrl = hero ? sizedUrl(hero, 1080) : full.url;
        await sleep(700, signal);
        mark("stage", "done", hero ? "Creative take" : sc.title);

        step = "light";
        mark("light", "active", hero ? "Loading your creative take" : "Matching the shadow to the scene's light");
        await atLeast(preloadImage(previewUrl, signal), 900, signal);
        mark("light", "done", hero ? "Ready" : lightFrom(sc.dna));

        step = "qa";
        mark("qa", "active", "Checking nothing about your product changed");
        let verdict: QaResult;
        let tokens = args.tokens;
        if (hero?.qa) {
          await sleep(500, signal);
          verdict = hero.qa;
        } else {
          const q = await atLeast(api.qa({ sku: src.sku, url: saveUrl, kind: hero ? "creative" : "exact" }, signal), 1000, signal);
          seen(q.source);
          verdict = q.data.qa;
          tokens += q.data.tokens;
        }
        setQa(verdict);
        if (verdict.status === "rejected") {
          mark("qa", "failed", verdict.reasons[0] ?? "The check found a change to your product");
          setFailure({ step: "qa", message: `QA rejected this version: ${verdict.reasons.join(", ").toLowerCase() || "the product changed"}. Adjust the placement or pick another scene, then update the kit.`, from: "stage" });
          return;
        }
        mark("qa", "done", "Your product is unchanged");

        step = "pack";
        mark("pack", "active", "Making every format");
        const sceneSlug = sc.publicId.split("/").slice(-2).join("-");
        const offer = st.offer.hindi.trim() || st.offer.english.trim() ? { hindi: st.offer.hindi.trim() || undefined, english: st.offer.english.trim() || undefined } : undefined;
        const started = await api.pack({ sku: src.sku, heroUrl: saveUrl, sceneSlug, offer, recolor: st.swatches }, signal);
        seen(started.source);
        let assets = started.data.assets;
        let pending = started.data.pending;
        let zipUrl: string | undefined;
        const t = Date.now();
        while (pending.length && Date.now() - t < PACK_TIMEOUT_MS) {
          mark("pack", "active", `${assets.length - pending.length} of ${assets.length} formats ready`);
          await sleep(PACK_POLL_MS, signal);
          const s = await api.packStatus(src.sku, signal);
          seen(s.source);
          assets = s.data.assets;
          pending = s.data.pending;
          zipUrl = s.data.zipUrl;
        }
        if (!zipUrl && !pending.length && started.source === "live") {
          zipUrl = (await api.packStatus(src.sku, signal).catch(() => null))?.data.zipUrl;
        }

        const ready = assets
          .filter((a) => a.id !== "hero" && !pending.includes(a.id))
          .map((a) => (a.id.startsWith("recolor-") ? { ...a, label: recolorLabel(a.id) } : a));
        const heroId = started.data.heroPublicId;
        const heroAsset: KitAsset = hero
          ? { ...hero, id: "hero", label: "Hero 4:5", publicId: heroId }
          : { id: "hero", format: "hero", label: "Hero 4:5", url: full.url, width: 1080, height: 1350, frame: "feed-post", alt: heroAlt(p, sc), xray: full, publicId: heroId, qa: verdict };

        let delivered = 0;
        try {
          const h = await fetch(heroAsset.url, { method: "HEAD", signal });
          delivered = Number(h.headers.get("content-length") ?? 0);
        } catch {
          delivered = 0;
        }

        const next: Kit = {
          sku: src.sku,
          product: p,
          mode: hero ? "creative" : "exact",
          scene: sc,
          controls: c,
          hero: heroAsset,
          assets: ready,
          reel: reelUrl({
            heroPublicId: heroId,
            closeUp: { scenePublicId: sc.publicId, cutoutPublicId: p.cutout!.publicId, placement: p.understanding?.placement ?? "standing" },
            caption: st.offer.hindi.trim() || undefined,
          }),
          zipUrl,
          cost: {
            generationCredits: 0,
            creditsSavedByReuse: hero ? 0 : sc.credits,
            aiVisionTokens: tokens,
            transformationsEstimate: 0,
            bytesOriginal: src.info.bytes,
            bytesDelivered: delivered,
            seconds: Math.max(1, Math.round((performance.now() - args.t0) / 1000)),
          },
          createdAt: new Date().toISOString(),
        };
        setKit(next);
        setPackedSig(sigOf(sc.publicId, c, st, hero));
        mark("pack", "done", pending.length ? `${ready.length} formats ready, ${pending.length} still rendering` : `Kit ready: ${countAssets(next)} assets`);
        setDeal((d) => ({ key: (d?.key ?? 0) + 1, from: () => stageRef.current?.getBoundingClientRect() ?? null }));
      } catch (e) {
        if (isAborted(e)) return;
        mark(step, "failed", api.messageFor(e));
        setFailure({ step, message: api.messageFor(e), from: "stage" });
      }
    },
    [buildHero, mark, seen],
  );

  /** The whole run, from a fresh photo. */
  const start = React.useCallback(
    async (src: SourceReady) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const signal = ac.signal;
      const t0 = performance.now();
      setSource(src);
      setLinkError(null);
      setStatus(IDLE);
      setNotes({});
      setFailure(null);
      setProduct(null);
      setScenes(null);
      setSceneId(null);
      setControls(null);
      setHeroOverride(null);
      setQa(null);
      setKit(null);
      setPackedSig(null);
      setCreditsUsed(0);
      setRunning(true);
      const query = getSample(src.sku) ? `sample=${src.sku}` : `sku=${src.sku}`;
      window.history.replaceState(null, "", `/studio?${query}`);

      let step: PipelineStepId = "fix";
      try {
        mark("fix", "active", "Reading your photo");
        const a = await atLeast(api.analyze(src.sku, signal), 1100, signal);
        seen(a.source);
        let p: ProductRecord = {
          sku: src.sku,
          rawPublicId: getSample(src.sku)?.product.rawPublicId ?? rawPublicId(src.sku),
          rawWidth: src.info.width,
          rawHeight: src.info.height,
          rawBytes: src.info.bytes,
          caption: a.data.caption,
          focus: a.data.focus ?? undefined,
          understanding: a.data.understanding,
        };
        setProduct(p);
        mark("fix", "done", a.data.understanding.name);

        step = "cutout";
        mark("cutout", "active", "Lifting it off the background");
        const c = await atLeast(api.cutout(src.sku, signal), 1300, signal);
        seen(c.source);
        p = { ...p, cutout: c.data.cutout };
        setProduct(p);
        mark("cutout", "done", "Clean edges, background gone");

        step = "stage";
        mark("stage", "active", "Finding a scene that fits");
        const view = VIEW_FOR_PLACEMENT[p.understanding!.placement];
        const sc = await api.scenes(view, signal);
        seen(sc.source);
        const list = sc.data;
        const preferred = getSample(src.sku)?.scene.publicId;
        const pick =
          list.find((s) => s.publicId === preferred) ??
          list.find((s) => p.understanding!.suggested_themes.includes(s.theme)) ??
          list[0] ??
          getSample(src.sku)?.scene ??
          SAMPLES[0].scene;
        const ctl = getSample(src.sku)?.controls ?? defaultControls(p.understanding!.placement, pick.dna);
        setScenes(list.length ? list : [pick]);
        setSceneId(pick.publicId);
        setControls(ctl);
        const st = getSample(src.sku) ? { offer: getSample(src.sku)!.offer, swatches: getSample(src.sku)!.swatches } : DEFAULT_SETTINGS;
        setSettings(st);

        await finish({ src, product: p, scene: pick, controls: ctl, settings: st, hero: null, tokens: a.data.tokens, t0, signal });
      } catch (e) {
        if (isAborted(e)) return;
        mark(step, "failed", api.messageFor(e));
        setFailure({ step, message: api.messageFor(e), from: "fix" });
      } finally {
        if (!signal.aborted) setRunning(false);
      }
    },
    [finish, mark, seen],
  );

  /** Re-stage with the current scene/sliders/settings and re-pack. */
  const update = React.useCallback(
    async (hero: KitAsset | null = heroOverride) => {
      if (!source || !product?.cutout || !scene || !controls) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setFailure(null);
      setQa(null);
      setRunning(true);
      setStatus((s) => ({ ...s, stage: "waiting", light: "waiting", qa: "waiting", pack: "waiting" }));
      try {
        await finish({ src: source, product, scene, controls, settings, hero, tokens: 0, t0: performance.now(), signal: ac.signal });
      } finally {
        if (!ac.signal.aborted) setRunning(false);
      }
    },
    [source, product, scene, controls, settings, heroOverride, finish],
  );

  const retry = () => {
    if (!source) return;
    if (failure?.from === "fix") void start(source);
    else void update();
  };

  const reset = () => {
    abortRef.current?.abort();
    setSource(null);
    setStatus(IDLE);
    setKit(null);
    setFailure(null);
    setRunning(false);
    setProduct(null);
    setHeroOverride(null);
    setQa(null);
    window.history.replaceState(null, "", "/studio");
  };

  // Deep links: ?sample=… starts right away; ?sku=… waits for that photo (phone flow, refresh).
  const booted = React.useRef(false);
  React.useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const s = getSample(initialSample);
    if (s) {
      void Promise.resolve().then(() => start({ sku: s.sku, via: "sample", info: { width: s.product.rawWidth, height: s.product.rawHeight, bytes: s.product.rawBytes } }));
      return;
    }
    if (!initialSku) return;
    const sk = getSample(initialSku);
    if (sk) {
      void Promise.resolve().then(() => start({ sku: sk.sku, via: "sample", info: { width: sk.product.rawWidth, height: sk.product.rawHeight, bytes: sk.product.rawBytes } }));
      return;
    }
    if (!SKU_RE.test(initialSku)) {
      void Promise.resolve().then(() => setLinkError("That studio link doesn't point to a product photo. Add one below."));
      return;
    }
    const ac = new AbortController();
    const giveUp = setTimeout(() => ac.abort(), 60_000);
    (async () => {
      const now = await rawInfo(initialSku, ac.signal).catch(() => null);
      const info = now ?? (await waitForRaw(initialSku, ac.signal));
      clearTimeout(giveUp);
      await start({ sku: initialSku, via: "phone", info });
    })().catch(() => setLinkError("We couldn't find the photo for that link. It may still be uploading. Try again, or add a photo below."));
    return () => {
      clearTimeout(giveUp);
    };
  }, [initialSample, initialSku, start]);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  const dirty = !!kit && packedSig !== sigOf(sceneId, controls, settings, heroOverride);
  const cutoutReady = status.cutout === "done";
  const busyLabel = running ? null : stageBusy ? "Rendering" : null;

  const shareUrl = kit ? `/kit/${kit.sku}` : null;
  const copyShare = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${shareUrl}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  if (!source) {
    return (
      <div className="px-4 sm:px-8">
        {linkError ? (
          <p role="alert" className="mx-auto mt-4 max-w-[64rem] rounded-xl bg-sindoor/10 px-4 py-3 text-sm text-sindoor ring-1 ring-sindoor/30">
            {linkError}
          </p>
        ) : null}
        <SourcePicker onReady={(s) => void start(s)} />
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <div className="mx-auto grid max-w-[90rem] gap-6 px-4 [grid-template-areas:'head'_'stage'_'panel'] sm:px-8 lg:grid-cols-[auto_minmax(22rem,28rem)] lg:grid-rows-[auto_1fr] lg:justify-center lg:gap-x-12 lg:[grid-template-areas:'stage_head'_'stage_panel']">
          <div className="min-w-0 [grid-area:head]">
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-display text-2xl leading-tight font-bold tracking-[-0.02em] sm:text-3xl">{product?.understanding?.name ?? (sample ? sample.title : "Your product")}</h1>
            <div className="flex items-center gap-2">
              {demo ? (
                <Tip label="Some steps use demo data while the live service is being connected. Every image is still rendered by Cloudinary.">
                  <span tabIndex={0} className="rounded-full bg-stage-2 px-3 py-1.5 text-[0.78rem] font-semibold whitespace-nowrap text-dim ring-1 ring-line-strong ring-inset">
                    Demo data
                  </span>
                </Tip>
              ) : null}
              <Button variant="ghost" size="sm" onClick={reset}>
                <RotateCcw />
                New photo
              </Button>
            </div>
          </div>

          <div className="mt-4">
            <PipelineRail status={status} notes={notes} />
          </div>


          {failure ? (
            <div role="alert" className="mt-4 flex flex-col gap-3 rounded-2xl bg-sindoor/10 p-4 text-sm text-paper ring-1 ring-sindoor/35 sm:flex-row sm:items-center sm:justify-between">
              <p>
                <span className="font-semibold text-sindoor">{PIPELINE_STEPS.find((s) => s.id === failure.step)?.label} didn&apos;t finish.</span> {failure.message}
              </p>
              <div className="flex shrink-0 gap-2">
                {failure.step !== "qa" ? (
                  <Button size="sm" variant="secondary" onClick={retry}>
                    <RefreshCw />
                    Try again
                  </Button>
                ) : null}
                {failure.from === "fix" && !getSample(source.sku) ? (
                  <Button size="sm" onClick={() => void start({ sku: SAMPLES[0].sku, via: "sample", info: { width: SAMPLES[0].product.rawWidth, height: SAMPLES[0].product.rawHeight, bytes: SAMPLES[0].product.rawBytes } })}>
                    Try the sample
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          </div>

            <div className="mx-auto w-full max-w-[36rem] [grid-area:stage] lg:sticky lg:top-4 lg:mx-0 lg:w-[min(calc((100dvh-6rem)*0.8),calc(100vw-40rem))] lg:max-w-none lg:self-start">
              <Stage
                ref={stageRef}
                src={stageSrc}
                alt={stageAlt}
                placeholder={scene && preview ? lqip(scene.publicId) : rawThumb ?? undefined}
                originalSrc={status.stage === "done" || heroOverride ? rawView : null}
                scanning={scanning}
                qa={qa}
                onBusy={setStageBusy}
                busyLabel={busyLabel}
                xray={heroOverride ?? (preview && product && scene ? { id: "stage", format: "hero", label: "Hero 4:5", url: preview.url, width: 1080, height: 1350, frame: "feed-post", alt: stageAlt, xray: preview } : null)}
              />
            </div>

            <aside aria-label="Adjust" className="min-w-0 [grid-area:panel]">
              <Tabs.Root value={tab} onValueChange={setTab}>
                <Tabs.List aria-label="Mode" className="grid grid-cols-2 gap-1 rounded-full bg-stage p-1 ring-1 ring-line">
                  {[
                    ["exact", "Exact"],
                    ["creative", "Creative"],
                  ].map(([v, l]) => (
                    <Tabs.Trigger
                      key={v}
                      value={v}
                      className="h-10 rounded-full text-sm font-semibold text-dim transition-colors hover:text-paper data-[state=active]:bg-paper data-[state=active]:text-studio"
                    >
                      {l}
                    </Tabs.Trigger>
                  ))}
                </Tabs.List>
                <p className="mt-3 text-[0.85rem] text-dim">
                  {tab === "exact" ? "Your real photo, composited. Free, instant and pixel-faithful." : "A generated reshoot. Slower and uses credits, always QA-checked."}
                </p>

                <Tabs.Content value="exact" className="mt-6 focus-visible:outline-none">
                  <CompositePanel
                    scenes={scenes}
                    sceneId={sceneId}
                    onScene={(s) => {
                      setSceneId(s.publicId);
                      setHeroOverride(null);
                      if (product?.understanding) setControls((c) => ({ ...defaultControls(product.understanding!.placement, s.dna), scale: c?.scale ?? 0.46 }));
                    }}
                    controls={controls}
                    onControls={(c) => {
                      setHeroOverride(null);
                      setControls(c);
                    }}
                    onReset={() => scene && product?.understanding && setControls(getSample(source.sku)?.controls ?? defaultControls(product.understanding.placement, scene.dna))}
                    placement={placement}
                    settings={settings}
                    onSettings={setSettings}
                    disabled={!cutoutReady}
                  />
                </Tabs.Content>
                <Tabs.Content value="creative" className="mt-6 focus-visible:outline-none">
                  <CreativePanel
                    sku={source.sku}
                    ready={cutoutReady}
                    onDemo={() => setDemo(true)}
                    onCredits={(n) => setCreditsUsed((x) => x + n)}
                    onUseAsHero={(a) => {
                      setHeroOverride(a);
                      void update(a);
                    }}
                  />
                </Tabs.Content>
              </Tabs.Root>

              <div className="sticky bottom-0 z-10 -mx-4 mt-8 border-t border-line bg-studio/90 px-4 py-4 backdrop-blur-md sm:mx-0 sm:rounded-2xl sm:border sm:px-5 lg:bottom-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-dim">{running ? "Working on it…" : dirty ? "You've made changes." : kit ? "Kit is up to date." : "Your kit appears below."}</p>
                  <Button onClick={() => void update()} disabled={!dirty || running}>
                    <RefreshCw />
                    Update kit
                  </Button>
                </div>
              </div>
            </aside>
        </div>

        {kit ? (
          <section ref={kitRef} aria-labelledby="kit-title" data-kit className="mx-auto mt-20 max-w-[90rem] scroll-mt-4 pb-20">
            <div className="flex flex-col gap-4 px-4 sm:flex-row sm:items-end sm:justify-between sm:px-8">
              <div>
                <h2 id="kit-title" className="text-[clamp(1.9rem,4.5vw,3rem)] leading-none font-bold tracking-[-0.03em]">
                  Your shelf: {countAssets(kit)} assets
                </h2>
                <p className="mt-3 text-dim">Tap the code button under any asset to see the Cloudinary URL that makes it.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {kit.zipUrl ? (
                  <a href={kit.zipUrl} className={buttonVariants({})}>
                    <Download />
                    Download all (.zip)
                  </a>
                ) : (
                  <div className="flex items-center gap-3">
                    <Button disabled aria-describedby="zip-note">
                      <Download />
                      Download all (.zip)
                    </Button>
                    <p id="zip-note" className="max-w-52 text-[0.78rem] leading-snug text-dim">
                      {demo || getSample(kit.sku) ? "The zip is made when a kit is saved on the live service." : "The zip is still being prepared."}
                    </p>
                  </div>
                )}
                <Button variant="secondary" onClick={copyShare}>
                  <Link2 />
                  {copied ? "Link copied" : "Copy kit link"}
                </Button>
              </div>
            </div>
            <div className="mt-6">
              <KitShelves kit={kit} deal={deal} />
            </div>
            <div className="mt-10 px-4 sm:px-8">
              <Receipt cost={{ ...kit.cost, generationCredits: creditsUsed }} mode={kit.mode} assetCount={countAssets(kit)} className="max-w-[40rem]" />
            </div>
          </section>
        ) : status.pack === "active" ? (
          <section aria-label="Your kit is being made" className="mx-auto mt-20 max-w-[90rem] px-4 pb-20 sm:px-8">
            <div className="skeleton h-9 w-72 rounded-lg" />
            <div className="mt-8 flex gap-6 overflow-hidden">
              {[0.5625, 0.8, 0.8, 1].map((r, i) => (
                <div key={i} className="skeleton h-[300px] shrink-0 rounded-2xl" style={{ width: 300 * r }} />
              ))}
            </div>
          </section>
        ) : null}
      </TooltipProvider>
    </MotionConfig>
  );
}
