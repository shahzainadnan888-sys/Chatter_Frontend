import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

/**
 * The packaged desktop build is loaded over file://, so exported assets need
 * relative URLs. The dev server is served over http and must keep absolute ones.
 */
export default function config(phase: string): NextConfig {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    output: "export",
    assetPrefix: isDev ? undefined : "./",
    images: {
      unoptimized: true,
    },
  };
}
