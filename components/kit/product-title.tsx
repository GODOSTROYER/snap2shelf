import { cn } from "@/lib/client/util";
import { nameParts } from "@/lib/showcase";

/**
 * A product name for a heading. A qualified name ("Steel bottle, cluttered-counter
 * photo") sets its qualifier as a quieter second line; the text still reads as the
 * whole name. Server-safe.
 */
export function ProductTitle({ name, qualifierClassName }: { name: string; qualifierClassName?: string }) {
  const [main, qualifier] = nameParts(name);
  return (
    <>
      {main}
      {qualifier ? (
        <>
          <span className="sr-only">, </span>
          <span className={cn("block font-semibold tracking-[-0.01em] text-dim", qualifierClassName)}>{qualifier}</span>
        </>
      ) : null}
    </>
  );
}
