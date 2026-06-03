"use client";

import dynamic from "next/dynamic";

/**
 * three.js + fiber + drei are ~200-400KB gzipped and only the anon
 * home renders them (authed users redirect away before this mounts), so
 * the scene canvas is loaded lazily and client-only. ssr:false is only
 * legal inside a Client Component — this wrapper exists for that. The
 * surrounding HTML sections SSR normally for crawlers; only the canvas
 * is deferred.
 */
export const HomeScene = dynamic(
  () => import("./home-scene").then((m) => m.HomeScene),
  { ssr: false }
);
