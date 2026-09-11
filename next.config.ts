import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit .next/standalone with a self-contained server.js and only the
  // node_modules actually used, which is what the Dockerfile ships.
  output: "standalone",
};

export default nextConfig;
