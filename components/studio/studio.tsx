"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { ArrowUpRight, ChevronDown, Download, ImageUp, Link2, RefreshCw, RotateCcw, Store, WandSparkles } from "lucide-react";
import { MotionConfig } from "motion/react";
import dynamic from "next/dynamic";
import Link from "next/link";
import * as React from "react";
import { ReadOnlyNote } from "@/components/features/shared";
import type { DealRequest } from "@/components/kit/kit-shelves";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tip, TooltipProvider } from "@/components/ui/controls";
import type { BriefResponse } from "@/lib/api-contract";
import * as api from "@/lib/client/api";
import { fixMeta } from "@/lib/client/features";
import { useDebounced } from "@/lib/client/hooks";
import { isBuiltUrl, isGenerative, publicUrl, sizedUrl, storedUrl } from "@/lib/client/img";
import { DEMO_SHELF, SAMPLE_PHOTO_DISCLOSURE, SAMPLE_PHOTO_LABEL } from "@/lib/claims";
import { kitContents, zipLabel } from "@/lib/client/kit-view";
import { dnaOf, firstSentence, fixWords, qaMarks, replayAttempts, type QaMarks } from "@/lib/client/qa-replay";
import { sampleCost, sampleHeroWeight, sampleTimeLine } from "@/lib/client/sample-data";
import { canRecolor, MAX_SWATCHES, recolorExplain, recolorLabel, swatchName } from "@/lib/client/swatches";
import { rawInfo, rawPublicId, waitForRaw } from "@/lib/client/upload";
import { Aborted, atLeast, cn, isAborted, preloadImage, sleep } from "@/lib/client/util";
import type { ReadinessReport } from "@/lib/readiness";
import { beforeAt, getSample, heroAlt, heroAt, PRIMARY_SAMPLE, reelClips, SCENE_LIBRARY, type SampleProduct } from "@/lib/showcase";
import { compositeUrl, defaultControls, geometry, lqip, OFFSET_RANGE, quantise, SCALE_RANGE } from "@/lib/transform/composite";
import { reelUrl } from "@/lib/transform/reel";
import {
  PIPELINE_STEPS,
  PLATE,
  SKU_RE,
  VIEW_FOR_PLACEMENT,
  type BriefKit,
  type BuiltUrl,
  type CompositeControls,
  type Kit,
  type KitAsset,
  type PipelineStepId,
  type ProductRecord,
  type QaResult,
  type RetouchFix,
  type Scene,
  type SceneDNA,
} from "@/lib/types";
import type { PackSettings } from "./composite-panel";
import { DnaToggle } from "./dna-toggle";
import { PipelineRail, type StepStatus } from "./pipeline-rail";
import type { SourceReady } from "./source-picker";
import { Stage, type QaStory } from "./stage";

// Split out of the first load: each panel loads when it is first shown (the kit's parts while the run works).
const SourcePicker = dynamic(() => import("./source-picker").then((m) => m.SourcePicker));
const CompositePanel = dynamic(() => import("./composite-panel").then((m) => m.CompositePanel), { ssr: false, loading: () => <PanelSkeleton /> });
const SamplePicker = dynamic(() => import("./source-picker").then((m) => m.SamplePicker), { ssr: false });
const CreativePanel = dynamic(() => import("./creative-panel").then((m) => m.CreativePanel), { ssr: false, loading: () => <PanelSkeleton /> });
const BriefBar = dynamic(() => import("@/components/features/brief-bar").then((m) => m.BriefBar), { ssr: false, loading: () => <PanelSkeleton /> });
const RetouchCard = dynamic(() => import("@/components/features/retouch-card").then((m) => m.RetouchCard), { ssr: false, loading: () => <PanelSkeleton /> });
const SceneGenerator = dynamic(() => import("@/components/features/scene-generator").then((m) => m.SceneGenerator), { ssr: false, loading: () => <PanelSkeleton /> });
const preloadKitParts = () => Promise.all([import("@/components/kit/kit-shelves"), import("@/components/readiness/KitReadiness"), import("@/components/features/cost-receipt")]);
const KitShelves = dynamic(() => import("@/components/kit/kit-shelves").then((m) => m.KitShelves), { ssr: false });
const KitReadiness = dynamic(() => import("@/components/readiness/KitReadiness").then((m) => m.KitReadiness), { ssr: false });
const CostReceipt = dynamic(() => import("@/components/features/cost-receipt").then((m) => m.CostReceipt), { ssr: false });

type Status = Record<PipelineStepId, StepStatus>;
const IDLE: Status = { fix: "waiting", cutout: "waiting", stage: "waiting", light: "waiting", qa: "waiting", pack: "waiting" };
const DEFAULT_SETTINGS: PackSettings = { offer: { hindi: "त्योहार ऑफ़र", english: "Festive offer, 20% off" }, swatches: ["0f766e"] };
const PACK_POLL_MS = 2500;
const PACK_TIMEOUT_MS = 90_000;
const PACK_RESUME_MS = 4000;
const RETOUCH_MAX_MS = 150_000;
/** What a browser sends for an image: f_auto answers the format a real visitor gets (WebP/AVIF), not JPEG. */
const IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";
const CAUGHT_MS = 2200; // QA's catch stays on screen at least this long, so it can be read
const APPROVED_MS = 1100; // and its "Approved" lands before the pack starts

/** Where the stage's first frame comes from, and at which of the site's fixed widths. */
const STAGE_SIZES = "(min-width: 1024px) 50vw, (min-width: 640px) min(36rem, calc(100vw - 4rem)), calc(100vw - 2rem)";

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
  quota?: boolean; // the live pipeline is paused (transformation floor / Admin API limit): lead with the samples
  readOnly?: boolean; // the write lock (403 read_only): someone else's or a demo product, viewable but not changeable
}

/** The auto-retouch between analyze and the cutout (live photos only). */
interface Retouch {
  sku: string;
  state: "running" | "done" | "failed";
  fixes: RetouchFix[];
  url?: string; // the retouched photo, when something was fixed
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
const isQuota = (e: unknown) => e instanceof api.ApiFailure && e.body.code === "quota_low";

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

/**
 * Formats that can go on the shelf: saved, not still rendering, not failed. A failed
 * format is never shown through its recipe URL: the browser would re-run a generative
 * transformation that already failed (and bill it) on every view.
 */
function shelfReady(assets: KitAsset[], pending: string[], failed: string[]) {
  const ok: KitAsset[] = [];
  const bad: KitAsset[] = [];
  for (const a of assets) {
    if (a.id === "hero" || pending.includes(a.id)) continue;
    if (failed.includes(a.id) || (!a.publicId && isGenerative(a))) bad.push(a);
    else ok.push(a);
  }
  return { ok, bad };
}

/** Show a pack asset from its stored copy; label colour variants for what they really change. */
function presentAsset(a: KitAsset, p: ProductRecord): KitAsset {
  const stored = a.publicId ? { url: storedUrl(a.publicId) } : {};
  if (!a.id.startsWith("recolor-")) return { ...a, ...stored };
  const xray = isBuiltUrl(a.xray) ? { ...a.xray, segments: a.xray.segments.map((g) => (g.kind === "gen-ai" ? { ...g, label: recolorExplain(p.understanding) } : g)) } : a.xray;
  return { ...a, ...stored, xray, label: recolorLabel(a.id, p.understanding), alt: `${a.alt}, in ${swatchName(a.id.slice(8)).toLowerCase()}` };
}

export function Studio({ initialSample, initialSku }: { initialSample?: string; initialSku?: string }) {
  // a ?sample= link renders the run from the first paint (the server HTML already shows the photo being read)
  const [boot] = React.useState(() => getSample(initialSample) ?? getSample(initialSku) ?? null);
  const [source, setSource] = React.useState<SourceReady | null>(() => (boot ? sourceOf(boot) : null));
  const [linkError, setLinkError] = React.useState<string | null>(null);
  // a ?sku= link (phone capture, refresh): look for that photo before offering the picker
  const [awaiting, setAwaiting] = React.useState(() => !!initialSku && SKU_RE.test(initialSku) && !getSample(initialSku) && !getSample(initialSample));
  const [status, setStatus] = React.useState<Status>(() => (boot ? { ...IDLE, fix: "active" } : IDLE));
  const [notes, setNotes] = React.useState<Partial<Record<PipelineStepId, string>>>(() => (boot ? { fix: "AI Vision is reading your photo" } : {}));
  const [failure, setFailure] = React.useState<Failure | null>(null);
  const [product, setProduct] = React.useState<ProductRecord | null>(null);
  const [retouch, setRetouch] = React.useState<Retouch | null>(null);
  const [retouchOpen, setRetouchOpen] = React.useState(false);
  const [scenes, setScenes] = React.useState<Scene[] | null>(null);
  const [sceneId, setSceneId] = React.useState<string | null>(null);
  const [controls, setControls] = React.useState<CompositeControls | null>(null);
  const [settings, setSettings] = React.useState<PackSettings>(DEFAULT_SETTINGS);
  const [brief, setBrief] = React.useState<BriefResponse | null>(null);
  const [genOpen, setGenOpen] = React.useState(false);
  const [heroOverride, setHeroOverride] = React.useState<KitAsset | null>(null);
  const [replayShot, setReplayShot] = React.useState<string | null>(null); // a stored frame the replay shows (a rejected attempt)
  const [qa, setQa] = React.useState<QaResult | null>(null);
  const [qaStory, setQaStory] = React.useState<QaStory | null>(null);
  const [settle, setSettle] = React.useState<number | null>(null); // QA's fix: the next frame settles by this much
  const [autoFixed, setAutoFixed] = React.useState(false);
  const [dnaOn, setDnaOn] = React.useState(false);
  const [dnaFlash, setDnaFlash] = React.useState(false);
  const [kit, setKit] = React.useState<Kit | null>(null);
  const [pendingFormats, setPendingFormats] = React.useState<string[]>([]);
  const [failedFormats, setFailedFormats] = React.useState<KitAsset[]>([]); // formats Cloudinary couldn't render
  const [heroFormat, setHeroFormat] = React.useState(""); // what a browser got for the hero (webp, avif…)
  const [deal, setDeal] = React.useState<DealRequest | null>(null);
  const [packedSig, setPackedSig] = React.useState<string | null>(null);
  const [demo, setDemo] = React.useState(false);
  const [running, setRunning] = React.useState(!!boot);
  const [adjustOpen, setAdjustOpen] = React.useState(false); // a sample's controls, folded away while it replays
  const [creditsUsed, setCreditsUsed] = React.useState(0);
  const [stageBusy, setStageBusy] = React.useState(false);
  const [tab, setTab] = React.useState("exact");
  const [copied, setCopied] = React.useState(false);
  const [runId, setRunId] = React.useState(0);

  const abortRef = React.useRef<AbortController | null>(null);
  const retouchWait = React.useRef<((fixes: RetouchFix[]) => void) | null>(null);
  // a brief applied while the photo is still being read / cut out is used by that same run
  const appliedBrief = React.useRef<{ sku: string; kit: BriefKit } | null>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const kitRef = React.useRef<HTMLElement>(null);

  const scene = scenes?.find((s) => s.publicId === sceneId) ?? null;
  const placement = product?.understanding?.placement ?? "standing";
  const liveControls = useDebounced(controls, 250);
  const sample = getSample(source?.sku);
  const recolorOk = canRecolor(product?.understanding);

  const buildHero = React.useCallback(
    (p: ProductRecord, sc: Scene, c: CompositeControls, opts: { width?: number; format?: string } = {}): BuiltUrl =>
      compositeUrl({ scenePublicId: sc.publicId, dna: sc.dna, cutout: p.cutout!, placement: p.understanding?.placement ?? "standing", controls: c, ...opts }),
    [],
  );

  const preview = product?.cutout && scene && liveControls && status.stage !== "waiting" ? buildHero(product, scene, liveControls) : null;

  // What the stage shows right now.
  const atSampleDefaults = !!sample && sceneId === sample.scene.publicId && !!controls && sigOf(null, controls, settings, null) === sigOf(null, sample.controls, settings, null);
  // a sample shows its stored frames (the approved hero, a rejected attempt) instead of re-rendering the recipe
  const sampleShot = sample && !heroOverride && status.stage !== "waiting" ? (replayShot ?? (atSampleDefaults ? heroAt(sample.kit, 1080) : null)) : null;
  const retouched = retouch?.sku === source?.sku ? retouch?.url : undefined;
  const rawView = source ? (sample ? beforeAt(sample, 1080) : (retouched ?? publicUrl(rawPublicId(source.sku), { w: 1080, h: 1350, crop: "c_pad,b_auto:border" }))) : null;
  // a sample's photo is already a cached stored asset: no extra tiny derivative for it
  const rawThumb = source && !sample ? publicUrl(rawPublicId(source.sku), { w: 48, h: 60, crop: "c_pad,b_auto:border" }) : null;
  const cutoutView = product?.cutout ? publicUrl(product.cutout.publicId, { w: 1080, h: 1350, crop: "c_mpad,b_rgb:00000000" }) : null;
  const stageSrc = heroOverride ? sizedUrl(heroOverride, 1080) : (sampleShot ?? preview?.url ?? cutoutView ?? rawView);
  const photoWord = sample ? `${SAMPLE_PHOTO_LABEL} (AI-generated test image)` : "Your photo";
  const stageAlt = heroOverride?.alt ?? ((sampleShot || preview) && product && scene ? heroAlt(product, scene) : product?.caption ? `${photoWord}: ${product.caption}` : photoWord);
  const scanning = status.fix === "active" ? (retouch?.state === "running" ? "Touching up" : "Reading your photo") : status.cutout === "active" ? "Cutting out" : null;
  const composite = !!scene && !heroOverride && !!(sampleShot || preview);
  // where the product sits on the plate: Scene DNA's labels keep off it
  const productBox = product?.cutout && scene && controls ? geometry(product.cutout, scene.dna, controls, placement) : null;
  const dnaShown = (dnaOn || dnaFlash) && composite && !!scene;
  const [bx, by, bw, bh] = productBox ? [productBox.px, productBox.py, productBox.pw, productBox.ph] : [0, 0, 0, 0];
  const stageDna = React.useMemo(
    () => (dnaShown && scene ? { dna: scene.dna, key: scene.publicId, shadow: scene.view !== "top-down", product: bw ? { x: bx, y: by, w: bw, h: bh } : null } : null),
    [dnaShown, scene, bx, by, bw, bh],
  );
  // the stage's object props keep their identity between renders, so the memoised stage only
  // re-renders when what it shows changes (the replay re-renders the studio many times a second)
  const previewUrl = preview?.url;
  const stageXray: KitAsset | null = React.useMemo(
    () =>
      heroOverride ??
      (sample && sampleShot && !replayShot
        ? sample.kit.hero
        : preview && product && scene
          ? { id: "stage", format: "hero", label: "Hero 4:5", url: preview.url, width: 1080, height: 1350, frame: "feed-post", alt: stageAlt, xray: preview, qa: qa ?? undefined }
          : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `preview` is rebuilt every render; its url is its identity
    [heroOverride, sample, sampleShot, replayShot, previewUrl, product, scene, stageAlt, qa],
  );
  const lightOn = !!scene && !heroOverride && (status.light === "active" || status.qa === "active");
  const lightAz = scene?.dna.light_azimuth ?? 0;
  const stageLight = React.useMemo(() => (lightOn ? { azimuth: lightAz, key: runId } : null), [lightOn, lightAz, runId]);

  // unchanged marks keep the same objects, so nothing re-renders for them
  const mark = React.useCallback((id: PipelineStepId, st: StepStatus, note?: string) => {
    setStatus((s) => (s[id] === st ? s : { ...s, [id]: st }));
    if (note !== undefined) setNotes((n) => (n[id] === note ? n : { ...n, [id]: note }));
  }, []);
  const seen = React.useCallback((src: api.DataSource) => {
    if (src === "demo") setDemo(true);
  }, []);

  /** Resolves when the retouch card finishes (or gives up): the cutout then starts from the best photo. */
  const waitForRetouch = React.useCallback(
    (signal: AbortSignal) =>
      new Promise<RetouchFix[]>((resolve, reject) => {
        if (signal.aborted) return reject(new Aborted());
        const t = setTimeout(() => resolve([]), RETOUCH_MAX_MS);
        retouchWait.current = (fixes) => {
          clearTimeout(t);
          resolve(fixes);
        };
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            reject(new Aborted());
          },
          { once: true },
        );
      }),
    [],
  );
  const retouchDone = (fixes: RetouchFix[], url?: string) => {
    setRetouch((r) => (r ? { ...r, state: "done", fixes, url } : r));
    retouchWait.current?.(fixes);
    retouchWait.current = null;
  };
  const retouchFailed = () => {
    setRetouch((r) => (r ? { ...r, state: "failed", fixes: [] } : r));
    retouchWait.current?.([]);
    retouchWait.current = null;
  };

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
      // a sample whose live run needed QA's fix replays every check it recorded
      const attempts = replay && !hero ? replayAttempts(replay) : null;
      let shot: string | null = attempts ? attempts[0].url : null; // the frame a replay shows
      let sc = args.scene;
      let c = args.controls;
      let step: PipelineStepId = "stage";
      const placementOf = p.understanding?.placement ?? "standing";
      setRunId((n) => n + 1);
      setQaStory(null);
      setSettle(null);
      setAutoFixed(false);
      try {
        mark("stage", "active", hero ? "Using your creative take" : `Placing it on the ${sc.title} scene`);
        if (replay && !hero) {
          // the flourish: Scene DNA draws itself over the plate, then gets out of the way
          setDnaFlash(true);
          await sleep(700, signal);
          mark("stage", "active", "Scene DNA: AI Vision found the surface, the anchor and the light");
          await sleep(1500, signal);
          setDnaFlash(false);
        } else {
          await sleep(650, signal);
        }
        mark("stage", "done", hero ? "Creative take" : sc.title);

        const lightUp = async () => {
          step = "light";
          const previewUrl = hero ? sizedUrl(hero, 1080) : replay ? (shot ?? heroAt(replay.kit, 1080)) : buildHero(p, sc, c).url;
          mark("light", "active", hero ? "Loading your creative take" : "Matching shadows and tone to the scene's light");
          await atLeast(preloadImage(previewUrl, signal), 900, signal);
          mark("light", "done", hero ? "Ready" : lightFrom(sc.dna));
        };
        await lightUp();

        step = "qa";
        void preloadKitParts().catch(() => {}); // the shelves, readiness and receipt: ready by the time the kit is
        let tokens = args.tokens;
        let fixed: string | null = null; // what the automatic fix changed, when QA needed one
        let firstCatch = "";
        let lastMarks: QaMarks | null = null;
        let checks = 1;
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
        /** QA caught it: hold the catch (the ring, the correction) long enough to read, then apply the fix. */
        const catchAndFix = async (s: Omit<QaStory, "phase">, next: string) => {
          setSettle(null);
          setQaStory({ phase: "caught", ...s });
          mark("qa", "active", `QA caught it: ${s.caught} Fixing it automatically…`);
          await Promise.all([
            sleep(CAUGHT_MS, signal),
            preloadImage(next, signal).catch((e) => {
              if (isAborted(e)) throw e;
            }),
          ]);
          // the fixed frame settles down by exactly the correction the fix made
          setSettle(s.marks?.dy ? s.marks.dy / PLATE.height : null);
          setQaStory({ phase: "fixing", ...s });
          mark("qa", "active", `Fixing it: we ${s.fix}`);
          if (!firstCatch) firstCatch = s.caught;
          lastMarks = s.marks ?? null;
        };
        mark("qa", "active", "AI Vision is checking it looks real and nothing about your product changed");
        let verdict: QaResult;

        if (attempts && replay) {
          // the live run's checks, replayed in order, each on the frame it judged
          const last = attempts[attempts.length - 1];
          for (let i = 0; ; i++) {
            const a = attempts[i];
            await sleep(replay.pace.qa, signal);
            verdict = a.qa;
            setQa(verdict);
            const next = attempts[i + 1];
            if (verdict.status !== "rejected" || !next) break;
            const same = next.scenePublicId === a.scenePublicId;
            const nextScene = same ? sc : (args.scenes.find((x) => x.publicId === next.scenePublicId) ?? SCENE_LIBRARY.find((x) => x.publicId === next.scenePublicId) ?? sc);
            const dna = dnaOf(a.scenePublicId, sc);
            const marks = dna && p.cutout ? qaMarks({ cutout: p.cutout, dna, placement: placementOf, controls: a.controls }, { controls: next.controls, sameScene: same }) : null;
            await catchAndFix(
              {
                check: i + 1,
                checks: attempts.length,
                caught: firstSentence(verdict.reasons[0]),
                fix: fixWords({ controls: a.controls, scene: a.scenePublicId }, { controls: next.controls, scene: next.scenePublicId, sceneTitle: nextScene.title }),
                marks,
              },
              next === last ? heroAt(replay.kit, 1080) : next.url,
            );
            if (nextScene.publicId !== sc.publicId) {
              sc = nextScene;
              setSceneId(sc.publicId);
            }
            c = quantise(next.controls);
            shot = next === last ? null : next.url;
            setReplayShot(shot);
            setControls(c);
            setQa(null);
          }
          checks = attempts.length;
          if (verdict.status === "approved") fixed = fixWords({ controls: attempts[0].controls, scene: attempts[0].scenePublicId }, { controls: last.controls, scene: last.scenePublicId, sceneTitle: sc.title });
        } else {
          verdict = await check();
          setQa(verdict);
          if (verdict.status === "rejected" && !hero) {
            const fix = planFix(verdict, c, sc, args.scenes, p);
            if (fix) {
              const next = quantise(fix.controls);
              const same = fix.scene.publicId === sc.publicId;
              const marks = p.cutout ? qaMarks({ cutout: p.cutout, dna: sc.dna, placement: placementOf, controls: c }, { controls: next, sameScene: same }) : null;
              await catchAndFix({ check: 1, caught: firstSentence(verdict.reasons[0]), fix: fix.note, marks }, buildHero(p, fix.scene, next).url);
              sc = fix.scene;
              c = next;
              shot = null;
              setReplayShot(null);
              setSceneId(sc.publicId);
              setControls(c);
              setQa(null);
              await lightUp();
              step = "qa";
              mark("qa", "active", "Checking the fixed version");
              verdict = await check();
              setQa(verdict);
              checks = 2;
              if (verdict.status === "approved") fixed = fix.note;
              else setQaStory(null);
            }
          }
        }

        if (verdict.status === "rejected") {
          const why = verdict.reasons.join(" ") || "The check found a change to your product.";
          mark("qa", "failed", verdict.reasons[0] ?? "The check found a problem");
          setFailure({ step: "qa", message: `${why} Adjust it on the right, then update the kit.`, from: "stage" });
          return;
        }
        if (fixed) {
          setAutoFixed(true);
          setQaStory({ phase: "fixed", check: checks, checks: attempts ? checks : undefined, caught: firstCatch, fix: fixed, marks: lastMarks });
          mark("qa", "done", `Auto-fixed: ${fixed}. Approved${attempts ? ` after ${checks} checks` : ""}`);
          await sleep(APPROVED_MS, signal);
        } else {
          mark("qa", "done", "Approved: looks real, product unchanged");
        }
        // a replay's controls unfold beside the stage once the story is told (phones keep them one tap
        // away: opening them there would push the kit down while the shelves deal in)
        if (replay && !hero && window.matchMedia("(min-width: 1024px)").matches) setAdjustOpen(true);

        step = "pack";
        mark("pack", "active", "Making every format");
        const saveUrl = hero ? hero.url : buildHero(p, sc, c, { format: "f_jpg,q_90" }).url;
        const full = buildHero(p, sc, c);
        const sceneSlug = sc.publicId.split("/").slice(-2).join("-");
        const offer = st.offer.hindi.trim() || st.offer.english.trim() ? { hindi: st.offer.hindi.trim() || undefined, english: st.offer.english.trim() || undefined } : undefined;
        const productBox = hero ? undefined : geometry(p.cutout!, sc.dna, quantise(c), p.understanding?.placement ?? "standing");
        const recolor = canRecolor(p.understanding) ? st.swatches.slice(0, MAX_SWATCHES) : [];
        const started = await patient(
          api.pack({ sku: src.sku, heroUrl: saveUrl, sceneSlug, offer, recolor, textZone: hero ? undefined : (st.textZone ?? sc.dna.text_zone), productBox }, signal),
          { signal, onSlow: () => mark("pack", "active", "Saving the hero and starting every format") },
        );
        seen(started.source);
        let assets = started.data.assets;
        let pending = started.data.pending;
        let failed = started.data.failed ?? [];
        let zipUrl: string | undefined;
        const total = assets.filter((a) => a.id !== "hero").length;
        if (replay) {
          // replay: count the stored formats in as they "finish"
          for (let n = 1; n <= total; n++) {
            mark("pack", "active", `${n} of ${total} formats ready`);
            await sleep(Math.round(replay.pace.pack / total), signal);
          }
        }
        const t = Date.now();
        while (pending.length && Date.now() - t < PACK_TIMEOUT_MS) {
          // failed formats are out of the count: "N of M" is only what can still arrive
          mark("pack", "active", `${total - failed.length - pending.length} of ${total - failed.length} formats ready`);
          await sleep(PACK_POLL_MS, signal);
          const s = await api.packStatus(src.sku, signal);
          seen(s.source);
          assets = s.data.assets;
          pending = s.data.pending;
          failed = s.data.failed ?? failed;
          zipUrl = s.data.zipUrl;
        }
        if (!zipUrl && !pending.length && started.source === "live") {
          zipUrl = (await api.packStatus(src.sku, signal).catch(() => null))?.data.zipUrl;
        }

        const heroId = started.data.heroPublicId;
        // the hero's weight as a browser receives it (f_auto answers per Accept header); a sample's was measured once
        const measured = replay && !hero ? sampleHeroWeight(src.sku) : null;
        let delivered = measured?.delivered ?? 0;
        let deliveredAs = measured?.format ?? "";
        if (!measured) {
          try {
            const h = await fetch(storedUrl(heroId), { method: "HEAD", signal, headers: { Accept: IMAGE_ACCEPT } });
            delivered = Number(h.headers.get("content-length") ?? 0);
            deliveredAs = (h.headers.get("content-type") ?? "").split(";")[0].replace(/^image\//, "").trim();
          } catch {
            delivered = 0;
          }
        }
        setHeroFormat(deliveredAs);
        const shelf = shelfReady(assets, pending, failed);

        let next: Kit;
        if (replay && !hero) {
          next = { ...replay.kit, cost: { ...replay.kit.cost, bytesOriginal: measured?.original ?? replay.kit.cost.bytesOriginal, bytesDelivered: delivered || replay.kit.cost.bytesDelivered } };
        } else {
          const ready = shelf.ok.map((a) => presentAsset(a, p));
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
        setFailedFormats(replay && !hero ? [] : shelf.bad.map((a) => presentAsset(a, p)));
        setPackedSig(sigOf(sc.publicId, c, st, hero));
        mark("pack", "done", pending.length ? `${next.assets.length} formats ready, ${pending.length} still rendering` : `Kit ready: ${kitContents(next)}`);
        setDeal((d) => ({ key: (d?.key ?? 0) + 1, from: () => stageRef.current?.getBoundingClientRect() ?? null }));
      } catch (e) {
        setDnaFlash(false);
        if (isAborted(e)) return;
        mark(step, isBusy(e) || api.isReadOnly(e) ? "paused" : "failed", isBusy(e) ? "Paused: Cloudinary is busy right now" : api.isReadOnly(e) ? "View only" : api.messageFor(e));
        setFailure({ step, message: api.messageFor(e), from: "stage", busy: isBusy(e), quota: isQuota(e), readOnly: api.isReadOnly(e) });
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
      // a sample link's first paint already shows this state: keep its objects (no re-render for nothing)
      setSource((s) => (s && s.sku === src.sku && s.via === src.via ? s : src));
      setAwaiting(false);
      setLinkError(null);
      setStatus((s) => (PIPELINE_STEPS.every((x) => s[x.id] === (x.id === "fix" ? "active" : "waiting")) ? s : { ...IDLE, fix: "active" }));
      setNotes((n) => (Object.keys(n).length === 1 && n.fix === "AI Vision is reading your photo" ? n : { fix: "AI Vision is reading your photo" }));
      setFailure(null);
      setProduct(null);
      setRetouch(null);
      setRetouchOpen(false);
      setScenes(null);
      setSceneId(null);
      setControls(null);
      if (appliedBrief.current?.sku !== src.sku) {
        appliedBrief.current = null;
        setBrief(null);
      }
      setGenOpen(false);
      setHeroOverride(null);
      setReplayShot(null);
      setQa(null);
      setQaStory(null);
      setSettle(null);
      setDnaFlash(false);
      setAdjustOpen(false);
      setKit(null);
      setPendingFormats([]);
      setFailedFormats([]);
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
        const name = a.data.understanding.name;

        if (!replay && a.source === "live") {
          // Q4 auto-retouch: the card runs it and narrates; the cutout waits for its answer
          mark("fix", "active", "Touching up the photo before the cutout");
          setRetouch({ sku: src.sku, state: "running", fixes: [] });
          setRetouchOpen(true);
          const fixes = await waitForRetouch(signal);
          mark("fix", "done", fixes.length ? `${name}, touched up: ${fixes.map((f) => fixMeta(f).label.toLowerCase()).join(", ")}` : name);
        } else {
          mark("fix", "done", name);
        }

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
        setRetouchOpen(false); // the touch-up told its story; the scene controls take the space
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
        const early = !replay && appliedBrief.current?.sku === src.sku ? appliedBrief.current.kit : null;
        // a replay with QA catches starts from the attempt the live QA rejected first
        const first = replayAttempts(replay)?.[0];
        const pick =
          (first ? list.find((s) => s.publicId === first.scenePublicId) : undefined) ??
          (replay ? list.find((s) => s.publicId === replay.scene.publicId) : undefined) ??
          (early?.theme ? list.find((s) => s.theme === early.theme) : undefined) ??
          list.find((s) => p.understanding!.suggested_themes.includes(s.theme)) ??
          list[0];
        if (!pick) throw new api.ApiFailure(404, { error: "No scenes fit this product's angle yet. Try a sample product.", code: "not_found" });
        const ctl = first ? quantise(first.controls) : (replay?.controls ?? quantise(defaultControls(p.understanding!.placement, pick.dna, p.cutout)));
        setScenes(list);
        setSceneId(pick.publicId);
        setControls(ctl);
        if (first) setReplayShot(first.url);
        const st: PackSettings = replay
          ? { offer: replay.offer, swatches: replay.swatches }
          : early
            ? { offer: { hindi: early.offer.hindi ?? "", english: early.offer.english ?? "" }, swatches: canRecolor(p.understanding) ? early.swatches.slice(0, MAX_SWATCHES) : [] }
            : { ...DEFAULT_SETTINGS, swatches: canRecolor(p.understanding) ? DEFAULT_SETTINGS.swatches : [] };
        setSettings(st);

        await finish({ src, product: p, scene: pick, scenes: list, controls: ctl, settings: st, hero: null, tokens: a.data.tokens, t0, signal });
      } catch (e) {
        if (isAborted(e)) return;
        mark(step, isBusy(e) || api.isReadOnly(e) ? "paused" : "failed", isBusy(e) ? "Paused: Cloudinary is busy right now" : api.isReadOnly(e) ? "View only" : api.messageFor(e));
        setFailure({ step, message: api.messageFor(e), from: "fix", busy: isBusy(e), quota: isQuota(e), readOnly: api.isReadOnly(e) });
      } finally {
        if (!signal.aborted) setRunning(false);
      }
    },
    [finish, mark, seen, waitForRetouch],
  );

  /** Re-stage with the current (or given) scene/sliders/settings and re-pack (live products only). */
  const update = React.useCallback(
    async (hero: KitAsset | null = heroOverride, over: { controls?: CompositeControls; settings?: PackSettings } = {}) => {
      const c = over.controls ?? controls;
      const st = over.settings ?? settings;
      if (!source || !product?.cutout || !scene || !c || getSample(source.sku)) return;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setFailure(null);
      setQa(null);
      setRunning(true);
      setStatus((s) => ({ ...s, stage: "waiting", light: "waiting", qa: "waiting", pack: "waiting" }));
      try {
        await finish({ src: source, product, scene, scenes: scenes ?? [scene], controls: c, settings: st, hero, tokens: 0, t0: performance.now(), signal: ac.signal });
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
        const shelf = shelfReady(s.data.assets, s.data.pending, s.data.failed ?? []);
        const ready = shelf.ok.map((a) => presentAsset(a, kit.product));
        setFailedFormats(shelf.bad.map((a) => presentAsset(a, kit.product)));
        setKit((k) => {
          if (!k || k.sku !== kit.sku) return k;
          const reel = reelUrl({ images: reelClips(k.hero.publicId!, ready), offer: settings.offer.hindi || settings.offer.english ? { hindi: settings.offer.hindi || undefined, english: settings.offer.english || undefined } : undefined });
          return { ...k, assets: ready, zipUrl: s.data.zipUrl ?? k.zipUrl, reel: { url: reel.url, xray: reel, seconds: reel.seconds } };
        });
        setPendingFormats(s.data.pending);
        if (!s.data.pending.length) {
          mark("pack", "done", `Kit ready: ${kitContents({ assets: ready, reel: kit.reel })}`);
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
    setRetouch(null);
    setHeroOverride(null);
    setReplayShot(null);
    setQa(null);
    setQaStory(null);
    setSettle(null);
    setDnaFlash(false);
    setAdjustOpen(false);
    window.history.replaceState(null, "", "/studio");
  };

  /** Pick a scene: keep the seller's size and shadow choices, re-anchor on the new surface. */
  const selectScene = (s: Scene) => {
    setSceneId(s.publicId);
    setHeroOverride(null);
    setReplayShot(null);
    setQa(null); // the new composite hasn't been checked yet
    setQaStory(null);
    if (product?.understanding)
      setControls((c) => {
        const d = defaultControls(product.understanding!.placement, s.dna, product.cutout);
        return c ? { ...d, scale: c.scale, shadow: c.shadow, contact: c.contact, harmonise: c.harmonise } : d;
      });
  };

  /** "Use these settings" from the brief: offer and colours into the pack, the theme onto the stage. */
  const applyBrief = (bk: BriefKit, res: BriefResponse) => {
    setBrief(res);
    if (source) appliedBrief.current = { sku: source.sku, kit: bk };
    setSettings((s) => ({
      ...s,
      offer: { hindi: bk.offer.hindi ?? "", english: bk.offer.english ?? "" },
      swatches: recolorOk ? bk.swatches.slice(0, MAX_SWATCHES) : [],
    }));
    const match = bk.theme ? scenes?.find((x) => x.theme === bk.theme) : undefined;
    if (match) selectScene(match);
    else if (bk.theme && scenes?.length) setGenOpen(true); // no library plate for that theme at this angle: offer matches / a new one
  };

  /** Readiness one-click fixes that change the hero: apply, then re-stage and re-pack. */
  const restageFix = (patch: Partial<CompositeControls>) => {
    if (!controls) return;
    const next = quantise({ ...controls, ...patch });
    setControls(next);
    setHeroOverride(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
    void update(null, { controls: next });
  };
  const repackFix = (textZone: SceneDNA["text_zone"]) => {
    const st = { ...settings, textZone };
    setSettings(st);
    window.scrollTo({ top: 0, behavior: "smooth" });
    void update(heroOverride, { settings: st });
  };
  /** A fixed marketplace image replaces the one on the shelf (versioned URL, so no stale cache). */
  const onReadiness = (r: ReadinessReport) => {
    if (!r.image.materialised) return;
    setKit((k) => (k ? { ...k, assets: k.assets.map((a) => (a.id === "marketplace" && a.url !== r.image.url ? { ...a, url: r.image.url } : a)) } : k));
  };

  // Deep links: ?sample=… starts right away; ?sku=… waits for that photo (phone flow, refresh).
  const booted = React.useRef(false);
  React.useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const s = getSample(initialSample) ?? getSample(initialSku);
    if (s) {
      // its own task, after the first paint and hydration have finished
      setTimeout(() => void start(sourceOf(s)), 0);
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

  const barText = running ? "Working on it…" : dirty ? "You've made changes." : kit ? "Kit is up to date." : "Your kit appears below.";
  // the bar only floats over the controls when it has something to do
  const barSticky = dirty && !running && tab === "exact";

  const marketplacePending = pendingFormats.includes("marketplace");

  const controlsPanel = (
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
        {tab === "exact" ? "The photo itself, composited onto a stage. No generation credits, and the product's pixels are never redrawn." : "A generated reshoot. Slower and uses credits, always QA-checked."}
      </p>

      <Tabs.Content value="exact" className="mt-6 focus-visible:outline-none">
        <CompositePanel
          scenes={scenes}
          sceneId={sceneId}
          onScene={selectScene}
          controls={controls}
          onControls={(c) => {
            setHeroOverride(null);
            setReplayShot(null);
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
          recolor={recolorOk}
          top={sample ? <BriefTeaser /> :<BriefBar sku={source.sku} disabled={!product?.understanding} recolor={recolorOk} onResult={setBrief} onApply={applyBrief} />}
          sceneExtra={
            sample ? null : (
              <Disclosure
                open={genOpen}
                onToggle={() => setGenOpen((o) => !o)}
                label="Need a different backdrop?"
                hint={brief?.kit.theme ? "Library matches for your brief, or a new plate" : "Search the library, or generate a new plate once"}
                disabled={!cutoutReady}
              >
                <SceneGenerator
                  heading={false}
                  sku={source.sku}
                  theme={brief?.kit.theme || product?.understanding?.suggested_themes[0]}
                  prompt={brief?.scenePrompt}
                  view={VIEW_FOR_PLACEMENT[placement]}
                  selectedId={sceneId}
                  onSelect={(s) => {
                    setScenes((l) => (l?.some((x) => x.publicId === s.publicId) ? l : [...(l ?? []), s]));
                    selectScene(s);
                  }}
                />
              </Disclosure>
            )
          }
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
  );

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <div className="mx-auto grid max-w-[90rem] gap-6 px-4 [grid-template-areas:'head'_'stage'_'panel'] sm:px-8 lg:grid-cols-[auto_minmax(22rem,28rem)] lg:grid-rows-[auto_1fr] lg:justify-center lg:gap-x-12 lg:[grid-template-areas:'stage_head'_'stage_panel']">
          <div className="min-w-0 [grid-area:head]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="font-display text-2xl leading-tight font-bold tracking-[-0.02em] sm:text-3xl">
                  {sample ? sample.title : (product?.understanding?.name ?? "Your product")}
                </h1>
                {sample ? (
                  <Tip label="These are the real Cloudinary results from a live run of this sample photo, saved and replayed step by step, so a sample uses no AI quota. Upload your own photo to run every step live.">
                    <button type="button" className="mt-0.5 inline-flex min-h-8 items-center gap-1.5 rounded-full text-[0.8rem] font-medium text-dim underline decoration-dotted underline-offset-4 hover:text-paper">
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
                {sample ? (
                  <Button variant="secondary" size="sm" onClick={reset}>
                    <ImageUp />
                    Use my photo
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={reset}>
                    <RotateCcw />
                    New photo
                  </Button>
                )}
              </div>
            </div>

            <div className="mt-4">
              <PipelineRail status={status} notes={notes} fixed={autoFixed} />
            </div>

            {failure?.readOnly ? (
              <ReadOnlyNote message={failure.message} onUpload={reset} className="mt-4" />
            ) : failure?.busy ? (
              <div role="alert" className="mt-4 grid gap-4 rounded-2xl bg-marigold/10 p-4 text-sm text-paper ring-1 ring-marigold/35">
                <p>
                  {failure.quota ? (
                    <>
                      <span className="font-semibold text-marigold">Live kits are paused for now.</span> {failure.message} Your photo is saved: try again later. Every sample below still
                      replays the whole pipeline.
                    </>
                  ) : (
                    <>
                      <span className="font-semibold text-marigold">Cloudinary is busy right now.</span> The shared account is handling a lot of requests, so this step paused. Your
                      photo is saved: try again in a minute. Meanwhile, see a kit finished from a sample photo.
                    </>
                  )}
                </p>
                {failure.quota ? <SamplePicker onPick={(s) => void start(sourceOf(s))} compact className="bg-stage/80" /> : null}
                <div className="flex flex-wrap gap-2">
                  {failure.quota ? null : (
                    <Button size="sm" onClick={() => void start(sourceOf(PRIMARY_SAMPLE))}>
                      Open a finished sample
                    </Button>
                  )}
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
                    <Button size="sm" onClick={() => void start(sourceOf(PRIMARY_SAMPLE))}>
                      Try the sample
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mx-auto w-full max-w-[36rem] [grid-area:stage] lg:sticky lg:top-4 lg:mx-0 lg:w-[min(calc((100dvh-8rem)*0.8),calc(100vw-40rem))] lg:max-w-none lg:self-start">
            <Stage
              ref={stageRef}
              src={stageSrc}
              alt={stageAlt}
              placeholder={scene && (sampleShot || preview) ? lqip(scene.publicId) : (rawThumb ?? undefined)}
              srcSet={sample ? `${beforeAt(sample, 720)} 720w, ${beforeAt(sample, 1080)} 1080w` : undefined}
              sizes={STAGE_SIZES}
              priority={!!sample}
              originalSrc={status.stage === "done" || heroOverride ? rawView : null}
              originalLabel={sample ? (atSampleDefaults ? "Hold to compare" : "Hold to see the sample photo") : "Hold to see your photo"}
              scanning={scanning}
              qa={qa}
              qaStory={qaStory}
              onBusy={setStageBusy}
              busyLabel={busyLabel}
              enter={settle != null ? "settle" : heroOverride ? "focus" : sampleShot || preview ? (running ? "focus" : "soft") : cutoutView ? "wipe" : "focus"}
              settle={settle}
              light={stageLight}
              xray={stageXray}
              dna={stageDna}
            />
            <div aria-hidden className="shelf-ledge relative -mx-3 -mt-1 hidden sm:block sm:-mx-5" />
            {/* said once, where the photo is */}
            {sample ? <p className="mt-2.5 text-[13px] leading-snug text-dim sm:mt-1.5">{SAMPLE_PHOTO_DISCLOSURE}</p> : null}
            {scene ? <DnaToggle dna={scene.dna} on={dnaOn || dnaFlash} onChange={setDnaOn} disabled={!composite} /> : null}
          </div>

          <aside aria-label="Adjust" className="min-w-0 [grid-area:panel]">
            {retouch && retouch.sku === source.sku ? (
              <RetouchSlot retouch={retouch} open={retouchOpen} onToggle={() => setRetouchOpen((o) => !o)}>
                <RetouchCard
                  key={retouch.sku}
                  sku={retouch.sku}
                  frame="result"
                  onDone={(fixes, res) => retouchDone(fixes, res.status === "done" && fixes.length && res.url ? res.url : undefined)}
                  onError={retouchFailed}
                />
              </RetouchSlot>
            ) : null}

            {sample ? (
              // a sample's controls stay folded while it replays: the stage and the rail tell the story
              <Disclosure
                open={adjustOpen}
                onToggle={() => setAdjustOpen((o) => !o)}
                label="Adjust this kit"
                hint={running ? "Scene, placement, offer text and colours. Open it any time" : "Scene, placement, offer text and colours"}
              >
                {controlsPanel}
                {dirty ? (
                  <p className="mt-6 text-sm text-dim" aria-live="polite">
                    Your changes preview live. Upload your own photo to build a kit with them.
                  </p>
                ) : null}
              </Disclosure>
            ) : (
              <>
                {controlsPanel}
                <div
                  className={cn(
                    "z-10 mt-8 border-line bg-studio/90 px-4 py-4 backdrop-blur-md sm:px-5",
                    barSticky ? "sticky bottom-0 -mx-4 border-t sm:mx-0 sm:rounded-2xl sm:border lg:bottom-4" : "rounded-2xl border",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-dim" aria-live="polite">
                      {barText}
                    </p>
                    <Button onClick={() => void update()} disabled={!dirty || running}>
                      <RefreshCw />
                      Update kit
                    </Button>
                  </div>
                </div>
              </>
            )}
          </aside>
        </div>

        {kit ? (
          <section ref={kitRef} aria-labelledby="kit-title" data-kit className="mx-auto mt-20 max-w-[90rem] scroll-mt-4 pb-20">
            <div className="flex flex-col gap-4 px-4 sm:flex-row sm:items-end sm:justify-between sm:px-8">
              <div>
                <h2 id="kit-title" className="text-[clamp(1.9rem,4.5vw,3rem)] leading-none font-bold tracking-[-0.03em]">
                  {sample ? "The shelf" : "Your shelf"}: {kitContents(kit)}
                </h2>
                <p className="mt-3 text-dim">Tap the code button under any asset to see the Cloudinary URL that makes it.</p>
              </div>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <div className="flex flex-wrap gap-2">
                  {kit.zipUrl ? (
                    <a href={kit.zipUrl} className={buttonVariants({})}>
                      <Download />
                      {zipLabel(kit)}
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
                    {sample ? "This sample's formats are saved one by one. A kit from your own photo downloads as one zip." : pendingFormats.length ? "The zip is ready once the last formats finish rendering." : "Cloudinary is packing the zip. It appears here in a moment."}
                  </p>
                ) : kit.reel ? (
                  <p className="max-w-80 text-[0.8rem] leading-snug text-dim sm:text-right">The zip holds every image; the reel plays from its Cloudinary URL.</p>
                ) : null}
                {sample ? (
                  <Link href={DEMO_SHELF.path} prefetch={false} className="inline-flex min-h-8 items-center gap-1.5 text-sm font-medium text-paper underline decoration-marigold/60 underline-offset-4 hover:decoration-marigold">
                    <Store aria-hidden className="size-4 text-marigold" />
                    See a shop built from the sample products
                  </Link>
                ) : null}
              </div>
            </div>
            <div className="mt-6">
              <KitShelves kit={kit} deal={deal} rendering={pendingFormats} />
            </div>
            {failedFormats.length ? <FailedFormats assets={failedFormats} /> : null}

            {/* below the shelves: mounted once the deal has played, and not laid out until scrolled near */}
            <div className="mt-14 grid items-start gap-10 px-4 [contain-intrinsic-size:auto_900px] [content-visibility:auto] sm:px-8 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-12">
              <AfterDeal key={kit.sku}>
                {marketplacePending ? (
                  <KitReadiness sku={kit.sku} waiting />
                ) : (
                  <KitReadiness
                    sku={kit.sku}
                    sample={!!sample}
                    measureKey={`${kit.hero.publicId}-${kit.createdAt}`}
                    readOnly={sample ? "This is a saved sample, so it stays as measured. On a kit from your own photo, each fix is one click." : undefined}
                    photoLabel={sample ? SAMPLE_PHOTO_LABEL : undefined}
                    busy={running}
                    onReport={onReadiness}
                    onRestage={(patch) => restageFix(patch)}
                    onRepack={(zone) => repackFix(zone)}
                  />
                )}
                <CostReceipt
                  key={kit.sku}
                  sku={kit.sku}
                  scene={kit.scene?.publicId}
                  refreshKey={`${kit.createdAt}-${creditsUsed}`}
                  // a sample's receipt prints from its saved run: no request
                  initial={sample && kit.sku === sample.sku ? sampleCost(sample, kit, heroFormat) : undefined}
                  replay={sample && kit.sku === sample.sku ? sampleTimeLine(sample, kit) : undefined}
                  className="lg:mx-0"
                />
              </AfterDeal>
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

/** The touch-up card while it works; afterwards one line that re-opens it (kept mounted, so it never re-runs). */
function RetouchSlot({ retouch, open, onToggle, children }: { retouch: Retouch; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  const id = React.useId();
  const summary =
    retouch.state === "running"
      ? "Touching up your photo"
      : retouch.state === "failed"
        ? "Touch-up skipped: the cutout used your photo as it is"
        : retouch.fixes.length
          ? `Touched up: ${retouch.fixes.map((f) => fixMeta(f).label.toLowerCase()).join(", ")}`
          : "Photo check passed: no touch-up needed";
  return (
    <div className="mb-6">
      {!open ? (
        <button
          type="button"
          aria-expanded={false}
          aria-controls={id}
          onClick={onToggle}
          className="flex w-full items-center gap-3 rounded-2xl bg-stage px-4 py-3 text-left ring-1 ring-line transition-colors duration-200 hover:bg-stage-2"
        >
          <span aria-hidden className={cn("grid size-8 shrink-0 place-items-center rounded-full", retouch.fixes.length ? "bg-leaf/14 text-leaf" : "bg-stage-2 text-dim")}>
            <WandSparkles className="size-4" />
          </span>
          <span className="min-w-0 flex-1 text-sm font-medium text-paper">{summary}</span>
          <span className="shrink-0 text-[0.8rem] font-semibold text-marigold">{retouch.url ? "Compare" : "Details"}</span>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-dim" />
        </button>
      ) : null}
      <div id={id} inert={!open} className={cn("grid transition-[grid-template-rows,opacity] duration-500 ease-(--ease-out-expo)", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
        <div className="min-h-0 overflow-hidden">
          {children}
          {retouch.state !== "running" ? (
            <div className="mt-2 flex justify-end">
              <Button variant="ghost" size="sm" onClick={onToggle} className="-mr-2">
                Hide
                <ChevronDown className="rotate-180" />
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * On a sample, the brief bar's place shows what it does instead of a dead input:
 * a replay makes no AI calls, so the one-line brief runs on the seller's own photo.
 */
function BriefTeaser() {
  return (
    <section aria-labelledby="brief-teaser" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <div>
        <h3 id="brief-teaser" className="font-display text-base font-semibold text-paper">
          Describe the ad
        </h3>
        <p className="mt-1 text-[0.9rem] text-dim">On your own photo, one line sets the stage, the offer text, the channels and the colours. A sample replays a saved run, so it skips this.</p>
      </div>
      <div aria-hidden className="flex h-[3.75rem] items-center gap-2.5 rounded-2xl bg-stage-2/50 pr-4 pl-4 ring-1 ring-line ring-inset">
        <WandSparkles className="size-5 shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate text-base text-faint">Diwali sale, 20% off, Hindi, for WhatsApp + Instagram</span>
      </div>
    </section>
  );
}

/**
 * Formats Cloudinary couldn't render, as quiet placeholders: no image (their recipe
 * would re-run a failed generative step on every view) and no retry.
 */
function FailedFormats({ assets }: { assets: KitAsset[] }) {
  return (
    <div className="mt-8 px-4 sm:px-8">
      <p className="text-sm font-semibold text-paper">Not in this kit</p>
      <ul className="mt-3 flex flex-wrap gap-3">
        {assets.map((a) => (
          <li key={a.id} className="grid aspect-[4/5] w-36 content-center justify-items-center gap-1.5 rounded-2xl border border-dashed border-line-strong bg-stage/50 p-3 text-center">
            <span className="text-[0.82rem] leading-snug font-semibold text-paper">{a.label}</span>
            <span className="text-[0.75rem] leading-snug text-dim">Couldn&apos;t render this format</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Mounts its children once the kit's deal has played (about 2.5 s) and the page is idle,
 * so the shelves animate without a big mount landing in the middle of them.
 */
function AfterDeal({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    let idle = 0;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const t = window.setTimeout(() => {
      if (w.requestIdleCallback) idle = w.requestIdleCallback(() => setReady(true), { timeout: 1500 });
      else setReady(true);
    }, 2500);
    return () => {
      window.clearTimeout(t);
      if (idle) w.cancelIdleCallback?.(idle);
    };
  }, []);
  return ready ? <>{children}</> : null;
}

/** Holds a panel's place while its code loads (first open only). */
function PanelSkeleton() {
  return (
    <div className="grid gap-3" aria-busy="true">
      <div className="skeleton h-5 w-2/5 rounded-md" />
      <div className="skeleton h-14 rounded-2xl" />
    </div>
  );
}

/** A quiet "more options" row that opens in place; its content mounts on first open and then stays. */
function Disclosure({ open, onToggle, label, hint, disabled, children }: { open: boolean; onToggle: () => void; label: string; hint?: string; disabled?: boolean; children: React.ReactNode }) {
  const id = React.useId();
  const [mounted, setMounted] = React.useState(open);
  if (open && !mounted) setMounted(true);
  return (
    <div className={cn("mt-1 rounded-2xl ring-1 ring-line transition-colors", open ? "bg-stage" : "bg-transparent")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-stage-2/60 disabled:opacity-50"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-paper">{label}</span>
          {hint ? <span className="block text-[0.8rem] text-dim">{hint}</span> : null}
        </span>
        <ChevronDown aria-hidden className={cn("size-4 shrink-0 text-dim transition-transform duration-300", open && "rotate-180")} />
      </button>
      <div id={id} hidden={!open} className="border-t border-line px-4 pt-4 pb-5">
        {mounted ? children : null}
      </div>
    </div>
  );
}
