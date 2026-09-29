import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cloudinary Next.js Starter Kit",
  description: "A ready-to-use development environment with Cloudinary integration.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
