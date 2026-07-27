import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse and mammoth resolve files at runtime, which makes the bundler
  // trace the whole project. Loading them from node_modules at runtime instead
  // of bundling them keeps the trace clean.
  serverExternalPackages: ["pdf-parse", "mammoth"],
};

export default nextConfig;
