import type { Metadata } from "next";
import { KitPage, kitMetadata } from "../kit-page";

/** A live kit (anything without a static folder next to this one): rendered on request. */
type Props = { params: Promise<{ sku: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return kitMetadata((await params).sku);
}

export default async function LiveKitPage({ params }: Props) {
  return <KitPage sku={(await params).sku} />;
}
