"use client";

import { Download, ExternalLink, KeyRound, LockOpen, PauseCircle, RefreshCw, ShieldEllipsis, Sparkles } from "lucide-react";
import * as React from "react";
import { CloudImg } from "@/components/cloud-img";
import { QaBadge } from "@/components/kit/qa-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import * as api from "@/lib/client/api";
import { flyImage } from "@/lib/client/flight";
import { sizedUrl } from "@/lib/client/img";
import { cn, isAborted, sleep } from "@/lib/client/util";
import { CREATIVE_APPROVED, CREATIVE_MODELS, CREATIVE_REJECTED } from "@/lib/showcase";
import type { JobResponse } from "@/lib/api-contract";
import type { KitAsset, Sku } from "@/lib/types";

type ModelId = (typeof CREATIVE_MODELS)[number]["id"];

/**
 * Takes per click. Faithful is the expensive one: one take per click, so the
 * credits on its card are exactly what the click spends. Fast draft is cheap
 * enough to try two seeds at once.
 */
const TAKES: Record<ModelId, number> = { "nano-banana-2-edit": 1, "flux-2-flash-edit": 2 };
/** Roughly how long the fidelity check takes once the image exists (seconds, measured on a live run). */
const CHECK_S = 15;
/** What an empty scene prompt gets (the server's default scene, lib/server/creative.ts). */
const EMPTY_PROMPT_HINT = "Leave empty for a warm, softly lit tabletop in a festive Indian home";

/** The job's status, including "checking" (the fidelity QA on the finished image). */
type JobStatus = JobResponse["status"];

interface Take {
  key: string;
  model: ModelId;
  seed: number;
  status: "queued" | "generating" | "checking" | "done" | "failed";
  asset?: KitAsset;
  error?: string;
  credits?: number;
  startedAt: number;
  checkingAt?: number; // when the fidelity check started
  sample?: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Creative mode: image_to_image around the real cut-out, two seeds at a time,
 * every take judged by the fidelity QA before it can become the hero.
 */
export function CreativePanel({
  sku,
  ready,
  isSample,
  active,
  onUseAsHero,
  onCredits,
  onDemo,
  stageRect,
}: {
  sku: Sku;
  ready: boolean;
  isSample?: boolean;
  active?: boolean; // the tab is showing: check the live quota once
  onUseAsHero: (a: KitAsset) => void;
  onCredits: (n: number) => void;
  onDemo: () => void;
  stageRect?: () => DOMRect | null;
}) {
  const [unlocked, setUnlocked] = React.useState<{ left: number } | null>(null);
  const [live, setLive] = React.useState<"checking" | "on" | "paused" | "unknown">("checking");
  const checked = React.useRef(false);
  const [askCode, setAskCode] = React.useState(false);
  const [model, setModel] = React.useState<ModelId>("nano-banana-2-edit");
  const [prompt, setPrompt] = React.useState("");
  const [takes, setTakes] = React.useState<Take[]>([]);
  const [now, setNow] = React.useState(0);
  const ac = React.useRef<AbortController | null>(null);
  const running = takes.some((t) => t.status === "queued" || t.status === "generating" || t.status === "checking");

  React.useEffect(() => () => ac.current?.abort(), []);

  // One usage check when the tab first opens: is live generation on, and is this session unlocked?
  React.useEffect(() => {
    if (!active || checked.current || isSample) return;
    checked.current = true;
    api
      .usage()
      .then((u) => {
        if (u.source === "demo") onDemo();
        setLive(u.data.liveGeneration ? "on" : "paused");
        if (u.data.session.unlocked) setUnlocked({ left: u.data.session.generationsLeft });
      })
      .catch(() => setLive("unknown"));
  }, [active, isSample, onDemo]);

  // Samples, paused quota and a used-up session: show the real example takes right away.
  const autoSamples = isSample || live === "paused" || unlocked?.left === 0;
  const examples = React.useMemo(() => sampleTakes(), []);
  const shown = takes.length ? takes : autoSamples ? examples : [];
  React.useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [running]);

  const patch = (key: string, p: Partial<Take>) => setTakes((ts) => ts.map((t) => (t.key === key ? { ...t, ...p } : t)));

  async function runTake(take: Take, signal: AbortSignal) {
    try {
      const g = await api.generate({ sku, kind: "creative", model: take.model, seed: take.seed, prompt: prompt.trim() || undefined }, signal);
      if (g.source === "demo") onDemo();
      const started = Date.now();
      for (;;) {
        await sleep(2000, signal);
        const j = await api.job(g.data.job, signal);
        const st = j.data.status as JobStatus;
        if (st === "processing") patch(take.key, { status: "generating" });
        if (st === "checking") setTakes((ts) => ts.map((t) => (t.key === take.key && t.status !== "checking" ? { ...t, status: "checking", checkingAt: Date.now(), asset: j.data.asset ?? t.asset } : t)));
        if (j.data.status === "completed" && j.data.asset) {
          patch(take.key, { status: "done", asset: j.data.asset, credits: j.data.credits });
          if (j.data.credits) onCredits(j.data.credits);
          return;
        }
        if (j.data.status === "failed") throw new Error(j.data.error || "The model couldn't finish this take.");
        if (Date.now() - started > 120_000) throw new Error("This take is taking too long. Try again.");
      }
    } catch (e) {
      if (isAborted(e)) return;
      patch(take.key, { status: "failed", error: api.messageFor(e) });
    }
  }

  const generate = () => {
    ac.current?.abort();
    const ctl = new AbortController();
    ac.current = ctl;
    const count = takesFor(model, unlocked?.left);
    const fresh: Take[] = Array.from({ length: count }, (_, i) => ({
      key: `${Date.now()}-${i}`,
      model,
      seed: Math.floor(Math.random() * 1_000_000),
      status: "queued",
      startedAt: Date.now(),
    }));
    setTakes(fresh);
    setNow(Date.now());
    setUnlocked((u) => (u ? { left: Math.max(0, u.left - count) } : u));
    fresh.forEach((t) => void runTake(t, ctl.signal));
  };

  const showSamples = () => setTakes(sampleTakes());

  return (
    <div className="grid gap-6">
      <div>
        <h3 className="font-display text-base font-semibold text-paper">A new photo around your product</h3>
        <p className="mt-1 text-[0.9rem] text-dim">
          Creative mode asks an image model to reshoot the whole scene using your cut-out as the reference. It can look more natural, but models sometimes redraw details, so every take
          goes through the same QA check before you can use it.
        </p>
      </div>

      {isSample ? (
        <div className="grid gap-2 rounded-2xl bg-stage-2 p-4 ring-1 ring-line">
          <p className="text-sm text-paper">Creative mode reshoots your own photo.</p>
          <p className="text-sm text-dim">Below are two real takes from a test run, and what the QA check made of them. Upload your photo to try it.</p>
        </div>
      ) : live === "paused" ? (
        <div role="status" className="grid gap-2 rounded-2xl bg-stage-2 p-4 ring-1 ring-line">
          <p className="flex items-center gap-2 text-sm font-semibold text-paper">
            <PauseCircle className="size-4 text-marigold" aria-hidden />
            Live generation is paused
          </p>
          <p className="text-sm text-dim">The shared image-generation quota is nearly used up, so new takes are on hold. Here are real takes from an earlier run. Exact mode keeps working as normal.</p>
        </div>
      ) : live === "checking" && !unlocked ? (
        <div className="grid gap-3 rounded-2xl bg-stage-2 p-4 ring-1 ring-line" aria-busy="true">
          <div className="skeleton h-4 w-3/4 rounded" />
          <div className="skeleton h-9 w-44 rounded-full" />
        </div>
      ) : !unlocked ? (
        <div className="grid gap-3 rounded-2xl bg-stage-2 p-4 ring-1 ring-line">
          <p className="text-sm text-dim">It spends image generation credits, so it needs an access code.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setAskCode(true)}>
              <KeyRound />
              Enter access code
            </Button>
            {shown.length ? null : (
              <Button size="sm" variant="ghost" onClick={showSamples}>
                See example takes
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-5">
          <div role="radiogroup" aria-label="Model" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {CREATIVE_MODELS.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={model === m.id}
                onClick={() => setModel(m.id)}
                className={cn(
                  "rounded-2xl p-3.5 text-left ring-2 transition-colors ring-inset",
                  model === m.id ? "bg-stage-2 ring-marigold" : "bg-stage-2/50 ring-line hover:ring-line-strong",
                )}
              >
                <span className="block font-semibold text-paper">{m.name}</span>
                <span className="mt-0.5 block text-[0.82rem] text-dim">{m.detail}</span>
                {/* exactly what one click spends */}
                <span className="tabular mt-2 block text-[0.78rem] text-faint">
                  {plural(m.credits * takesFor(m.id, unlocked.left), "credit")} · {plural(takesFor(m.id, unlocked.left), "take")}, about {m.seconds} s
                </span>
              </button>
            ))}
          </div>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-paper">Describe the scene (optional)</span>
            <textarea
              value={prompt}
              maxLength={300}
              rows={2}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={EMPTY_PROMPT_HINT}
              className="resize-none rounded-xl bg-stage-2 px-3.5 py-2.5 text-[0.95rem] text-paper ring-1 ring-line ring-inset focus:ring-marigold focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={generate} disabled={!ready || running || unlocked.left <= 0}>
              <Sparkles />
              {running ? "Generating…" : unlocked.left <= 0 ? "Generate" : `Generate ${plural(takesFor(model, unlocked.left), "take")}`}
            </Button>
            {unlocked.left > 0 ? (
              <span className="tabular text-sm text-dim">{unlocked.left} left this session</span>
            ) : (
              <span role="status" className="text-sm text-dim">
                <span className="font-semibold text-paper">Session limit reached.</span> {takes.length ? "Your takes are below." : "Example takes from a test run are below."}
              </span>
            )}
          </div>
          {!ready ? <p className="text-sm text-dim">Available once your product has been cut out.</p> : null}
        </div>
      )}

      {shown.length ? (
        <div className="grid gap-3">
          {shown[0].sample ? <p className="text-[0.82rem] text-dim">Example takes of a test sneaker, made earlier. No credits used now.</p> : null}
          <ul className="grid grid-cols-2 gap-3">
            {shown.map((t) => (
              <TakeTile key={t.key} take={t} now={now} onUse={(a, img) => {
                flyImage(img, stageRect?.() ?? null);
                onUseAsHero(a);
              }} onRetry={() => void runTake({ ...t, status: "queued", startedAt: Date.now() }, (ac.current ??= new AbortController()).signal)} />
            ))}
          </ul>
        </div>
      ) : null}

      <AccessDialog
        open={askCode}
        onOpenChange={setAskCode}
        onUnlocked={(left, demo) => {
          setUnlocked({ left });
          setAskCode(false);
          if (demo) onDemo();
        }}
      />
    </div>
  );
}

/** Takes one click makes on this model, within what the session has left. */
function takesFor(model: ModelId, left?: number) {
  const n = TAKES[model];
  return left && left > 0 ? Math.min(n, left) : n;
}

/**
 * The take's own delivery URL as a download: the same crop, as a JPEG any app
 * opens (f_auto would hand a browser AVIF), with fl_attachment so Cloudinary
 * sends it as a file.
 */
function downloadUrl(url: string) {
  return url.includes("/f_auto,q_auto/") ? url.replace("/f_auto,q_auto/", "/f_jpg,q_auto,fl_attachment/") : url;
}

function sampleTakes(): Take[] {
  return [CREATIVE_APPROVED, CREATIVE_REJECTED].map((a, i) => ({
    key: `sample-${i}`,
    model: i === 0 ? "nano-banana-2-edit" : "flux-2-flash-edit",
    seed: 7,
    status: "done",
    asset: a,
    startedAt: 0,
    sample: true,
  }));
}

function TakeTile({ take, now, onUse, onRetry }: { take: Take; now: number; onUse: (a: KitAsset, img: HTMLImageElement | null) => void; onRetry: () => void }) {
  const box = React.useRef<HTMLDivElement>(null);
  const model = CREATIVE_MODELS.find((m) => m.id === take.model)!;
  const secs = Math.max(0, Math.round(((now || take.startedAt) - take.startedAt) / 1000));
  const checkingFor = take.checkingAt ? Math.max(0, ((now || take.checkingAt) - take.checkingAt) / 1000) : 0;
  const qa = take.asset?.qa;
  return (
    <li className="grid content-start gap-2">
      <div ref={box} className="relative aspect-[4/5] overflow-hidden rounded-xl bg-stage-2 ring-1 ring-line">
        {take.status === "done" && take.asset ? (
          <>
            <CloudImg src={sizedUrl(take.asset, 480)} alt={take.asset.alt} width={1080} height={1350} className="size-full object-cover" />
            {qa ? (
              <span className="absolute top-2 right-2 left-2 flex flex-wrap gap-1">
                <QaBadge qa={qa} className="bg-studio/85 backdrop-blur-sm" />
                {typeof qa.fidelity === "number" ? (
                  <span className="tabular inline-flex items-center rounded-full bg-studio/85 px-2.5 py-1 text-[0.75rem] leading-none font-semibold text-paper backdrop-blur-sm">fidelity {qa.fidelity}</span>
                ) : null}
              </span>
            ) : null}
          </>
        ) : take.status === "checking" ? (
          // the image exists; the fidelity QA is comparing it with the cut-out
          <div className={cn("grid size-full place-items-center", take.asset ? "" : "skeleton")}>
            {take.asset ? <CloudImg src={sizedUrl(take.asset, 480)} alt="" width={1080} height={1350} className="absolute inset-0 size-full object-cover opacity-45" /> : null}
            <div className="relative grid w-[85%] justify-items-center gap-2 rounded-xl bg-studio/80 px-3 py-2.5 text-center backdrop-blur-sm" role="status">
              <span className="inline-flex items-center gap-1.5 text-[0.78rem] leading-snug font-semibold text-paper">
                <ShieldEllipsis className="size-3.5 shrink-0 text-marigold" aria-hidden />
                Checking it&apos;s still your product…
              </span>
              <span aria-hidden className="h-1 w-full overflow-hidden rounded-full bg-stage-3">
                <span className="block h-full rounded-full bg-marigold transition-[width] duration-500 ease-linear" style={{ width: `${Math.min(92, (checkingFor / CHECK_S) * 100)}%` }} />
              </span>
              <span className="tabular text-[0.72rem] text-dim">{Math.round(checkingFor)} s</span>
            </div>
          </div>
        ) : take.status === "failed" ? (
          <div className="grid size-full place-items-center p-3 text-center text-[0.8rem] text-sindoor">{take.error}</div>
        ) : (
          <div className="skeleton grid size-full place-items-center">
            <span className="tabular rounded-full bg-studio/70 px-2.5 py-1 text-[0.75rem] text-paper">
              {take.status === "queued" ? "Queued" : "Generating"} {secs} s
            </span>
          </div>
        )}
      </div>
      <p className="text-[0.8rem] font-semibold text-paper">
        {model.name}
        <span className="tabular ml-1.5 font-normal text-faint">seed {take.seed}</span>
      </p>
      {take.status === "done" && take.asset?.qa?.status === "rejected" ? (
        <ul className="grid gap-0.5 text-[0.78rem] text-sindoor">
          {take.asset.qa.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      {take.status === "done" && take.asset?.qa?.status === "approved" ? (
        <>
          <p className="text-[0.78rem] text-dim">{take.asset.qa.reasons[0] ?? "Same product as your photo"}</p>
          {take.sample ? null : (
            <Button size="sm" variant="secondary" onClick={() => onUse(take.asset!, box.current?.querySelector("img") ?? null)}>
              Use as hero
            </Button>
          )}
        </>
      ) : null}
      {take.status === "done" && take.asset ? (
        // the take on its own, without re-packing the kit
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[0.78rem] font-semibold">
          <a href={take.asset.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 text-paper underline decoration-line-strong underline-offset-4 hover:decoration-marigold">
            <ExternalLink className="size-3.5" aria-hidden />
            Open full size
          </a>
          <a href={downloadUrl(take.asset.url)} className="inline-flex min-h-8 items-center gap-1 text-paper underline decoration-line-strong underline-offset-4 hover:decoration-marigold">
            <Download className="size-3.5" aria-hidden />
            Download
          </a>
        </div>
      ) : null}
      {take.status === "failed" ? (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          <RefreshCw />
          Try again
        </Button>
      ) : null}
    </li>
  );
}

function AccessDialog({ open, onOpenChange, onUnlocked }: { open: boolean; onOpenChange: (o: boolean) => void; onUnlocked: (left: number, demo: boolean) => void }) {
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return setError("Enter the access code you were given.");
    setBusy(true);
    setError(null);
    try {
      const r = await api.access(code.trim());
      onUnlocked(r.data.generationsLeft, r.source === "demo");
      setCode("");
    } catch (err) {
      setError(err instanceof api.ApiFailure && err.body.code === "locked" ? "That code didn't work. Check it and try again." : api.messageFor(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Unlock Creative mode" description="Judges and invited testers have a code. Exact mode stays free and unlimited without one.">
        <form onSubmit={submit} className="grid gap-4">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-paper">Access code</span>
            <input
              autoFocus
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? "access-error" : undefined}
              className="h-12 rounded-xl bg-stage-2 px-4 text-base text-paper ring-1 ring-line ring-inset focus:ring-marigold focus:outline-none aria-[invalid=true]:ring-sindoor"
            />
          </label>
          {error ? (
            <p id="access-error" role="alert" className="text-sm text-sindoor">
              {error}
            </p>
          ) : null}
          <Button type="submit" size="lg" disabled={busy}>
            <LockOpen />
            {busy ? "Checking…" : "Unlock"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
