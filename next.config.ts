import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit .next/standalone with a self-contained server.js and only the
  // node_modules actually used, which is what the Dockerfile ships.
  // Vercel packages the app itself and its build never writes the
  // whole-server trace the standalone step copies from, so skip it there.
  output: process.env.VERCEL ? undefined : "standalone",
};

export default nextConfig;
