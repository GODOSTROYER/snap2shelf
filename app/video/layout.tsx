import type { Metadata, Viewport } from "next";
import { presentFontVars } from "@/components/present/fonts";
import "@/components/present/present.css";

export const metadata: Metadata = {
  title: { absolute: "Snap2Shelf · Video cards" },
  robots: { index: false },
};

export const viewport: Viewport = {
  themeColor: "#0e0c0a",
  colorScheme: "dark",
};

export default function VideoLayout({ children }: { children: React.ReactNode }) {
  return <div className={`pz ${presentFontVars}`}>{children}</div>;
}
