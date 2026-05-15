"use client";

import dynamic from "next/dynamic";

// HeroShowcase pulls in three.js, @react-three/fiber, and drei —
// ~200-400KB gzipped of dependencies whose only audience is the anon
// home page (authed users redirect to /u/[username] before this ever
// renders). Loading them lazily moves the bulk of the canvas chunk
// off the critical path so the rest of the marketing hero —
// wordmark, search bar, upload CTA — paints sooner.
//
// next/dynamic with `ssr: false` is the supported path in Next 16 and
// is only legal inside a Client Component (server components can't
// disable SSR). The wrapper exists for exactly that reason; do not
// inline this back into a server component.
//
// The fallback reserves the same vertical footprint as the canvas +
// material carousel so the page doesn't shift when the chunk arrives.
export const HeroShowcase = dynamic(
  () => import("./hero-showcase").then((m) => m.HeroShowcase),
  {
    ssr: false,
    loading: () => (
      <div
        className="flex w-full flex-col items-center gap-1"
        aria-hidden
      >
        <div className="relative -mx-4 w-[100vw] h-[300px] sm:mx-0 sm:w-full sm:h-[480px]" />
        <div className="h-9 w-full max-w-[420px] mx-auto" />
      </div>
    ),
  }
);
