"use client";

import { Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RangeField, Segmented, Toggle } from "@/components/ui/controls";
import { isWholeRecolor, MAX_SWATCHES, SWATCHES } from "@/lib/client/swatches";
import { cn } from "@/lib/client/util";
import { OFFSET_RANGE, SCALE_RANGE } from "@/lib/transform/composite";
import type { CompositeControls, Placement, ProductRecord, Scene, SceneDNA } from "@/lib/types";
import { ScenePicker } from "./scene-picker";

export interface PackSettings {
  offer: { hindi: string; english: string };
  swatches: string[];
  /** Where the offer text goes (a readiness fix can move it); default: the scene's own text zone. */
  textZone?: SceneDNA["text_zone"];
}

/** Exact mode: scene, placement sliders, shadows, and what goes into the pack. */
export function CompositePanel({
  scenes,
  sceneId,
  onScene,
  controls,
  onControls,
  onReset,
  product,
  placement,
  settings,
  onSettings,
  disabled,
  top,
  sceneExtra,
  recolor = true,
}: {
  scenes: Scene[] | null;
  sceneId: string | null;
  onScene: (s: Scene) => void;
  controls: CompositeControls | null;
  onControls: (c: CompositeControls) => void;
  onReset: () => void;
  product?: ProductRecord | null;
  placement: Placement;
  settings: PackSettings;
  onSettings: (s: PackSettings) => void;
  disabled?: boolean;
  /** Above the scene: the brief bar. */
  top?: React.ReactNode;
  /** Under the scene picker: find or generate another backdrop. */
  sceneExtra?: React.ReactNode;
  /** false: this product gets no colour variants (printed packaging). */
  recolor?: boolean;
}) {
  const set = <K extends keyof CompositeControls>(k: K, v: CompositeControls[K]) => controls && onControls({ ...controls, [k]: v });
  const whole = isWholeRecolor(product?.understanding);
  const part = product?.understanding?.recolorable_part?.toLowerCase() || "product";
  const toggleSwatch = (hex: string) => {
    const has = settings.swatches.includes(hex);
    if (!has && settings.swatches.length >= MAX_SWATCHES) return;
    onSettings({ ...settings, swatches: has ? settings.swatches.filter((h) => h !== hex) : [...settings.swatches, hex] });
  };

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-8">
      {top}
      <Section title="Scene" hint="Ready-made and reused, so they cost no generation credits.">
        <ScenePicker scenes={scenes} selected={sceneId} onSelect={onScene} disabled={disabled} />
        {sceneExtra}
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
            <RangeField label="Size" min={SCALE_RANGE.min} max={SCALE_RANGE.max} step={SCALE_RANGE.step} value={controls.scale} display={`${Math.round(controls.scale * 100)}% of the frame`} onChange={(v) => set("scale", v)} disabled={disabled} />
            <RangeField label="Left and right" min={OFFSET_RANGE.min} max={OFFSET_RANGE.max} step={OFFSET_RANGE.step} value={controls.offsetX} display={nudge(controls.offsetX, "right", "left")} onChange={(v) => set("offsetX", v)} disabled={disabled} />
            <RangeField label="Up and down" min={OFFSET_RANGE.min} max={OFFSET_RANGE.max} step={OFFSET_RANGE.step} value={controls.offsetY} display={nudge(controls.offsetY, "down", "up")} onChange={(v) => set("offsetY", v)} disabled={disabled} />
            <div className="grid gap-1">
              <Toggle label={placement === "flatlay" ? "Lift shadow" : "Cast shadow"} hint={placement === "flatlay" ? "A soft shadow as if it rests on the cloth" : "Falls away from the scene's light"} checked={controls.shadow} onChange={(v) => set("shadow", v)} disabled={disabled} />
              {placement !== "flatlay" ? <Toggle label="Contact shadow" hint="Grounds the product on the surface" checked={controls.contact} onChange={(v) => set("contact", v)} disabled={disabled} /> : null}
              <Toggle label="Light-match" hint="Tints your product toward the scene's light, colours kept true" checked={controls.harmonise} onChange={(v) => set("harmonise", v)} disabled={disabled} />
            </div>
            {placement !== "flatlay" ? (
              <Segmented
                label="Reflection"
                disabled={disabled}
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

      <Section title="Offer text" hint="Printed on the festive offer and across the reel.">
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
              maxLength={40}
              onChange={(e) => onSettings({ ...settings, offer: { ...settings.offer, english: e.target.value } })}
              className="h-11 rounded-xl bg-stage-2 px-3.5 text-[0.95rem] text-paper ring-1 ring-line ring-inset focus:ring-marigold focus:outline-none"
            />
          </label>
        </div>
      </Section>

      {recolor ? (
      <Section
        title={whole ? "Colourways" : "Colour variants"}
        hint={
          whole
            ? `Pick up to ${MAX_SWATCHES}. Generative recolor repaints the whole shoe in each colour.`
            : `Pick up to ${MAX_SWATCHES}. Generative recolor repaints only the ${part}, shading kept.`
        }
      >
        <div className="flex flex-wrap gap-2.5" role="group" aria-label={whole ? "Colourways" : "Colour variants"}>
          {[...SWATCHES, ...settings.swatches.filter((h) => !SWATCHES.some((s) => s.hex === h)).map((hex) => ({ hex, name: `Brief colour #${hex}` }))].map((s) => {
            const on = settings.swatches.includes(s.hex);
            const full = !on && settings.swatches.length >= MAX_SWATCHES;
            return (
              <button
                key={s.hex}
                type="button"
                aria-pressed={on}
                aria-label={s.name}
                title={full ? `You can pick up to ${MAX_SWATCHES}` : s.name}
                disabled={full || disabled}
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
      ) : null}
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
