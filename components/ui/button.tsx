import { Slot } from "@radix-ui/react-slot";
import * as React from "react";
import { cn } from "@/lib/client/util";
import { buttonVariants, type ButtonVariantProps } from "./button-variants";

export { buttonVariants };

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, ButtonVariantProps {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} type={asChild ? undefined : (type ?? "button")} {...props} />;
}
