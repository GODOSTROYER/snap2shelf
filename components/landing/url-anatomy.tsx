import { PeelUrl } from "@/components/landing/url/peel-url";
import type { BuiltUrl } from "@/lib/types";

/**
 * A real transformation URL, colour-coded, with the picture it renders beside
 * it and a plain-language key. Each colour peels its part out of the URL and
 * the picture re-renders from what is left (components/landing/url/).
 */
export function UrlAnatomy({ built, note, alt }: { built: BuiltUrl; note?: React.ReactNode; alt?: string }) {
  return <PeelUrl built={built} note={note} alt={alt} />;
}
