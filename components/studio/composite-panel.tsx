"use client";

import { Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RangeField, Segmented, Toggle } from "@/components/ui/controls";
import { MAX_SWATCHES, SWATCHES } from "@/lib/client/swatches";
import { cn } from "@/lib/client/util";
import type { CompositeControls, Placement, Scene } from "@/lib/types";
import { ScenePicker } from "./scene-picker";

export interface PackSettings {
  offer: { hindi: string; english: string };
  swatches: string[];
}

/** Exact mode: scene, placement sliders, shadows, and what goes into the pack. */
export function CompositePanel({
  scenes,
  sceneId,
  onScene,
  controls,
  onControls,
  onReset,
  placement,
  settings,
  onSettings,
  disabled,
}: {
  scenes: Scene[] | null;
  sceneId: string | null;
  onScene: (s: Scene) => void;
  controls: CompositeControls | null;
  onControls: (c: CompositeControls) => void;
  onReset: () => void;
  placement: Placement;
  settings: PackSettings;
  onSettings: (s: PackSettings) => void;
  disabled?: boolean;
}) {
  const set = <K extends keyof CompositeControls>(k: K, v: CompositeControls[K]) => controls && onControls({ ...controls, [k]: v });
  const toggleSwatch = (hex: string) => {
    const has = settings.swatches.includes(hex);
    if (!has && settings.swatches.length >= MAX_SWATCHES) return;
    onSettings({ ...settings, swatches: has ? settings.swatches.filter((h) => h !== hex) : [...settings.swatches, hex] });
  };

  return (
    <div className="grid gap-8">
      <Section title="Scene" hint="Ready-made and reused, so they cost no generation credits.">
        <ScenePicker scenes={scenes} selected={sceneId} onSelect={onScene} disabled={disabled} />
      </Section>

      <Section
        title="Placement"
        action={
          <Button variant="ghost" size="sm" onClick={onReset} disabled={disabled || !controls} className="-mr-2">
            <RotateCcw />
            Reset
          </Button>
        }
      >
        {controls ? (
          <div className="grid gap-5">
            <RangeField label="Size" min={0.2} max={0.8} step={0.02} value={controls.scale} display={`${Math.round(controls.scale * 100)}% of the width`} onChange={(v) => set("scale", v)} disabled={disabled} />
            <RangeField label="Left and right" min={-300} max={300} step={10} value={controls.offsetX} display={nudge(controls.offsetX, "right", "left")} onChange={(v) => set("offsetX", v)} disabled={disabled} />
            <RangeField label="Up and down" min={-300} max={300} step={10} value={controls.offsetY} display={nudge(controls.offsetY, "down", "up")} onChange={(v) => set("offsetY", v)} disabled={disabled} />
            <div className="grid gap-1">
              <Toggle label="Cast shadow" hint="Falls away from the scene's light" checked={controls.shadow} onChange={(v) => set("shadow", v)} />
              {placement !== "flatlay" ? <Toggle label="Contact shadow" hint="Grounds the product on the surface" checked={controls.contact} onChange={(v) => set("contact", v)} /> : null}
            </div>
            {placement !== "flatlay" ? (
              <Segmented
                label="Reflection"
                value={controls.reflection}
                onChange={(v) => set("reflection", v)}
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "on", label: "On" },
                  { value: "off", label: "Off" },
                ]}
              />
            ) : null}
          </div>
        ) : (
          <div className="grid gap-4" aria-busy="true">
            <div className="skeleton h-10 rounded-lg" />
            <div className="skeleton h-10 rounded-lg" />
          </div>
        )}
      </Section>

      <Section title="Offer text" hint="Printed on the festive offer and the reel.">
        <div className="grid gap-3">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-paper">Hindi</span>
            <input
              lang="hi"
              value={settings.offer.hindi}
              maxLength={40}
              onChange={(e) => onSettings({ ...settings, offer: { ...settings.offer, hindi: e.target.value } })}
              className="h-11 rounded-xl bg-stage-2 px-3.5 text-[0.95rem] text-paper ring-1 ring-line ring-inset focus:ring-marigold focus:outline-none"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-paper">English</span>
            <input
              value={settings.offer.english}
              maxLength={48}
              onChange={(e) => onSettings({ ...settings, offer: { ...settings.offer, english: e.target.value } })}
              className="h-11 rounded-xl bg-stage-2 px-3.5 text-[0.95rem] text-paper ring-1 ring-line ring-inset focus:ring-marigold focus:outline-none"
            />
          </label>
        </div>
      </Section>

      <Section title="Colour variants" hint={`Pick up to ${MAX_SWATCHES}. Each one recolours the product with generative AI.`}>
        <div className="flex flex-wrap gap-2.5" role="group" aria-label="Colour variants">
          {SWATCHES.map((s) => {
            const on = settings.swatches.includes(s.hex);
            const full = !on && settings.swatches.length >= MAX_SWATCHES;
            return (
              <button
                key={s.hex}
                type="button"
                aria-pressed={on}
                aria-label={s.name}
                title={full ? `You can pick up to ${MAX_SWATCHES}` : s.name}
                disabled={full}
                onClick={() => toggleSwatch(s.hex)}
                className={cn("grid size-10 place-items-center rounded-full ring-2 ring-offset-2 ring-offset-stage transition-shadow disabled:opacity-35", on ? "ring-marigold" : "ring-transparent hover:ring-line-strong")}
                style={{ background: `#${s.hex}` }}
              >
                {on ? <Check className="size-4 text-white" aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function nudge(v: number, pos: string, neg: string) {
  if (v === 0) return "Centred";
  return `${Math.abs(v)} px ${v > 0 ? pos : neg}`;
}

function Section({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-semibold tracking-[-0.01em] text-paper">{title}</h3>
          {hint ? <p className="mt-0.5 text-[0.82rem] text-dim">{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
