import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Snap2Shelf",
  description: "One photo. A whole shelf. AI builds the stage — your product stays real.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
