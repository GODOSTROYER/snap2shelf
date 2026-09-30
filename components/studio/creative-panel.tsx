"use client";

import { KeyRound, LockOpen, RefreshCw, Sparkles } from "lucide-react";
import * as React from "react";
import { CloudImg } from "@/components/cloud-img";
import { QaBadge } from "@/components/kit/qa-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import * as api from "@/lib/client/api";
import { sizedUrl } from "@/lib/client/img";
import { cn, isAborted, sleep } from "@/lib/client/util";
import { CREATIVE_APPROVED, CREATIVE_MODELS, CREATIVE_REJECTED } from "@/lib/showcase";
import type { KitAsset, Sku } from "@/lib/types";

type ModelId = (typeof CREATIVE_MODELS)[number]["id"];

interface Take {
  key: string;
  model: ModelId;
  seed: number;
  status: "queued" | "generating" | "done" | "failed";
  asset?: KitAsset;
  error?: string;
  credits?: number;
  startedAt: number;
  sample?: boolean;
}

/**
 * Creative mode: image_to_image around the real cut-out, two seeds at a time,
 * every take judged by the fidelity QA before it can become the hero.
 */
export function CreativePanel({
  sku,
  ready,
  onUseAsHero,
  onCredits,
  onDemo,
}: {
  sku: Sku;
  ready: boolean;
  onUseAsHero: (a: KitAsset) => void;
  onCredits: (n: number) => void;
  onDemo: () => void;
}) {
  const [unlocked, setUnlocked] = React.useState<{ left: number } | null>(null);
  const [askCode, setAskCode] = React.useState(false);
  const [model, setModel] = React.useState<ModelId>("nano-banana-2-edit");
  const [prompt, setPrompt] = React.useState("");
  const [takes, setTakes] = React.useState<Take[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(0);
  const ac = React.useRef<AbortController | null>(null);
  const running = takes.some((t) => t.status === "queued" || t.status === "generating");

  React.useEffect(() => () => ac.current?.abort(), []);
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
        if (j.data.status === "processing") patch(take.key, { status: "generating" });
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
    setError(null);
    const count = unlocked && unlocked.left < 2 ? Math.max(1, unlocked.left) : 2;
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

  const showSamples = () => {
    setTakes(
      [CREATIVE_APPROVED, CREATIVE_REJECTED].map((a, i) => ({
        key: `sample-${i}`,
        model: i === 0 ? "nano-banana-2-edit" : "flux-2-flash-edit",
        seed: 7,
        status: "done",
        asset: a,
        startedAt: 0,
        sample: true,
      })),
    );
  };

  return (
    <div className="grid gap-6">
      <div>
        <h3 className="font-display text-base font-semibold text-paper">A new photo around your product</h3>
        <p className="mt-1 text-[0.9rem] text-dim">
          Creative mode asks an image model to reshoot the whole scene using your cut-out as the reference. It can look more natural, but models sometimes redraw details, so every take
          goes through the same QA check before you can use it.
        </p>
      </div>

      {!unlocked ? (
        <div className="grid gap-3 rounded-2xl bg-stage-2 p-4 ring-1 ring-line">
          <p className="text-sm text-dim">It spends image generation credits, so it needs an access code.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setAskCode(true)}>
              <KeyRound />
              Enter access code
            </Button>
            <Button size="sm" variant="ghost" onClick={showSamples}>
              See sample takes
            </Button>
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
                <span className="tabular mt-2 block text-[0.78rem] text-faint">
                  {m.credits} {m.credits === 1 ? "credit" : "credits"}, about {m.seconds} s
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
              placeholder="A sandstone ledge in a sunlit courtyard"
              className="resize-none rounded-xl bg-stage-2 px-3.5 py-2.5 text-[0.95rem] text-paper ring-1 ring-line ring-inset focus:ring-marigold focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={generate} disabled={!ready || running || unlocked.left <= 0}>
              <Sparkles />
              {running ? "Generating…" : unlocked.left === 1 ? "Generate 1 take" : "Generate 2 takes"}
            </Button>
            <span className="tabular text-sm text-dim">{unlocked.left > 0 ? `${unlocked.left} left this session` : "No generations left this session"}</span>
          </div>
          {!ready ? <p className="text-sm text-dim">Available once your product has been cut out.</p> : null}
        </div>
      )}

      {error ? (
        <p role="alert" className="text-sm text-sindoor">
          {error}
        </p>
      ) : null}

      {takes.length ? (
        <div className="grid gap-3">
          {takes[0].sample ? <p className="text-[0.82rem] text-dim">Sample takes of the sneaker. No credits used.</p> : null}
          <ul className="grid grid-cols-2 gap-3">
            {takes.map((t) => (
              <TakeTile key={t.key} take={t} now={now} onUse={onUseAsHero} onRetry={() => void runTake({ ...t, status: "queued", startedAt: Date.now() }, (ac.current ??= new AbortController()).signal)} />
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

function TakeTile({ take, now, onUse, onRetry }: { take: Take; now: number; onUse: (a: KitAsset) => void; onRetry: () => void }) {
  const model = CREATIVE_MODELS.find((m) => m.id === take.model)!;
  const secs = Math.max(0, Math.round(((now || take.startedAt) - take.startedAt) / 1000));
  return (
    <li className="grid content-start gap-2">
      <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-stage-2 ring-1 ring-line">
        {take.status === "done" && take.asset ? (
          <>
            <CloudImg src={sizedUrl(take.asset, 480)} alt={take.asset.alt} width={1080} height={1350} className="size-full object-cover" />
            {take.asset.qa ? <QaBadge qa={take.asset.qa} className="absolute top-2 left-2 bg-studio/85 backdrop-blur-sm" /> : null}
          </>
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
          <p className="text-[0.78rem] text-dim">{take.asset.qa.reasons[0]}</p>
          <Button size="sm" variant="secondary" onClick={() => onUse(take.asset!)}>
            Use as hero
          </Button>
        </>
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
