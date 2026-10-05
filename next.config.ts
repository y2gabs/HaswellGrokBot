import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the VPS (see deploy/).
  output: "standalone",
  poweredByHeader: false,
};

export default nextConfig;
