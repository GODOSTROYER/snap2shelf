import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Analytics: Mark this project as created via create-cloudinary-next CLI
    CLOUDINARY_SOURCE: "cli",
  },
};

export default nextConfig;
