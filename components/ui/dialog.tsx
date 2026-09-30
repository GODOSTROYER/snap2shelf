"use client";

import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/client/util";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

const overlay =
  "fixed inset-0 z-50 bg-[rgb(10_8_6/0.72)] backdrop-blur-[6px] data-[state=open]:animate-[fade-in_200ms_ease-out] data-[state=closed]:animate-[fade-out_150ms_ease-in]";

/** Centred dialog (bottom sheet on phones). */
export function DialogContent({
  className,
  children,
  title,
  description,
  ...props
}: React.ComponentProps<typeof D.Content> & { title: string; description?: React.ReactNode }) {
  return (
    <D.Portal>
      <D.Overlay className={overlay} />
      <D.Content
        className={cn(
          "fixed z-50 flex max-h-[92dvh] flex-col overflow-y-auto bg-stage text-paper shadow-[0_40px_80px_-20px_rgb(0_0_0/0.8)] ring-1 ring-line-strong",
          "inset-x-0 bottom-0 rounded-t-3xl p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] data-[state=open]:animate-[sheet-up_320ms_var(--ease-out-expo)]",
          "sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-[min(30rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:p-8 sm:data-[state=open]:animate-[pop-in_260ms_var(--ease-out-expo)]",
          className,
        )}
        {...props}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <D.Title className="font-display text-2xl leading-tight font-bold tracking-[-0.02em]">{title}</D.Title>
            {description ? <D.Description className="mt-1.5 text-[0.95rem] text-dim">{description}</D.Description> : null}
          </div>
          <D.Close className="-mt-1 -mr-2 grid size-10 place-items-center rounded-full text-dim transition-colors hover:bg-stage-2 hover:text-paper" aria-label="Close">
            <X className="size-5" />
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}

/** Side panel on desktop, bottom sheet on phones. */
export function SheetContent({
  className,
  children,
  title,
  description,
  ...props
}: React.ComponentProps<typeof D.Content> & { title: string; description?: React.ReactNode }) {
  return (
    <D.Portal>
      <D.Overlay className={overlay} />
      <D.Content
        className={cn(
          "fixed z-50 flex flex-col bg-stage text-paper shadow-[0_40px_80px_-20px_rgb(0_0_0/0.8)] ring-1 ring-line-strong",
          "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-3xl data-[state=open]:animate-[sheet-up_320ms_var(--ease-out-expo)]",
          "md:inset-y-3 md:right-3 md:left-auto md:max-h-none md:w-[min(34rem,calc(100vw-1.5rem))] md:rounded-2xl md:data-[state=open]:animate-[sheet-left_320ms_var(--ease-out-expo)]",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 pt-6 pb-5">
          <div className="min-w-0">
            <D.Title className="font-display text-xl leading-tight font-bold tracking-[-0.02em]">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-sm text-dim">{description}</D.Description> : null}
          </div>
          <D.Close className="-mt-1 -mr-2 grid size-10 shrink-0 place-items-center rounded-full text-dim transition-colors hover:bg-stage-2 hover:text-paper" aria-label="Close">
            <X className="size-5" />
          </D.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
