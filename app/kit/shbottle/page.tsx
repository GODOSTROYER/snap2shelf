import { KitPage, kitMetadata } from "../kit-page";

/** A sample kit: prerendered at build, served as static HTML (app/kit/kit-page.tsx). */
export const generateMetadata = () => kitMetadata("shbottle");

export default function SampleKitPage() {
  return <KitPage sku="shbottle" />;
}
