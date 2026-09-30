import { cva, type VariantProps } from "class-variance-authority";

/**
 * The button classes on their own (no Slot, no tailwind-merge), so a small client
 * island like the landing's phone button can style a plain <button> without
 * pulling the whole Button into the landing bundle. button.tsx re-exports this.
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap select-none transition-[background-color,color,box-shadow,transform,opacity] duration-200 ease-(--ease-out-quart) active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-marigold text-marigold-ink shadow-[0_10px_30px_-10px_rgb(245_165_36/0.6)] hover:bg-marigold-hi hover:shadow-[0_14px_36px_-10px_rgb(245_165_36/0.7)]",
        secondary: "bg-stage-2 text-paper ring-1 ring-line-strong ring-inset hover:bg-stage-3",
        ghost: "text-dim hover:bg-stage-2 hover:text-paper",
        danger: "bg-sindoor/15 text-sindoor ring-1 ring-sindoor/40 ring-inset hover:bg-sindoor/25",
      },
      size: {
        lg: "h-14 px-7 text-base [&_svg]:size-5",
        md: "h-11 px-5 text-[0.95rem] [&_svg]:size-[18px]",
        sm: "h-9 px-3.5 text-sm [&_svg]:size-4",
        icon: "size-9 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
