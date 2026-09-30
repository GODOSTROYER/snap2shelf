"use client";

import { FlaskConical } from "lucide-react";
import { MotionConfig } from "motion/react";
import * as React from "react";
import { BriefBar } from "@/components/features/brief-bar";
import { CostReceipt } from "@/components/features/cost-receipt";
import { RetouchCard } from "@/components/features/retouch-card";
import { SceneGenerator, type SceneChoice } from "@/components/features/scene-generator";
import { Segmented, TooltipProvider } from "@/components/ui/controls";
import type { BriefResponse } from "@/lib/api-contract";
import { ApiFailure, featuresClient, type FeaturesClient } from "@/lib/client/features";
import { cn, sleep } from "@/lib/client/util";
import { SCENE_THEMES, type BriefKit, type RetouchFix, type Scene } from "@/lib/types";

/** Processed products on the demo cloud (analysed and cut out). */
const PRODUCTS = [
  { sku: "tmixdk01", name: "Trail mix pouch", retouched: true },
  { sku: "9uo8w8pc", name: "Steel bottle", retouched: true },
  { sku: "pddaufff", name: "Steel bottle, second photo", retouched: false },
] as const;
type LabSku = (typeof PRODUCTS)[number]["sku"];

const DEFAULT_SCENE = "snap2shelf/scenes/diwali/final-59f4388a";
const HEADLINE_BRIEF = "Diwali sale ad, 20% off, Hindi, for WhatsApp + Instagram";

/**
 * The lab never spends generation credits: a new backdrop is only requested while
 * the session is locked (reuse answers at once, anything new is refused with 403
 * and the access dialog). Once unlocked, this guard stops the request instead.
 */
const guardedClient: FeaturesClient = {
  ...featuresClient,
  async generateScene(req, signal) {
    const usage = await fetch("/api/usage", { cache: "no-store", signal })
      .then((r) => (r.ok ? (r.json() as Promise<{ session?: { unlocked?: boolean } }>) : null))
      .catch(() => null);
    if (usage?.session?.unlocked) {
      throw new ApiFailure(400, {
        code: "bad_request",
        error: "Lab guard: this browser session is unlocked, so a new backdrop could spend a real credit. Library matches still work here; generate new scenes from the studio.",
      });
    }
    return featuresClient.generateScene(req, signal);
  },
};

export function LabBench() {
  const [sku, setSku] = React.useState<LabSku>("tmixdk01");
  const [brief, setBrief] = React.useState<BriefResponse | null>(null);
  const [applied, setApplied] = React.useState<BriefKit | null>(null);
  const [scene, setScene] = React.useState<{ scene: Scene; choice: SceneChoice } | null>(null);
  const [fixes, setFixes] = React.useState<RetouchFix[] | null>(null);
  const product = PRODUCTS.find((p) => p.sku === sku)!;
  const theme = applied?.theme ?? brief?.kit.theme;
  const view = SCENE_THEMES.find((t) => t.slug === theme)?.view ?? "eye-level";

  const pick = (s: LabSku) => {
    setSku(s);
    setBrief(null);
    setApplied(null);
    setScene(null);
    setFixes(null);
  };

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <div className="mt-8 max-w-[34rem]">
          <Segmented label="Product" value={sku} options={PRODUCTS.map((p) => ({ value: p.sku, label: p.name.replace(", second photo", " #2") }))} onChange={pick} />
          <p className="mt-2 font-mono text-[0.75rem] text-faint">sku {sku}</p>
        </div>

        <div className="mt-10 flex flex-wrap items-start gap-x-10 gap-y-14">
          <Bench title="Touch-up" where="After analyze, before the cutout. The cutout starts from the retouched photo." width="lg:w-[25rem]">
            <RetouchCard key={sku} sku={sku} autoStart={product.retouched} onDone={(f) => setFixes(f)} />
            {!product.retouched ? <p className="mt-3 text-[0.8rem] text-faint">This product hasn&apos;t been checked yet, so the first check spends a few AI Vision tokens.</p> : null}
            {fixes ? <Readout rows={[["onDone(fixes)", fixes.length ? `[${fixes.map((f) => `"${f}"`).join(", ")}]` : "[] (nothing to fix)"]]} /> : null}
          </Bench>

          <Bench title="Brief" where="Before staging. Feeds the scene choice and PackRequest.offer / .recolor." width="lg:w-[46rem]">
            <BriefBar key={sku} sku={sku} defaultBrief={sku === "9uo8w8pc" ? HEADLINE_BRIEF : ""} onResult={setBrief} onApply={(kit) => setApplied(kit)} />
            {applied ? (
              <Readout
                rows={[
                  ["theme", `"${applied.theme}"  → scene selection`],
                  ["offer", `${JSON.stringify(applied.offer)}  → PackRequest.offer`],
                  ["recolor", `${JSON.stringify(applied.swatches)}  → PackRequest.recolor`],
                  ["channels", applied.channels.join(", ") || "(all)"],
                  ["tone", applied.tone],
                ]}
              />
            ) : null}
          </Bench>

          <Bench title="Backdrop" where="Inside the scene picker. Reuse first; a new plate only with the access code." width="lg:w-[28rem]">
            <SceneGenerator
              key={sku}
              sku={sku}
              theme={theme}
              prompt={brief?.scenePrompt}
              view={view}
              selectedId={scene?.scene.publicId ?? null}
              onSelect={(s, choice) => setScene({ scene: s, choice })}
              client={guardedClient}
            />
            {scene ? (
              <Readout
                rows={[
                  ["onSelect(scene)", scene.scene.publicId],
                  ["choice", JSON.stringify(scene.choice)],
                ]}
              />
            ) : null}
          </Bench>

          <Bench title="Receipt" where="On the kit view, under the shelves. Pass the staged scene's publicId." width="lg:w-[24rem]">
            <CostReceipt key={sku} sku={sku} scene={scene?.scene.publicId ?? DEFAULT_SCENE} />
          </Bench>

          <Bench
            title="Generation preview"
            where="Simulated: the job answers are mocked in this browser. No generation request is sent and no credits are used."
            badge
            width="lg:w-[28rem]"
          >
            <MockedJob />
          </Bench>
        </div>
      </TooltipProvider>
    </MotionConfig>
  );
}

function Bench({ title, where, badge, width, children }: { title: string; where: string; badge?: boolean; width: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <section aria-labelledby={id} className={cn("w-full min-w-0 max-w-full", width)}>
      <div className="mb-5 border-b border-line pb-3">
        <h2 id={id} className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-[-0.02em]">
          {title}
          {badge ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-stage-3 px-2.5 py-1 font-sans text-[0.72rem] font-semibold tracking-normal text-paper ring-1 ring-line-strong ring-inset">
              <FlaskConical className="size-3.5" aria-hidden />
              Simulated
            </span>
          ) : null}
        </h2>
        <p className="mt-1 text-sm text-dim">{where}</p>
      </div>
      {children}
    </section>
  );
}

function Readout({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 rounded-xl bg-studio p-3.5 font-mono text-[0.72rem] leading-relaxed ring-1 ring-line">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-faint">{k}</dt>
          <dd className="break-all text-dim">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

// ─── simulated scene job (clearly labelled; never calls the generate route) ─────

function MockedJob() {
  const [outcome, setOutcome] = React.useState<"pass" | "fail">("pass");
  const [picked, setPicked] = React.useState<string | null>(null);
  const client = React.useMemo<FeaturesClient>(() => mockJobClient(outcome), [outcome]);
  return (
    <div className="grid gap-5">
      <div className="max-w-[24rem]">
        <Segmented
          label="Simulated outcome"
          value={outcome}
          options={[
            { value: "pass", label: "Passes the check" },
            { value: "fail", label: "Fails the check" },
          ]}
          onChange={setOutcome}
        />
      </div>
      <SceneGenerator
        key={outcome}
        theme="kitchen"
        prompt="A light oak kitchen counter with fresh herbs and soft morning window light"
        view="eye-level"
        selectedId={picked}
        onSelect={(s) => setPicked(s.publicId)}
        client={client}
      />
    </div>
  );
}

/**
 * Library matches are real (public, cached); generate + poll are simulated:
 * pending → processing ×3 → completed with an existing library plate, or a
 * scene-check rejection.
 */
function mockJobClient(outcome: "pass" | "fail"): FeaturesClient {
  let polls = 0;
  let plate: Scene | null = null;
  return {
    ...featuresClient,
    async generateScene(req, signal) {
      const top = await featuresClient.matchScenes({ theme: "kitchen", limit: 1 }, signal).catch(() => []);
      plate = top[0]?.scene ?? null;
      polls = 0;
      await sleep(700, signal);
      return { reused: false, job: "simulated-job", tier: req.tier, modelId: "flux-2-flash", estimatedCredits: 1 };
    },
    async sceneJob() {
      polls += 1;
      if (polls < 2) return { status: "pending" };
      if (polls < 5) return { status: "processing" };
      if (outcome === "fail" || !plate) {
        return {
          status: "failed",
          credits: 1,
          qa: { status: "rejected", matched: ["text-or-letters"], reasons: ["Scene check: text or letters"] },
          error: "The new backdrop showed a product, text or a person, so it was kept out of the library.",
        };
      }
      return { status: "completed", scene: { ...plate, credits: 1 }, credits: 1, qa: { status: "approved", matched: [], reasons: [] } };
    },
    async access() {
      return { ok: true, generationsLeft: 3 };
    },
  };
}
