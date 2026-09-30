import type { NextConfig } from "next";

/**
 * Baseline security headers for every route. No Content-Security-Policy yet: a
 * correct one needs per-request nonces for Next's inline scripts plus the Upload
 * Widget's script, iframe and API origins, and a wrong one breaks uploads.
 * The camera is not restricted: the Upload Widget's camera source runs in its iframe.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  env: {
    // Analytics: Mark this project as created via create-cloudinary-next CLI
    CLOUDINARY_SOURCE: "cli",
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
