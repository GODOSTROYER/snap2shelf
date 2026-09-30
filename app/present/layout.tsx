import type { Metadata, Viewport } from "next";
import { presentFontVars } from "@/components/present/fonts";
import "@/components/present/present.css";

export const metadata: Metadata = {
  title: { absolute: "Snap2Shelf · Director's cut" },
  description: "A keyboard-driven walkthrough of Snap2Shelf: one photo becomes a whole shelf, built on Cloudinary.",
  robots: { index: false },
};

export const viewport: Viewport = {
  themeColor: "#0e0c0a",
  colorScheme: "dark",
};

export default function PresentLayout({ children }: { children: React.ReactNode }) {
  return <div className={`pz ${presentFontVars}`}>{children}</div>;
}
