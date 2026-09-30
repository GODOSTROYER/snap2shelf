"use client";

import * as T from "@radix-ui/react-tooltip";
import type * as React from "react";

/*
 * Tooltips on their own module (controls.tsx re-exports them): the kit page only
 * needs these, and importing controls pulled the Radix slider into its bundle.
 */
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
