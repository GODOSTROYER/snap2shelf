"use client";

import * as S from "@radix-ui/react-slider";
import * as T from "@radix-ui/react-tooltip";
import * as React from "react";
import { cn } from "@/lib/client/util";

export const TooltipProvider = T.Provider;

export function Tip({ label, children, side = "top" }: { label: React.ReactNode; children: React.ReactElement; side?: T.TooltipContentProps["side"] }) {
  return (
    <T.Root delayDuration={250}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={8}
          className="z-[60] max-w-64 rounded-lg bg-paper px-3 py-2 text-[0.8rem] leading-snug font-medium text-studio shadow-[0_12px_30px_-8px_rgb(0_0_0/0.6)] data-[state=delayed-open]:animate-[fade-in_150ms_ease-out]"
        >
          {label}
          <T.Arrow className="fill-paper" />
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export function RangeField({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const id = React.useId();
  return (
    <div className={cn("grid gap-2.5", disabled && "opacity-50")}>
      <div className="flex items-baseline justify-between text-sm">
        <span id={id} className="font-medium text-paper">
          {label}
        </span>
        <span className="tabular text-dim">{display}</span>
      </div>
      <S.Root
        aria-labelledby={id}
        className="relative flex h-6 touch-none items-center select-none"
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(v) => onChange(v[0])}
      >
        <S.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-stage-3">
          <S.Range className="absolute h-full rounded-full bg-marigold" />
        </S.Track>
        <S.Thumb
          aria-valuetext={display}
          className="block size-5 rounded-full bg-paper shadow-[0_2px_10px_rgb(0_0_0/0.5)] ring-4 ring-marigold/0 transition-[box-shadow] hover:ring-marigold/25 focus-visible:ring-marigold/40 focus-visible:outline-none"
        />
      </S.Root>
    </div>
  );
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 rounded-xl py-1.5 text-left"
    >
      <span>
        <span className="block text-sm font-medium text-paper">{label}</span>
        {hint ? <span className="block text-[0.8rem] text-dim">{hint}</span> : null}
      </span>
      <span
        aria-hidden
        className={cn(
          "relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200",
          checked ? "bg-marigold" : "bg-stage-3",
        )}
      >
        <span
          className={cn(
            "absolute top-1 left-1 size-4 rounded-full bg-paper shadow transition-transform duration-200 ease-(--ease-out-expo)",
            checked && "translate-x-4",
          )}
        />
      </span>
    </button>
  );
}

export function Segmented<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium text-paper">{label}</span>
      <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-full bg-stage-2 p-1 ring-1 ring-line ring-inset">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-8 rounded-full text-sm font-medium transition-colors",
              value === o.value ? "bg-paper text-studio" : "text-dim hover:text-paper",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
