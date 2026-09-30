"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { ArrowUpRight, Download, ImageUp, Link2, RefreshCw, RotateCcw } from "lucide-react";
import { MotionConfig } from "motion/react";
import * as React from "react";
import { KitShelves, type DealRequest } from "@/components/kit/kit-shelves";
import { Receipt } from "@/components/kit/receipt";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tip, TooltipProvider } from "@/components/ui/controls";
import * as api from "@/lib/client/api";
import { useDebounced } from "@/lib/client/hooks";
import { isBuiltUrl, publicUrl, sizedUrl, storedUrl } from "@/lib/client/img";
import { countAssets } from "@/lib/client/kit-view";
import { recolorExplain, recolorLabel, swatchName } from "@/lib/client/swatches";
import { rawInfo, rawPublicId, waitForRaw } from "@/lib/client/upload";
import { atLeast, isAborted, preloadImage, sleep } from "@/lib/client/util";
import { beforeAt, getSample, heroAlt, reelClips, SAMPLES, SCENE_LIBRARY, type SampleProduct } from "@/lib/showcase";
import { compositeUrl, defaultControls, geometry, lqip, OFFSET_RANGE, quantise, SCALE_RANGE } from "@/lib/transform/composite";
import { reelUrl } from "@/lib/transform/reel";
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
import { Stage, type QaStory } from "./stage";

type Status = Record<PipelineStepId, StepStatus>;
const IDLE: Status = { fix: "waiting", cutout: "waiting", stage: "waiting", light: "waiting", qa: "waiting", pack: "waiting" };
const DEFAULT_SETTINGS: PackSettings = { offer: { hindi: "त्योहार ऑफ़र", english: "Festive offer, 20% off" }, swatches: ["0f766e"] };
const PACK_POLL_MS = 2500;
const PACK_TIMEOUT_MS = 90_000;
const PACK_RESUME_MS = 4000;

function lightFrom(dna: SceneDNA) {
  const dirs = ["above", "the upper right", "the right", "the lower right", "below", "the lower left", "the left", "the upper left"];
  return `Light from ${dirs[Math.round((((dna.light_azimuth % 360) + 360) % 360) / 45) % 8]}, shadow matched`;
}

const sigOf = (sceneId: string | null, c: CompositeControls | null, s: PackSettings, hero: KitAsset | null) =>
  JSON.stringify({ sceneId, c: c && quantise(c), s, hero: hero?.url ?? null });

const sourceOf = (s: SampleProduct): SourceReady => ({ sku: s.sku, via: "sample", info: { width: s.product.rawWidth, height: s.product.rawHeight, bytes: s.product.rawBytes } });

interface Failure {
  step: PipelineStepId;
  message: string;
  from: "fix" | "stage";
  busy?: boolean; // Cloudinary rate-limited or out of quota: offer a finished sample meanwhile
}

/**
 * A live step that runs long says so; one that never answers becomes the
 * "Cloudinary is busy" fallback instead of spinning forever.
 */
function patient<T>(p: Promise<T>, o: { signal: AbortSignal; onSlow: () => void; slowMs?: number; maxMs?: number }): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const slow = setTimeout(o.onSlow, o.slowMs ?? 12_000);
    const stuck = setTimeout(() => reject(new api.ApiFailure(504, { error: "Cloudinary is taking too long to answer.", code: "upstream" })), o.maxMs ?? 55_000);
    const done = () => {
      clearTimeout(slow);
      clearTimeout(stuck);
    };
    o.signal.addEventListener("abort", done, { once: true });
    p.then(
      (v) => {
        done();
        resolve(v);
      },
      (e) => {
        done();
        reject(e);
      },
    );
  });
}

/** Rate limits, exhausted quota and upstream hiccups: not the seller's fault, and not worth a red error. */
const isBusy = (e: unknown) => e instanceof api.ApiFailure && ([420, 429, 502, 503, 504].includes(e.status) || e.body.code === "quota_low") && e.body.code !== "cap_reached";

/** One automatic repair for an Exact QA rejection (the spec's single retry). */
interface Fix {
  controls: CompositeControls;
  scene: Scene;
  note: string; // what was changed, shown as the proud "auto-fixed" moment
}

function planFix(q: QaResult, c: CompositeControls, scene: Scene, scenes: Scene[], p: ProductRecord): Fix | null {
  const has = (t: string) => q.matched.includes(t);
  const placement = p.understanding?.placement ?? "standing";
  const nextScene = () => {
    const pool = scenes.filter((s) => s.publicId !== scene.publicId && s.view === scene.view);
    return pool.find((s) => p.understanding?.suggested_themes.includes(s.theme)) ?? pool[0] ?? null;
  };
  if (has("compositing-artifact") || has("garbled-text") || has("unsafe")) {
    const s = nextScene();
    if (s) return { scene: s, controls: { ...defaultControls(placement, s.dna, p.cutout), scale: c.scale }, note: `moved it to the ${s.title} scene` };
    if (has("compositing-artifact") && c.shadow) return { scene, controls: { ...c, shadow: false }, note: "turned the cast shadow off" };
    return null;
  }
  if (has("product-floating")) {
    // nudged above the surface: put it back on the line Scene DNA found; otherwise sink it a little
    const down = c.offsetY < 0 ? 0 : Math.min(OFFSET_RANGE.max, c.offsetY + 2 * OFFSET_RANGE.step);
    return { scene, controls: { ...c, offsetY: down, contact: true, shadow: true }, note: "set it down onto the surface and turned on the contact shadow" };
  }
  if (has("scale-implausible")) {
    const base = defaultControls(placement, scene.dna, p.cutout).scale;
    const scale = Math.min(SCALE_RANGE.max, Math.max(SCALE_RANGE.min, c.scale > base ? c.scale - 0.08 : c.scale + 0.08));
    return { scene, controls: { ...c, scale }, note: c.scale > base ? "made it a little smaller" : "made it a little larger" };
  }
  if (!has("product-visible")) {
    const base = defaultControls(placement, scene.dna, p.cutout);
    return { scene, controls: { ...c, scale: base.scale, offsetX: 0, offsetY: 0 }, note: "brought it back to the centre of the surface" };
  }
  return null;
}

/** Show a pack asset from its stored copy; label colour variants for what they really change. */
function presentAsset(a: KitAsset, p: ProductRecord): KitAsset {
  const stored = a.publicId ? { url: storedUrl(a.publicId) } : {};
  if (!a.id.startsWith("recolor-")) return { ...a, ...stored };
  const xray = isBuiltUrl(a.xray) ? { ...a.xray, segments: a.xray.segments.map((g) => (g.kind === "gen-ai" ? { ...g, label: recolorExplain(p.understanding) } : g)) } : a.xray;
  return { ...a, ...stored, xray, label: recolorLabel(a.id, p.understanding), alt: `${a.alt}, in ${swatchName(a.id.slice(8)).toLowerCase()}` };
}

export function Studio({ initialSample, initialSku }: { initialSample?: string; initialSku?: string }) {
  const [source, setSource] = React.useState<SourceReady | null>(null);
  const [linkError, setLinkError] = React.useState<string | null>(null);
  // a ?sku= link (phone capture, refresh): look for that photo before offering the picker
  const [awaiting, setAwaiting] = React.useState(() => !!initialSku && SKU_RE.test(initialSku) && !getSample(initialSku) && !getSample(initialSample));
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
  const [qaStory, setQaStory] = React.useState<QaStory | null>(null);
  const [autoFixed, setAutoFixed] = React.useState(false);
  const [kit, setKit] = React.useState<Kit | null>(null);
  const [pendingFormats, setPendingFormats] = React.useState<string[]>([]);
  const [deal, setDeal] = React.useState<DealRequest | null>(null);
  const [packedSig, setPackedSig] = React.useState<string | null>(null);
  const [demo, setDemo] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [creditsUsed, setCreditsUsed] = React.useState(0);
  const [stageBusy, setStageBusy] = React.useState(false);
  const [tab, setTab] = React.useState("exact");
  const [copied, setCopied] = React.useState(false);
  const [runId, setRunId] = React.useState(0);

  const abortRef = React.useRef<AbortController | null>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const kitRef = React.useRef<HTMLElement>(null);

  const scene = scenes?.find((s) => s.publicId === sceneId) ?? null;
  const placement = product?.understanding?.placement ?? "standing";
  const liveControls = useDebounced(controls, 250);
  const sample = getSample(source?.sku);

  const buildHero = React.useCallback(
    (p: ProductRecord, sc: Scene, c: CompositeControls, opts: { width?: number; format?: string } = {}): BuiltUrl =>
      compositeUrl({ scenePublicId: sc.publicId, dna: sc.dna, cutout: p.cutout!, placement: p.understanding?.placement ?? "standing", controls: c, ...opts }),
    [],
  );

  const preview = product?.cutout && scene && liveControls && status.stage !== "waiting" ? buildHero(product, scene, liveControls) : null;

  // What the stage shows right now.
  const atSampleDefaults = !!sample && sceneId === sample.scene.publicId && !!controls && sigOf(null, controls, settings, null) === sigOf(null, sample.controls, settings, null);
  const rawView = source ? (sample ? beforeAt(sample, 1080) : publicUrl(rawPublicId(source.sku), { w: 1080, h: 1350, crop: "c_pad,b_auto:border" })) : null;
  const rawThumb = source ? (sample ? beforeAt(sample, 48) : publicUrl(rawPublicId(source.sku), { w: 48, h: 60, crop: "c_pad,b_auto:border" })) : null;
  const cutoutView = product?.cutout ? publicUrl(product.cutout.publicId, { w: 1080, h: 1350, crop: "c_mpad,b_rgb:00000000" }) : null;
  const stageSrc = heroOverride ? sizedUrl(heroOverride, 1080) : (preview?.url ?? cutoutView ?? rawView);
  const stageAlt = heroOverride?.alt ?? (preview && product && scene ? heroAlt(product, scene) : product?.caption ? `Your photo: ${product.caption}` : "Your product photo");
  const scanning = status.fix === "active" ? "Reading your photo" : status.cutout === "active" ? "Cutting out" : null;

  const mark = React.useCallback((id: PipelineStepId, st: StepStatus, note?: string) => {
    setStatus((s) => ({ ...s, [id]: st }));
    if (note !== undefined) setNotes((n) => ({ ...n, [id]: note }));
  }, []);
  const seen = React.useCallback((src: api.DataSource) => {
    if (src === "demo") setDemo(true);
  }, []);

  /** Stage → Light-match → QA (one automatic fix) → Pack → deal. Shared by the first run and "Update kit". */
  const finish = React.useCallback(
    async (args: {
      src: SourceReady;
      product: ProductRecord;
      scene: Scene;
      scenes: Scene[];
      controls: CompositeControls;
      settings: PackSettings;
      hero: KitAsset | null;
      tokens: number;
      t0: number;
      signal: AbortSignal;
    }) => {
      const { src, product: p, settings: st, hero, signal } = args;
      const replay = getSample(src.sku);
      let sc = args.scene;
      let c = args.controls;
      let step: PipelineStepId = "stage";
      setRunId((n) => n + 1);
      setQaStory(null);
      setAutoFixed(false);
      try {
        mark("stage", "active", hero ? "Using your creative take" : `Placing it on the ${sc.title} scene`);
        await sleep(650, signal);
        mark("stage", "done", hero ? "Creative take" : sc.title);

        const lightUp = async () => {
          step = "light";
          const previewUrl = hero ? sizedUrl(hero, 1080) : buildHero(p, sc, c).url;
          mark("light", "active", hero ? "Loading your creative take" : "Matching shadows and tone to the scene's light");
          await atLeast(preloadImage(previewUrl, signal), 900, signal);
          mark("light", "done", hero ? "Ready" : lightFrom(sc.dna));
        };
        await lightUp();

        step = "qa";
        let tokens = args.tokens;
        let fixed: Fix | null = null;
        const check = async (): Promise<QaResult> => {
          if (hero?.qa) {
            await sleep(500, signal);
            return hero.qa;
          }
          const url = hero ? hero.url : buildHero(p, sc, c, { format: "f_jpg,q_90" }).url;
          const q = await atLeast(
            patient(api.qa({ sku: src.sku, url, kind: hero ? "creative" : "exact" }, signal), { signal, onSlow: () => mark("qa", "active", "Still checking. AI Vision is slower than usual right now") }),
            replay?.pace.qa ?? 1000,
            signal,
          );
          seen(q.source);
          tokens += q.data.tokens;
          return q.data.qa;
        };
        mark("qa", "active", "AI Vision is checking it looks real and nothing about your product changed");
        let verdict = await check();
        setQa(verdict);

        if (verdict.status === "rejected" && !hero) {
          const fix = planFix(verdict, c, sc, args.scenes, p);
          if (fix) {
            // first sentence of the server's reason, as written
            const caught = (verdict.reasons[0] ?? "Something looked off.").split(/(?<=\.)\s/)[0];
            setQaStory({ phase: "fixing", caught, fix: fix.note });
            mark("qa", "active", `QA caught it: ${caught} Fixing it automatically…`);
            await sleep(1400, signal);
            sc = fix.scene;
            c = quantise(fix.controls);
            setSceneId(sc.publicId);
            setControls(c);
            setQa(null);
            await lightUp();
            step = "qa";
            mark("qa", "active", "Checking the fixed version");
            verdict = await check();
            setQa(verdict);
            if (verdict.status === "approved") {
              fixed = fix;
              setAutoFixed(true);
              setQaStory({ phase: "fixed", caught, fix: fix.note });
            } else {
              setQaStory(null);
            }
          }
        }

        if (verdict.status === "rejected") {
          const why = verdict.reasons.join(" ") || "The check found a change to your product.";
          mark("qa", "failed", verdict.reasons[0] ?? "The check found a problem");
          setFailure({ step: "qa", message: `${why} Adjust it on the right, then update the kit.`, from: "stage" });
          return;
        }
        mark("qa", "done", fixed ? `Auto-fixed: ${fixed.note}. Approved` : "Approved: looks real, product unchanged");

        step = "pack";
        mark("pack", "active", "Making every format");
        const saveUrl = hero ? hero.url : buildHero(p, sc, c, { format: "f_jpg,q_90" }).url;
        const full = buildHero(p, sc, c);
        const sceneSlug = sc.publicId.split("/").slice(-2).join("-");
        const offer = st.offer.hindi.trim() || st.offer.english.trim() ? { hindi: st.offer.hindi.trim() || undefined, english: st.offer.english.trim() || undefined } : undefined;
        const productBox = hero ? undefined : geometry(p.cutout!, sc.dna, quantise(c), p.understanding?.placement ?? "standing");
        const started = await patient(
          api.pack({ sku: src.sku, heroUrl: saveUrl, sceneSlug, offer, recolor: st.swatches, textZone: hero ? undefined : sc.dna.text_zone, productBox }, signal),
          { signal, onSlow: () => mark("pack", "active", "Saving the hero and starting every format") },
        );
        seen(started.source);
        let assets = started.data.assets;
        let pending = started.data.pending;
        let zipUrl: string | undefined;
        const total = assets.length;
        if (replay) {
          // replay: count the stored formats in as they "finish"
          for (let n = 1; n <= total; n++) {
            mark("pack", "active", `${n} of ${total} formats ready`);
            await sleep(Math.round(replay.pace.pack / total), signal);
          }
        }
        const t = Date.now();
        while (pending.length && Date.now() - t < PACK_TIMEOUT_MS) {
          mark("pack", "active", `${total - pending.length} of ${total} formats ready`);
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

        const heroId = started.data.heroPublicId;
        let delivered = 0;
        try {
          const h = await fetch(storedUrl(heroId), { method: "HEAD", signal });
          delivered = Number(h.headers.get("content-length") ?? 0);
        } catch {
          delivered = 0;
        }

        let next: Kit;
        if (replay && !hero) {
          next = { ...replay.kit, cost: { ...replay.kit.cost, bytesDelivered: delivered } };
        } else {
          const ready = assets.filter((a) => a.id !== "hero" && !pending.includes(a.id)).map((a) => presentAsset(a, p));
          const heroAsset: KitAsset = hero
            ? { ...hero, id: "hero", label: "Hero 4:5", publicId: heroId }
            : { id: "hero", format: "hero", label: "Hero 4:5", url: full.url, width: 1080, height: 1350, frame: "feed-post", alt: heroAlt(p, sc), xray: full, publicId: heroId, qa: verdict };
          const clips = reelClips(heroId, ready);
          const reel = reelUrl({ images: clips, offer });
          const gen = ready.filter((a) => isBuiltUrl(a.xray) && a.xray.segments.some((g) => g.kind === "gen-ai")).length;
          next = {
            sku: src.sku,
            product: p,
            mode: hero ? "creative" : "exact",
            scene: sc,
            controls: c,
            hero: heroAsset,
            assets: ready,
            reel: { url: reel.url, xray: reel, seconds: reel.seconds },
            zipUrl,
            cost: {
              generationCredits: 0,
              creditsSavedByReuse: hero ? 0 : sc.credits,
              aiVisionTokens: tokens,
              transformationsEstimate: gen * 50 + ready.length - gen + 2,
              bytesOriginal: src.info.bytes,
              bytesDelivered: delivered,
              seconds: Math.max(1, Math.round((performance.now() - args.t0) / 1000)),
            },
            createdAt: new Date().toISOString(),
          };
        }
        setKit(next);
        setPendingFormats(pending);
        setPackedSig(sigOf(sc.publicId, c, st, hero));
        mark("pack", "done", pending.length ? `${next.assets.length} formats ready, ${pending.length} still rendering` : `Kit ready: ${countAssets(next)} assets`);
        setDeal((d) => ({ key: (d?.key ?? 0) + 1, from: () => stageRef.current?.getBoundingClientRect() ?? null }));
      } catch (e) {
        if (isAborted(e)) return;
        mark(step, isBusy(e) ? "paused" : "failed", isBusy(e) ? "Paused: Cloudinary is busy right now" : api.messageFor(e));
        setFailure({ step, message: api.messageFor(e), from: "stage", busy: isBusy(e) });
      }
    },
    [buildHero, mark, seen],
  );

  /** The whole run, from a fresh photo (or a sample replay). */
  const start = React.useCallback(
    async (src: SourceReady) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const signal = ac.signal;
      const t0 = performance.now();
      const replay = getSample(src.sku);
      setSource(src);
      setAwaiting(false);
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
      setQaStory(null);
      setKit(null);
      setPendingFormats([]);
      setPackedSig(null);
      setCreditsUsed(0);
      setRunning(true);
      window.history.replaceState(null, "", `/studio?${replay ? `sample=${src.sku}` : `sku=${src.sku}`}`);

      let step: PipelineStepId = "fix";
      try {
        mark("fix", "active", "AI Vision is reading your photo");
        const a = await atLeast(
          patient(api.analyze(src.sku, signal), { signal, onSlow: () => mark("fix", "active", "Still reading. Cloudinary is slower than usual right now") }),
          replay?.pace.analyze ?? 1100,
          signal,
        );
        seen(a.source);
        let p: ProductRecord = {
          sku: src.sku,
          rawPublicId: replay?.product.rawPublicId ?? rawPublicId(src.sku),
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
        const c = await atLeast(
          patient(
            api.cutout(src.sku, signal, (n) => mark("cutout", "active", n > 2 ? "Still cutting out. Detailed edges take a few seconds" : "Lifting it off the background")),
            { signal, onSlow: () => mark("cutout", "active", "Still cutting out. Detailed edges take a few seconds"), slowMs: 15_000, maxMs: 90_000 },
          ),
          replay?.pace.cutout ?? 1300,
          signal,
        );
        seen(c.source);
        p = { ...p, cutout: c.data.cutout };
        setProduct(p);
        mark("cutout", "done", "Clean edges, background gone");

        step = "stage";
        mark("stage", "active", "Finding a scene that fits");
        const view = VIEW_FOR_PLACEMENT[p.understanding!.placement];
        let list: Scene[];
        if (replay) {
          // a replay makes no requests: the library snapshot ships with the page
          await sleep(500, signal);
          list = api.curateScenes(SCENE_LIBRARY.filter((s) => s.view === view));
          if (!list.some((s) => s.publicId === replay.scene.publicId)) list = [replay.scene, ...list];
        } else {
          const sc = await api.scenes(view, signal);
          seen(sc.source);
          list = sc.data;
        }
        const pick = (replay ? list.find((s) => s.publicId === replay.scene.publicId) : undefined) ?? list.find((s) => p.understanding!.suggested_themes.includes(s.theme)) ?? list[0];
        if (!pick) throw new api.ApiFailure(404, { error: "No scenes fit this product's angle yet. Try a sample product.", code: "not_found" });
        const ctl = replay?.controls ?? quantise(defaultControls(p.understanding!.placement, pick.dna, p.cutout));
        setScenes(list);
        setSceneId(pick.publicId);
        setControls(ctl);
        const st = replay ? { offer: replay.offer, swatches: replay.swatches } : DEFAULT_SETTINGS;
        setSettings(st);

        await finish({ src, product: p, scene: pick, scenes: list, controls: ctl, settings: st, hero: null, tokens: a.data.tokens, t0, signal });
      } catch (e) {
        if (isAborted(e)) return;
        mark(step, isBusy(e) ? "paused" : "failed", isBusy(e) ? "Paused: Cloudinary is busy right now" : api.messageFor(e));
        setFailure({ step, message: api.messageFor(e), from: "fix", busy: isBusy(e) });
      } finally {
        if (!signal.aborted) setRunning(false);
      }
    },
    [finish, mark, seen],
  );

  /** Re-stage with the current scene/sliders/settings and re-pack (live products only). */
  const update = React.useCallback(
    async (hero: KitAsset | null = heroOverride) => {
      if (!source || !product?.cutout || !scene || !controls || getSample(source.sku)) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setFailure(null);
      setQa(null);
      setRunning(true);
      setStatus((s) => ({ ...s, stage: "waiting", light: "waiting", qa: "waiting", pack: "waiting" }));
      try {
        await finish({ src: source, product, scene, scenes: scenes ?? [scene], controls, settings, hero, tokens: 0, t0: performance.now(), signal: ac.signal });
      } finally {
        if (!ac.signal.aborted) setRunning(false);
      }
    },
    [source, product, scene, scenes, controls, settings, heroOverride, finish],
  );

  // Formats still rendering when the run ended: keep checking quietly and add them as they land.
  React.useEffect(() => {
    if (!kit || !pendingFormats.length || getSample(kit.sku)) return;
    const ac = new AbortController();
    const until = Date.now() + 120_000;
    (async () => {
      while (Date.now() < until) {
        await sleep(PACK_RESUME_MS, ac.signal);
        const s = await api.packStatus(kit.sku, ac.signal).catch(() => null);
        if (!s) continue;
        const heroMatches = !s.data.heroPublicId || s.data.heroPublicId === kit.hero.publicId;
        if (!heroMatches) return;
        const ready = s.data.assets.filter((a) => a.id !== "hero" && !s.data.pending.includes(a.id)).map((a) => presentAsset(a, kit.product));
        setKit((k) => {
          if (!k || k.sku !== kit.sku) return k;
          const reel = reelUrl({ images: reelClips(k.hero.publicId!, ready), offer: settings.offer.hindi || settings.offer.english ? { hindi: settings.offer.hindi || undefined, english: settings.offer.english || undefined } : undefined });
          return { ...k, assets: ready, zipUrl: s.data.zipUrl ?? k.zipUrl, reel: { url: reel.url, xray: reel, seconds: reel.seconds } };
        });
        setPendingFormats(s.data.pending);
        if (!s.data.pending.length) {
          mark("pack", "done", `Kit ready: ${ready.length + 1} assets`);
          return;
        }
      }
    })().catch(() => {});
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when the kit or its pending set changes
  }, [kit?.sku, kit?.hero.publicId, pendingFormats.length]);

  const retry = () => {
    if (!source) return;
    if (failure?.from === "fix" || getSample(source.sku)) void start(source);
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
    setQaStory(null);
    window.history.replaceState(null, "", "/studio");
  };

  // Deep links: ?sample=… starts right away; ?sku=… waits for that photo (phone flow, refresh).
  const booted = React.useRef(false);
  React.useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const s = getSample(initialSample) ?? getSample(initialSku);
    if (s) {
      void Promise.resolve().then(() => start(sourceOf(s)));
      return;
    }
    if (initialSample) {
      void Promise.resolve().then(() => setLinkError("That sample isn't available any more. Pick one below."));
      return;
    }
    if (!initialSku) return;
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
    })()
      .catch(() => setLinkError("We couldn't find the photo for that link. It may still be uploading. Try again, or add a photo below."))
      .finally(() => setAwaiting(false));
    return () => {
      clearTimeout(giveUp);
    };
  }, [initialSample, initialSku, start]);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  // the "caught, fixed, approved" card has told its story once the kit is dealt; the rail keeps the wrench
  React.useEffect(() => {
    if (qaStory?.phase !== "fixed" || status.pack !== "done") return;
    const t = setTimeout(() => setQaStory(null), 8000);
    return () => clearTimeout(t);
  }, [qaStory?.phase, status.pack]);

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

  if (!source && awaiting) {
    return (
      <div role="status" className="mx-auto grid min-h-[60dvh] max-w-md place-items-center px-4 text-center">
        <div className="grid justify-items-center gap-4">
          <span className="relative flex size-3">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-marigold opacity-60" />
            <span className="relative inline-flex size-3 rounded-full bg-marigold" />
          </span>
          <p className="font-display text-2xl font-bold tracking-[-0.02em]">Looking for your photo</p>
          <p className="text-dim">It appears here the moment it finishes uploading.</p>
          <Button variant="ghost" size="sm" onClick={() => setAwaiting(false)}>
            Add a different photo
          </Button>
        </div>
      </div>
    );
  }

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

  const barText = running
    ? "Working on it…"
    : sample
      ? dirty
        ? "Your changes preview live. Upload your own photo to build a kit with them."
        : "This sample replays a finished run. Upload your photo to make your own."
      : dirty
        ? "You've made changes."
        : kit
          ? "Kit is up to date."
          : "Your kit appears below.";

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <div className="mx-auto grid max-w-[90rem] gap-6 px-4 [grid-template-areas:'head'_'stage'_'panel'] sm:px-8 lg:grid-cols-[auto_minmax(22rem,28rem)] lg:grid-rows-[auto_1fr] lg:justify-center lg:gap-x-12 lg:[grid-template-areas:'stage_head'_'stage_panel']">
          <div className="min-w-0 [grid-area:head]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="font-display text-2xl leading-tight font-bold tracking-[-0.02em] sm:text-3xl">
                  {product?.understanding?.name ?? (sample ? sample.title : "Your product")}
                </h1>
                {sample ? (
                  <Tip label="These are the real Cloudinary results from a live run of this photo, saved and replayed, so a sample uses no AI quota. Upload your own photo to run every step live.">
                    <button type="button" className="mt-1.5 inline-flex items-center gap-1.5 rounded-full text-[0.8rem] font-medium text-dim underline decoration-dotted underline-offset-4 hover:text-paper">
                      <span aria-hidden className="size-1.5 rounded-full bg-marigold" />
                      Sample replay, no quota used
                    </button>
                  </Tip>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {demo ? (
                  <Tip label="Offline demo mode (NEXT_PUBLIC_S2S_MOCK). Answers come from built-in examples.">
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
              <PipelineRail status={status} notes={notes} fixed={autoFixed} />
            </div>

            {failure?.busy ? (
              <div role="alert" className="mt-4 grid gap-3 rounded-2xl bg-marigold/10 p-4 text-sm text-paper ring-1 ring-marigold/35">
                <p>
                  <span className="font-semibold text-marigold">Cloudinary is busy right now.</span> The shared account is handling a lot of requests, so this step paused. Your photo is
                  saved: try again in a minute. Meanwhile, see a kit finished from a sample photo.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void start(sourceOf(SAMPLES[0]))}>
                    Open a finished sample
                  </Button>
                  <Button size="sm" variant="secondary" onClick={retry}>
                    <RefreshCw />
                    Try again
                  </Button>
                </div>
              </div>
            ) : failure ? (
              <div role="alert" className="mt-4 flex flex-col gap-3 rounded-2xl bg-sindoor/10 p-4 text-sm text-paper ring-1 ring-sindoor/35 sm:flex-row sm:items-center sm:justify-between">
                <p>
                  <span className="font-semibold text-sindoor">{failure.step === "qa" ? "QA stopped this version." : `${PIPELINE_STEPS.find((s) => s.id === failure.step)?.label} didn't finish.`}</span>{" "}
                  {failure.message}
                </p>
                <div className="flex shrink-0 gap-2">
                  {failure.step !== "qa" ? (
                    <Button size="sm" variant="secondary" onClick={retry}>
                      <RefreshCw />
                      Try again
                    </Button>
                  ) : null}
                  {failure.from === "fix" && !sample ? (
                    <Button size="sm" onClick={() => void start(sourceOf(SAMPLES[0]))}>
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
              placeholder={scene && preview ? lqip(scene.publicId) : (rawThumb ?? undefined)}
              originalSrc={status.stage === "done" || heroOverride ? rawView : null}
              originalLabel={sample && atSampleDefaults ? "Hold to compare with the photo" : "Hold to see your photo"}
              scanning={scanning}
              qa={qa}
              qaStory={qaStory}
              onBusy={setStageBusy}
              busyLabel={busyLabel}
              enter={heroOverride ? "focus" : preview ? (running ? "focus" : "soft") : cutoutView ? "wipe" : "focus"}
              light={scene && !heroOverride && (status.light === "active" || status.qa === "active") ? { azimuth: scene.dna.light_azimuth, key: runId } : null}
              xray={heroOverride ?? (preview && product && scene ? { id: "stage", format: "hero", label: "Hero 4:5", url: preview.url, width: 1080, height: 1350, frame: "feed-post", alt: stageAlt, xray: preview, qa: qa ?? undefined } : null)}
            />
            <div aria-hidden className="shelf-ledge relative -mx-3 -mt-1 hidden sm:block sm:-mx-5" />
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
                    setQa(null); // the new composite hasn't been checked yet
                    setQaStory(null);
                    if (product?.understanding)
                      setControls((c) => {
                        const d = defaultControls(product.understanding!.placement, s.dna, product.cutout);
                        return c ? { ...d, scale: c.scale, shadow: c.shadow, contact: c.contact, harmonise: c.harmonise } : d;
                      });
                  }}
                  controls={controls}
                  onControls={(c) => {
                    setHeroOverride(null);
                    setControls(c);
                    setQa(null);
                    setQaStory(null);
                  }}
                  onReset={() =>
                    scene && product?.understanding && setControls(sample && scene.publicId === sample.scene.publicId ? sample.controls : quantise(defaultControls(product.understanding.placement, scene.dna, product.cutout)))
                  }
                  product={product}
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
                  isSample={!!sample}
                  active={tab === "creative"}
                  onDemo={() => setDemo(true)}
                  onCredits={(n) => setCreditsUsed((x) => x + n)}
                  stageRect={() => stageRef.current?.getBoundingClientRect() ?? null}
                  onUseAsHero={(a) => {
                    setHeroOverride(a);
                    void update(a);
                  }}
                />
              </Tabs.Content>
            </Tabs.Root>

            <div className="sticky bottom-0 z-10 -mx-4 mt-8 border-t border-line bg-studio/90 px-4 py-4 backdrop-blur-md sm:mx-0 sm:rounded-2xl sm:border sm:px-5 lg:bottom-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-dim" aria-live="polite">
                  {barText}
                </p>
                {sample ? (
                  <Button onClick={reset} variant={dirty ? "primary" : "secondary"} disabled={running}>
                    <ImageUp />
                    Use my photo
                  </Button>
                ) : (
                  <Button onClick={() => void update()} disabled={!dirty || running}>
                    <RefreshCw />
                    Update kit
                  </Button>
                )}
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
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <div className="flex flex-wrap gap-2">
                  {kit.zipUrl ? (
                    <a href={kit.zipUrl} className={buttonVariants({})}>
                      <Download />
                      Download all (.zip)
                    </a>
                  ) : sample ? (
                    <a href={`/kit/${kit.sku}`} className={buttonVariants({})}>
                      <ArrowUpRight />
                      Open the kit page
                    </a>
                  ) : (
                    <Button disabled aria-describedby="zip-note">
                      <Download />
                      Preparing the zip…
                    </Button>
                  )}
                  <Button variant="secondary" onClick={copyShare}>
                    <Link2 />
                    {copied ? "Link copied" : "Copy kit link"}
                  </Button>
                </div>
                {!kit.zipUrl ? (
                  <p id="zip-note" className="max-w-80 text-[0.8rem] leading-snug text-dim sm:text-right">
                    {sample ? "Samples replay a finished kit. A kit from your own photo downloads as one zip." : pendingFormats.length ? "The zip is ready once the last formats finish rendering." : "Cloudinary is packing the zip. It appears here in a moment."}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="mt-6">
              <KitShelves kit={kit} deal={deal} rendering={pendingFormats} />
            </div>
            <div className="mt-10 px-4 sm:px-8">
              <Receipt cost={{ ...kit.cost, generationCredits: creditsUsed }} mode={kit.mode} assetCount={countAssets(kit)} replay={!!sample} className="max-w-[40rem]" />
            </div>
          </section>
        ) : status.pack === "active" ? (
          <section aria-label="Your kit is being made" className="mx-auto mt-20 max-w-[90rem] px-4 pb-20 sm:px-8">
            <div className="skeleton h-9 w-72 max-w-full rounded-lg" />
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
