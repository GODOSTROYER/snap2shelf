"use client";

/* eslint-disable @next/next/no-img-element -- Cloudinary delivery URLs, already sized (f_auto/q_auto) */

import { Check, ImagePlus, KeyRound, LockOpen, Recycle } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CldImage } from "next-cloudinary";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { SceneMatch } from "@/lib/api-contract";
import {
  ApiFailure,
  featureMessage,
  featuresClient,
  isBusy,
  matchReason,
  sceneJobUntilDone,
  themeLabel,
  type FeaturesClient,
} from "@/lib/client/features";
import { useDebounced } from "@/lib/client/hooks";
import { publicUrl } from "@/lib/client/img";
import { cn, isAborted } from "@/lib/client/util";

import type { QaResult, Scene, SceneView, Sku } from "@/lib/types";
import { Narration, Notice } from "./shared";

const EXPO = [0.16, 1, 0.3, 1] as const;

export interface SceneChoice {
  /** true: an existing library plate, 0 credits. */
  reused: boolean;
  /** credits this choice spent (0 when reused). */
  credits: number;
  /** credits a fresh generation would have cost. */
  creditsSaved: number;
}

export interface SceneGeneratorProps {
  /** Records credits spent / saved against this product's cost meter. */
  sku?: Sku;
  /** BriefKit.theme: ranks matches and files a new scene under this theme. */
  theme?: string;
  /** BriefResponse.scenePrompt: prefills the new-backdrop description. */
  prompt?: string;
  /** The product's camera view (VIEW_FOR_PLACEMENT[placement]). */
  view?: SceneView;
  selectedId?: string | null;
  onSelect: (scene: Scene, choice: SceneChoice) => void;
  client?: FeaturesClient;
  className?: string;
}

type Gen =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "developing"; since: number; status: "pending" | "processing"; estimatedCredits: number }
  | { kind: "ready"; scene: Scene; choice: SceneChoice; qa?: QaResult }
  | { kind: "rejected"; message: string; reasons: string[]; credits?: number }
  | { kind: "error"; message: string; tone: "error" | "busy" | "info"; locked?: boolean };

/**
 * "Need a different backdrop?" Library matches first (reused, 0 credits), then
 * "Generate a new scene": reuse is checked before any spend; a new plate is
 * developed like a print in a darkroom while the job runs, and lands in the
 * library for everyone after the scene check.
 */
export function SceneGenerator({ sku, theme, prompt, view, selectedId, onSelect, client = featuresClient, className }: SceneGeneratorProps) {
  const [text, setText] = React.useState(prompt ?? "");
  const [seenPrompt, setSeenPrompt] = React.useState(prompt);
  if (seenPrompt !== prompt) {
    setSeenPrompt(prompt);
    setText(prompt ?? "");
  }
  const [picked, setPicked] = React.useState<string | null>(null);
  const selected = selectedId !== undefined ? selectedId : picked;
  const [gen, setGen] = React.useState<Gen>({ kind: "idle" });
  const [askCode, setAskCode] = React.useState(false);
  const ac = React.useRef<AbortController | null>(null);
  const ids = React.useId();
  React.useEffect(() => () => ac.current?.abort(), []);

  // ── library matches (public, cached list: no credits, no Admin API)
  const q = useDebounced(text, 500);
  const key = JSON.stringify([theme ?? "", q.trim(), view ?? ""]);
  const [matches, setMatches] = React.useState<{ key: string; list: SceneMatch[] | null; error?: string }>({ key: "", list: null });
  const [attempt, setAttempt] = React.useState(0);
  React.useEffect(() => {
    const ctl = new AbortController();
    const t = setTimeout(() => {
      client
        .matchScenes({ theme, q, view, limit: 6 }, ctl.signal)
        .then((list) => setMatches({ key, list }))
        .catch((e) => {
          if (!isAborted(e) && !ctl.signal.aborted) setMatches({ key, list: null, error: featureMessage(e) });
        });
    }, 0);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [client, key, theme, q, view, attempt]);
  const loadingMatches = matches.key !== key;

  const choose = (scene: Scene, choice: SceneChoice) => {
    setPicked(scene.publicId);
    onSelect(scene, choice);
  };

  // ── generate (reuse first)
  const generate = async () => {
    const description = text.trim();
    if (description && description.length < 8) {
      setGen({ kind: "error", tone: "info", message: "Describe the backdrop in a few more words (at least 8 characters)." });
      return;
    }
    if (!description && !theme) {
      setGen({ kind: "error", tone: "info", message: "Describe the backdrop you want, for example a teak table with brass lamps." });
      return;
    }
    ac.current?.abort();
    const ctl = new AbortController();
    ac.current = ctl;
    setGen({ kind: "checking" });
    try {
      const r = await client.generateScene({ theme, prompt: description || undefined, tier: "draft", view, sku }, ctl.signal);
      if (r.reused) {
        setGen({ kind: "ready", scene: r.scene, choice: { reused: true, credits: 0, creditsSaved: r.creditsSaved } });
        return;
      }
      const since = Date.now();
      setGen({ kind: "developing", since, status: "pending", estimatedCredits: r.estimatedCredits });
      const done = await sceneJobUntilDone(client, r.job, {
        signal: ctl.signal,
        onStatus: (s) => {
          if (s.status === "pending" || s.status === "processing") setGen({ kind: "developing", since, status: s.status, estimatedCredits: r.estimatedCredits });
        },
      });
      if (ctl.signal.aborted) return;
      if (done.status === "completed" && done.scene) {
        setGen({ kind: "ready", scene: done.scene, choice: { reused: false, credits: done.credits ?? r.estimatedCredits, creditsSaved: 0 }, qa: done.qa });
      } else {
        setGen({
          kind: "rejected",
          message: done.error ?? "The new backdrop didn't pass the scene check.",
          reasons: done.qa?.reasons ?? [],
          credits: done.credits,
        });
      }
    } catch (e) {
      if (isAborted(e) || ctl.signal.aborted) return;
      if (e instanceof ApiFailure && e.body.code === "locked") {
        setGen({ kind: "error", tone: "info", locked: true, message: "A new scene uses image generation credits, so it needs the demo access code. Library scenes stay free." });
        setAskCode(true);
        return;
      }
      if (e instanceof ApiFailure && e.status === 409) {
        setGen({ kind: "rejected", message: e.body.error, reasons: [] });
        return;
      }
      const quota = e instanceof ApiFailure && (e.body.code === "quota_low" || e.body.code === "cap_reached");
      setGen({ kind: "error", tone: quota ? "info" : isBusy(e) ? "busy" : "error", message: featureMessage(e) });
    }
  };

  const working = gen.kind === "checking" || gen.kind === "developing";
  const savedHint = matches.list?.find((m) => m.scene.publicId === selected)?.scene.credits;

  return (
    <section aria-labelledby={`${ids}-title`} className={cn("grid gap-5", className)}>
      <div>
        <h3 id={`${ids}-title`} className="font-display text-base font-semibold text-paper">
          Need a different backdrop?
        </h3>
        <p className="mt-1 text-[0.9rem] text-dim">Library scenes are reused, so they cost nothing. A new one is generated once, then shared.</p>
      </div>

      {/* ── best matches */}
      <div className="grid gap-2.5">
        <p id={`${ids}-matches`} className="text-[0.82rem] font-medium text-dim">
          Best matches in the library
        </p>
        {loadingMatches && !matches.list ? (
          <div className="grid grid-cols-3 gap-2.5" aria-busy="true" aria-label="Finding matching scenes">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton aspect-[4/5] rounded-xl" />
            ))}
          </div>
        ) : matches.error ? (
          <Notice tone="busy" title="Couldn't load the library" onRetry={() => setAttempt((n) => n + 1)}>
            {matches.error}
          </Notice>
        ) : !matches.list?.length ? (
          <p className="rounded-xl bg-stage-2 p-4 text-sm text-dim ring-1 ring-line">No library scene fits this yet. Describe one below and it will be generated once, then reused.</p>
        ) : (
          <div role="radiogroup" aria-labelledby={`${ids}-matches`} className={cn("grid grid-cols-3 gap-2.5 transition-opacity", loadingMatches && "opacity-60")}>
            {matches.list.slice(0, 6).map((m, i) => {
              const on = m.scene.publicId === selected;
              return (
                <motion.button
                  key={m.scene.publicId}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={m.reasons[0] ? `${m.scene.title}, ${matchReason(m.reasons[0])}` : m.scene.title}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: i * 0.05, ease: EXPO }}
                  onClick={() => choose(m.scene, { reused: true, credits: 0, creditsSaved: m.scene.credits })}
                  className={cn(
                    "group relative overflow-hidden rounded-xl text-left ring-2 transition-[box-shadow] duration-200 ring-inset",
                    on ? "ring-marigold" : "ring-transparent hover:ring-line-strong",
                  )}
                >
                  <CldImage
                    src={m.scene.publicId}
                    width={240}
                    height={300}
                    crop="fill"
                    sizes="(min-width: 1024px) 120px, 30vw"
                    alt=""
                    className="aspect-[4/5] w-full bg-stage-2 object-cover transition-transform duration-500 ease-(--ease-out-expo) group-hover:scale-[1.04]"
                  />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-2 pt-8 pb-1.5">
                    <span className="block text-[0.72rem] leading-tight font-semibold text-white">{m.scene.title}</span>
                    {m.reasons[0] ? <span className="mt-0.5 block truncate text-[0.66rem] leading-tight text-white/75">{matchReason(m.reasons[0])}</span> : null}
                  </span>
                  {on ? (
                    <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-marigold text-marigold-ink">
                      <Check className="size-3.5" aria-hidden />
                    </span>
                  ) : null}
                </motion.button>
              );
            })}
          </div>
        )}
        {selected && savedHint !== undefined ? <ReuseBadge saved={savedHint} /> : null}
      </div>

      {/* ── generate a new one */}
      <div className="grid gap-3 rounded-2xl bg-stage-2/60 p-4 ring-1 ring-line">
        <div className="grid gap-1.5 text-sm">
          <label htmlFor={`${ids}-prompt`} className="font-medium text-paper">
            Describe a new backdrop
          </label>
          <p id={`${ids}-hint`} className="text-[0.8rem] text-dim">
            An empty surface and background. No product, text or people: the scene check keeps those out.
          </p>
        </div>
        <textarea
          id={`${ids}-prompt`}
          aria-describedby={`${ids}-hint`}
          value={text}
          maxLength={300}
          rows={3}
          disabled={working}
          onChange={(e) => setText(e.target.value)}
          placeholder="A carved teak tabletop with brass diyas and warm fairy-light bokeh"
          className="resize-none rounded-xl bg-stage px-3.5 py-2.5 text-[0.95rem] text-paper ring-1 ring-line ring-inset focus:ring-marigold focus:outline-none disabled:opacity-60"
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button onClick={() => void generate()} disabled={working} className="max-sm:w-full">
            {gen.kind === "checking" ? <span aria-hidden className="size-[18px] animate-spin rounded-full border-2 border-marigold-ink/30 border-t-marigold-ink" /> : <ImagePlus />}
            {gen.kind === "checking" ? "Checking the library…" : gen.kind === "developing" ? "Generating…" : "Generate a new scene"}
          </Button>
          <p className="text-[0.78rem] leading-snug text-faint">
            {theme ? `Filed under ${themeLabel(theme)}. ` : ""}Reuses a match first; a new draft costs about 1 credit.
          </p>
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {gen.kind === "developing" ? (
          <motion.div key="dev" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            <Darkroom since={gen.since} status={gen.status} credits={gen.estimatedCredits} />
          </motion.div>
        ) : gen.kind === "ready" ? (
          <motion.div key={`ready-${gen.scene.publicId}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="grid gap-3">
            <DevelopedPrint scene={gen.scene} fast={gen.choice.reused} />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display font-semibold text-paper">{gen.scene.title}</p>
                {gen.choice.reused ? (
                  <ReuseBadge saved={gen.choice.creditsSaved} lead="Already in the library" className="mt-1.5" />
                ) : (
                  <p className="tabular mt-1 text-[0.82rem] text-dim">
                    New scene, {gen.choice.credits} {gen.choice.credits === 1 ? "credit" : "credits"}. It passed the scene check and is in the library for everyone now.
                  </p>
                )}
              </div>
              <Button variant={selected === gen.scene.publicId ? "secondary" : "primary"} disabled={selected === gen.scene.publicId} onClick={() => choose(gen.scene, gen.choice)} className="max-sm:w-full">
                <Check />
                {selected === gen.scene.publicId ? "Scene in use" : "Use this scene"}
              </Button>
            </div>
          </motion.div>
        ) : gen.kind === "rejected" ? (
          <motion.div key="rejected" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Notice tone="error" title="The scene check kept this backdrop out" onRetry={() => void generate()} retryLabel="Try again">
              <p>{gen.message}</p>
              {gen.reasons.length ? (
                <ul className="mt-1.5 grid gap-0.5">
                  {gen.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-1.5">Reword the description (describe only the surface and the background), or pick a library match above.</p>
            </Notice>
          </motion.div>
        ) : gen.kind === "error" ? (
          <motion.div key={`err-${gen.message}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {gen.locked ? (
              <Notice tone="info" title="New scenes need the access code" onRetry={() => setAskCode(true)} retryLabel="Enter access code" retryIcon={<KeyRound />}>
                {gen.message}
              </Notice>
            ) : (
              <Notice
                tone={gen.tone}
                title={gen.tone === "busy" ? "Cloudinary is busy" : gen.tone === "info" ? "Pick a library scene for now" : "The new scene didn't start"}
                onRetry={gen.tone === "info" && gen.message.includes("few more words") ? undefined : () => void generate()}
              >
                {gen.message}
              </Notice>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AccessDialog
        open={askCode}
        onOpenChange={setAskCode}
        client={client}
        onUnlocked={() => {
          setAskCode(false);
          void generate();
        }}
      />
    </section>
  );
}

function ReuseBadge({ saved, lead = "Reused", className }: { saved: number; lead?: string; className?: string }) {
  return (
    <p className={cn("inline-flex w-fit flex-wrap items-center gap-x-1.5 rounded-full bg-marigold/12 px-3 py-1 text-[0.8rem] font-semibold text-marigold-hi ring-1 ring-marigold/30 ring-inset", className)}>
      <Recycle className="size-3.5" aria-hidden />
      <span>{lead}</span>
      <span aria-hidden className="text-marigold/60">·</span>
      <span className="tabular">0 credits</span>
      {saved > 0 ? (
        <>
          <span aria-hidden className="text-marigold/60">·</span>
          <span className="tabular">
            saved {saved} {saved === 1 ? "credit" : "credits"}
          </span>
        </>
      ) : null}
    </p>
  );
}

/**
 * While the job runs: a print in the developing tray under the amber safelight.
 * Honest about what's known: queued at the model, then composing and checking.
 */
function Darkroom({ since, status, credits }: { since: number; status: "pending" | "processing"; credits: number }) {
  const reduce = useReducedMotion();
  const [now, setNow] = React.useState(since);
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.round((now - since) / 1000));
  return (
    <div className="relative isolate grid aspect-[4/5] w-full place-items-center overflow-hidden rounded-2xl bg-[color-mix(in_srgb,var(--color-studio)_55%,black)] ring-1 ring-line sm:aspect-[5/4]">
      {/* safelight */}
      <motion.div
        aria-hidden
        className="absolute inset-x-[-20%] top-[-45%] h-[110%] bg-[radial-gradient(closest-side,rgb(245_120_36/0.55),rgb(245_120_36/0.14)_55%,transparent)]"
        animate={reduce ? undefined : { opacity: [0.65, 1, 0.65] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* the print, still blank */}
      <div className="relative grid aspect-[4/5] h-[62%] place-items-center rounded-[4px] bg-[linear-gradient(160deg,rgb(245_237_225/0.10),rgb(245_237_225/0.04))] shadow-[0_24px_40px_-18px_rgb(0_0_0/0.9)] ring-1 ring-paper/10">
        {!reduce ? (
          <motion.div
            aria-hidden
            className="absolute inset-0 rounded-[4px] bg-[linear-gradient(100deg,transparent_30%,rgb(255_195_94/0.10)_50%,transparent_70%)] bg-[length:250%_100%]"
            animate={{ backgroundPosition: ["150% 0%", "-50% 0%"] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          />
        ) : null}
        <span className="tabular font-display text-3xl font-semibold text-marigold-hi/90">{secs}s</span>
      </div>
      <div className="absolute inset-x-0 bottom-0 grid gap-1 p-4 text-center">
        <p role="status" aria-live="polite" className="text-sm font-semibold text-paper">
          <span className="sr-only">{status === "pending" ? "Queued at the model" : "Composing and checking the new scene"}</span>
          <Narration
            lines={status === "pending" ? ["Queued at the model", "Composing the backdrop"] : ["Composing the backdrop", "Reading its light", "Checking it's empty"]}
            every={1800}
          />
        </p>
        <p className="tabular text-[0.78rem] text-dim">Draft model, about {credits} {credits === 1 ? "credit" : "credits"}. Usually 10 to 30 seconds.</p>
      </div>
    </div>
  );
}

/** The finished plate developing in: paper-white and soft, then contrast and focus arrive. */
function DevelopedPrint({ scene, fast }: { scene: Scene; fast: boolean }) {
  const reduce = useReducedMotion();
  const [loaded, setLoaded] = React.useState(false);
  const src = publicUrl(scene.publicId, { w: 720 });
  const ms = reduce ? 0 : fast ? 1400 : 2800;
  // decode() settles even when the image was already cached before listeners attached.
  const watch = React.useCallback((el: HTMLImageElement | null) => {
    if (!el) return;
    const show = () => requestAnimationFrame(() => requestAnimationFrame(() => setLoaded(true)));
    el.decode().then(show, show);
  }, []);
  return (
    <div className="relative isolate aspect-[4/5] w-full overflow-hidden rounded-2xl bg-paper shadow-[0_40px_70px_-35px_rgb(0_0_0/0.95)] ring-1 ring-line">
      <img
        ref={watch}
        src={src}
        alt={`Scene: ${scene.title}`}
        width={1080}
        height={1350}
        decoding="async"
        className="absolute inset-0 size-full object-cover transition-[opacity,filter,scale] ease-(--ease-out-expo)"
        style={{
          transitionDuration: `${ms}ms`,
          opacity: loaded ? 1 : 0,
          filter: loaded ? "brightness(1) contrast(1) sepia(0) blur(0px)" : "brightness(1.9) contrast(0.35) sepia(0.8) blur(12px)",
          scale: loaded ? "1" : "1.04",
        }}
      />
      {!reduce ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgb(245_120_36/0.5),transparent_70%)] mix-blend-multiply transition-opacity ease-(--ease-out-expo)"
          style={{ transitionDuration: `${ms * 0.8}ms`, opacity: loaded ? 0 : 1 }}
        />
      ) : null}
    </div>
  );
}

function AccessDialog({ open, onOpenChange, onUnlocked, client }: { open: boolean; onOpenChange: (o: boolean) => void; onUnlocked: (left: number) => void; client: FeaturesClient }) {
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const errId = React.useId();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return setError("Enter the access code you were given.");
    setBusy(true);
    setError(null);
    try {
      const r = await client.access(code.trim());
      setCode("");
      onUnlocked(r.generationsLeft);
    } catch (err) {
      setError(err instanceof ApiFailure && err.body.code === "locked" ? "That code didn't work. Check it and try again." : featureMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Unlock new scenes" description="Judges and invited testers have a code. Library scenes stay free without one.">
        <form onSubmit={submit} className="grid gap-4">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-paper">Access code</span>
            <input
              autoFocus
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? errId : undefined}
              className="h-12 rounded-xl bg-stage-2 px-4 text-base text-paper ring-1 ring-line ring-inset focus:ring-marigold focus:outline-none aria-[invalid=true]:ring-sindoor"
            />
          </label>
          {error ? (
            <p id={errId} role="alert" className="text-sm text-sindoor">
              {error}
            </p>
          ) : null}
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? <KeyRound /> : <LockOpen />}
            {busy ? "Checking…" : "Unlock and generate"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
