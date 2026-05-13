import type { NextConfig } from "next";
import path from "path";

// Anchor tracing + tooling to the actual ShadowBid repo so Next does not pick a
// random parent lockfile (e.g. ~/package-lock.json) as the workspace root.
const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, ".."),
  webpack: (config, { dev }) => {
    // Avoid MODULE_NOT_FOUND for numbered chunks (e.g. ./231.js) when the
    // persistent cache points at files removed by concurrent writes / HMR.
    if (dev) {
      config.cache = false;
    }
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      os: false,
      path: false,
      crypto: false,
    };
    return config;
  },
};

export default nextConfig;
